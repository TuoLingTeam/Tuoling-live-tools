"""管理员接口：/admin/login 与 /admin/users/*，均需 admin token（除 login 外），并写审计日志"""
import csv
import io
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import bindparam, exists, not_, or_, select, table, column, text
from sqlalchemy.orm import Session

from config import settings
from database import get_db, is_mysql
from deps import (
    auth_audit_log_async,
    create_admin_token,
    get_current_admin,
    hash_password,
)
from models import AuditLog, RefreshToken, Subscription, User, UserConfig
from schemas import err_wrong_password
from schemas_admin import (
    AdminLoginBody,
    AdminLoginResponse,
    AdminResetPasswordBody,
    AdminResetPasswordResponse,
    AdminUserDetail,
    AdminUserListItem,
    AuditLogItem,
    ExtendTrialBody,
    PaginatedAuditLogs,
    PaginatedUserList,
)
from subscription_rules import build_membership_info, is_paid_plan, normalize_plan

router = APIRouter(prefix="/admin", tags=["admin"])
TRIALS_TABLE = table(
    "trials",
    column("username"),
    column("start_ts"),
    column("end_ts"),
)


def _is_email(s: str) -> bool:
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", s))


def _is_phone(s: str) -> bool:
    return bool(re.match(r"^1[3-9]\d{9}$", s))


def _get_user_by_username(db: Session, username: str) -> Optional[User]:
    """通过邮箱、手机号、username 或 user_id 解析用户。"""
    u = (username or "").strip()
    if not u:
        return None
    if _is_email(u):
        return db.query(User).filter(User.email == u).first()
    if _is_phone(u):
        return db.query(User).filter(User.phone == u).first()
    return db.query(User).filter(
        or_(User.email == u, User.phone == u, User.username == u, User.id == u)
    ).first()


def _username_of(user: User) -> str:
    return user.email or user.phone or user.username or user.id


