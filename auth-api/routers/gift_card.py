"""礼品卡路由：用户兑换 /gift-card/redeem，管理员 /admin/gift-cards/*"""
import csv
import io
import logging
import re
import secrets
import time
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database import get_db, is_mysql
from deps import auth_audit_log, auth_audit_log_async, get_current_admin, get_current_user
from models import GiftCard, GiftCardRedemption, Subscription, User
from schemas import (
    CreateGiftCardBody,
    CreateGiftCardResponse,
    GiftCardOut,
    GiftCardRedemptionOut,
    GiftCardStatsOut,
    PaginatedGiftCards,
    RedeemGiftCardBody,
    RedeemResultOut,
)
from subscription_rules import (
    TIER_BENEFITS,
    get_tier_benefits,
    infer_tier_from_membership_type,
    is_upgrade_allowed,
    normalize_plan,
    normalize_tier,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["gift-card"])

# 兑换码字符集：去除容易混淆的 O/0/I/1/L
_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
# 支持多种格式：XXXX-XXXX-XXXX 或 XXXX-XXXX 或 XXXX-XXX 等，支持大小写和连字符
_CODE_PATTERN = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$")


def _generate_code() -> str:
    """生成 XXXX-XXXX-XXXX 格式兑换码"""
    parts = []
    for _ in range(3):
        part = "".join(secrets.choice(_CODE_CHARS) for _ in range(4))
        parts.append(part)
    return "-".join(parts)


def _card_to_out(card: GiftCard) -> GiftCardOut:
    return GiftCardOut(
        id=card.id,
        code=card.code,
        type=card.type or "membership",
        tier=card.tier or "pro",  # 新增
        membership_type=card.membership_type,
        membership_days=card.membership_days or 0,
        status=card.status or "active",
        batch_id=card.batch_id,
        created_by=card.created_by,
        created_at=card.created_at.isoformat() if card.created_at else None,
        expires_at=card.expires_at.isoformat() if card.expires_at else None,
        redeemed_at=card.redeemed_at.isoformat() if card.redeemed_at else None,
        redeemed_by=card.redeemed_by,
    )


def _req_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


def _generate_unique_codes(db: Session, quantity: int) -> List[str]:
    selected_codes: List[str] = []
    generated_codes = set()
    generated_attempts = 0
    max_generated = max(50, quantity * 20)

    while len(selected_codes) < quantity and generated_attempts < max_generated:
        needed = quantity - len(selected_codes)
        batch_size = min(max(needed * 2, 8), max_generated - generated_attempts)
        candidate_codes: List[str] = []
        for _ in range(batch_size):
            generated_attempts += 1
            code = _generate_code()
            if code in generated_codes:
                continue
            generated_codes.add(code)
            candidate_codes.append(code)

        if not candidate_codes:
            continue

        existing_codes = {
            row[0]
            for row in db.query(GiftCard.code)
            .filter(GiftCard.code.in_(candidate_codes))
            .all()
        }
        for code in candidate_codes:
            if code in existing_codes:
                continue
            selected_codes.append(code)
            if len(selected_codes) >= quantity:
                break

    if len(selected_codes) < quantity:
        raise HTTPException(status_code=500, detail={"code": "code_gen_failed", "message": "兑换码生成失败"})

    return selected_codes


def _normalize_card_ids(raw_ids) -> List[str]:
    if not isinstance(raw_ids, list):
        return []

    normalized_ids: List[str] = []
    seen = set()
    for raw_id in raw_ids:
        card_id = str(raw_id).strip()
        if not card_id or card_id in seen:
            continue
        seen.add(card_id)
        normalized_ids.append(card_id)
    return normalized_ids


# ===================== 用户端 =====================

