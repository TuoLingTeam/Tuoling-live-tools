import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace

from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_config_sync.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-config-sync-secret-32-byte-key"
os.environ["SMS_MODE"] = "dev"

from database import SessionLocal, create_tables, engine  # noqa: E402
from models import User, UserConfig  # noqa: E402
from routers.config import sync_user_config  # noqa: E402
from schemas import SyncConfigRequest, UserConfigData  # noqa: E402


class ConfigSyncTests(unittest.TestCase):
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

        self.user_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=self.user_id,
                    username="config-sync@example.com",
                    email="config-sync@example.com",
                    password_hash="hashed_password",
                    status="active",
                    plan="trial",
                )
            )
            db.commit()
        finally:
            db.close()

    def _body(self, index: int) -> SyncConfigRequest:
        return SyncConfigRequest(
            config=UserConfigData(
                platformPreferences={
                    "douyin": {
                        "enabled": True,
                        "auditBatch": index,
                    }
                },
                autoReplyConfigs={
                    "main": {
                        "enabled": True,
                        "keywords": ["券", "链接"],
                    }
                },
            )
        )

    def _sync_once(self, index: int, barrier: Barrier):
        db = SessionLocal()
        try:
            barrier.wait(timeout=5)
            return sync_user_config(
                self._body(index),
                SimpleNamespace(id=self.user_id),
                db,
            )
        finally:
            db.close()

    def test_first_sync_is_atomic_under_concurrency(self):
        worker_count = 20
        barrier = Barrier(worker_count)

        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            results = list(executor.map(lambda index: self._sync_once(index, barrier), range(worker_count)))

        self.assertTrue(all(result.success for result in results))

        db = SessionLocal()
        try:
            rows = db.query(UserConfig).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].user_id, self.user_id)
            self.assertIn(
                rows[0].config_json["platformPreferences"]["douyin"]["auditBatch"],
                range(worker_count),
            )
        finally:
            db.close()

    def test_sync_updates_existing_record_without_creating_duplicates(self):
        first_db = SessionLocal()
        try:
            sync_user_config(self._body(1), SimpleNamespace(id=self.user_id), first_db)
        finally:
            first_db.close()

        second_db = SessionLocal()
        try:
            sync_user_config(self._body(2), SimpleNamespace(id=self.user_id), second_db)
        finally:
            second_db.close()

        db = SessionLocal()
        try:
            rows = db.query(UserConfig).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].config_json["platformPreferences"]["douyin"]["auditBatch"], 2)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
