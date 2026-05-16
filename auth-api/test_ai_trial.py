import os
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_ai_trial.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-ai-trial-secret-32-byte-key"
os.environ["AI_TRIAL_JWT_SECRET"] = "test-ai-trial-jwt-secret-32-byte-key"
os.environ["AI_TRIAL_SHARED_API_KEY"] = "trial-shared-key"
os.environ["SMS_MODE"] = "dev"

from database import SessionLocal, create_tables, engine  # noqa: E402
from main import app  # noqa: E402
from models import AITrialSettings, AITrialUserUsage  # noqa: E402


class AITrialApiTests(unittest.TestCase):
    def setUp(self):
        with engine.begin() as conn:
            for table in (
                "ai_trial_user_usage",
                "ai_trial_settings",
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
        self.register_data = self.client.post(
            "/register",
            json={"username": "trial-api@example.com", "password": "secret123"},
        ).json()
        self.headers = {"Authorization": f"Bearer {self.register_data['access_token']}"}

    def test_trial_session_issues_token_and_returns_defaults(self):
        response = self.client.post(
            "/ai/trial/session",
            json={
                "device_id": "device-1",
                "client_version": "1.0.0",
                "features": ["chat", "auto_reply"],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["token"])
        self.assertEqual(body["expires_in"], 43200)
        self.assertEqual(body["models"]["chat"], "deepseek-chat")
        self.assertEqual(body["limits"]["chat_remaining"], 100)
        self.assertTrue(body["auto_send_default"])
        self.assertEqual(body["credential"]["provider"], "deepseek")
        self.assertEqual(body["credential"]["api_key"], "trial-shared-key")

    def test_report_use_upserts_usage_record(self):
        first = self.client.post(
            "/ai/trial/report-use",
            json={
                "feature": "auto_reply",
                "device_id": "device-1",
                "model": "deepseek-chat",
                "client_version": "1.0.0",
            },
            headers=self.headers,
        )
        self.assertEqual(first.status_code, 200, first.text)

        second = self.client.post(
            "/ai/trial/report-use",
            json={
                "feature": "auto_reply",
                "device_id": "device-1",
                "model": "deepseek-chat",
                "client_version": "1.0.1",
            },
            headers=self.headers,
        )
        self.assertEqual(second.status_code, 200, second.text)

        db = SessionLocal()
        try:
            row = (
                db.query(AITrialUserUsage)
                .filter(AITrialUserUsage.feature == "auto_reply")
                .first()
            )
            self.assertIsNotNone(row)
            self.assertEqual(row.use_count, 2)
            self.assertEqual(row.last_client_version, "1.0.1")
        finally:
            db.close()

    def test_trial_status_returns_current_defaults(self):
        response = self.client.get("/ai/trial/status", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["trial_enabled"])
        self.assertEqual(body["expires_in"], 43200)
        self.assertEqual(body["models"]["knowledge_draft"], "deepseek-chat")
        self.assertEqual(body["provider"], "deepseek")

    def test_trial_status_reflects_disabled_setting(self):
        db = SessionLocal()
        try:
            row = db.query(AITrialSettings).first()
            row.trial_enabled = False
            db.commit()
        finally:
            db.close()

        response = self.client.get("/ai/trial/status", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["trial_enabled"])


if __name__ == "__main__":
    unittest.main()
