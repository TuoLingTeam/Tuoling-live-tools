import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

TEST_DB_PATH = Path(__file__).resolve().parent / "data" / "test_healthcheck.db"
TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET"] = "test-healthcheck-secret-32-byte-key"
os.environ["SMS_MODE"] = "dev"

from main import app  # noqa: E402
from config import MIN_JWT_SECRET_LENGTH, settings, validate_jwt_secret_strength  # noqa: E402
from database import _build_engine_options  # noqa: E402


class HealthcheckTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_returns_200_when_database_is_available(self):
        with patch(
            "main.check_database_health",
            return_value={"ok": True, "dialect": "sqlite"},
        ):
            response = self.client.get("/health")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["service"], "auth-api")
        self.assertEqual(body["database"]["dialect"], "sqlite")
        self.assertIn("timestamp", body)

    def test_health_returns_503_when_database_is_unavailable(self):
        with patch(
            "main.check_database_health",
            return_value={"ok": False, "dialect": "sqlite", "error": "OperationalError"},
        ):
            response = self.client.get("/health")

        self.assertEqual(response.status_code, 503, response.text)
        body = response.json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["database"]["error"], "OperationalError")

    def test_mysql_engine_options_include_configured_pool_limits(self):
        original = (
            settings.DB_POOL_SIZE,
            settings.DB_MAX_OVERFLOW,
            settings.DB_POOL_TIMEOUT_SECONDS,
            settings.DB_POOL_RECYCLE_SECONDS,
        )
        try:
            settings.DB_POOL_SIZE = 12
            settings.DB_MAX_OVERFLOW = 18
            settings.DB_POOL_TIMEOUT_SECONDS = 7
            settings.DB_POOL_RECYCLE_SECONDS = 420

            options = _build_engine_options("mysql+pymysql://user:pass@host/auth_db")
        finally:
            (
                settings.DB_POOL_SIZE,
                settings.DB_MAX_OVERFLOW,
                settings.DB_POOL_TIMEOUT_SECONDS,
                settings.DB_POOL_RECYCLE_SECONDS,
            ) = original

        self.assertEqual(options["pool_size"], 12)
        self.assertEqual(options["max_overflow"], 18)
        self.assertEqual(options["pool_timeout"], 7)
        self.assertEqual(options["pool_recycle"], 420)
        self.assertEqual(options["connect_args"], {})

    def test_sqlite_engine_options_skip_queue_pool_limits(self):
        options = _build_engine_options("sqlite:////tmp/auth-test.db")

        self.assertEqual(options["connect_args"], {"check_same_thread": False})
        self.assertNotIn("pool_size", options)
        self.assertNotIn("max_overflow", options)
        self.assertNotIn("pool_timeout", options)

    def test_jwt_secret_strength_rejects_short_configured_secret(self):
        with self.assertRaises(ValueError):
            validate_jwt_secret_strength("JWT_SECRET", "short-secret", required=True)

    def test_jwt_secret_strength_accepts_minimum_length_secret(self):
        secret = "x" * MIN_JWT_SECRET_LENGTH

        self.assertEqual(validate_jwt_secret_strength("JWT_SECRET", secret, required=True), secret)


if __name__ == "__main__":
    unittest.main()
