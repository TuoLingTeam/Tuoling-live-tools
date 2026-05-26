"""消息中心：客户端读取消息，管理员发布/编辑消息"""
import asyncio
import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from deps import auth_audit_log_async, get_current_admin, get_current_user
from models import Announcement, AnnouncementReceipt, AnnouncementStreamState, User
from schemas import MessageItem, MessageListResponse, MessageMarkReadResponse
from schemas_admin import (
    AdminAnnouncementActionResponse,
    AdminAnnouncementItem,
    AdminAnnouncementUpsertBody,
    PaginatedAdminAnnouncements,
)
from subscription_rules import normalize_plan

router = APIRouter(prefix="/messages", tags=["messages"])
admin_router = APIRouter(prefix="/admin/messages", tags=["admin-messages"])


@dataclass
class _LoopStreamWatcher:
    loop: asyncio.AbstractEventLoop
    condition: asyncio.Condition
    version: int = -1
    waiter_count: int = 0
    idle_ticks: int = 0
    task: Optional[asyncio.Task] = None


class AnnouncementStreamHub:
    """基于共享数据库版本的消息变更通知中心，用于 SSE 实时推送。"""

    _ROW_ID = 1
    _IDLE_TICKS_BEFORE_STOP = 6

    def __init__(self):
        self._watchers_lock = threading.Lock()
        self._loop_watchers: dict[int, _LoopStreamWatcher] = {}

    @property
    def version(self) -> int:
        return self._get_shared_version()

    def _get_or_create_state(self, db: Session) -> AnnouncementStreamState:
        state = db.get(AnnouncementStreamState, self._ROW_ID)
        if state:
            return state

        state = AnnouncementStreamState(id=self._ROW_ID, version=0, updated_at=_now())
        db.add(state)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            state = db.get(AnnouncementStreamState, self._ROW_ID)
            if state:
                return state
            raise
        db.refresh(state)
        return state

    def _get_shared_version(self) -> int:
        with SessionLocal() as db:
            state = self._get_or_create_state(db)
            return int(state.version or 0)

    def notify(self) -> None:
        with SessionLocal() as db:
            state = self._get_or_create_state(db)
            state.version = int(state.version or 0) + 1
            state.updated_at = _now()
            db.commit()
            next_version = int(state.version or 0)
        self._wake_loop_watchers(next_version)

    async def wait_for_change(
        self,
        last_version: int,
        timeout: float = 15.0,
        poll_interval: float = 0.5,
    ) -> int:
        current_version = await asyncio.to_thread(self._get_shared_version)
        if current_version != last_version:
            return current_version

        watcher = self._ensure_loop_watcher(poll_interval)
        watcher.version = max(watcher.version, current_version)
        watcher.waiter_count += 1
        deadline = asyncio.get_running_loop().time() + timeout

        try:
            while True:
                if watcher.version != last_version:
                    return watcher.version

                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    return last_version

                try:
                    async with watcher.condition:
                        if watcher.version != last_version:
                            return watcher.version
                        await asyncio.wait_for(
                            watcher.condition.wait_for(lambda: watcher.version != last_version),
                            timeout=remaining,
                        )
                except asyncio.TimeoutError:
                    return last_version
        finally:
            watcher.waiter_count = max(0, watcher.waiter_count - 1)

    def _ensure_loop_watcher(self, poll_interval: float) -> _LoopStreamWatcher:
        loop = asyncio.get_running_loop()
        key = id(loop)
        with self._watchers_lock:
            watcher = self._loop_watchers.get(key)
            if watcher is None or watcher.loop.is_closed():
                watcher = _LoopStreamWatcher(loop=loop, condition=asyncio.Condition())
                self._loop_watchers[key] = watcher

            if watcher.task is None or watcher.task.done():
                watcher.task = loop.create_task(self._watch_shared_version(watcher, poll_interval))

            return watcher

    async def _watch_shared_version(self, watcher: _LoopStreamWatcher, poll_interval: float) -> None:
        try:
            while True:
                if watcher.waiter_count <= 0:
                    watcher.idle_ticks += 1
                    if watcher.idle_ticks >= self._IDLE_TICKS_BEFORE_STOP:
                        break
                else:
                    watcher.idle_ticks = 0

                await asyncio.sleep(poll_interval)
                current_version = await asyncio.to_thread(self._get_shared_version)
                if current_version == watcher.version:
                    continue

                await self._notify_watcher(watcher, current_version)
        finally:
            with self._watchers_lock:
                if self._loop_watchers.get(id(watcher.loop)) is watcher:
                    self._loop_watchers.pop(id(watcher.loop), None)

    def _wake_loop_watchers(self, version: int) -> None:
        with self._watchers_lock:
            watchers = list(self._loop_watchers.values())

        for watcher in watchers:
            if watcher.loop.is_closed():
                continue
            watcher.loop.call_soon_threadsafe(
                lambda current=watcher, next_version=version: asyncio.create_task(
                    self._notify_watcher(current, next_version)
                )
            )

    async def _notify_watcher(self, watcher: _LoopStreamWatcher, version: int) -> None:
        async with watcher.condition:
            if version > watcher.version:
                watcher.version = version
            watcher.condition.notify_all()


