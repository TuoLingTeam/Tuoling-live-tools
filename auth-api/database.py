"""SQLAlchemy 引擎与会话，启动时创建表"""
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import declarative_base, sessionmaker

from config import settings
from config import settings
from models import AITrialSettings, Base

_url = settings.DATABASE_URL.strip().lower()


def is_mysql() -> bool:
    """当前是否使用 MySQL 数据库"""
    return _url.startswith("mysql")
_connect_args = {"check_same_thread": False} if _url.startswith("sqlite") else {}
engine = create_engine(
    settings.DATABASE_URL,
    connect_args=_connect_args,
    pool_pre_ping=True,
    pool_recycle=300,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database_health() -> dict:
    """执行轻量数据库探测，供 /health 使用。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "ok": True,
            "dialect": engine.dialect.name,
        }
    except SQLAlchemyError as exc:
        return {
            "ok": False,
            "dialect": engine.dialect.name,
            "error": exc.__class__.__name__,
        }
    except Exception as exc:
        return {
            "ok": False,
            "dialect": engine.dialect.name,
            "error": exc.__class__.__name__,
        }


def create_tables():
    Base.metadata.create_all(bind=engine)
    _ensure_user_columns()
    _ensure_trials_table()
    _ensure_sms_codes_table()
    _ensure_sms_verify_failures_table()
    _ensure_refresh_tokens_table()
    _ensure_subscriptions_table()
    _ensure_audit_logs_table()
    _ensure_gift_cards_tables()
    _ensure_ai_trial_settings()


def _ensure_ai_trial_settings():
    with SessionLocal() as db:
        exists = db.query(AITrialSettings).first()
        if exists:
            return

        db.add(
            AITrialSettings(
                trial_enabled=True,
                token_version=1,
                token_expires_in_seconds=43200,
                chat_daily_limit=100,
                auto_reply_daily_limit=500,
                knowledge_draft_daily_limit=50,
                default_chat_model=settings.AI_TRIAL_DEFAULT_CHAT_MODEL,
                default_auto_reply_model=settings.AI_TRIAL_DEFAULT_AUTO_REPLY_MODEL,
                default_knowledge_model=settings.AI_TRIAL_DEFAULT_KNOWLEDGE_MODEL,
                auto_send_default=True,
            )
        )
        db.commit()


def _ensure_sms_codes_table():
    """SQLite：创建 sms_codes 表"""
    if not _url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS sms_codes("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, code TEXT NOT NULL, "
                "expire_at INTEGER NOT NULL, created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)"
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON sms_codes(phone)"))


def _ensure_sms_verify_failures_table():
    """SQLite/MySQL：创建 sms_verify_failures 表。"""
    if _url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS sms_verify_failures("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "phone TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'login', "
                    "created_at INTEGER NOT NULL)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_sms_verify_failures_phone_created_at "
                    "ON sms_verify_failures(phone, created_at)"
                )
            )
        return

    if _url.startswith("mysql"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS sms_verify_failures("
                    "id INT AUTO_INCREMENT PRIMARY KEY, "
                    "phone VARCHAR(32) NOT NULL, action VARCHAR(32) NOT NULL DEFAULT 'login', "
                    "created_at BIGINT NOT NULL, "
                    "INDEX idx_sms_verify_failures_phone_created_at(phone, created_at))"
                )
            )
        return


def _ensure_refresh_tokens_table():
    """SQLite：确保 refresh_tokens 表存在"""
    if not _url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS refresh_tokens("
                "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, "
                "expires_at DATETIME NOT NULL, revoked_at DATETIME, created_at DATETIME)"
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_rt_token_hash ON refresh_tokens(token_hash)"))


def _ensure_subscriptions_table():
    """SQLite：确保 subscriptions 表存在"""
    if not _url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS subscriptions("
                "id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, plan TEXT DEFAULT 'trial', "
                "status TEXT DEFAULT 'active', current_period_end DATETIME, features_json TEXT)"
            )
        )


def _ensure_trials_table():
    """SQLite/MySQL：创建 trials 表（存储试用开始/结束时间）。"""
    # SQLite 版本
    if _url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS trials("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "username TEXT UNIQUE, "
                    "start_ts INTEGER, "
                    "end_ts INTEGER)"
                )
            )
        return

    # MySQL 版本
    if _url.startswith("mysql"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS trials ("
                    "id INT AUTO_INCREMENT PRIMARY KEY, "
                    "username VARCHAR(255) UNIQUE, "
                    "start_ts BIGINT, "
                    "end_ts BIGINT)"
                )
            )
        return


def _ensure_audit_logs_table():
    """确保 audit_logs 表存在"""
    if _url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS audit_logs("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "request_id TEXT, url TEXT, action TEXT, "
                "target_user TEXT, status TEXT, response TEXT, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)"))
    elif _url.startswith("mysql"):
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS audit_logs("
                "id INT AUTO_INCREMENT PRIMARY KEY, "
                "request_id VARCHAR(36), url VARCHAR(512), action VARCHAR(64), "
                "target_user VARCHAR(255), status VARCHAR(20), response VARCHAR(2048), "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "INDEX idx_audit_action(action))"
            ))


def _ensure_gift_cards_tables():
    """确保 gift_cards 和 gift_card_redemptions 表存在"""
    if _url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS gift_cards("
                "id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, "
                "type TEXT DEFAULT 'membership', membership_type TEXT, "
                "membership_days INTEGER DEFAULT 0, status TEXT DEFAULT 'active', "
                "batch_id TEXT, created_by TEXT, created_at DATETIME, "
                "expires_at DATETIME, redeemed_at DATETIME, redeemed_by TEXT)"
            ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gc_code ON gift_cards(code)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gc_status ON gift_cards(status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gc_batch ON gift_cards(batch_id)"))
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS gift_card_redemptions("
                "id TEXT PRIMARY KEY, gift_card_id TEXT NOT NULL, "
                "user_id TEXT NOT NULL, redeemed_at DATETIME, "
                "previous_plan TEXT, new_plan TEXT, "
                "previous_expiry_ts INTEGER, new_expiry_ts INTEGER)"
            ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gcr_user ON gift_card_redemptions(user_id)"))
    elif _url.startswith("mysql"):
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS gift_cards("
                "id VARCHAR(36) PRIMARY KEY, code VARCHAR(14) UNIQUE NOT NULL, "
                "type VARCHAR(20) DEFAULT 'membership', membership_type VARCHAR(20), "
                "membership_days INT DEFAULT 0, status VARCHAR(20) DEFAULT 'active', "
                "batch_id VARCHAR(36), created_by VARCHAR(100), created_at DATETIME, "
                "expires_at DATETIME, redeemed_at DATETIME, redeemed_by VARCHAR(36), "
                "INDEX idx_gc_code(code), INDEX idx_gc_status(status), INDEX idx_gc_batch(batch_id))"
            ))
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS gift_card_redemptions("
                "id VARCHAR(36) PRIMARY KEY, gift_card_id VARCHAR(36) NOT NULL, "
                "user_id VARCHAR(36) NOT NULL, redeemed_at DATETIME, "
                "previous_plan VARCHAR(32), new_plan VARCHAR(32), "
                "previous_expiry_ts BIGINT, new_expiry_ts BIGINT, "
                "INDEX idx_gcr_user(user_id))"
            ))


def _ensure_user_columns():
    """SQLite/MySQL：为 users 表补列 phone"""
    if _url.startswith("sqlite"):
        _ensure_user_columns_sqlite()
    elif _url.startswith("mysql"):
        _ensure_user_columns_mysql()


def _ensure_user_columns_sqlite():
    """SQLite：为 users 表补齐 ORM 模型所需的全部列"""
    if not _url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")
        ).fetchone()
        if not exists:
            return
        result = conn.execute(text("PRAGMA table_info(users)"))
        rows = result.fetchall()
        columns = [row[1] for row in rows] if rows else []

        _needed = {
            "phone": "TEXT",
            "email": "TEXT",
            "password_hash": "TEXT",
            "password_configured": "INTEGER",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
            "last_login_at": "DATETIME",
            "last_active_at": "DATETIME",
            "status": "TEXT DEFAULT 'active'",
            "plan": "TEXT DEFAULT 'trial'",
            "trial_start_at": "DATETIME",
            "trial_end_at": "DATETIME",
        }
        for col, col_type in _needed.items():
            if col not in columns:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {col_type}"))

        if "phone" not in columns:
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)"))
        if "email" not in columns:
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"))

        if "password_hash" not in columns and "password" in columns:
            conn.execute(text("UPDATE users SET password_hash = password WHERE password_hash IS NULL"))


def _ensure_user_columns_mysql():
    """MySQL：为 users 表补齐缺失的列"""
    if not _url.startswith("mysql"):
        return
    try:
        with engine.begin() as conn:
            result = conn.execute(text("DESCRIBE users"))
            rows = result.fetchall()
            columns = [row[0] for row in rows] if rows else []

            if "phone" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL"))
                conn.execute(text("CREATE UNIQUE INDEX idx_users_phone ON users(phone)"))
            if "password_configured" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN password_configured TINYINT(1) NULL"))
            if "last_active_at" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN last_active_at DATETIME NULL"))
    except Exception:
        pass
