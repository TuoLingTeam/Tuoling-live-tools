"""数据表：users, refresh_tokens, subscriptions, sms_codes, gift_cards, gift_card_redemptions"""
from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=True)
    phone = Column(String(32), unique=True, index=True, nullable=True)
    password_hash = Column(String(255), nullable=False)
    password_configured = Column(Boolean, nullable=True, default=None)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    last_active_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="active")
    plan = Column(String(32), default="trial")
    trial_start_at = Column(DateTime, nullable=True)
    trial_end_at = Column(DateTime, nullable=True)

    # 账号数量限制（新增）
    max_accounts = Column(Integer, default=1)  # 默认允许1个账号
    trial_used = Column(Integer, default=0)    # 是否已使用过试用

    refresh_tokens = relationship("RefreshToken", back_populates="user")
    subscription = relationship("Subscription", back_populates="user", uselist=False)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(255), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    plan = Column(String(32), default="trial")
    status = Column(String(20), default="active")
    current_period_end = Column(DateTime, nullable=True)
    features_json = Column(JSON, nullable=True)

    user = relationship("User", back_populates="subscription")


class SMSCode(Base):
    """短信验证码表"""
    __tablename__ = "sms_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(32), nullable=False, index=True)
    code = Column(String(6), nullable=False)
    expire_at = Column(Integer, nullable=False)
    created_at = Column(Integer, nullable=False)
    used = Column(Integer, default=0)
    date_str = Column(String(8), nullable=False, index=True)  # 格式：YYYYMMDD，用于单日限制


class SMSVerifyFailure(Base):
    """短信验证码校验失败记录，用于暴力破解防护。"""

    __tablename__ = "sms_verify_failures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(32), nullable=False, index=True)
    action = Column(String(32), nullable=False, default="login")
    created_at = Column(Integer, nullable=False, index=True)


class GiftCard(Base):
    __tablename__ = "gift_cards"

    id = Column(String(36), primary_key=True, index=True)
    code = Column(String(14), unique=True, nullable=False, index=True)
    type = Column(String(20), default="membership")

    # 礼品卡档位（新增）: pro/pro_max/ultra
    tier = Column(String(20), nullable=True)

    # 权益配置（JSON格式，便于扩展）
    benefits_json = Column(JSON, nullable=True, default=lambda: {
        "max_accounts": 1,
        "features": ["all"],
        "duration_days": None
    })

    membership_type = Column(String(20), nullable=True)  # 保留兼容
    membership_days = Column(Integer, default=0)         # 保留兼容
    status = Column(String(20), default="active", index=True)
    batch_id = Column(String(36), nullable=True, index=True)
    created_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    redeemed_at = Column(DateTime, nullable=True)
    redeemed_by = Column(String(36), nullable=True)

    redemptions = relationship("GiftCardRedemption", back_populates="gift_card")


class GiftCardRedemption(Base):
    __tablename__ = "gift_card_redemptions"

    id = Column(String(36), primary_key=True, index=True)
    gift_card_id = Column(String(36), ForeignKey("gift_cards.id"), nullable=False, index=True)
    user_id = Column(String(36), nullable=False, index=True)
    redeemed_at = Column(DateTime, default=datetime.utcnow)
    previous_plan = Column(String(32), nullable=True)
    new_plan = Column(String(32), nullable=True)
    previous_expiry_ts = Column(Integer, nullable=True)
    new_expiry_ts = Column(Integer, nullable=True)

    gift_card = relationship("GiftCard", back_populates="redemptions")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    request_id = Column(String(36), index=True)
    url = Column(String(512), nullable=True)
    action = Column(String(64), index=True)
    target_user = Column(String(255), nullable=True)
    status = Column(String(20))
    response = Column(String(2048), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserConfig(Base):
    """用户配置数据表 - 用于跨设备同步"""
    __tablename__ = "user_configs"

    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True, index=True)

    config_json = Column(JSON, nullable=False, default=lambda: {})

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="config")


class AITrialSettings(Base):
    __tablename__ = "ai_trial_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_enabled = Column(Boolean, default=True, nullable=False)
    token_version = Column(Integer, default=1, nullable=False)
    token_expires_in_seconds = Column(Integer, default=43200, nullable=False)

    chat_daily_limit = Column(Integer, default=100, nullable=False)
    auto_reply_daily_limit = Column(Integer, default=500, nullable=False)
    knowledge_draft_daily_limit = Column(Integer, default=50, nullable=False)

    default_chat_model = Column(String(100), nullable=False)
    default_auto_reply_model = Column(String(100), nullable=False)
    default_knowledge_model = Column(String(100), nullable=False)

    auto_send_default = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AITrialUserUsage(Base):
    __tablename__ = "ai_trial_user_usage"
    __table_args__ = (
        UniqueConstraint("user_id", "feature", name="uq_ai_trial_user_feature"),
        Index("idx_ai_trial_usage_last_used", "last_used_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    device_id = Column(String(128), nullable=True)
    feature = Column(String(32), nullable=False, index=True)
    first_used_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    use_count = Column(Integer, default=1, nullable=False)
    last_model = Column(String(100), nullable=True)
    last_client_version = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="ai_trial_usage")


class Feedback(Base):
    """用户反馈表"""
    __tablename__ = "feedbacks"

    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    username = Column(String(100), nullable=True, index=True)
    contact = Column(String(100), nullable=True)
    category = Column(String(32), nullable=False)  # 问题类型
    content = Column(String(2000), nullable=False)  # 问题描述
    platform = Column(String(32), nullable=True)  # 当前平台
    app_version = Column(String(32), nullable=True)  # 软件版本
    os_info = Column(String(100), nullable=True)  # 操作系统信息
    diagnostic_info = Column(JSON, nullable=True)  # 诊断信息摘要
    status = Column(String(20), default="pending", index=True)  # pending/processing/resolved/closed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="feedbacks")


class Announcement(Base):
    """站内消息/公告"""

    __tablename__ = "announcements"

    id = Column(String(36), primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    type = Column(String(20), default="notice", index=True)
    status = Column(String(20), default="draft", index=True)  # draft/published/revoked
    target_scope = Column(String(20), default="all", index=True)  # all/plan/user
    target_value = Column(String(255), nullable=True, index=True)
    is_pinned = Column(Boolean, default=False, nullable=False)
    created_by = Column(String(100), nullable=True)
    published_at = Column(DateTime, nullable=True, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    receipts = relationship("AnnouncementReceipt", back_populates="announcement")


class AnnouncementReceipt(Base):
    """用户消息已读状态"""

    __tablename__ = "announcement_receipts"
    __table_args__ = (
        UniqueConstraint("announcement_id", "user_id", name="uq_announcement_receipt_user"),
        Index("idx_receipt_user_read_at", "user_id", "read_at"),
    )

    id = Column(String(36), primary_key=True, index=True)
    announcement_id = Column(
        String(36),
        ForeignKey("announcements.id"),
        nullable=False,
        index=True,
    )
    user_id = Column(String(36), nullable=False, index=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    announcement = relationship("Announcement", back_populates="receipts")


class AnnouncementStreamState(Base):
    """消息流共享状态，用于跨实例同步公告版本。"""

    __tablename__ = "announcement_stream_state"

    id = Column(Integer, primary_key=True)
    version = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
