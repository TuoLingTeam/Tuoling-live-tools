"""请求/响应 Pydantic 模型，预留订阅字段。
登录/注册请求体兼容 username 与 identifier 二选一（Pydantic v2：validation_alias=AliasChoices）。
"""
from datetime import datetime
from typing import Any, List, Optional

from pydantic import AliasChoices, BaseModel, Field

MIN_PASSWORD_LENGTH = 8


# ----- 请求（兼容 username / identifier，统一为 username 供路由使用） -----
def _username_field(**kwargs: Any) -> Any:
    """邮箱或手机号：请求体可传 username 或 identifier，内部统一为 username。"""
    return Field(..., description="邮箱或手机号", validation_alias=AliasChoices("username", "identifier"), **kwargs)


class RegisterBody(BaseModel):
    username: str = _username_field()
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH)


class LoginBody(BaseModel):
    username: str = _username_field()
    password: str = Field(..., min_length=1)


class RefreshBody(BaseModel):
    refresh_token: Optional[str] = None


# ----- 响应：用户（不含密码） -----
class UserOut(BaseModel):
    id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime
    last_login_at: Optional[datetime] = None
    status: str

    class Config:
        from_attributes = True


# ----- 订阅预留 -----
class SubscriptionOut(BaseModel):
    plan: str = "trial"
    status: str = "active"
    current_period_end: Optional[datetime] = None
    features: List[str] = Field(default_factory=list)


# ----- 认证响应 -----
class TokensOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthResponse(BaseModel):
    user: UserOut
    access_token: str
    token: Optional[str] = None
    refresh_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    """/login 和 /auth/sms/login 统一响应格式"""
    user: UserOut
    access_token: str
    token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None  # 短信登录返回
    needs_password: Optional[bool] = None  # 短信登录返回，标识是否需要设置密码


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ----- GET /me -----
class MeResponse(BaseModel):
    user: UserOut
    subscription: SubscriptionOut


# ----- GET /auth/status（用户状态，只读） -----
class TrialOut(BaseModel):
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    is_active: bool = False
    is_expired: bool = False


class FeatureAccessOut(BaseModel):
    requires_auth: bool = False
    required_plan: str = "trial"
    can_access: bool = False


class UserCapabilitiesOut(BaseModel):
    is_paid_user: bool = False
    can_use_all_features: bool = False
    max_live_accounts: int = 1
    feature_access: dict[str, FeatureAccessOut] = Field(default_factory=dict)


class UserStatusResponse(BaseModel):
    user_id: str
    username: str
    status: str = "active"
    plan: str = "trial"
    max_accounts: int = 1  # 新增：最大账号数
    has_password: bool = True
    created_at: Optional[str] = None
    last_login_at: Optional[str] = None
    expire_at: Optional[str] = None
    trial: Optional[TrialOut] = None
    capabilities: Optional[UserCapabilitiesOut] = None


class AITrialSessionBody(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)
    client_version: Optional[str] = Field(default=None, max_length=64)
    features: List[str] = Field(default_factory=list)


class AITrialModelsOut(BaseModel):
    chat: str
    auto_reply: str
    knowledge_draft: str


class AITrialCredentialOut(BaseModel):
    provider: str
    base_url: str
    api_key: str


class AITrialLimitsOut(BaseModel):
    chat_remaining: int
    auto_reply_remaining: int
    knowledge_draft_remaining: int


class AITrialSessionResponse(BaseModel):
    ok: bool = True
    mode: str = "trial"
    token: str
    expires_in: int
    token_type: str = "Bearer"
    models: AITrialModelsOut
    limits: AITrialLimitsOut
    auto_send_default: bool
    credential: AITrialCredentialOut


class AITrialReportUseBody(BaseModel):
    feature: str = Field(..., min_length=1, max_length=32)
    device_id: Optional[str] = Field(default=None, max_length=128)
    model: Optional[str] = Field(default=None, max_length=100)
    client_version: Optional[str] = Field(default=None, max_length=64)


class AITrialReportUseResponse(BaseModel):
    ok: bool = True


class AITrialStatusResponse(BaseModel):
    ok: bool = True
    trial_enabled: bool
    mode: str = "trial"
    expires_in: int
    auto_send_default: bool
    models: AITrialModelsOut
    provider: str
    base_url: str


# ----- 错误规范 -----
class ErrorDetail(BaseModel):
    code: str
    message: str


# 统一错误码：account_exists | wrong_password | invalid_params | token_invalid
def err_account_exists() -> dict:
    return {"code": "account_exists", "message": "账号已存在"}


def err_wrong_password() -> dict:
    return {"code": "wrong_password", "message": "用户名或密码错误"}


def err_invalid_params(msg: str = "参数错误") -> dict:
    return {"code": "invalid_params", "message": msg}