stream_hub = AnnouncementStreamHub()


def _now() -> datetime:
    return datetime.utcnow()


def _req_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


def _parse_optional_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_datetime", "message": "时间格式不正确"},
        ) from exc

    if parsed.tzinfo is not None:
        return parsed.astimezone().replace(tzinfo=None)
    return parsed


def _user_identifiers(user: User) -> set[str]:
    values = {
        str(user.id or "").strip(),
        str(user.username or "").strip(),
        str(user.email or "").strip(),
        str(user.phone or "").strip(),
    }
    return {value for value in values if value}


def _base_active_query(db: Session):
    now = _now()
    return db.query(Announcement).filter(
        Announcement.status == "published",
        or_(Announcement.published_at.is_(None), Announcement.published_at <= now),
        or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
    )


def _apply_target_filter(query, user: User):
    identifiers = list(_user_identifiers(user))
    plan = normalize_plan(getattr(user, "plan", None))
    conditions = [Announcement.target_scope == "all"]
    if identifiers:
        conditions.append(
            and_(
                Announcement.target_scope == "user",
                Announcement.target_value.in_(identifiers),
            )
        )
    if plan:
        conditions.append(
            and_(
                Announcement.target_scope == "plan",
                Announcement.target_value == plan,
            )
        )
    return query.filter(or_(*conditions))


def _to_admin_item(item: Announcement) -> AdminAnnouncementItem:
    return AdminAnnouncementItem(
        id=item.id,
        title=item.title,
        content=item.content,
        type=item.type,
        status=item.status,
        target_scope=item.target_scope,
        target_value=item.target_value,
        is_pinned=bool(item.is_pinned),
        created_by=item.created_by,
        published_at=item.published_at.isoformat() if item.published_at else None,
        expires_at=item.expires_at.isoformat() if item.expires_at else None,
        created_at=item.created_at.isoformat() if item.created_at else None,
        updated_at=item.updated_at.isoformat() if item.updated_at else None,
    )


def _to_client_item(item: Announcement, is_read: bool) -> MessageItem:
    return MessageItem(
        id=item.id,
        title=item.title,
        content=item.content,
        type=item.type,
        is_pinned=bool(item.is_pinned),
        is_read=is_read,
        created_at=item.created_at.isoformat() if item.created_at else None,
        published_at=item.published_at.isoformat() if item.published_at else None,
        expires_at=item.expires_at.isoformat() if item.expires_at else None,
    )


def _announcement_or_404(db: Session, announcement_id: str) -> Announcement:
    item = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "announcement_not_found", "message": "消息不存在"},
        )
    return item


