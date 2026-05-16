"""POST /register, /login（无 /auth 前缀）；/refresh, /status, /trial/*"""
from functools import lru_cache
import logging
import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from database import get_db, is_mysql
from deps import (
    create_access_token,
    decode_refresh_token,
    get_current_user,
    hash_password,
    issue_user_session,
    require_active_access_session,
    security,
    token_hash,
    user_has_password,
    verify_password,
)
from models import RefreshToken, Subscription, User
from schemas import (
    AuthResponse,
    ChangePasswordBody,
    ErrorDetail,
    FeatureAccessOut,
    LoginBody,
    LoginResponse,
    RefreshBody,
    RefreshResponse,
    RegisterBody,
    SetPasswordBody,
    TrialOut,
    UserCapabilitiesOut,
    UserOut,
    UserStatusResponse,
    err_account_exists,
    err_invalid_params,
    err_wrong_password,
    err_token_invalid,
)
from auth_feature_rules import build_feature_access
from subscription_rules import (
    can_use_all_features,
    is_paid_plan,
    normalize_plan,
    resolve_user_max_accounts,
)

router = APIRouter(prefix="", tags=["auth"])


def is_email(s: str) -> bool:
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", s))


def is_phone(s: str) -> bool:
    return bool(re.match(r"^1[3-9]\d{9}$", s))


def _build_trial_out(
    *,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
    is_active: bool = False,
    is_expired: bool = False,
) -> TrialOut:
    return TrialOut(
        start_at=start_at,
        end_at=end_at,
        is_active=is_active,
        is_expired=is_expired,
    )


def _load_membership_snapshot(
    user: User,
    db: Optional[Session],
) -> tuple[str, Optional[datetime], TrialOut]:
    plan = "trial"
    expire_at: Optional[datetime] = None
    trial = _build_trial_out()

    if db is not None:
        now = datetime.utcnow()
        now_ts = int(time.time())

        try:
            sub_row = db.execute(
                text(
                    "SELECT plan, current_period_end "
                    "FROM subscriptions WHERE user_id = :u "
                    "ORDER BY current_period_end DESC LIMIT 1"
                ),
                {"u": user.id},
            ).fetchone()
            if sub_row and sub_row[0]:
                sub_plan = normalize_plan(sub_row[0])
                sub_end_dt = sub_row[1]
                if is_paid_plan(sub_plan) and sub_end_dt and sub_end_dt > now:
                    plan = sub_plan
                    expire_at = sub_end_dt
        except Exception:
            logger.exception("查询 subscriptions 表失败", extra={"user_id": user.id})

        if not is_paid_plan(plan):
            try:
                row = db.execute(
                    text("SELECT start_ts, end_ts FROM trials WHERE username = :u"),
                    {"u": user.id},
                ).fetchone()
                if row and row[0] is not None and row[1] is not None:
                    start_ts, end_ts = row[0], row[1]
                    trial = _build_trial_out(
                        start_at=datetime.utcfromtimestamp(start_ts).isoformat() + "Z"
                        if start_ts
                        else None,
                        end_at=datetime.utcfromtimestamp(end_ts).isoformat() + "Z"
                        if end_ts
                        else None,
                        is_active=end_ts > now_ts,
                        is_expired=end_ts <= now_ts,
                    )
            except Exception:
                logger.exception("查询 trials 表失败", extra={"user_id": user.id})

    if not is_paid_plan(plan):
        user_plan = normalize_plan(getattr(user, "plan", None))
        if is_paid_plan(user_plan):
            plan = user_plan
            user_expire = getattr(user, "expire_at", None)
            if user_expire:
                expire_at = user_expire

        if not is_paid_plan(plan) and not trial.start_at and not trial.end_at:
            trial_start_at = getattr(user, "trial_start_at", None)
            trial_end_at = getattr(user, "trial_end_at", None)
            if trial_end_at:
                is_active = trial_end_at > datetime.utcnow()
                trial = _build_trial_out(
                    start_at=trial_start_at.isoformat() if trial_start_at else None,
                    end_at=trial_end_at.isoformat() if trial_end_at else None,
                    is_active=is_active,
                    is_expired=not is_active,
                )
                if is_active:
                    plan = "trial"

    if is_paid_plan(plan):
        trial = _build_trial_out(
            start_at=trial.start_at,
            end_at=trial.end_at,
            is_active=False,
            is_expired=trial.is_expired,
        )

    return plan, expire_at, trial


