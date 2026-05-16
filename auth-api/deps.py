"""JWT 与依赖：access_token 解析、get_current_user、refresh 校验；管理员 admin token 与审计日志"""
from functools import lru_cache
import hashlib
import json
import logging
import threading
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import RefreshToken, User

security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)
USER_ACTIVITY_PERSIST_INTERVAL_SECONDS = 300

# 管理员 JWT 使用独立 secret（空则复用 JWT_SECRET）
def _admin_jwt_secret() -> str:
    return (settings.ADMIN_JWT_SECRET or settings.JWT_SECRET).strip() or settings.JWT_SECRET


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


@lru_cache(maxsize=4096)
def is_placeholder_password_hash(password_hash: str) -> bool:
    """
    判断密码哈希是否仍为短信注册占位密码。

    这里对相同 hash 做进程内缓存，避免 /status 等高频接口重复执行 bcrypt 校验。
    当用户修改密码后，hash 字符串会变化，因此不会命中旧缓存。
    """
    return verify_password("!", password_hash)


def has_real_password(password_hash: str) -> bool:
    return not is_placeholder_password_hash(password_hash)


def user_has_password(user: User) -> bool:
    configured = getattr(user, "password_configured", None)
    if configured is not None:
        return bool(configured)
    return has_real_password(user.password_hash)


def create_access_token(user_id: str, jti: Optional[str] = None) -> str:
    """
    创建 access_token
    :param user_id: 用户ID（sub 字段）
    :param jti: 会话标识，等于 refresh_token.id，用于精确检查会话有效性
    """
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire, "type": "access"}
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def create_refresh_token(user_id: str, jti: Optional[str] = None) -> str:
    """JWT with type=refresh，与 login 相同 SECRET+算法，较长有效期（如 7d）"""
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": expire, "type": "refresh", "jti": jti or str(uuid.uuid4())}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def token_hash(raw: str) -> str:
    """对 refresh_token 做稳定哈希，便于持久化与查找。"""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def decode_refresh_token(token: str) -> Optional[str]:
    """校验 refresh_token（type=refresh），成功返回 sub（user_id）"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "refresh":
            return None
        return payload.get("sub")
    except InvalidTokenError:
        return None


def decode_access_token(token: str) -> Optional[str]:
    """解码 access_token，返回 sub（user_id）"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except InvalidTokenError:
        return None