def err_token_invalid() -> dict:
    return {"code": "token_invalid", "message": "token 失效或已过期"}


def err_forbidden(msg: str = "无权访问") -> dict:
    return {"code": "forbidden", "message": msg}


def err_user_not_found() -> dict:
    return {"code": "user_not_found", "message": "用户不存在"}


# ----- 手机验证码相关 -----
class SendCodeBody(BaseModel):
    phone: str = Field(..., description="手机号")
    purpose: str = Field(default="login", description="用途: login | register | reset_password")


class SendCodeResponse(BaseModel):
    success: bool = True
    message: str = "验证码已发送"
    expires_in: Optional[int] = Field(default=300, description="验证码有效期(秒)")


class PhoneLoginBody(BaseModel):
    phone: str = Field(..., description="手机号")
    code: str = Field(..., description="验证码")


class PhoneRegisterBody(BaseModel):
    phone: str = Field(..., description="手机号")
    code: str = Field(..., description="验证码")
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, description="密码")


class ResetPasswordSmsBody(BaseModel):
    phone: str = Field(..., description="手机号")
    code: str = Field(..., description="验证码")
    new_password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, description="新密码")


class PhoneLoginResponse(BaseModel):
    user: UserOut
    token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"


class PhoneRegisterResponse(BaseModel):
    user: UserOut
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# ----- 验证码错误码 -----
def err_sms_code_invalid() -> dict:
    return {"code": "sms_code_invalid", "message": "验证码错误"}


def err_sms_code_invalid_or_expired() -> dict:
    return {"code": "sms_code_invalid", "message": "验证码错误或已过期"}


def err_sms_code_expired() -> dict:
    return {"code": "sms_code_expired", "message": "验证码已过期"}


def err_sms_code_used() -> dict:
    return {"code": "sms_code_used", "message": "验证码已使用"}


def err_phone_format_error() -> dict:
    return {"code": "phone_format_error", "message": "手机号格式不正确"}


def err_phone_not_registered() -> dict:
    return {"code": "phone_not_registered", "message": "该手机号未注册"}


def err_phone_already_registered() -> dict:
    return {"code": "phone_already_registered", "message": "该手机号已注册"}


def err_rate_limit_exceeded() -> dict:
    return {"code": "rate_limit_exceeded", "message": "发送过于频繁，请稍后再试"}


def err_sms_send_failed() -> dict:
    return {"code": "sms_send_failed", "message": "短信发送失败"}


def err_sms_verify_failed() -> dict:
    return {"code": "sms_verify_failed", "message": "短信验证码校验服务异常，请稍后重试"}


# ----- 礼品卡相关 -----
class RedeemGiftCardBody(BaseModel):
    code: str = Field(..., min_length=1, max_length=14, description="兑换码")


class GiftCardOut(BaseModel):
    id: str
    code: str
    type: str = "membership"
    tier: Optional[str] = None  # 新增：pro/pro_max/ultra
    membership_type: Optional[str] = None
    membership_days: int = 0
    status: str = "active"
    batch_id: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    redeemed_at: Optional[str] = None
    redeemed_by: Optional[str] = None


class RedeemResultOut(BaseModel):
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None
    data: Optional[dict] = None


class CreateGiftCardBody(BaseModel):
    type: str = Field(default="membership", description="membership")
    tier: str = Field(default="pro", description="pro | pro_max | ultra")  # 新增：档位
    membership_type: str = Field(default="trial", description="trial | pro")
    membership_days: int = Field(default=3, ge=1, le=3650, description="会员天数")  # 改为默认3天
    quantity: int = Field(default=1, ge=1, le=1000, description="生成数量")  # 增加到1000
    expires_at: Optional[str] = Field(None, description="过期时间 ISO 格式")


class CreateGiftCardResponse(BaseModel):
    ok: bool = True
    batch_id: str
    cards: List[GiftCardOut]
    count: int


class GiftCardStatsOut(BaseModel):
    total: int = 0
    active: int = 0
    redeemed: int = 0
    expired: int = 0
    disabled: int = 0


class PaginatedGiftCards(BaseModel):
    items: List[GiftCardOut]
    total: int
    page: int
    size: int


class GiftCardRedemptionOut(BaseModel):
    id: str
    gift_card_code: str
    membership_type: Optional[str] = None
    membership_days: int = 0
    redeemed_at: Optional[str] = None
    previous_plan: Optional[str] = None
    new_plan: Optional[str] = None


# ----- 礼品卡错误码 -----
def err_gift_card_invalid_format() -> dict:
    return {"code": "INVALID_CODE_FORMAT", "message": "兑换码格式不正确"}


def err_gift_card_not_found() -> dict:
    return {"code": "CODE_NOT_FOUND", "message": "兑换码不存在"}