@lru_cache(maxsize=16)
def _get_feature_access_snapshot(
    normalized_plan: str,
) -> tuple[tuple[str, bool, str, bool], ...]:
    return tuple(
        (
            feature,
            bool(access["requires_auth"]),
            str(access["required_plan"]),
            bool(access["can_access"]),
        )
        for feature, access in build_feature_access(normalized_plan, is_authenticated=True).items()
    )


def _build_user_capabilities(plan: str, max_accounts: int) -> UserCapabilitiesOut:
    normalized_plan = normalize_plan(plan)
    return UserCapabilitiesOut(
        is_paid_user=is_paid_plan(normalized_plan),
        can_use_all_features=can_use_all_features(normalized_plan),
        max_live_accounts=max_accounts,
        feature_access={
            feature: FeatureAccessOut(
                requires_auth=requires_auth,
                required_plan=required_plan,
                can_access=can_access,
            )
            for feature, requires_auth, required_plan, can_access in _get_feature_access_snapshot(
                normalized_plan,
            )
        },
    )


def build_user_status_response(user: User, db: Optional[Session] = None) -> UserStatusResponse:
    """拼装 /auth/status 返回结构（含 plan、trial）。

    【P0-1 会员规则对齐】优先级：正式订阅(subscription) > 试用(trial)

    1. 优先查询 subscriptions 表（正式订阅）
    2. 其次查询 trials 表（试用）
    3. 最后兜底 user 表字段

    确保 Pro/ProMax/Ultra 不会被 trial 逻辑覆盖
    """
    username = user.email or user.phone or user.id
    plan, expire_at, trial = _load_membership_snapshot(user, db)
    has_password = user_has_password(user)
    max_accounts = resolve_user_max_accounts(plan, getattr(user, "max_accounts", None))
    capabilities = _build_user_capabilities(plan, max_accounts)

    return UserStatusResponse(
        user_id=user.id,
        username=username,
        status=user.status or "active",
        plan=plan,
        max_accounts=max_accounts,
        has_password=has_password,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
        expire_at=expire_at.isoformat() if expire_at else None,
        trial=trial,
        capabilities=capabilities,
    )


