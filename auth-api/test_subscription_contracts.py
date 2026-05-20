import os
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_subscription_contracts.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-subscription-contracts-secret-32-byte-key"
os.environ["SMS_MODE"] = "dev"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "super-secret-admin"

from database import SessionLocal, create_tables, engine  # noqa: E402
from main import app  # noqa: E402
from models import GiftCard, GiftCardRedemption, Subscription, User  # noqa: E402
from config import settings  # noqa: E402
from routers.subscription import get_current_user  # noqa: E402


class SubscriptionContractTests(unittest.TestCase):
    def setUp(self):
        settings.ADMIN_USERNAME = os.environ["ADMIN_USERNAME"]
        settings.ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
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

    def _register(self, username: str, password: str) -> dict:
        response = self.client.post("/register", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def _admin_headers(self) -> dict[str, str]:
        response = self.client.post(
            "/admin/login",
            json={"username": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def test_subscription_status_forbidden_error_is_structured(self):
        register_data = self._register("subscription@example.com", "secret123")

        response = self.client.get(
            "/subscription/status?username=other@example.com",
            headers=self._auth_headers(register_data["access_token"]),
        )

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(
            response.json()["detail"],
            {"code": "forbidden", "message": "无权查询其他用户状态"},
        )

    def test_subscription_status_user_not_found_error_is_structured(self):
        class _MissingUser:
            email = "missing@example.com"
            phone = None
            id = "missing-user-id"

        app.dependency_overrides[get_current_user] = lambda: _MissingUser()
        try:
            response = self.client.get("/subscription/status?username=missing@example.com")

            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(
                response.json()["detail"],
                {"code": "user_not_found", "message": "用户不存在"},
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_subscription_status_uses_user_id_and_normalizes_datetime_period_end(self):
        register_data = self._register("paid@example.com", "secret123")
        user_id = register_data["user"]["id"]
        db = SessionLocal()
        try:
            subscription = db.query(Subscription).filter(Subscription.user_id == user_id).first()
            self.assertIsNotNone(subscription)
            subscription.plan = "pro_max"
            subscription.status = "active"
            subscription.current_period_end = datetime.utcnow() + timedelta(days=7)
            db.commit()
        finally:
            db.close()

        response = self.client.get(
            "/subscription/status?username=paid@example.com",
            headers=self._auth_headers(register_data["access_token"]),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["plan"], "pro_max")
        self.assertEqual(body["username"], "paid@example.com")
        self.assertIsInstance(body["current_period_end"], int)
        self.assertFalse(body["expired"])

    def test_gift_card_redeem_rejects_cards_without_expiring_duration(self):
        register_data = self._register("giftcard@example.com", "secret123")
        db = SessionLocal()
        try:
            db.add(
                GiftCard(
                    id=str(uuid.uuid4()),
                    code="ABCD-EFGH-JKLM",
                    tier="pro",
                    benefits_json={"plan": "pro", "max_accounts": 1, "duration_days": None},
                    membership_type="pro",
                    membership_days=0,
                    status="active",
                )
            )
            db.commit()
        finally:
            db.close()

        response = self.client.post(
            "/gift-card/redeem",
            json={"code": "ABCD-EFGH-JKLM"},
            headers=self._auth_headers(register_data["access_token"]),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "INVALID_CARD_CONFIG")
        self.assertEqual(body["message"], "礼品卡配置无效，请联系客服处理")

    def test_admin_create_gift_cards_skips_existing_code_conflicts(self):
        db = SessionLocal()
        try:
            db.add(
                GiftCard(
                    id=str(uuid.uuid4()),
                    code="DUPL-DUPL-DUPL",
                    tier="pro",
                    benefits_json={"plan": "pro", "max_accounts": 1, "duration_days": 3},
                    membership_type="pro",
                    membership_days=3,
                    status="active",
                )
            )
            db.commit()
        finally:
            db.close()

        generated_codes = [
            "DUPL-DUPL-DUPL",
            "NEWA-AAAA-AAAA",
            "NEWB-BBBB-BBBB",
            "NEWC-CCCC-CCCC",
            "NEWD-DDDD-DDDD",
            "NEWE-EEEE-EEEE",
            "NEWF-FFFF-FFFF",
            "NEWG-GGGG-GGGG",
        ]
        with patch("routers.gift_card._generate_code", side_effect=generated_codes):
            response = self.client.post(
                "/admin/gift-cards",
                json={"tier": "pro", "membership_days": 3, "quantity": 2},
                headers=self._admin_headers(),
            )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["count"], 2)
        codes = {card["code"] for card in body["cards"]}
        self.assertEqual(codes, {"NEWA-AAAA-AAAA", "NEWB-BBBB-BBBB"})

    def test_admin_gift_card_batch_actions_preserve_behavior(self):
        active_card_id = str(uuid.uuid4())
        second_active_card_id = str(uuid.uuid4())
        redeemed_card_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            db.add_all(
                [
                    GiftCard(
                        id=active_card_id,
                        code="ACTV-AAAA-AAAA",
                        tier="pro",
                        benefits_json={"plan": "pro", "max_accounts": 1, "duration_days": 3},
                        membership_type="pro",
                        membership_days=3,
                        status="active",
                    ),
                    GiftCard(
                        id=second_active_card_id,
                        code="ACTV-BBBB-BBBB",
                        tier="pro",
                        benefits_json={"plan": "pro", "max_accounts": 1, "duration_days": 3},
                        membership_type="pro",
                        membership_days=3,
                        status="active",
                    ),
                    GiftCard(
                        id=redeemed_card_id,
                        code="REDM-CCCC-CCCC",
                        tier="pro",
                        benefits_json={"plan": "pro", "max_accounts": 1, "duration_days": 3},
                        membership_type="pro",
                        membership_days=3,
                        status="redeemed",
                    ),
                ]
            )
            db.add(
                GiftCardRedemption(
                    id=str(uuid.uuid4()),
                    gift_card_id=active_card_id,
                    user_id="stray-user",
                )
            )
            db.add(
                GiftCardRedemption(
                    id=str(uuid.uuid4()),
                    gift_card_id=redeemed_card_id,
                    user_id="redeemed-user",
                )
            )
            db.commit()
        finally:
            db.close()

        disable_response = self.client.post(
            "/admin/gift-cards/batch-disable",
            json={"card_ids": [active_card_id, second_active_card_id, redeemed_card_id, active_card_id, "missing"]},
            headers=self._admin_headers(),
        )

        self.assertEqual(disable_response.status_code, 200, disable_response.text)
        self.assertEqual(disable_response.json()["affected"], 2)

        delete_response = self.client.post(
            "/admin/gift-cards/batch-delete",
            json={"card_ids": [active_card_id, second_active_card_id, redeemed_card_id, active_card_id, "missing"]},
            headers=self._admin_headers(),
        )

        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        delete_body = delete_response.json()
        self.assertEqual(delete_body["deleted"], 2)
        self.assertEqual(delete_body["skipped_redeemed"], 1)

        db = SessionLocal()
        try:
            self.assertIsNone(db.query(GiftCard).filter(GiftCard.id == active_card_id).first())
            self.assertIsNone(db.query(GiftCard).filter(GiftCard.id == second_active_card_id).first())
            self.assertIsNotNone(db.query(GiftCard).filter(GiftCard.id == redeemed_card_id).first())
            self.assertIsNone(
                db.query(GiftCardRedemption)
                .filter(GiftCardRedemption.gift_card_id == active_card_id)
                .first()
            )
            self.assertIsNotNone(
                db.query(GiftCardRedemption)
                .filter(GiftCardRedemption.gift_card_id == redeemed_card_id)
                .first()
            )
        finally:
            db.close()

    def test_admin_users_paginates_after_membership_filtering(self):
        db = SessionLocal()
        try:
            for index in range(5):
                user_id = str(uuid.uuid4())
                user = User(
                    id=user_id,
                    username=f"user{index}@example.com",
                    email=f"user{index}@example.com",
                    password_hash="hashed_password",
                    plan="trial",
                )
                db.add(user)
                db.flush()
                if index < 3:
                    db.add(
                        Subscription(
                            id=str(uuid.uuid4()),
                            user_id=user_id,
                            plan="pro_max",
                            status="active",
                            current_period_end=datetime.utcnow() + timedelta(days=7),
                        )
                    )
            db.commit()
        finally:
            db.close()

        response = self.client.get(
            "/admin/users?page=2&size=2&membership=pro_max",
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["total"], 3)
        self.assertEqual(body["page"], 2)
        self.assertEqual(body["size"], 2)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["membership_status"], "pro_max")

    def test_admin_users_membership_trial_and_expired_filters_are_sql_compatible(self):
        db = SessionLocal()
        try:
            active_trial_user = User(
                id=str(uuid.uuid4()),
                username="active-trial@example.com",
                email="active-trial@example.com",
                password_hash="hashed_password",
                plan="trial",
            )
            expired_trial_user = User(
                id=str(uuid.uuid4()),
                username="expired-trial@example.com",
                email="expired-trial@example.com",
                password_hash="hashed_password",
                plan="trial",
            )
            no_history_user = User(
                id=str(uuid.uuid4()),
                username="no-history@example.com",
                email="no-history@example.com",
                password_hash="hashed_password",
                plan="trial",
            )
            db.add_all([active_trial_user, expired_trial_user, no_history_user])
            db.flush()

            now_ts = int(datetime.utcnow().timestamp())
            db.execute(
                text(
                    "INSERT INTO trials (username, start_ts, end_ts) VALUES (:u1, :s1, :e1), (:u2, :s2, :e2)"
                ),
                {
                    "u1": active_trial_user.id,
                    "s1": now_ts - 60,
                    "e1": now_ts + 3600,
                    "u2": expired_trial_user.id,
                    "s2": now_ts - 7200,
                    "e2": now_ts - 3600,
                },
            )
            db.commit()
        finally:
            db.close()

        trial_response = self.client.get(
            "/admin/users?page=1&size=10&membership=trial",
            headers=self._admin_headers(),
        )
        self.assertEqual(trial_response.status_code, 200, trial_response.text)
        trial_body = trial_response.json()
        trial_usernames = {item["username"] for item in trial_body["items"]}
        self.assertIn("active-trial@example.com", trial_usernames)
        self.assertIn("no-history@example.com", trial_usernames)
        self.assertNotIn("expired-trial@example.com", trial_usernames)

        expired_response = self.client.get(
            "/admin/users?page=1&size=10&membership=expired",
            headers=self._admin_headers(),
        )
        self.assertEqual(expired_response.status_code, 200, expired_response.text)
        expired_body = expired_response.json()
        expired_usernames = {item["username"] for item in expired_body["items"]}
        self.assertIn("expired-trial@example.com", expired_usernames)
        self.assertNotIn("active-trial@example.com", expired_usernames)

    def test_admin_users_export_batches_trial_lookup(self):
        user_id = str(uuid.uuid4())
        trial_end = int((datetime.utcnow() + timedelta(days=3)).timestamp())
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=user_id,
                    username="export-user@example.com",
                    email="export-user@example.com",
                    password_hash="hashed_password",
                    plan="trial",
                )
            )
            db.execute(
                text("INSERT INTO trials (username, start_ts, end_ts) VALUES (:u, :s, :e)"),
                {"u": user_id, "s": trial_end - 86400, "e": trial_end},
            )
            db.commit()
        finally:
            db.close()

        with patch(
            "routers.admin._trial_end_ts",
            side_effect=AssertionError("export should use batch trial lookup"),
        ):
            response = self.client.get("/admin/users/export", headers=self._admin_headers())

        self.assertEqual(response.status_code, 200, response.text)
        csv_text = response.content.decode("utf-8-sig")
        self.assertIn("export-user@example.com", csv_text)

    def test_admin_reset_password_rejects_short_password(self):
        register_data = self._register("admin-reset@example.com", "secret123")

        response = self.client.post(
            "/admin/users/admin-reset@example.com/reset-password",
            json={"new_password": "1234567"},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 422, response.text)

        login_response = self.client.post(
            "/login",
            json={"username": "admin-reset@example.com", "password": "secret123"},
        )
        self.assertEqual(login_response.status_code, 200, login_response.text)
        self.assertEqual(login_response.json()["user"]["id"], register_data["user"]["id"])


if __name__ == "__main__":
    unittest.main()
