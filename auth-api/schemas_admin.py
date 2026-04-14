"""Admin API 请求/响应模型"""
from typing import List, Optional

from pydantic import BaseModel, Field

MIN_PASSWORD_LENGTH = 8


class AdminLoginBody(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str


class AdminUserListItem(BaseModel):
    username: str
    user_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: Optional[str] = None
    disabled: bool = False
    is_online: bool = False
    last_active_at: Optional[str] = None
    trial_end: Optional[int] = None
    plan: str = "trial"
    # 【新增】会员状态统一字段
    membership_status: str = "trial"  # free | trial | pro | pro_max | ultra | expired
    membership_label: str = "试用中"  # 免费版 | 试用中 | Pro | ProMax | Ultra | 已过期
    membership_expire_at: Optional[str] = None  # 到期时间 ISO 格式
    membership_type: str = "none"  # none | trial | subscription 标识来源


class AdminUserDetail(AdminUserListItem):
    last_login_at: Optional[str] = None
    trial_start: Optional[int] = None


class PaginatedUserList(BaseModel):
    items: List[AdminUserListItem]
    total: int
    page: int
    size: int


class AdminResetPasswordBody(BaseModel):
    new_password: Optional[str] = Field(None, min_length=MIN_PASSWORD_LENGTH)


class AdminResetPasswordResponse(BaseModel):
    ok: bool = True
    temp_password: Optional[str] = None
    message: str = ""


class ExtendTrialBody(BaseModel):
    days: int = Field(..., ge=1, le=365)


class AuditLogItem(BaseModel):
    id: int
    action: str
    target_user: Optional[str] = None
    status: str
    response: Optional[str] = None
    created_at: Optional[str] = None


class PaginatedAuditLogs(BaseModel):
    items: List[AuditLogItem]
    total: int
    page: int
    size: int


class AdminAnnouncementItem(BaseModel):
    id: str
    title: str
    content: str
    type: str = "notice"
    status: str = "draft"
    target_scope: str = "all"
    target_value: Optional[str] = None
    is_pinned: bool = False
    created_by: Optional[str] = None
    published_at: Optional[str] = None
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PaginatedAdminAnnouncements(BaseModel):
    items: List[AdminAnnouncementItem]
    total: int
    page: int
    size: int


class AdminAnnouncementUpsertBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=4000)
    type: str = Field(default="notice", pattern="^(notice|update|warning|marketing)$")
    status: str = Field(default="draft", pattern="^(draft|published)$")
    target_scope: str = Field(default="all", pattern="^(all|plan|user)$")
    target_value: Optional[str] = Field(default=None, max_length=255)
    is_pinned: bool = False
    expires_at: Optional[str] = None


class AdminAnnouncementActionResponse(BaseModel):
    ok: bool = True
    message: str = ""
    item: Optional[AdminAnnouncementItem] = None
