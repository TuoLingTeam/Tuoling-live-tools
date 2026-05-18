import asyncio
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_messages_stream.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-messages-stream-secret-32-byte-key"
os.environ["SMS_MODE"] = "dev"

from database import SessionLocal, create_tables, engine  # noqa: E402
from models import AnnouncementStreamState, User  # noqa: E402
from routers import messages as messages_router  # noqa: E402
from routers.messages import AnnouncementStreamHub, stream_hub  # noqa: E402
from schemas import MessageListResponse  # noqa: E402
from schemas_admin import AdminAnnouncementUpsertBody  # noqa: E402


class MessageStreamHubTests(unittest.TestCase):
    def setUp(self):
        with engine.begin() as conn:
            for table in (
                "announcement_stream_state",
                "announcement_receipts",
                "announcements",
                "feedbacks",
                "gift_card_redemptions",
                "gift_cards",
                "audit_logs",
                "sms_verify_failures",
                "subscriptions",
                "refresh_tokens",
                "sms_codes",
                "trials",
                "user_configs",
                "users",
            ):
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        create_tables()

    def test_notify_persists_shared_version(self):
        stream_hub.notify()
        stream_hub.notify()

        db = SessionLocal()
        try:
            state = db.get(AnnouncementStreamState, 1)
            self.assertIsNotNone(state)
            self.assertEqual(state.version, 2)
        finally:
            db.close()

    def test_wait_for_change_detects_update_from_another_hub_instance(self):
        publisher = AnnouncementStreamHub()
        subscriber = AnnouncementStreamHub()

        async def exercise() -> int:
            baseline = subscriber.version
            waiter = asyncio.create_task(
                subscriber.wait_for_change(baseline, timeout=1.0, poll_interval=0.05)
            )
            await asyncio.sleep(0.1)
            publisher.notify()
            return await waiter

        next_version = asyncio.run(exercise())
        self.assertEqual(next_version, 1)

    def test_capture_stream_snapshot_keeps_prebuild_version_when_change_happens_mid_build(self):
        publisher = AnnouncementStreamHub()
        subscriber = AnnouncementStreamHub()

        def fake_build_payload(db, user, limit):
            publisher.notify()
            return MessageListResponse(success=True, items=[], unread_count=0, fetched_at=None)

        with patch.object(messages_router, "_build_message_payload", side_effect=fake_build_payload):
            payload, observed_version = messages_router._capture_stream_snapshot(object(), 20)

        self.assertEqual(observed_version, 0)
        self.assertEqual(payload["unread_count"], 0)

        next_version = asyncio.run(
            subscriber.wait_for_change(observed_version, timeout=0.2, poll_interval=0.05)
        )
        self.assertEqual(next_version, 1)

    def test_admin_create_published_message_updates_stream_and_unread_snapshot(self):
        db = SessionLocal()
        try:
            user = User(
                id="user-1",
                username="client@example.com",
                password_hash="placeholder",
                status="active",
                plan="trial",
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            baseline_version = stream_hub.version
            response = messages_router.admin_create_message(
                AdminAnnouncementUpsertBody(
                    title="系统维护通知",
                    content="今晚会有一次短暂维护。",
                    status="published",
                    target_scope="all",
                ),
                SimpleNamespace(
                    state=SimpleNamespace(request_id="test-message-create"),
                    url="http://testserver/admin/messages",
                ),
                admin="admin",
                db=db,
            )

            self.assertTrue(response.ok)
            self.assertEqual(response.item.status, "published")
            self.assertGreater(stream_hub.version, baseline_version)

            payload = messages_router._build_message_payload(db, user, 20)
            self.assertEqual(payload.unread_count, 1)
            self.assertEqual(payload.items[0].title, "系统维护通知")
            self.assertFalse(payload.items[0].is_read)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
