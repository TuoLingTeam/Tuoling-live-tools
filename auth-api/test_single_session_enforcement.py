import os
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_single_session.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-single-session-secret-32-byte-key"
os.environ["SMS_MODE"] = "dev"

from database import create_tables, engine  # noqa: E402
from deps import create_access_token  # noqa: E402
from main import app  # noqa: E402
from models import SMSCode  # noqa: E402
from database import SessionLocal  # noqa: E402


class SingleSessionEnforcementTests(unittest.TestCase):
    def setUp(self):
        with engine.begin() as conn:
            for table in (
                "user_configs",
                "feedbacks",
                "gift_card_redemptions",
                "gift_cards",
                "audit_logs",
                "sms_verify_failures",
                "subscriptions",
                "refresh_tokens",
                "sms_codes",
                "trials",
                "users",
            ):
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        create_tables()
        self.client = TestClient(app)

    def _auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def _register(self, username: str, password: str) -> dict:
        response = self.client.post("/register", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _login(self, username: str, password: str) -> dict:
        response = self.client.post("/login", json={"username": username, "password": password})
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

    def test_password_login_revokes_previous_session(self):
        password = "secret123"
        register_data = self._register("single@example.com", password)
        old_access_token = register_data["access_token"]

        before_status = self.client.get("/status", headers=self._auth_headers(old_access_token))
        self.assertEqual(before_status.status_code, 200, before_status.text)

        login_data = self._login("single@example.com", password)
        new_access_token = login_data["access_token"]
        new_refresh_token = login_data["refresh_token"]

        kicked_status = self.client.get("/status", headers=self._auth_headers(old_access_token))
        self.assertEqual(kicked_status.status_code, 401, kicked_status.text)
        self.assertEqual(kicked_status.json()["detail"]["code"], "kicked_out")

        kicked_me = self.client.get("/me", headers=self._auth_headers(old_access_token))
        self.assertEqual(kicked_me.status_code, 401, kicked_me.text)
        self.assertEqual(kicked_me.json()["detail"]["code"], "kicked_out")

        active_status = self.client.get("/status", headers=self._auth_headers(new_access_token))
        self.assertEqual(active_status.status_code, 200, active_status.text)

        active_refresh = self.client.post("/refresh", json={"refresh_token": new_refresh_token})
        self.assertEqual(active_refresh.status_code, 200, active_refresh.text)

    def test_sms_login_revokes_previous_session(self):
        phone = "13800000001"

        self._insert_sms_code(phone, "111111")
        first_login = self.client.post(f"/auth/sms/login?phone={phone}&code=111111")
        self.assertEqual(first_login.status_code, 200, first_login.text)
        first_access_token = first_login.json()["token"]

        self._insert_sms_code(phone, "222222")
        second_login = self.client.post(f"/auth/sms/login?phone={phone}&code=222222")
        self.assertEqual(second_login.status_code, 200, second_login.text)
        second_login_body = second_login.json()
        second_access_token = second_login_body["token"]

        self.assertNotEqual(first_login.json()["refresh_token"], second_login_body["refresh_token"])

        kicked_status = self.client.get("/status", headers=self._auth_headers(first_access_token))
        self.assertEqual(kicked_status.status_code, 401, kicked_status.text)
        self.assertEqual(kicked_status.json()["detail"]["code"], "kicked_out")

        active_status = self.client.get("/status", headers=self._auth_headers(second_access_token))
        self.assertEqual(active_status.status_code, 200, active_status.text)

        active_refresh = self.client.post(
            "/refresh",
            json={"refresh_token": second_login_body["refresh_token"]},
        )
        self.assertEqual(active_refresh.status_code, 200, active_refresh.text)

    def test_legacy_access_token_without_jti_is_rejected(self):
        register_data = self._register("legacy@example.com", "secret123")
        user_id = register_data["user"]["id"]
        legacy_token = create_access_token(user_id)

        legacy_status = self.client.get("/status", headers=self._auth_headers(legacy_token))
        self.assertEqual(legacy_status.status_code, 401, legacy_status.text)
        self.assertEqual(legacy_status.json()["detail"]["code"], "token_invalid")

        legacy_me = self.client.get("/me", headers=self._auth_headers(legacy_token))
        self.assertEqual(legacy_me.status_code, 401, legacy_me.text)
        self.assertEqual(legacy_me.json()["detail"]["code"], "token_invalid")


if __name__ == "__main__":
    unittest.main()