@router.post("/gift-card/redeem", response_model=RedeemResultOut)
def redeem_gift_card(
    body: RedeemGiftCardBody,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """用户兑换礼品卡"""
    req_id = _req_id(request)
    code = body.code.strip().upper()

    if not _CODE_PATTERN.match(code):
        return RedeemResultOut(success=False, error="INVALID_CODE_FORMAT", message="兑换码格式不正确，请检查后重试")

    card = db.query(GiftCard).filter(func.upper(GiftCard.code) == code).first()
    if not card:
        auth_audit_log(req_id, str(request.url), "redeem_gift_card", user.email or user.phone, "failure", {"reason": "not_found"})
        return RedeemResultOut(success=False, error="CODE_NOT_FOUND", message="兑换码不存在，请检查后重试")

    if card.status == "redeemed":
        return RedeemResultOut(success=False, error="ALREADY_REDEEMED", message="该兑换码已被使用")

    if card.status == "disabled":
        return RedeemResultOut(success=False, error="CODE_DISABLED", message="兑换码已禁用，请联系客服")

    if card.status == "expired":
        return RedeemResultOut(success=False, error="CODE_EXPIRED", message="兑换码已过期")

    if card.expires_at and card.expires_at < datetime.utcnow():
        card.status = "expired"
        db.commit()
        return RedeemResultOut(success=False, error="CODE_EXPIRED", message="兑换码已过期")

    user_id_str = str(user.id)
    now_ts = int(time.time())

    # 查询当前试用/订阅状态
    try:
        row = db.execute(
            text("SELECT start_ts, end_ts FROM trials WHERE username = :u"),
            {"u": user_id_str},
        ).fetchone()
    except Exception:
        row = None

    previous_plan = normalize_plan(getattr(user, "plan", None))
    previous_expiry_ts = int(row[1]) if row and row[1] else None
    previous_max_accounts = getattr(user, "max_accounts", 1)

    # 确定档位和权益
    # 优先使用tier字段，兼容旧数据使用membership_type
    tier = normalize_tier(card.tier or infer_tier_from_membership_type(card.membership_type or "pro"))
    benefits = get_tier_benefits(tier, card.benefits_json)
    
    # 计算新的到期时间
    membership_days = card.membership_days or benefits.get("duration_days") or 0
    if membership_days <= 0:
        auth_audit_log(
            req_id,
            str(request.url),
            "redeem_gift_card",
            user.email or user.phone,
            "failure",
            {"reason": "invalid_duration", "card_id": card.id},
        )
        return RedeemResultOut(
            success=False,
            error="INVALID_CARD_CONFIG",
            message="礼品卡配置无效，请联系客服处理",
        )
    extend_secs = membership_days * 86400 if membership_days > 0 else 0
    new_plan = normalize_plan(benefits.get("plan"), default=tier)
    new_max_accounts = benefits.get("max_accounts", 1)

    # 检查是否允许升级（不允许降级）
    if not is_upgrade_allowed(previous_plan, new_plan):
        return RedeemResultOut(
            success=False, 
            error="DOWNGRADE_NOT_ALLOWED", 
            message="不支持降级兑换，请选择同档位或更高档位的礼品卡"
        )

    if previous_expiry_ts and previous_expiry_ts > now_ts and membership_days > 0:
        new_expiry_ts = previous_expiry_ts + extend_secs
    elif membership_days > 0:
        new_expiry_ts = now_ts + extend_secs
    else:
        # 永久权益，不设置过期时间
        new_expiry_ts = None

    try:
        # 【P0-1】更新 trials 表（保持向后兼容）
        if new_expiry_ts:
            if row:
                start_ts = int(row[0]) if row[0] else now_ts
                db.execute(
                    text("UPDATE trials SET end_ts = :e WHERE username = :u"),
                    {"e": new_expiry_ts, "u": user_id_str},
                )
            else:
                if is_mysql():
                    db.execute(
                        text(
                            "INSERT INTO trials(username, start_ts, end_ts) VALUES (:u, :s, :e) "
                            "ON DUPLICATE KEY UPDATE start_ts = :s2, end_ts = :e2"
                        ),
                        {"u": user_id_str, "s": now_ts, "e": new_expiry_ts, "s2": now_ts, "e2": new_expiry_ts},
                    )
                else:
                    db.execute(
                        text("INSERT OR REPLACE INTO trials(username, start_ts, end_ts) VALUES (:u, :s, :e)"),
                        {"u": user_id_str, "s": now_ts, "e": new_expiry_ts},
                    )

        # 【P0-1】同步更新 subscriptions 表，确保与 /auth/status 查询链路一致
        # 策略：UPSERT - 如果存在则更新，不存在则插入
        # 使用 user_id 作为关联键，与 /auth/status 查询条件一致
        current_period_end = datetime.utcfromtimestamp(new_expiry_ts) if new_expiry_ts else None
        
        # 先尝试更新现有记录
        update_result = db.execute(
            text("""
                UPDATE subscriptions 
                SET plan = :plan, 
                    current_period_end = :end_date,
                    status = 'active'
                WHERE user_id = :user_id
            """),
            {
                "plan": new_plan,
                "end_date": current_period_end,
                "user_id": user_id_str,
            },
        )
        
        # 如果没有更新到记录，则插入新记录
        if update_result.rowcount == 0:
            new_subscription = Subscription(
                id=str(uuid.uuid4()),
                user_id=user_id_str,
                plan=new_plan,
                status="active",
                current_period_end=current_period_end,
            )
            db.add(new_subscription)

        # 更新用户 plan 和账号数量限制
        user.plan = new_plan
        user.max_accounts = new_max_accounts

        # 更新礼品卡状态
        card.status = "redeemed"
        card.redeemed_at = datetime.utcnow()
        card.redeemed_by = user_id_str

        # 写入兑换记录
        redemption = GiftCardRedemption(
            id=str(uuid.uuid4()),
            gift_card_id=card.id,
            user_id=user_id_str,
            redeemed_at=datetime.utcnow(),
            previous_plan=previous_plan,
            new_plan=new_plan,
            previous_expiry_ts=previous_expiry_ts,
            new_expiry_ts=new_expiry_ts,
        )
        db.add(redemption)
        db.commit()

        expiry_iso = datetime.utcfromtimestamp(new_expiry_ts).isoformat() + "Z" if new_expiry_ts else None

        auth_audit_log(
            req_id, str(request.url), "redeem_gift_card",
            user.email or user.phone, "success",
            {"card_id": card.id, "tier": tier, "new_plan": new_plan, "max_accounts": new_max_accounts},
        )

        return RedeemResultOut(
            success=True,
            message="兑换成功",
            data={
                "membershipType": new_plan,
                "membershipDays": membership_days,
                "newMembershipType": new_plan,
                "newExpiryDate": expiry_iso,
                "tier": tier,
                "maxAccounts": new_max_accounts,
                "previousMaxAccounts": previous_max_accounts,
                "redeemedBalance": 0,
                "newBalance": 0,
            },
        )
    except Exception as e:
        db.rollback()
        logger.exception("redeem_gift_card failed: %s", e)
        auth_audit_log(req_id, str(request.url), "redeem_gift_card", user.email or user.phone, "failure", {"error": str(e)})
        return RedeemResultOut(success=False, error="REDEEM_FAILED", message="兑换失败，请稍后重试")


@router.get("/gift-card/history")
def gift_card_history(
    limit: int = 20,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """用户查询自己的兑换历史"""
    user_id_str = str(user.id)
    redemptions = (
        db.query(GiftCardRedemption)
        .filter(GiftCardRedemption.user_id == user_id_str)
        .order_by(GiftCardRedemption.redeemed_at.desc())
        .limit(min(limit, 100))
        .all()
    )
    card_ids = [r.gift_card_id for r in redemptions if r.gift_card_id]
    cards_by_id = {}
    if card_ids:
        cards_by_id = {
            card.id: card
            for card in db.query(GiftCard)
            .filter(GiftCard.id.in_(card_ids))
            .all()
        }

    items = []
    for r in redemptions:
        card = cards_by_id.get(r.gift_card_id)
        items.append(GiftCardRedemptionOut(
            id=r.id,
            gift_card_code=card.code if card else "UNKNOWN",
            membership_type=card.membership_type if card else None,
            membership_days=card.membership_days if card else 0,
            redeemed_at=r.redeemed_at.isoformat() if r.redeemed_at else None,
            previous_plan=r.previous_plan,
            new_plan=r.new_plan,
        ))
    return {"success": True, "data": items}


# ===================== 管理员端 =====================

@router.post("/admin/gift-cards", response_model=CreateGiftCardResponse)
def admin_create_gift_cards(
    body: CreateGiftCardBody,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员批量生成礼品卡"""
    req_id = _req_id(request)
    
    # 验证档位
    tier = (body.tier or "pro").strip().lower()
    if tier not in TIER_BENEFITS:
        raise HTTPException(status_code=400, detail={"code": "invalid_tier", "message": f"无效的档位: {tier}"})
    
    batch_id = str(uuid.uuid4())
    expires_at = None
    if body.expires_at:
        try:
            expires_at = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail={"code": "invalid_params", "message": "过期时间格式不正确"})

    # 获取档位权益配置
    benefits = get_tier_benefits(tier)
    membership_days = (
        body.membership_days if body.membership_days > 0 else benefits.get("duration_days", 0)
    )
    if membership_days <= 0:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_duration", "message": "礼品卡必须配置有效的会员天数"},
        )
    benefits["duration_days"] = membership_days

    cards = []
    for code in _generate_unique_codes(db, body.quantity):
        card = GiftCard(
            id=str(uuid.uuid4()),
            code=code,
            type=body.type,
            tier=tier,
            benefits_json=benefits,
            membership_type=benefits["plan"],  # 兼容旧字段
            membership_days=membership_days,
            status="active",
            batch_id=batch_id,
            created_by=admin,
            created_at=datetime.utcnow(),
            expires_at=expires_at,
        )
        db.add(card)
        cards.append(card)

    db.commit()

    card_outs = [_card_to_out(c) for c in cards]
    auth_audit_log_async(req_id, str(request.url), "create_gift_cards", admin, "success", {"batch_id": batch_id, "count": len(cards)})
    return CreateGiftCardResponse(batch_id=batch_id, cards=card_outs, count=len(cards))


def _gift_cards_query(db: Session, status_filter: Optional[str], batch_id: Optional[str], code_search: Optional[str]):
    """共用筛选逻辑"""
    q = db.query(GiftCard)
    if status_filter and status_filter.strip():
        q = q.filter(GiftCard.status == status_filter.strip())
    if batch_id and batch_id.strip():
        q = q.filter(GiftCard.batch_id == batch_id.strip())
    if code_search and code_search.strip():
        code_val = code_search.strip()
        q = q.filter(GiftCard.code.ilike(f"%{code_val}%"))
    return q


@router.get("/admin/gift-cards", response_model=PaginatedGiftCards)
def admin_list_gift_cards(
    request: Request,
    page: int = 1,
    size: int = 20,
    status_filter: Optional[str] = None,
    batch_id: Optional[str] = None,
    code_search: Optional[str] = None,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员查看礼品卡列表（支持状态、批次、兑换码搜索）"""
    if page < 1:
        page = 1
    if size < 1 or size > 100:
        size = 20
    offset = (page - 1) * size

    q = _gift_cards_query(db, status_filter, batch_id, code_search)
    total = q.count()
    cards = q.order_by(GiftCard.created_at.desc()).offset(offset).limit(size).all()
    
    # 关联查询用户手机号
    user_ids = list({c.redeemed_by for c in cards if c.redeemed_by})
    phone_map = {}
    if user_ids:
        users = db.query(User.id, User.phone).filter(User.id.in_(user_ids)).all()
        phone_map = {str(u.id): u.phone for u in users}
    
    items = []
    for c in cards:
        card_out = _card_to_out(c)
        if c.redeemed_by and c.redeemed_by in phone_map:
            card_out.redeemed_by = phone_map[c.redeemed_by]
        items.append(card_out)
    
    return PaginatedGiftCards(items=items, total=total, page=page, size=size)


@router.get("/admin/gift-cards/export")
def admin_export_gift_cards(
    request: Request,
    status_filter: Optional[str] = None,
    batch_id: Optional[str] = None,
    code_search: Optional[str] = None,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """导出礼品卡为 CSV（按当前筛选条件）"""
    req_id = _req_id(request)
    q = _gift_cards_query(db, status_filter, batch_id, code_search)
    cards = q.order_by(GiftCard.created_at.desc()).limit(10000).all()
    
    # 关联查询用户手机号
    user_ids = list({c.redeemed_by for c in cards if c.redeemed_by})
    phone_map = {}
    if user_ids:
        users = db.query(User.id, User.phone).filter(User.id.in_(user_ids)).all()
        phone_map = {str(u.id): u.phone for u in users}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["兑换码", "类型", "天数", "状态", "批次ID", "创建时间", "过期时间", "兑换时间", "兑换者"])
    for c in cards:
        created_str = c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else "-"
        expires_str = c.expires_at.strftime("%Y-%m-%d %H:%M") if c.expires_at else "-"
        redeemed_str = c.redeemed_at.strftime("%Y-%m-%d %H:%M") if c.redeemed_at else "-"
        redeemed_by = phone_map.get(c.redeemed_by, c.redeemed_by) if c.redeemed_by else "-"
        writer.writerow([
            c.code,
            c.membership_type or "-",
            c.membership_days or 0,
            c.status or "active",
            c.batch_id or "-",
            created_str,
            expires_str,
            redeemed_str,
            redeemed_by,
        ])
    auth_audit_log_async(req_id, str(request.url), "export_gift_cards", admin, "success", {"count": len(cards)})
    buf.seek(0)
    bom = "\ufeff"
    return StreamingResponse(
        iter([bom + buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=gift_cards.csv"},
    )


@router.post("/admin/gift-cards/{card_id}/disable")
def admin_disable_gift_card(
    card_id: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员禁用礼品卡"""
    req_id = _req_id(request)
    card = db.query(GiftCard).filter(GiftCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "礼品卡不存在"})
    if card.status == "redeemed":
        raise HTTPException(status_code=400, detail={"code": "already_redeemed", "message": "该礼品卡已被兑换，无法禁用"})
    card.status = "disabled"
    db.commit()
    auth_audit_log_async(req_id, str(request.url), "disable_gift_card", admin, "success", {"card_id": card_id})
    return {"ok": True, "message": "礼品卡已禁用"}


@router.post("/admin/gift-cards/batch-disable")
def admin_batch_disable_gift_cards(
    request: Request,
    body: dict = Body(...),
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """批量禁用礼品卡（仅对可用状态生效）"""
    req_id = _req_id(request)
    card_ids = _normalize_card_ids(body.get("card_ids") or [])
    if not card_ids:
        raise HTTPException(status_code=400, detail={"code": "empty_list", "message": "请选择要禁用的礼品卡"})
    affected = db.query(GiftCard).filter(
        GiftCard.id.in_(card_ids),
        GiftCard.status == "active",
    ).update({"status": "disabled"}, synchronize_session=False)
    db.commit()
    auth_audit_log_async(req_id, str(request.url), "batch_disable_gift_cards", admin, "success", {"affected": affected, "total": len(card_ids)})
    return {"ok": True, "affected": affected, "message": f"已禁用 {affected} 张礼品卡"}


@router.post("/admin/gift-cards/batch-delete")
def admin_batch_delete_gift_cards(
    request: Request,
    body: dict = Body(...),
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """批量删除礼品卡（仅可删除未兑换的卡，已兑换的将跳过）"""
    req_id = _req_id(request)
    card_ids = _normalize_card_ids(body.get("card_ids") or [])
    if not card_ids:
        raise HTTPException(status_code=400, detail={"code": "empty_list", "message": "请选择要删除的礼品卡"})
    status_rows = db.query(GiftCard.id, GiftCard.status).filter(GiftCard.id.in_(card_ids)).all()
    status_by_id = {row[0]: row[1] for row in status_rows}
    skipped_redeemed = sum(1 for status in status_by_id.values() if status == "redeemed")
    deletable_ids = [
        card_id
        for card_id in card_ids
        if card_id in status_by_id and status_by_id[card_id] != "redeemed"
    ]
    deleted = 0
    if deletable_ids:
        db.query(GiftCardRedemption).filter(
            GiftCardRedemption.gift_card_id.in_(deletable_ids)
        ).delete(synchronize_session=False)
        deleted = db.query(GiftCard).filter(GiftCard.id.in_(deletable_ids)).delete(synchronize_session=False)
    db.commit()
    auth_audit_log_async(req_id, str(request.url), "batch_delete_gift_cards", admin, "success", {"deleted": deleted, "skipped_redeemed": skipped_redeemed})
    return {"ok": True, "deleted": deleted, "skipped_redeemed": skipped_redeemed, "message": f"已删除 {deleted} 张，{skipped_redeemed} 张已兑换已跳过"}


@router.get("/admin/gift-cards/stats", response_model=GiftCardStatsOut)
def admin_gift_card_stats(
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员查看礼品卡统计"""
    now = datetime.utcnow()
    db.query(GiftCard).filter(
        GiftCard.status == "active",
        GiftCard.expires_at != None,
        GiftCard.expires_at < now,
    ).update({"status": "expired"}, synchronize_session=False)
    db.commit()

    status_counts = {
        row[0]: row[1]
        for row in db.query(GiftCard.status, func.count(GiftCard.id))
        .group_by(GiftCard.status)
        .all()
    }
    total = sum(status_counts.values())
    active = status_counts.get("active", 0)
    redeemed = status_counts.get("redeemed", 0)
    expired = status_counts.get("expired", 0)
    disabled = status_counts.get("disabled", 0)

    return GiftCardStatsOut(
        total=total,
        active=active,
        redeemed=redeemed,
        expired=expired,
        disabled=disabled,
    )
