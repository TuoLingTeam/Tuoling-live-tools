"""Auth API 配置：从环境变量读取，便于阿里云/本地部署"""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 数据库：阿里云 RDS 或本地 MySQL / SQLite（如 sqlite:////data/users.db）
    # 生产环境必须从环境变量读取，不提供默认值
    DATABASE_URL: str = ""
    # SQLite 时可选：DB_PATH 默认 /data/users.db，与容器挂载一致
    DB_PATH: str = "/data/users.db"
    # 数据库连接池：MySQL 生产环境使用，SQLite 本地测试不启用这些 QueuePool 参数
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SECONDS: int = 10
    DB_POOL_RECYCLE_SECONDS: int = 300
    # JWT - 生产环境必须从环境变量读取
    JWT_SECRET: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # 管理员（/admin/* 鉴权）- 生产环境必须从环境变量读取
    ADMIN_USERNAME: str = ""
    ADMIN_PASSWORD: str = ""
    ADMIN_JWT_SECRET: str = ""  # 空则复用 JWT_SECRET
    # CORS：先放开 * 测通，生产可改为 Electron 或具体域名
    CORS_ORIGINS: str = "*"
    # 短信服务配置
    SMS_CODE_EXPIRE_MINUTES: int = 5
    SMS_CODE_MAX_ATTEMPTS_PER_HOUR: int = 10
    SMS_CODE_RATE_LIMIT_MINUTES: int = 60
    # AI Trial（推广期体验凭证）
    AI_TRIAL_JWT_SECRET: str = ""
    AI_TRIAL_PROVIDER: str = "deepseek"
    AI_TRIAL_BASE_URL: str = "https://api.deepseek.com"
    AI_TRIAL_SHARED_API_KEY: str = ""
    AI_TRIAL_DEFAULT_CHAT_MODEL: str = "deepseek-chat"
    AI_TRIAL_DEFAULT_AUTO_REPLY_MODEL: str = "deepseek-chat"
    AI_TRIAL_DEFAULT_KNOWLEDGE_MODEL: str = "deepseek-chat"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
MIN_JWT_SECRET_LENGTH = 32


def validate_jwt_secret_strength(name: str, value: str, *, required: bool = False) -> str:
    secret = (value or "").strip()
    if required and not secret:
        raise ValueError(f"[SECURITY] {name} 未设置，请配置长度 >= {MIN_JWT_SECRET_LENGTH} 的高熵随机字符串。")
    if secret and len(secret) < MIN_JWT_SECRET_LENGTH:
        raise ValueError(
            f"[SECURITY] {name} 长度不足：{len(secret)} < {MIN_JWT_SECRET_LENGTH}。"
            "请使用 openssl rand -hex 32 生成高熵随机字符串。"
        )
    return secret


def validate_configured_jwt_secrets(*, production: bool) -> None:
    validate_jwt_secret_strength("JWT_SECRET", settings.JWT_SECRET, required=production)
    validate_jwt_secret_strength("ADMIN_JWT_SECRET", settings.ADMIN_JWT_SECRET, required=False)
    validate_jwt_secret_strength("AI_TRIAL_JWT_SECRET", settings.AI_TRIAL_JWT_SECRET, required=False)


# 支持从环境变量覆盖
if os.getenv("DATABASE_URL"):
    settings.DATABASE_URL = os.getenv("DATABASE_URL")
if os.getenv("DB_PATH"):
    settings.DB_PATH = os.getenv("DB_PATH")
# 当显式设置 DB_PATH 时，使用 SQLite 连接该路径（容器内 /data/users.db）
if os.getenv("DB_PATH"):
    p = os.getenv("DB_PATH").strip()
    settings.DATABASE_URL = "sqlite:///" + (p if p.startswith("/") else "/" + p)
if os.getenv("DB_POOL_SIZE"):
    settings.DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE"))
if os.getenv("DB_MAX_OVERFLOW"):
    settings.DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW"))
if os.getenv("DB_POOL_TIMEOUT_SECONDS"):
    settings.DB_POOL_TIMEOUT_SECONDS = int(os.getenv("DB_POOL_TIMEOUT_SECONDS"))
if os.getenv("DB_POOL_RECYCLE_SECONDS"):
    settings.DB_POOL_RECYCLE_SECONDS = int(os.getenv("DB_POOL_RECYCLE_SECONDS"))
if os.getenv("JWT_SECRET"):
    settings.JWT_SECRET = os.getenv("JWT_SECRET")
if os.getenv("ADMIN_USERNAME"):
    settings.ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
if os.getenv("ADMIN_PASSWORD"):
    settings.ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
if os.getenv("ADMIN_JWT_SECRET"):
    settings.ADMIN_JWT_SECRET = os.getenv("ADMIN_JWT_SECRET")
if os.getenv("AI_TRIAL_JWT_SECRET"):
    settings.AI_TRIAL_JWT_SECRET = os.getenv("AI_TRIAL_JWT_SECRET")
if os.getenv("AI_TRIAL_PROVIDER"):
    settings.AI_TRIAL_PROVIDER = os.getenv("AI_TRIAL_PROVIDER")
if os.getenv("AI_TRIAL_BASE_URL"):
    settings.AI_TRIAL_BASE_URL = os.getenv("AI_TRIAL_BASE_URL")
if os.getenv("AI_TRIAL_SHARED_API_KEY"):
    settings.AI_TRIAL_SHARED_API_KEY = os.getenv("AI_TRIAL_SHARED_API_KEY")
if os.getenv("AI_TRIAL_DEFAULT_CHAT_MODEL"):
    settings.AI_TRIAL_DEFAULT_CHAT_MODEL = os.getenv("AI_TRIAL_DEFAULT_CHAT_MODEL")
if os.getenv("AI_TRIAL_DEFAULT_AUTO_REPLY_MODEL"):
    settings.AI_TRIAL_DEFAULT_AUTO_REPLY_MODEL = os.getenv("AI_TRIAL_DEFAULT_AUTO_REPLY_MODEL")
if os.getenv("AI_TRIAL_DEFAULT_KNOWLEDGE_MODEL"):
    settings.AI_TRIAL_DEFAULT_KNOWLEDGE_MODEL = os.getenv("AI_TRIAL_DEFAULT_KNOWLEDGE_MODEL")

# [SECURITY] 生产环境强制检查 SMS_MODE，禁止 fallback 到 dev 模式
ENV = os.getenv("ENV", "development").lower()
SMS_MODE = os.getenv("SMS_MODE", "dev").strip().lower()
validate_configured_jwt_secrets(production=ENV == "production")
if ENV == "production":
    if SMS_MODE not in ["aliyun_dypns", "aliyun"]:
        raise ValueError(
            f"[SECURITY] 生产环境 SMS_MODE 必须是 'aliyun_dypns' 或 'aliyun'，"
            f"当前值为 '{SMS_MODE}'。请正确配置环境变量后重启服务。"
        )