def decode_access_token_jti(token: str) -> Optional[str]:
    """解码 access_token，返回 jti（会话标识，即 refresh_token.id）"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        return payload.get("jti")
    except InvalidTokenError:
        return None


def issue_user_session(
    db: Session,
    user_id: str,
    *,
    revoke_existing: bool = True,
) -> tuple[str, str, str]:
    """
    为用户签发新的单设备会话。

    真相源：
    - refresh_tokens.id = 当前会话 ID
    - access_token.jti = refresh_tokens.id
    - 新登录时撤销该用户所有未撤销 refresh_token
    """
    now = datetime.utcnow()
    if revoke_existing:
        db.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        ).update({"revoked_at": now}, synchronize_session=False)

    refresh_token_id = str(uuid.uuid4())
    refresh_token = create_refresh_token(user_id, jti=refresh_token_id)
    db.add(
        RefreshToken(
            id=refresh_token_id,
            user_id=user_id,
            token_hash=token_hash(refresh_token),
            expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            created_at=now,
        )
    )
    access_token = create_access_token(user_id, jti=refresh_token_id)
    return access_token, refresh_token, refresh_token_id


def require_active_access_session(token: str, db: Session) -> str:
    """
    校验 access_token 是否仍绑定当前有效会话。

    规则：
    - access_token 必须可解码且 type=access
    - access_token 必须带 jti（指向 refresh_tokens.id）
    - 该 refresh_token 必须存在、未撤销、未过期
    """
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_token_invalid(),
        )

    jti = decode_access_token_jti(token)
    if not jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_token_invalid(),
        )

    refresh_record = db.query(RefreshToken).filter(
        RefreshToken.id == jti,
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None),
        RefreshToken.expires_at > datetime.utcnow(),
    ).first()
    if not refresh_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "kicked_out", "message": "您的账号已在其他设备登录，请重新登录"},
        )

    return user_id


def _load_active_user(user_id: str, db: Session) -> Optional[User]:
    user = db.get(User, user_id)
    if user and user.status == "active":
        return user

    fallback_user = db.query(User).filter(User.username == user_id).first()
    if fallback_user and fallback_user.status == "active":
        return fallback_user
    return None


def _record_user_activity(db: Session, user: User, now: datetime) -> None:
    expire_on_commit = db.expire_on_commit
    try:
        db.expire_on_commit = False
        db.query(User).filter(User.id == user.id).update(
            {"last_active_at": now},
            synchronize_session=False,
        )
        db.commit()
        user.last_active_at = now
    except Exception:
        db.rollback()
        logger.exception("[Auth] failed to persist last_active_at", extra={"user_id": user.id})
    finally:
        db.expire_on_commit = expire_on_commit


def should_persist_user_activity(last_active_at: Optional[datetime], now: datetime) -> bool:
    if not last_active_at:
        return True
    return (now - last_active_at).total_seconds() > USER_ACTIVITY_PERSIST_INTERVAL_SECONDS


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_token_invalid(),
        )
    user_id = require_active_access_session(credentials.credentials, db)
    user = _load_active_user(user_id, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_token_invalid(),
        )
    now = datetime.utcnow()
    if should_persist_user_activity(user.last_active_at, now):
        _record_user_activity(db, user, now)
    return user


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """获取当前用户，如果未登录则返回 None（不抛出异常）"""
    if not credentials:
        return None
    try:
        user_id = require_active_access_session(credentials.credentials, db)
    except HTTPException:
        return None
    return _load_active_user(user_id, db)


def err_token_invalid() -> dict:
    return {"code": "token_invalid", "message": "token 失效或已过期"}


# ----- 管理员 JWT（type=admin） -----
ADMIN_TOKEN_EXPIRE_HOURS = 24


def create_admin_token() -> str:
    """签发管理员 JWT，sub=ADMIN_USERNAME，type=admin。"""
    expire = datetime.utcnow() + timedelta(hours=ADMIN_TOKEN_EXPIRE_HOURS)
    payload = {"sub": settings.ADMIN_USERNAME, "exp": expire, "type": "admin"}
    return jwt.encode(payload, _admin_jwt_secret(), algorithm="HS256")


def decode_admin_token(token: str) -> Optional[str]:
    """校验 admin token，成功返回 sub（管理员名）。"""
    try:
        payload = jwt.decode(token, _admin_jwt_secret(), algorithms=["HS256"])
        if payload.get("type") != "admin":
            return None
        return payload.get("sub")
    except InvalidTokenError:
        return None


def get_current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    """依赖：仅当 Bearer 为有效 admin token 时通过，返回管理员用户名。"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "admin_unauthorized", "message": "需要管理员 token"},
        )
    admin_sub = decode_admin_token(credentials.credentials)
    if not admin_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "admin_unauthorized", "message": "管理员 token 无效或已过期"},
        )
    return admin_sub


# ----- 审计日志（脱敏） -----
def _mask_response(obj: Any) -> Any:
    """对 response 中 password/token 等字段脱敏。"""
    if obj is None:
        return None
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            key_lower = (k or "").lower()
            if any(x in key_lower for x in ("password", "token", "secret", "refresh_token", "access_token")):
                out[k] = "***"
            else:
                out[k] = _mask_response(v)
        return out
    if isinstance(obj, list):
        return [_mask_response(x) for x in obj]
    return obj


def auth_audit_log(
    request_id: str,
    url: str,
    action: str,
    target_user: Optional[str],
    status: str,
    response: Any,
) -> None:
    """写入审计日志到 logger + 数据库。"""
    try:
        masked = _mask_response(response)
        if isinstance(masked, (dict, list)):
            response_str = json.dumps(masked, ensure_ascii=False, default=str)
        else:
            response_str = str(masked)
    except Exception:
        response_str = "<serialize_error>"
    logger.info(
        "[AUTH-AUDIT] requestId=%s url=%s action=%s targetUser=%s status=%s response=%s",
        request_id, url, action, target_user or "", status, response_str,
    )
    try:
        from database import SessionLocal
        from models import AuditLog
        db = SessionLocal()
        try:
            db.add(AuditLog(
                request_id=request_id,
                url=url,
                action=action,
                target_user=target_user,
                status=status,
                response=response_str[:2048] if response_str else None,
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        logger.exception("[AUTH-AUDIT] failed to persist audit log", extra={"request_id": request_id, "action": action})


def auth_audit_log_async(
    request_id: str,
    url: str,
    action: str,
    target_user: Optional[str],
    status: str,
    response: Any,
) -> None:
    """后台写审计日志，避免登录响应被数据库连接池等待拖住。"""
    thread = threading.Thread(
        target=auth_audit_log,
        args=(request_id, url, action, target_user, status, response),
        daemon=True,
    )
    thread.start()