def err_gift_card_already_redeemed() -> dict:
    return {"code": "ALREADY_REDEEMED", "message": "该兑换码已被使用"}


def err_gift_card_expired() -> dict:
    return {"code": "CODE_EXPIRED", "message": "兑换码已过期"}


def err_gift_card_disabled() -> dict:
    return {"code": "CODE_DISABLED", "message": "兑换码已禁用"}


# ----- 密码设置/修改 -----
class SetPasswordBody(BaseModel):
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, description="新密码")


class ChangePasswordBody(BaseModel):
    old_password: str = Field(..., min_length=1, description="旧密码")
    new_password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, description="新密码")


# ----- 用户配置同步 -----
class UserConfigData(BaseModel):
    """用户配置数据结构"""
    accounts: Optional[List[dict]] = None
    currentAccountId: Optional[str] = None
    defaultAccountId: Optional[str] = None
    platformPreferences: Optional[dict] = None
    autoReplyConfigs: Optional[dict] = None
    autoMessageConfigs: Optional[dict] = None
    autoPopUpConfigs: Optional[dict] = None
    chromeConfigs: Optional[dict] = None
    liveControlConfigs: Optional[dict] = None
    subAccountConfigs: Optional[dict] = None
    theme: Optional[str] = None


class SyncConfigRequest(BaseModel):
    """同步配置请求"""
    config: UserConfigData = Field(..., description="配置数据")
    version: Optional[int] = Field(default=1, description="配置版本")


class SyncConfigResponse(BaseModel):
    """同步配置响应"""
    success: bool = True
    message: str = "配置同步成功"
    synced_at: Optional[str] = None


class GetUserConfigResponse(BaseModel):
    """获取用户配置响应"""
    success: bool = True
    config: Optional[UserConfigData] = None
    version: int = 1
    updated_at: Optional[str] = None


# ----- 消息中心 -----
class MessageItem(BaseModel):
    id: str
    title: str
    content: str
    type: str = "notice"
    is_pinned: bool = False
    is_read: bool = False
    created_at: Optional[str] = None
    published_at: Optional[str] = None
    expires_at: Optional[str] = None


class MessageListResponse(BaseModel):
    success: bool = True
    items: List[MessageItem] = Field(default_factory=list)
    unread_count: int = 0
    fetched_at: Optional[str] = None


class MessageMarkReadResponse(BaseModel):
    success: bool = True
    unread_count: int = 0
    updated_at: Optional[str] = None


# ----- 用户反馈相关 -----
class FeedbackCategory:
    """反馈类型常量"""
    CONNECTION = "connection"  # 连接问题
    LOGIN = "login"  # 登录问题
    FUNCTION = "function"  # 功能异常
    SUGGESTION = "suggestion"  # 建议反馈
    FEATURE_REQUEST = "feature_request"  # 功能需求
    OTHER = "other"  # 其他


class SubmitFeedbackBody(BaseModel):
    """提交反馈请求体"""
    category: str = Field(
        ...,
        description="问题类型: connection/login/function/suggestion/feature_request/other",
    )
    content: str = Field(..., min_length=10, max_length=2000, description="问题描述")
    contact: Optional[str] = Field(None, max_length=100, description="联系方式（可选）")
    platform: Optional[str] = Field(None, description="当前平台")
    app_version: Optional[str] = Field(None, description="软件版本")
    os_info: Optional[str] = Field(None, description="操作系统信息")
    diagnostic_info: Optional[dict] = Field(None, description="诊断信息摘要")


class SubmitFeedbackResponse(BaseModel):
    """提交反馈响应"""
    success: bool = True
    message: str = "反馈提交成功"
    feedback_id: Optional[str] = None


class FeedbackOut(BaseModel):
    """反馈记录输出模型"""
    id: str
    username: Optional[str] = None
    contact: Optional[str] = None
    category: str
    content: str
    platform: Optional[str] = None
    app_version: Optional[str] = None
    os_info: Optional[str] = None
    diagnostic_info: Optional[dict] = None
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class FeedbackListResponse(BaseModel):
    """反馈列表响应"""
    items: List[FeedbackOut] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    size: int = 20


class UpdateFeedbackStatusBody(BaseModel):
    """更新反馈状态请求体"""
    status: str = Field(..., description="状态: pending/processing/resolved/closed")


# ----- 反馈错误码 -----
def err_feedback_invalid_category() -> dict:
    return {"code": "INVALID_CATEGORY", "message": "无效的反馈类型"}


def err_feedback_content_too_short() -> dict:
    return {"code": "CONTENT_TOO_SHORT", "message": "问题描述至少需要10个字符"}


def err_feedback_not_found() -> dict:
    return {"code": "FEEDBACK_NOT_FOUND", "message": "反馈记录不存在"}