def _trial_end_ts(db: Session, user_id: str) -> Optional[int]:
    try:
        row = db.execute(
            text("SELECT end_ts FROM trials WHERE username = :u"),
            {"u": user_id},
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except Exception:
        return None


def _trial_start_ts(db: Session, user_id: str) -> Optional[int]:
    try:
        row = db.execute(
            text("SELECT start_ts FROM trials WHERE username = :u"),
            {"u": user_id},
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except Exception:
        return None


def _req_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


ONLINE_THRESHOLD_SECONDS = 300  # 5 minutes


def _is_user_online(u: User) -> bool:
    if not u.last_active_at:
        return False
    now = datetime.utcnow()
    return (now - u.last_active_at).total_seconds() < ONLINE_THRESHOLD_SECONDS


def _apply_membership_filter(query, membership: Optional[str]):
    normalized = (membership or "").strip().lower()
    if not normalized:
        return query

    now = datetime.utcnow()
    now_ts = int(now.timestamp())

    active_paid_exists = exists(
        select(1).select_from(Subscription).where(
            Subscription.user_id == User.id,
            Subscription.plan.in_(("pro", "pro_max", "ultra")),
            Subscription.current_period_end.is_not(None),
            Subscription.current_period_end > now,
        )
    )
    any_subscription_exists = exists(
        select(1).select_from(Subscription).where(Subscription.user_id == User.id)
    )
    active_trial_exists = exists(
        select(1).select_from(TRIALS_TABLE).where(
            TRIALS_TABLE.c.username == User.id,
            TRIALS_TABLE.c.end_ts.is_not(None),
            TRIALS_TABLE.c.end_ts > now_ts,
        )
    )
    any_trial_exists = exists(
        select(1).select_from(TRIALS_TABLE).where(TRIALS_TABLE.c.username == User.id)
    )
    has_history = or_(any_subscription_exists, any_trial_exists)

    if normalized in ("pro", "pro_max", "ultra"):
        return query.filter(
            exists(
                select(1).select_from(Subscription).where(
                    Subscription.user_id == User.id,
                    Subscription.plan == normalized,
                    Subscription.current_period_end.is_not(None),
                    Subscription.current_period_end > now,
                )
            )
        )

    if normalized == "expired":
        return query.filter(not_(active_paid_exists), has_history, not_(active_trial_exists))

    if normalized == "trial":
        return query.filter(not_(active_paid_exists), or_(active_trial_exists, not_(has_history)))

    return query


def _apply_online_filter(query, online: Optional[str]):
    normalized = (online or "").strip().lower()
    if not normalized:
        return query

    threshold = datetime.utcnow() - timedelta(seconds=ONLINE_THRESHOLD_SECONDS)
    if normalized == "online":
        return query.filter(User.last_active_at.is_not(None), User.last_active_at > threshold)
    if normalized == "offline":
        return query.filter(
            or_(User.last_active_at.is_(None), User.last_active_at <= threshold),
        )
    return query


def _get_membership_status(u: User, db: Session) -> dict:
    """
    计算用户会员状态
    返回: {
        membership_status: trial | pro | pro_max | ultra | expired
        membership_label: 免费版 | 试用中 | Pro | ProMax | Ultra | 已过期
        membership_expire_at: ISO格式到期时间或None
        membership_type: none | trial | subscription
    }
    """
    now = datetime.utcnow()
    now_ts = int(now.timestamp())
    
    # 1. 优先检查正式订阅 (subscriptions 表)
    try:
        sub = db.query(Subscription).filter(Subscription.user_id == u.id).first()
        if sub and sub.plan and sub.current_period_end:
            # 检查订阅是否过期
            plan = normalize_plan(sub.plan)
            if sub.current_period_end > now and is_paid_plan(plan):
                return build_membership_info(
                    status=plan,
                    expire_at=sub.current_period_end,
                    membership_type="subscription",
                )
    except Exception:
        pass
    
    # 2. 检查试用状态 (trials 表)
    try:
        trial_end = _trial_end_ts(db, u.id)
        if trial_end:
            trial_end_dt = datetime.utcfromtimestamp(trial_end)
            if trial_end > now_ts:
                return build_membership_info("trial", trial_end_dt, "trial")
            else:
                return build_membership_info("expired", trial_end_dt, "trial")
    except Exception:
        pass
    
    # 3. 检查是否有历史订阅/试用记录但已过期
    has_history = False
    try:
        if db.query(Subscription).filter(Subscription.user_id == u.id).first():
            has_history = True
    except Exception:
        pass
    
    if not has_history:
        try:
            if _trial_end_ts(db, u.id):
                has_history = True
        except Exception:
            pass
    
    if has_history:
        return build_membership_info("expired", membership_type="none")
    
    # 4. 默认视为 trial 口径（无任何记录）
    return build_membership_info("trial", membership_type="none")


def _load_admin_user_context(
    db: Session,
    users: list[User],
) -> tuple[dict[str, Subscription], dict[str, tuple[Optional[int], Optional[int]]]]:
    if not users:
        return {}, {}

    user_ids = [str(user.id) for user in users]
    subscription_rows = db.query(Subscription).filter(Subscription.user_id.in_(user_ids)).all()
    subscription_by_user_id = {str(row.user_id): row for row in subscription_rows}
    trial_by_user_id = _load_trial_context(db, user_ids)
    return subscription_by_user_id, trial_by_user_id


def _load_trial_context(
    db: Session,
    user_ids: list[str],
) -> dict[str, tuple[Optional[int], Optional[int]]]:
    if not user_ids:
        return {}

    trial_rows = db.execute(
        text("SELECT username, start_ts, end_ts FROM trials WHERE username IN :user_ids").bindparams(
            bindparam("user_ids", expanding=True),
        ),
        {"user_ids": user_ids},
    ).fetchall()
    trial_by_user_id = {
        str(row[0]): (
            int(row[1]) if row[1] is not None else None,
            int(row[2]) if row[2] is not None else None,
        )
        for row in trial_rows
    }
    return trial_by_user_id


def _get_membership_status_from_context(
    u: User,
    subscription_by_user_id: dict[str, Subscription],
    trial_by_user_id: dict[str, tuple[Optional[int], Optional[int]]],
) -> dict:
    now = datetime.utcnow()
    now_ts = int(now.timestamp())
    subscription = subscription_by_user_id.get(str(u.id))

    if subscription and subscription.plan and subscription.current_period_end:
        plan = normalize_plan(subscription.plan)
        if subscription.current_period_end > now and is_paid_plan(plan):
            return build_membership_info(
                status=plan,
                expire_at=subscription.current_period_end,
                membership_type="subscription",
            )

    _, trial_end = trial_by_user_id.get(str(u.id), (None, None))
    if trial_end:
        trial_end_dt = datetime.utcfromtimestamp(trial_end)
        if trial_end > now_ts:
            return build_membership_info("trial", trial_end_dt, "trial")
        return build_membership_info("expired", trial_end_dt, "trial")

    if subscription or str(u.id) in trial_by_user_id:
        return build_membership_info("expired", membership_type="none")

    return build_membership_info("trial", membership_type="none")


def _build_user_item(
    u: User,
    db: Session,
    subscription_by_user_id: Optional[dict[str, Subscription]] = None,
    trial_by_user_id: Optional[dict[str, tuple[Optional[int], Optional[int]]]] = None,
) -> AdminUserListItem:
    # 计算会员状态
    if subscription_by_user_id is not None and trial_by_user_id is not None:
        membership = _get_membership_status_from_context(
            u,
            subscription_by_user_id,
            trial_by_user_id,
        )
        trial_end = trial_by_user_id.get(str(u.id), (None, None))[1]
    else:
        membership = _get_membership_status(u, db)
        trial_end = _trial_end_ts(db, u.id)
    
    return AdminUserListItem(
        username=_username_of(u),
        user_id=u.id,
        email=u.email,
        phone=u.phone,
        created_at=u.created_at.isoformat() if u.created_at else None,
        disabled=(u.status or "active") != "active",
        is_online=_is_user_online(u),
        last_active_at=u.last_active_at.isoformat() if u.last_active_at else None,
        trial_end=trial_end,
        plan=normalize_plan(getattr(u, "plan", None)),
        # 【新增】会员状态字段
        membership_status=membership["membership_status"],
        membership_label=membership["membership_label"],
        membership_expire_at=membership["membership_expire_at"],
        membership_type=membership["membership_type"],
    )


# ----- POST /admin/login -----
@router.post("/login", response_model=AdminLoginResponse)
def admin_login(body: AdminLoginBody, request: Request):
    req_id = str(uuid.uuid4())
    if (body.username or "").strip() != settings.ADMIN_USERNAME:
        auth_audit_log_async(req_id, str(request.url), "admin_login", None, "failure", {"reason": "wrong_username"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_wrong_password(),
        )
    if (body.password or "") != settings.ADMIN_PASSWORD:
        auth_audit_log_async(req_id, str(request.url), "admin_login", None, "failure", {"reason": "wrong_password"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=err_wrong_password(),
        )
    token = create_admin_token()
    auth_audit_log_async(req_id, str(request.url), "admin_login", settings.ADMIN_USERNAME, "success", {"token": "***"})
    return AdminLoginResponse(token=token)


# ----- GET /admin/users -----
@router.get("/users", response_model=PaginatedUserList)
def admin_list_users(
    request: Request,
    query: Optional[str] = None,
    page: int = 1,
    size: int = 20,
    membership: Optional[str] = None,  # 【新增】会员状态筛选
    reg_type: Optional[str] = None,    # 【新增】注册方式筛选
    status: Optional[str] = None,      # 【新增】账号状态筛选
    online: Optional[str] = None,      # 【新增】在线状态筛选
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    if page < 1:
        page = 1
    if size < 1 or size > 100:
        size = 20
    offset = (page - 1) * size
    q = db.query(User)
    
    # 搜索条件
    if query and query.strip():
        pattern = f"%{query.strip()}%"
        q = q.filter(
            or_(
                User.email.ilike(pattern),
                User.phone.ilike(pattern),
                User.username.ilike(pattern),
                User.id.ilike(pattern),
            )
        )
    
    # 【新增】注册方式筛选
    if reg_type:
        if reg_type == "phone":
            q = q.filter(User.phone.isnot(None))
        elif reg_type == "email":
            q = q.filter(User.email.isnot(None))
    
    # 【新增】账号状态筛选
    if status:
        if status == "active":
            q = q.filter((User.status == "active") | (User.status.is_(None)))
        elif status == "disabled":
            q = q.filter(User.status == "disabled")

    q = _apply_membership_filter(q, membership)
    q = _apply_online_filter(q, online)

    total = q.count()
    users = q.order_by(User.created_at.desc()).offset(offset).limit(size).all()
    subscription_by_user_id, trial_by_user_id = _load_admin_user_context(db, users)
    items = [
        _build_user_item(u, db, subscription_by_user_id, trial_by_user_id)
        for u in users
    ]
    
    auth_audit_log_async(req_id, str(request.url), "list_users", None, "success", {"count": len(items), "page": page})
    return PaginatedUserList(items=items, total=total, page=page, size=size)


# ----- GET /admin/users/export -----
@router.get("/users/export")
def admin_export_users(
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    users = db.query(User).order_by(User.created_at.desc()).all()
    trial_by_user_id = _load_trial_context(db, [str(user.id) for user in users])

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["账号", "邮箱", "手机", "user_id", "状态", "创建时间", "试用截止", "套餐"])
    for u in users:
        trial_end = trial_by_user_id.get(str(u.id), (None, None))[1]
        trial_str = ""
        if trial_end:
            import datetime as dt
            trial_str = dt.datetime.fromtimestamp(trial_end).strftime("%Y-%m-%d %H:%M")
        writer.writerow([
            _username_of(u),
            u.email or "",
            u.phone or "",
            u.id,
            "禁用" if (u.status or "active") != "active" else "正常",
            u.created_at.strftime("%Y-%m-%d %H:%M") if u.created_at else "",
            trial_str,
            getattr(u, "plan", None) or "trial",
        ])

    auth_audit_log_async(req_id, str(request.url), "export_users", None, "success", {"count": len(users)})
    buf.seek(0)
    bom = "\ufeff"
    return StreamingResponse(
        iter([bom + buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=users.csv"},
    )


# ----- GET /admin/users/{username} -----
@router.get("/users/{username}", response_model=AdminUserDetail)
def admin_get_user(
    username: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "get_user", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})
    trial_end = _trial_end_ts(db, user.id)
    trial_start = _trial_start_ts(db, user.id)
    auth_audit_log_async(req_id, str(request.url), "get_user", _username_of(user), "success", {"user_id": user.id})
    return AdminUserDetail(
        username=_username_of(user),
        user_id=user.id,
        email=user.email,
        phone=user.phone,
        created_at=user.created_at.isoformat() if user.created_at else None,
        disabled=(user.status or "active") != "active",
        is_online=_is_user_online(user),
        last_active_at=user.last_active_at.isoformat() if user.last_active_at else None,
        trial_end=trial_end,
        trial_start=trial_start,
        plan=getattr(user, "plan", None) or "trial",
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
    )


# ----- POST /admin/users/{username}/disable -----
@router.post("/users/{username}/disable")
def admin_disable_user(
    username: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "disable_user", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})
    user.status = "disabled"
    db.commit()
    db.refresh(user)
    auth_audit_log_async(req_id, str(request.url), "disable_user", _username_of(user), "success", {"status": "disabled"})
    return {"ok": True, "username": _username_of(user), "status": "disabled"}


# ----- POST /admin/users/{username}/enable -----
@router.post("/users/{username}/enable")
def admin_enable_user(
    username: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "enable_user", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})
    user.status = "active"
    db.commit()
    db.refresh(user)
    auth_audit_log_async(req_id, str(request.url), "enable_user", _username_of(user), "success", {"status": "active"})
    return {"ok": True, "username": _username_of(user), "status": "active"}


# ----- POST /admin/users/{username}/reset-password -----
@router.post("/users/{username}/reset-password", response_model=AdminResetPasswordResponse)
def admin_reset_password(
    username: str,
    request: Request,
    body: Optional[AdminResetPasswordBody] = None,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "reset_password", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})
    if body and body.new_password:
        new_pass = body.new_password
    else:
        new_pass = secrets.token_urlsafe(12)
    user.password_hash = hash_password(new_pass)
    user.password_configured = True
    db.commit()
    if body and body.new_password:
        auth_audit_log_async(req_id, str(request.url), "reset_password", _username_of(user), "success", {"message": "password_updated"})
        return AdminResetPasswordResponse(message="密码已更新")
    auth_audit_log_async(req_id, str(request.url), "reset_password", _username_of(user), "success", {"temp_password": "***"})
    return AdminResetPasswordResponse(temp_password=new_pass, message="已生成临时密码，请妥善保管")


# ----- POST /admin/users/{username}/extend-trial -----
@router.post("/users/{username}/extend-trial")
def admin_extend_trial(
    username: str,
    body: ExtendTrialBody,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "extend_trial", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})

    user_id_str = str(user.id)
    now_ts = int(time.time())
    extend_secs = body.days * 86400

    try:
        row = db.execute(
            text("SELECT start_ts, end_ts FROM trials WHERE username = :u"),
            {"u": user_id_str},
        ).fetchone()
    except Exception:
        row = None

    if row and row[1]:
        base_ts = max(int(row[1]), now_ts)
        new_end = base_ts + extend_secs
        db.execute(
            text("UPDATE trials SET end_ts = :e WHERE username = :u"),
            {"e": new_end, "u": user_id_str},
        )
    else:
        start_ts = now_ts
        new_end = start_ts + extend_secs
        if is_mysql():
            db.execute(
                text("INSERT INTO trials(username, start_ts, end_ts) VALUES (:u, :s, :e) "
                     "ON DUPLICATE KEY UPDATE start_ts = :s2, end_ts = :e2"),
                {"u": user_id_str, "s": start_ts, "e": new_end, "s2": start_ts, "e2": new_end},
            )
        else:
            db.execute(
                text("INSERT OR REPLACE INTO trials(username, start_ts, end_ts) VALUES (:u, :s, :e)"),
                {"u": user_id_str, "s": start_ts, "e": new_end},
            )
    db.commit()
    auth_audit_log_async(req_id, str(request.url), "extend_trial", _username_of(user), "success", {"days": body.days, "new_end": new_end})
    return {"ok": True, "username": _username_of(user), "trial_end": new_end, "days_added": body.days}


# ----- DELETE /admin/users/{username} -----
@router.delete("/users/{username}")
def admin_delete_user(
    username: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "delete_user", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})
    uid = user.id
    uname = _username_of(user)
    db.query(RefreshToken).filter(RefreshToken.user_id == uid).delete()
    db.query(Subscription).filter(Subscription.user_id == uid).delete()
    try:
        db.execute(text("DELETE FROM trials WHERE username = :u"), {"u": uid})
    except Exception:
        pass
    db.delete(user)
    db.commit()
    auth_audit_log_async(req_id, str(request.url), "delete_user", uname, "success", {"deleted_user_id": uid})
    return {"ok": True, "username": uname, "message": "用户已删除"}


# ----- POST /admin/users/batch-action -----
@router.post("/users/batch-action")
def admin_batch_action(
    request: Request,
    action: str = "disable",
    user_ids: list[str] = Body(default=[]),
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    if action not in ("disable", "enable", "delete"):
        raise HTTPException(status_code=400, detail={"code": "invalid_action", "message": "无效操作"})
    if not user_ids:
        raise HTTPException(status_code=400, detail={"code": "empty_list", "message": "请选择用户"})

    affected = 0
    for uid in user_ids:
        user = db.query(User).filter(User.id == uid).first()
        if not user:
            continue
        if action == "disable":
            user.status = "disabled"
            affected += 1
        elif action == "enable":
            user.status = "active"
            affected += 1
        elif action == "delete":
            db.query(RefreshToken).filter(RefreshToken.user_id == uid).delete()
            db.query(Subscription).filter(Subscription.user_id == uid).delete()
            try:
                db.execute(text("DELETE FROM trials WHERE username = :u"), {"u": uid})
            except Exception:
                pass
            db.delete(user)
            affected += 1
    db.commit()
    auth_audit_log_async(req_id, str(request.url), f"batch_{action}", None, "success", {"count": affected, "total": len(user_ids)})
    return {"ok": True, "action": action, "affected": affected}


# ----- GET /admin/audit-logs -----
@router.get("/audit-logs", response_model=PaginatedAuditLogs)
def admin_audit_logs(
    request: Request,
    page: int = 1,
    size: int = 50,
    action: Optional[str] = None,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if page < 1:
        page = 1
    if size < 1 or size > 200:
        size = 50
    offset = (page - 1) * size

    q = db.query(AuditLog)
    if action and action.strip():
        q = q.filter(AuditLog.action == action.strip())
    total = q.count()
    logs = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(size).all()
    items = [
        AuditLogItem(
            id=log.id,
            action=log.action or "",
            target_user=log.target_user,
            status=log.status or "",
            response=log.response,
            created_at=log.created_at.isoformat() if log.created_at else None,
        )
        for log in logs
    ]
    return PaginatedAuditLogs(items=items, total=total, page=page, size=size)


# ----- GET /admin/users/{username}/live-accounts -----
@router.get("/users/{username}/live-accounts")
def admin_get_user_live_accounts(
    username: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """获取用户的直播账号列表（从 user_configs 表读取）"""
    req_id = _req_id(request)
    user = _get_user_by_username(db, username)
    if not user:
        auth_audit_log_async(req_id, str(request.url), "get_live_accounts", username, "failure", {"reason": "not_found"})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "user_not_found", "message": "用户不存在"})
    
    # 从 user_configs 表获取用户配置
    user_config = db.query(UserConfig).filter(UserConfig.user_id == user.id).first()
    
    accounts = []
    if user_config and user_config.config_json:
        config = user_config.config_json or {}
        accounts = config.get("accounts", [])
    
    auth_audit_log_async(req_id, str(request.url), "get_live_accounts", _username_of(user), "success", {"count": len(accounts)})
    
    return {
        "success": True,
        "user_id": user.id,
        "username": _username_of(user),
        "accounts": accounts,
        "total": len(accounts),
    }
