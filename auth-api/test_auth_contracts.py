import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_auth_contracts.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-auth-contracts-secret-32-byte-key"
os.environ["SMS_MODE"] = "test"

from database import SessionLocal, create_tables, engine  # noqa: E402
from main import app  # noqa: E402
from models import SMSCode  # noqa: E402


class _FailingSmsService:
    mode = "aliyun"

    async def send(self, phone: str, code: str):
        return False, f"vendor detail for {phone}:{code}"

    def verify(self, phone: str, code: str):
        return False, "invalid_code"


class _VerifyUnavailableSmsService:
    mode = "aliyun_dypns"

    async def send(self, phone: str, code: str):
        return True, None

    def verify(self, phone: str, code: str):
        return False, "service_unavailable"


class AuthContractTests(unittest.TestCase):
    def setUp(self):
        with engine.begin() as conn:
            for table in (
                "user_configs",
                "feedbacks",
                "gift_card_redemptions",
                "gift_cards",
                "audit_logs",
                "subscriptions",
                "refresh_tokens",
                "sms_codes",
                "trials",
                "users",
            ):
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        create_tables()
        self.client = TestClient(app)

    def _register(self, username: str, password: str) -> dict:
        response = self.client.post("/register", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _insert_sms_code(self, phone: str, code: str) -> None:
        db = SessionLocal()
        try:
            db.add(
                SMSCode(
                    phone=phone,
                    code=code,
                    expire_at=2_000_000_000,
                    created_at=1_900_000_000,
                    used=0,
                    date_str="20990101",
                )
            )
            db.commit()
        finally:
            db.close()

    def _auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def _sms_login(self, phone: str, code: str) -> dict:
        response = self.client.post("/auth/sms/login", json={"phone": phone, "code": code})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_register_rejects_short_password(self):
        response = self.client.post(
            "/register",
            json={"username": "short-pass@example.com", "password": "1234567"},
        )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("String should have at least 8 characters", response.text)

    def test_password_register_and_login_return_both_token_fields(self):
        register_data = self._register("contract@example.com", "secret123")
        self.assertEqual(register_data["access_token"], register_data["token"])
        self.assertTrue(register_data["refresh_token"])

        login_response = self.client.post(
            "/login",
            json={"username": "contract@example.com", "password": "secret123"},
        )
        self.assertEqual(login_response.status_code, 200, login_response.text)
        login_data = login_response.json()
        self.assertEqual(login_data["access_token"], login_data["token"])
        self.assertTrue(login_data["refresh_token"])

    def test_sms_login_returns_both_token_fields(self):
        phone = "13800000009"
        self._insert_sms_code(phone, "123456")

        response = self.client.post("/auth/sms/login", json={"phone": phone, "code": "123456"})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()

        self.assertEqual(data["access_token"], data["token"])
        self.assertTrue(data["refresh_token"])

    def test_sms_login_accepts_normalized_code_input(self):
        phone = "13800000019"
        self._insert_sms_code(phone, "123456")

        response = self.client.post("/auth/sms/login", json={"phone": f" {phone} ", "code": " 123456 "})
        self.assertEqual(response.status_code, 200, response.text)

    def test_sms_verify_service_error_is_not_reported_as_invalid_code(self):
        phone = "13800000020"
        with patch("routers.sms.get_sms_service", return_value=_VerifyUnavailableSmsService()):
            response = self.client.post("/auth/sms/login", json={"phone": phone, "code": "123456"})

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(
            response.json()["detail"],
            {"code": "sms_verify_failed", "message": "短信验证码校验服务异常，请稍后重试"},
        )

    def test_sms_errors_are_structured_and_do_not_expose_vendor_details(self):
        invalid_phone = self.client.post("/auth/sms/send", json={"phone": "123"})
        self.assertEqual(invalid_phone.status_code, 422, invalid_phone.text)
        self.assertEqual(
            invalid_phone.json()["detail"],
            {"code": "phone_format_error", "message": "手机号格式不正确"},
        )

        with patch("routers.sms.get_sms_service", return_value=_FailingSmsService()):
            failed_send = self.client.post("/auth/sms/send", json={"phone": "13800000010"})

        self.assertEqual(failed_send.status_code, 500, failed_send.text)
        self.assertEqual(
            failed_send.json()["detail"],
            {"code": "sms_send_failed", "message": "短信发送失败"},
        )
        self.assertNotIn("vendor detail", failed_send.text)

        invalid_code = self.client.post(
            "/auth/sms/login",
            json={"phone": "13800000010", "code": "999999"},
        )
        self.assertEqual(invalid_code.status_code, 400, invalid_code.text)
        self.assertEqual(
            invalid_code.json()["detail"],
            {"code": "sms_code_invalid", "message": "验证码错误或已过期"},
        )

    def test_trial_start_supports_sqlite_upsert(self):
        register_data = self._register("trial-user@example.com", "secret123")
        access_token = register_data["access_token"]

        response = self.client.post(
            "/trial/start",
            json={"username": "trial-user@example.com"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()

        self.assertTrue(data["success"])
        self.assertIn("start_ts", data)
        self.assertIn("end_ts", data)

    def test_status_reports_has_password_for_password_registered_user(self):
        register_data = self._register("status-user@example.com", "secret123")

        response = self.client.get(
            "/status",
            headers={"Authorization": f"Bearer {register_data['access_token']}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["has_password"])

    def test_status_reports_no_password_for_sms_auto_created_user(self):
        phone = "13800000011"
        self._insert_sms_code(phone, "654321")

        login_response = self.client.post("/auth/sms/login", json={"phone": phone, "code": "654321"})
        self.assertEqual(login_response.status_code, 200, login_response.text)
        access_token = login_response.json()["access_token"]

        status_response = self.client.get(
            "/status",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        self.assertFalse(status_response.json()["has_password"])

    def test_set_password_rejects_short_password_and_accepts_eight_chars(self):
        phone = "13800000012"
        self._insert_sms_code(phone, "123456")
        login_data = self._sms_login(phone, "123456")
        headers = self._auth_headers(login_data["access_token"])

        short_response = self.client.post(
            "/set-password",
            json={"password": "1234567"},
            headers=headers,
        )
        self.assertEqual(short_response.status_code, 422, short_response.text)

        success_response = self.client.post(
            "/set-password",
            json={"password": "Pass1234"},
            headers=headers,
        )
        self.assertEqual(success_response.status_code, 200, success_response.text)
        self.assertEqual(success_response.json(), {"ok": True, "message": "密码设置成功"})

    def test_change_password_rejects_short_new_password(self):
        register_data = self._register("change-pass@example.com", "secret123")
        headers = self._auth_headers(register_data["access_token"])

        response = self.client.post(
            "/change-password",
            json={"old_password": "secret123", "new_password": "1234567"},
            headers=headers,
        )

        self.assertEqual(response.status_code, 422, response.text)

    def test_sms_reset_password_rejects_short_new_password(self):
        phone = "13800000013"
        self._insert_sms_code(phone, "111111")
        self._sms_login(phone, "111111")
        self._insert_sms_code(phone, "222222")

        response = self.client.post(
            "/auth/sms/reset-password",
            json={"phone": phone, "code": "222222", "new_password": "1234567"},
        )

        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