# ----- POST /login：密码登录 -----
@router.post("/login", response_model=AuthResponse)
def login(body: LoginBody, db: Session = Depends(get_db)):
    """密码登录（手机号/邮箱 + 密码）"""
    identifier = (body.username or "").strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_invalid_params("请输入手机号或邮箱"),
        )

    # 查找用户
    user = (
        db.query(User).filter(User.email == identifier).first()
        or db.query(User).filter(User.phone == identifier).first()
        or db.query(User).filter(User.username == identifier).first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_wrong_password(),
        )

    # 检查账号状态
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "account_disabled", "message": "账号已被禁用，请联系客服"},
        )

    # 验证密码
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_wrong_password(),
        )

    access_token, refresh_token, _refresh_token_id = issue_user_session(db, user.id)

    # 更新最后登录时间
    user.last_login_at = datetime.utcnow()
    db.commit()

    logger.info(f"[Auth] User {user.id} logged in, revoked all previous sessions")

    return AuthResponse(
        user=UserOut(
            id=user.id,
            email=user.email,
            phone=user.phone,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            status=user.status,
        ),
        access_token=access_token,
        token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/register", response_model=AuthResponse)
def register(body: RegisterBody, db: Session = Depends(get_db)):
    try:
        identifier = (body.username or "").strip()
        if not identifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err_invalid_params("请输入手机号或邮箱"),
            )
        if not is_email(identifier) and not is_phone(identifier):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err_invalid_params("请输入有效的手机号或邮箱"),
            )

        # 查重：email / phone / username 任一已存在则拒绝（避免 UNIQUE constraint 500）
        existing = (
            db.query(User).filter(User.email == identifier).first()
            or db.query(User).filter(User.phone == identifier).first()
            or db.query(User).filter(User.username == identifier).first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err_account_exists(),
            )

        # 创建用户
        user_id = str(uuid.uuid4())
        now = datetime.utcnow()
        password_hash = hash_password(body.password)

        # 判断是邮箱还是手机
        email = identifier if is_email(identifier) else None
        phone = identifier if is_phone(identifier) else None

        user = User(
            id=user_id,
            username=identifier,
            email=email,
            phone=phone,
            password_hash=password_hash,
            password_configured=True,
            created_at=now,
            updated_at=now,
            status="active",
            plan="trial",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # 创建默认订阅记录
        try:
            from sqlalchemy import text as sa_text
            _sub_sql = (
                "INSERT IGNORE INTO subscriptions (id, user_id, plan, status) "
                "VALUES (:sid, :uid, 'trial', 'active')"
            ) if is_mysql() else (
                "INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status) "
                "VALUES (:sid, :uid, 'trial', 'active')"
            )
            db.execute(sa_text(_sub_sql), {"sid": str(uuid.uuid4()), "uid": str(user.id)})
            db.commit()
        except Exception:
            db.rollback()

        access_token, refresh_raw, _refresh_token_id = issue_user_session(
            db,
            user_id,
            revoke_existing=False,
        )
        db.commit()

        return AuthResponse(
            user=UserOut(
                id=user_id,
                email=email,
                phone=phone,
                created_at=now,
                last_login_at=None,
                status="active",
            ),
            access_token=access_token,
            token=access_token,
            refresh_token=refresh_raw,
            token_type="bearer",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[Auth] Register error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "internal_error", "message": "注册失败，请稍后重试"},
        )


# ----- POST /set-password：SMS 注册用户首次设置密码 -----
@router.post("/set-password")
def set_password(
    body: SetPasswordBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """SMS 注册用户首次设置密码（需要登录状态）"""
    # 检查用户当前是否无密码（使用默认密码 "!"）
    if not user_has_password(current_user):
        # 可以设置密码
        current_user.password_hash = hash_password(body.password)
        current_user.password_configured = True
        db.commit()
        return {"ok": True, "message": "密码设置成功"}
    else:
        # 用户已有密码，不能通过此接口设置
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "password_exists", "message": "用户已设置密码，请使用修改密码功能"},
        )


# ----- POST /change-password：已有密码的用户修改密码 -----
@router.post("/change-password")
def change_password(
    body: ChangePasswordBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """已有密码的用户修改密码（需要登录状态）"""
    # 验证旧密码
    if not verify_password(body.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "wrong_password", "message": "旧密码错误"},
        )

    # 设置新密码
    current_user.password_hash = hash_password(body.new_password)
    current_user.password_configured = True
    db.commit()
    return {"ok": True, "message": "密码修改成功"}


# ----- GET /status：获取当前用户状态 -----
@router.get("/status", response_model=UserStatusResponse)
def get_user_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """GET /status：获取当前登录用户的完整状态（含会员等级、试用状态等）"""
    return build_user_status_response(current_user, db)