def _upsert_receipts(
    db: Session,
    user_id: str,
    items: Iterable[Announcement],
) -> None:
    now = _now()
    ids = [item.id for item in items]
    if not ids:
        return

    existing = {
        receipt.announcement_id: receipt
        for receipt in db.query(AnnouncementReceipt).filter(
            AnnouncementReceipt.user_id == user_id,
            AnnouncementReceipt.announcement_id.in_(ids),
        )
    }

    changed = False
    for announcement_id in ids:
        receipt = existing.get(announcement_id)
        if receipt:
            if receipt.read_at is None:
                receipt.read_at = now
                receipt.updated_at = now
                changed = True
            continue

        db.add(
            AnnouncementReceipt(
                id=str(uuid.uuid4()),
                announcement_id=announcement_id,
                user_id=user_id,
                read_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        changed = True

    if changed:
        db.commit()


def _compute_unread_count(db: Session, user: User) -> int:
    base_query = _apply_target_filter(_base_active_query(db), user)
    unread_query = (
        base_query.outerjoin(
            AnnouncementReceipt,
            and_(
                AnnouncementReceipt.announcement_id == Announcement.id,
                AnnouncementReceipt.user_id == user.id,
            ),
        )
        .filter(AnnouncementReceipt.read_at.is_(None))
    )
    return unread_query.count()


def _build_message_payload(db: Session, user: User, limit: int = 20) -> MessageListResponse:
    safe_limit = max(1, min(limit, 50))
    query = _apply_target_filter(_base_active_query(db), user).order_by(
        Announcement.is_pinned.desc(),
        Announcement.published_at.desc(),
        Announcement.created_at.desc(),
    )
    items = query.limit(safe_limit).all()
    ids = [item.id for item in items]
    read_map = {}
    if ids:
        read_map = {
            receipt.announcement_id: receipt.read_at is not None
            for receipt in db.query(AnnouncementReceipt).filter(
                AnnouncementReceipt.user_id == user.id,
                AnnouncementReceipt.announcement_id.in_(ids),
            )
        }

    return MessageListResponse(
        success=True,
        items=[_to_client_item(item, read_map.get(item.id, False)) for item in items],
        unread_count=_compute_unread_count(db, user),
        fetched_at=_now().isoformat(),
    )


def _emit_sse(event_name: str, payload: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _capture_stream_snapshot(user: User, limit: int = 20) -> tuple[dict, int]:
    """
    先记录构建前版本号，再查库生成快照。

    这样若快照构建期间又发生了新变更，后续 wait_for_change(last_version)
    仍能立刻感知并补发，不会把这次变更误判为“已同步”。
    """
    snapshot_version = stream_hub.version
    with SessionLocal() as db:
        payload = _build_message_payload(db, user, limit).model_dump(mode="json")
    return payload, snapshot_version


@router.get("", response_model=MessageListResponse)
def list_messages(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _build_message_payload(db, current_user, limit)


@router.get("/stream")
async def stream_messages(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    async def event_stream():
        last_version = -1
        while True:
            if await request.is_disconnected():
                break

            if last_version < 0:
                payload, snapshot_version = _capture_stream_snapshot(current_user, 20)
                yield _emit_sse("snapshot", payload)
                last_version = snapshot_version
                continue

            next_version = await stream_hub.wait_for_change(last_version, timeout=15.0)
            if next_version == last_version:
                yield ": heartbeat\n\n"
                continue

            payload, snapshot_version = _capture_stream_snapshot(current_user, 20)
            yield _emit_sse("snapshot", payload)
            last_version = snapshot_version

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


@router.post("/{announcement_id}/read", response_model=MessageMarkReadResponse)
def mark_message_read(
    announcement_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _announcement_or_404(db, announcement_id)
    _upsert_receipts(db, current_user.id, [item])
    stream_hub.notify()
    return MessageMarkReadResponse(
        success=True,
        unread_count=_compute_unread_count(db, current_user),
        updated_at=_now().isoformat(),
    )


@router.post("/read-all", response_model=MessageMarkReadResponse)
def mark_all_messages_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = _apply_target_filter(_base_active_query(db), current_user).all()
    _upsert_receipts(db, current_user.id, items)
    stream_hub.notify()
    return MessageMarkReadResponse(
        success=True,
        unread_count=0,
        updated_at=_now().isoformat(),
    )


@admin_router.get("", response_model=PaginatedAdminAnnouncements)
def admin_list_messages(
    request: Request,
    page: int = 1,
    size: int = 20,
    status_filter: Optional[str] = None,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    safe_page = max(page, 1)
    safe_size = max(1, min(size, 100))
    query = db.query(Announcement)
    if status_filter:
        query = query.filter(Announcement.status == status_filter)
    total = query.count()
    items = (
        query.order_by(
            Announcement.is_pinned.desc(),
            Announcement.updated_at.desc(),
            Announcement.created_at.desc(),
        )
        .offset((safe_page - 1) * safe_size)
        .limit(safe_size)
        .all()
    )
    auth_audit_log_async(
        req_id,
        str(request.url),
        "list_announcements",
        admin,
        "success",
        {"count": len(items), "page": safe_page},
    )
    return PaginatedAdminAnnouncements(
        items=[_to_admin_item(item) for item in items],
        total=total,
        page=safe_page,
        size=safe_size,
    )


@admin_router.post("", response_model=AdminAnnouncementActionResponse)
def admin_create_message(
    body: AdminAnnouncementUpsertBody,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    expires_at = _parse_optional_datetime(body.expires_at)
    published_at = _now() if body.status == "published" else None
    item = Announcement(
        id=str(uuid.uuid4()),
        title=body.title.strip(),
        content=body.content.strip(),
        type=body.type,
        status=body.status,
        target_scope=body.target_scope,
        target_value=body.target_value.strip() if body.target_value else None,
        is_pinned=body.is_pinned,
        created_by=admin,
        published_at=published_at,
        expires_at=expires_at,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    stream_hub.notify()
    auth_audit_log_async(
        req_id,
        str(request.url),
        "create_announcement",
        admin,
        "success",
        {"announcement_id": item.id, "status": item.status},
    )
    return AdminAnnouncementActionResponse(
        ok=True,
        message="消息创建成功",
        item=_to_admin_item(item),
    )


@admin_router.put("/{announcement_id}", response_model=AdminAnnouncementActionResponse)
def admin_update_message(
    announcement_id: str,
    body: AdminAnnouncementUpsertBody,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    item = _announcement_or_404(db, announcement_id)
    next_status = body.status
    expires_at = _parse_optional_datetime(body.expires_at)
    item.title = body.title.strip()
    item.content = body.content.strip()
    item.type = body.type
    item.target_scope = body.target_scope
    item.target_value = body.target_value.strip() if body.target_value else None
    item.is_pinned = body.is_pinned
    item.expires_at = expires_at
    if next_status == "published":
        item.status = "published"
        item.published_at = item.published_at or _now()
    else:
        item.status = "draft"
        item.published_at = None
    item.updated_at = _now()
    db.commit()
    db.refresh(item)
    stream_hub.notify()
    auth_audit_log_async(
        req_id,
        str(request.url),
        "update_announcement",
        admin,
        "success",
        {"announcement_id": item.id, "status": item.status},
    )
    return AdminAnnouncementActionResponse(
        ok=True,
        message="消息更新成功",
        item=_to_admin_item(item),
    )


@admin_router.post("/{announcement_id}/publish", response_model=AdminAnnouncementActionResponse)
def admin_publish_message(
    announcement_id: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    item = _announcement_or_404(db, announcement_id)
    item.status = "published"
    item.published_at = _now()
    item.updated_at = _now()
    db.commit()
    db.refresh(item)
    stream_hub.notify()
    auth_audit_log_async(
        req_id,
        str(request.url),
        "publish_announcement",
        admin,
        "success",
        {"announcement_id": item.id},
    )
    return AdminAnnouncementActionResponse(
        ok=True,
        message="消息已发布",
        item=_to_admin_item(item),
    )


@admin_router.post("/{announcement_id}/revoke", response_model=AdminAnnouncementActionResponse)
def admin_revoke_message(
    announcement_id: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    item = _announcement_or_404(db, announcement_id)
    item.status = "revoked"
    item.updated_at = _now()
    db.commit()
    db.refresh(item)
    stream_hub.notify()
    auth_audit_log_async(
        req_id,
        str(request.url),
        "revoke_announcement",
        admin,
        "success",
        {"announcement_id": item.id},
    )
    return AdminAnnouncementActionResponse(
        ok=True,
        message="消息已撤回",
        item=_to_admin_item(item),
    )


@admin_router.delete("/{announcement_id}", response_model=AdminAnnouncementActionResponse)
def admin_delete_message(
    announcement_id: str,
    request: Request,
    admin: str = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    req_id = _req_id(request)
    item = _announcement_or_404(db, announcement_id)

    db.query(AnnouncementReceipt).filter(
        AnnouncementReceipt.announcement_id == announcement_id
    ).delete(synchronize_session=False)
    db.delete(item)
    db.commit()

    stream_hub.notify()
    auth_audit_log_async(
        req_id,
        str(request.url),
        "delete_announcement",
        admin,
        "success",
        {"announcement_id": announcement_id},
    )
    return AdminAnnouncementActionResponse(
        ok=True,
        message="消息已删除",
        item=None,
    )
