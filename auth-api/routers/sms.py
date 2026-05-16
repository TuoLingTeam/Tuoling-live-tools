"""手机验证码登录/注册路由：/auth/sms/send, /auth/sms/login"""
import logging
import re
import time
import unicodedata
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import get_db, is_mysql
from deps import (
    hash_password,
    issue_user_session,
    user_has_password,
)
from models import SMSCode, SMSVerifyFailure, Subscription, User
from schemas import (
    PhoneLoginBody,
    ResetPasswordSmsBody,
    LoginResponse,
    MIN_PASSWORD_LENGTH,
    SendCodeBody,
    UserOut,
    err_phone_format_error,
    err_phone_not_registered,
    err_sms_code_invalid_or_expired,
    err_sms_send_failed,
    err_sms_verify_failed,
)
from sms_service import (
    SMS_CODE_EXPIRE_SECONDS,
    SMS_CODE_RESEND_COOLDOWN,
    generate_sms_code,
    get_sms_service,
    mask_phone,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/sms", tags=["sms"])

SMS_ERROR_DETAILS = {
    "too_many_requests": {"code": "too_many_requests", "message": "发送过于频繁，请稍后再试"},
    "daily_limit_exceeded": {"code": "daily_limit_exceeded", "message": "今日发送次数已达上限"},
    "too_many_failures": {"code": "too_many_failures", "message": "尝试过于频繁，请稍后再试"},
}


@router.get("/status")
def sms_status():
    """诊断用：查看当前短信服务模式与是否已配置，便于排查收不到验证码。不返回密钥等敏感信息。"""
    import os
    mode = (os.getenv("SMS_MODE") or "dev").strip().lower()
    has_key = bool(os.getenv("ALIYUN_ACCESS_KEY_ID") and os.getenv("ALIYUN_ACCESS_KEY_SECRET"))
    has_sign = bool(os.getenv("ALIYUN_SMS_SIGN_NAME"))
    has_tpl = bool(os.getenv("ALIYUN_SMS_TEMPLATE_CODE"))
    configured = has_key and has_sign and has_tpl
    return {
        "mode": mode,
        "configured": configured,
        "has_key": has_key,
        "has_sign": has_sign,
        "has_template": has_tpl,
    }


def is_valid_phone(phone: str) -> bool:
    return bool(re.match(r"^1[3-9]\d{9}$", phone))


def normalize_phone_input(phone: str) -> str:
    normalized = unicodedata.normalize("NFKC", phone or "")
    return re.sub(r"\D", "", normalized)


def normalize_sms_code_input(code: str) -> str:
    normalized = unicodedata.normalize("NFKC", code or "")
    return re.sub(r"\s+", "", normalized)


def is_invalid_sms_verify_message(message: Optional[str]) -> bool:
    if not message:
        return False
    normalized = message.lower()
    return any(
        token in normalized
        for token in (
            "invalid_code",
            "code_expired",
            "not_supported",
            "验证码错误",
            "已过期",
            "unknown",
        )
    )


def raise_sms_verify_exception(phone: str, code: str, verify_msg: Optional[str]) -> None:
    logger.warning(
        "[SMS] verify failed: phone=%s code_suffix=%s verify_msg=%s",
        mask_phone(phone),
        code[-2:] if code else "",
        verify_msg,
    )
    if is_invalid_sms_verify_message(verify_msg):
        raise HTTPException(status_code=400, detail=err_sms_code_invalid_or_expired())
    raise HTTPException(status_code=503, detail=err_sms_verify_failed())


def get_client_ip(request: Request) -> str:
    x_forwarded_for = request.headers.get("X-Forwarded-For")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else ""


def check_rate_limit(db: Session, phone: str) -> tuple[bool, Optional[str]]:
    now = int(time.time())

    recent = db.query(SMSCode).filter(
        SMSCode.phone == phone,
        SMSCode.created_at >= now - SMS_CODE_RESEND_COOLDOWN
    ).first()

    if recent:
        remaining = SMS_CODE_RESEND_COOLDOWN - (now - recent.created_at)
        return False, f"too_many_requests"

    return True, None


SMS_CODE_DAILY_LIMIT = 10
SMS_CODE_LOCKOUT_AFTER_FAILURES = 5
SMS_CODE_LOCKOUT_DURATION = 600


def check_daily_limit(db: Session, phone: str) -> tuple[bool, Optional[str]]:
    today = datetime.now().strftime("%Y%m%d")
    count = db.query(SMSCode).filter(
        SMSCode.phone == phone,
        SMSCode.date_str == today
    ).count()

    if count >= SMS_CODE_DAILY_LIMIT:
        return False, "daily_limit_exceeded"
    return True, None


def check_brute_force(db: Session, phone: str) -> tuple[bool, Optional[str]]:
    now = int(time.time())

    recent_failures = db.query(SMSVerifyFailure).filter(
        SMSVerifyFailure.phone == phone,
        SMSVerifyFailure.created_at >= now - SMS_CODE_LOCKOUT_DURATION,
    ).count()

    if recent_failures >= SMS_CODE_LOCKOUT_AFTER_FAILURES:
        return False, "too_many_failures"
    return True, None


def record_verify_failure(db: Session, phone: str, action: str) -> None:
    db.add(
        SMSVerifyFailure(
            phone=phone,
            action=action,
            created_at=int(time.time()),
        )
    )
    db.commit()


def reject_sms_verification(
    db: Session,
    *,
    phone: str,
    code: str,
    verify_msg: Optional[str],
    action: str,
) -> None:
    if verify_msg == "not_supported" or is_invalid_sms_verify_message(verify_msg):
        record_verify_failure(db, phone, action)
        raise_sms_verify_exception(phone, code, "invalid_code")

    raise_sms_verify_exception(phone, code, verify_msg)


def create_user_for_phone(phone: str, db: Session) -> User:
    """为手机号创建用户，与密码注册逻辑保持一致"""
    now = datetime.utcnow()
    pw = hash_password("!")
    
    user_id = str(uuid.uuid4())
    from sqlalchemy import text as sa_text
    db.execute(
        sa_text(
            "INSERT INTO users (id, username, email, phone, password_hash, password_configured, created_at, updated_at, status, plan) "
            "VALUES (:id, :u, NULL, :p, :pw, :pc, :ca, :ua, 'active', 'trial')"
        ),
        {"id": user_id, "u": phone, "p": phone, "pw": pw, "pc": False, "ca": now, "ua": now},
    )
    db.commit()

    user = db.query(User).filter(User.phone == phone).first()

    try:
        from sqlalchemy import text as sa_text2
        _sub_sql = (
            "INSERT IGNORE INTO subscriptions (id, user_id, plan, status) "
            "VALUES (:sid, :uid, 'trial', 'active')"
        ) if is_mysql() else (
            "INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status) "
            "VALUES (:sid, :uid, 'trial', 'active')"
        )
        db.execute(sa_text2(_sub_sql), {"sid": str(uuid.uuid4()), "uid": str(user.id)})
        db.commit()
    except Exception:
        db.rollback()

    logger.info(f"[SMS] Auto-created user: username={phone}, phone={mask_phone(phone)}")
    return user


@router.post("/send")
def send_sms(
    request: Request,
    db: Session = Depends(get_db),
    body: Optional[SendCodeBody] = Body(default=None),
    phone: Optional[str] = Query(default=None, description="11 位手机号"),
):
    phone = normalize_phone_input((body.phone if body else phone) or "")
    request_id = getattr(request.state, "request_id", "unknown")
    client_ip = get_client_ip(request)

    logger.info(f"[SMS][{request_id}] send request: phone={mask_phone(phone)}, ip={client_ip}")

    if not is_valid_phone(phone):
        logger.warning(f"[SMS][{request_id}] invalid phone format: {phone}")
        raise HTTPException(status_code=422, detail=err_phone_format_error())

    allowed, error = check_rate_limit(db, phone)
    if not allowed:
        logger.warning(f"[SMS][{request_id}] rate limit: phone={mask_phone(phone)}")
        raise HTTPException(status_code=429, detail=SMS_ERROR_DETAILS.get(error, {"code": error, "message": "发送过于频繁，请稍后再试"}))

    allowed, error = check_daily_limit(db, phone)
    if not allowed:
        logger.warning(f"[SMS][{request_id}] daily limit: phone={mask_phone(phone)}")
        raise HTTPException(status_code=429, detail=SMS_ERROR_DETAILS.get(error, {"code": error, "message": "今日发送次数已达上限"}))

    sms_service = get_sms_service()
    code = "" if getattr(sms_service, "mode", "") == "aliyun_dypns" else generate_sms_code(6)
    now = int(time.time())
    today = datetime.now().strftime("%Y%m%d")

    sms_code = SMSCode(
        phone=phone,
        code=code or "dypns",
        expire_at=now + SMS_CODE_EXPIRE_SECONDS,
        created_at=now,
        used=0,
        date_str=today
    )
    db.add(sms_code)
    db.commit()

    success, error_msg = False, None

    try:
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            success, error_msg = loop.run_until_complete(sms_service.send(phone, code or "0"))
        finally:
            asyncio.set_event_loop(None)
            loop.close()
    except Exception as e:
        logger.exception(f"[SMS][{request_id}] send exception: {e}")
        success = False
        error_msg = str(e)

    mode = getattr(sms_service, "mode", "")
    has_local_code = bool(code)
    # [SECURITY] 只有在明确测试模式下才返回 dev_code，防止生产环境泄露
    is_test_mode = mode == "test"

    if not success:
        logger.error(f"[SMS][{request_id}] send failed: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail=err_sms_send_failed(),
        )

    logger.info(f"[SMS][{request_id}] code sent: phone={mask_phone(phone)}")
    # [SECURITY] 只有明确测试模式才返回 dev_code，其他模式（包括 dev）都不返回
    if is_test_mode and has_local_code:
        return {"success": True, "dev_code": code}
    return {"success": True}


@router.post("/login")
def login_with_sms(
    db: Session = Depends(get_db),
    body: Optional[PhoneLoginBody] = Body(default=None),
    phone: Optional[str] = Query(default=None, description="11 位手机号"),
    code: Optional[str] = Query(default=None, description="6 位验证码"),
):
    phone = normalize_phone_input((body.phone if body else phone) or "")
    code = normalize_sms_code_input((body.code if body else code) or "")
    allowed, error = check_brute_force(db, phone)
    if not allowed:
        logger.warning(f"[SMS] brute force check failed: phone={mask_phone(phone)}")
        raise HTTPException(status_code=429, detail=SMS_ERROR_DETAILS.get(error, {"code": error, "message": "尝试过于频繁，请稍后再试"}))

    sms_service = get_sms_service()
    verified_ok = False
    now = int(time.time())
    # 先查库：兜底验证码（send 失败时写入的 fallback）或 dev/aliyun 模式均存库，可由此核验
    sms_code = db.query(SMSCode).filter(
        SMSCode.phone == phone,
        SMSCode.code == code,
        SMSCode.expire_at > now,
        SMSCode.used == 0
    ).first()
    if sms_code:
        sms_code.used = 1
        db.commit()
        verified_ok = True
    if not verified_ok and getattr(sms_service, "mode", "") == "aliyun_dypns":
        # dypns 且库中无此 code：走阿里云核验（真实短信下发的码）
        verify_success, verify_msg = sms_service.verify(phone, code)
        if verify_success:
            verified_ok = True
        if not verified_ok:
            reject_sms_verification(
                db,
                phone=phone,
                code=code,
                verify_msg=verify_msg,
                action="login",
            )
    elif not verified_ok:
        verify_success, verify_msg = sms_service.verify(phone, code)
        if verify_msg == "not_supported":
            pass  # 已在上方查库处理
        elif verify_success:
            verified_ok = True
        if not verified_ok:
            reject_sms_verification(
                db,
                phone=phone,
                code=code,
                verify_msg=verify_msg,
                action="login",
            )

    if not verified_ok:
        record_verify_failure(db, phone, "login")
        raise HTTPException(status_code=400, detail=err_sms_code_invalid_or_expired())

    user = db.query(User).filter(User.phone == phone).first()

    if not user:
        user = create_user_for_phone(phone, db)

    if user.status != "active":
        raise HTTPException(
            status_code=403,
            detail={"code": "account_disabled", "message": "账号已被禁用，请联系客服"},
        )

    user.last_login_at = datetime.utcnow()
    user_id_str = str(user.id)
    token, refresh_raw, _refresh_token_id = issue_user_session(db, user_id_str)
    db.commit()

    logger.info(f"[SMS] login success: phone={mask_phone(phone)}, username={user.username}")

    _has_real_password = user_has_password(user)

    # 统一返回格式与密码登录一致
    now = datetime.utcnow()
    created_at = getattr(user, "created_at", None)
    if created_at is None or not hasattr(created_at, "year"):
        created_at = now
    last_login_at = getattr(user, "last_login_at", None)
    status_str = (getattr(user, "status", None) or "active").strip() or "active"

    return LoginResponse(
        user=UserOut(
            id=user_id_str,
            email=getattr(user, "email", None),
            phone=getattr(user, "phone", None),
            created_at=created_at,
            last_login_at=last_login_at,
            status=status_str,
        ),
        access_token=token,
        token=token,
        refresh_token=refresh_raw,
        needs_password=not _has_real_password,
    )


@router.post("/reset-password")
def reset_password_sms(
    db: Session = Depends(get_db),
    body: Optional[ResetPasswordSmsBody] = Body(default=None),
    phone: Optional[str] = Query(default=None, description="11 位手机号"),
    code: Optional[str] = Query(default=None, description="6 位验证码"),
    new_password: Optional[str] = Query(default=None, description="新密码（至少 8 位）"),
):
    """POST /auth/sms/reset-password：通过手机验证码重置密码（忘记密码）"""
    phone = normalize_phone_input((body.phone if body else phone) or "")
    code = normalize_sms_code_input((body.code if body else code) or "")
    new_password = (body.new_password if body else new_password) or ""
    if not is_valid_phone(phone):
        raise HTTPException(status_code=422, detail=err_phone_format_error())

    if len(new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_params", "message": f"密码至少 {MIN_PASSWORD_LENGTH} 位"},
        )

    sms_service = get_sms_service()
    verified_ok = False
    now = int(time.time())
    sms_code = db.query(SMSCode).filter(
        SMSCode.phone == phone,
        SMSCode.code == code,
        SMSCode.expire_at > now,
        SMSCode.used == 0,
    ).first()
    if sms_code:
        sms_code.used = 1
        db.commit()
        verified_ok = True
    if not verified_ok and getattr(sms_service, "mode", "") == "aliyun_dypns":
        verify_success, verify_msg = sms_service.verify(phone, code)
        if verify_success:
            verified_ok = True
        if not verified_ok:
            reject_sms_verification(
                db,
                phone=phone,
                code=code,
                verify_msg=verify_msg,
                action="reset_password",
            )
    elif not verified_ok:
        verify_success, verify_msg = sms_service.verify(phone, code)
        if verify_msg == "not_supported":
            pass
        elif verify_success:
            verified_ok = True
        if not verified_ok:
            reject_sms_verification(
                db,
                phone=phone,
                code=code,
                verify_msg=verify_msg,
                action="reset_password",
            )

    if not verified_ok:
        record_verify_failure(db, phone, "reset_password")
        raise HTTPException(status_code=400, detail=err_sms_code_invalid_or_expired())

    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail=err_phone_not_registered(),
        )

    user.password_hash = hash_password(new_password)
    user.password_configured = True
    db.commit()
    logger.info(f"[SMS] password reset: phone={mask_phone(phone)}, username={user.username}")
    return {"ok": True, "message": "密码重置成功"}