# ----- POST /refresh：刷新 access_token -----
@router.post("/refresh", response_model=RefreshResponse)
def refresh_token(
    body: RefreshBody,
    db: Session = Depends(get_db),
):
    """POST /refresh：使用 refresh_token 获取新的 access_token"""
    # 验证 refresh_token（decode_refresh_token 返回 user_id 或 None）
    user_id = decode_refresh_token(body.refresh_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_refresh_token", "message": "刷新令牌无效或已过期"},
        )

    # 验证 token 是否存在于数据库且未被撤销
    hashed_refresh_token = token_hash(body.refresh_token)
    refresh_record = db.query(RefreshToken).filter(
        RefreshToken.token_hash == hashed_refresh_token,
        RefreshToken.expires_at > datetime.utcnow()
    ).first()

    if not refresh_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "token_revoked", "message": "刷新令牌已失效"},
        )

    # 【单设备登录】检查 token 是否已被撤销（在其他设备登录时被踢下线）
    if refresh_record.revoked_at is not None:
        logger.info(f"[Auth] Refresh token revoked for user {user_id}, revoked_at={refresh_record.revoked_at}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "kicked_out", "message": "您的账号已在其他设备登录，请重新登录"},
        )

    # 生成新的 access_token，jti = 当前 refresh_token.id（保持会话标识连续）
    new_access_token = create_access_token(user_id, jti=refresh_record.id)

    return RefreshResponse(
        access_token=new_access_token,
        token_type="bearer"
    )


# ----- POST /trial/start：开通试用 -----
@router.post("/trial/start")
def start_trial(
    body: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """POST /trial/start：为用户开通 3 天试用"""
    # 检查用户是否已有有效订阅
    existing_sub = db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.current_period_end > datetime.utcnow()
    ).first()

    if existing_sub and is_paid_plan(existing_sub.plan):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "already_paid", "message": "您已是付费会员，无需试用"},
        )

    # 检查是否已有试用记录
    existing_trial = db.execute(
        text("SELECT end_ts FROM trials WHERE username = :u"),
        {"u": current_user.id}
    ).fetchone()

    if existing_trial and existing_trial[0] > int(time.time()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "trial_active", "message": "您已有有效试用"},
        )

    # 创建试用记录（3天）
    now_ts = int(time.time())
    end_ts = now_ts + 3 * 24 * 60 * 60  # 3天后

    if is_mysql():
        db.execute(
            text("""
                INSERT INTO trials (username, start_ts, end_ts)
                VALUES (:u, :s, :e)
                ON DUPLICATE KEY UPDATE start_ts = :s, end_ts = :e
            """),
            {"u": current_user.id, "s": now_ts, "e": end_ts},
        )
    else:
        db.execute(
            text("""
                INSERT OR REPLACE INTO trials(username, start_ts, end_ts)
                VALUES (:u, :s, :e)
            """),
            {"u": current_user.id, "s": now_ts, "e": end_ts},
        )
    db.commit()

    return {
        "success": True,
        "start_ts": now_ts,
        "end_ts": end_ts
    }


# ----- GET /trial/status：查询试用状态 -----
@router.get("/trial/status")
def get_trial_status(
    username: str = Query(..., description="用户名"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """GET /trial/status：查询用户的试用状态"""
    # 只能查询自己的状态
    if username != current_user.id and username != current_user.username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "无权查询其他用户状态"},
        )

    row = db.execute(
        text("SELECT start_ts, end_ts FROM trials WHERE username = :u"),
        {"u": current_user.id}
    ).fetchone()

    if not row:
        return {"has_trial": False, "active": False}

    start_ts, end_ts = row
    now_ts = int(time.time())
    is_active = end_ts > now_ts

    return {
        "has_trial": True,
        "active": is_active,
        "start_ts": start_ts,
        "end_ts": end_ts
    }


# ----- GET /server-time：获取服务器时间 -----
@router.get("/server-time")
def get_server_time():
    """GET /server-time：获取服务器当前时间戳（秒）"""
    return {"server_time": int(time.time())}


# ----- GET /auth/session-check：会话状态检查（用于心跳检测）-----
@router.get("/auth/session-check")
def session_check(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """
    GET /auth/session-check：检查当前会话是否有效（会话级检查）
    基于 access_token 中的 jti（即 refresh_token.id）精确检查当前会话是否被顶
    """
    # 1. 验证 access_token
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_token_invalid(),
        )

    user_id = require_active_access_session(credentials.credentials, db)
    return {"ok": True, "user_id": user_id}
