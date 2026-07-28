"""Endpoints de captura guiada de rota (ML/Shopee) — ver
app.services.route_capture_service e o plano em
C:\\Users\\User\\.claude\\plans\\cosmic-puzzling-beacon.md.

DISTRIBUIDORA não usa nenhuma rota deste arquivo — continua no fluxo de
nota fiscal existente (app.api.v1.driver)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.driver_auth import DriverIdentity, require_driver_auth
from app.db.models.tenant import Tenant
from app.db.session import get_db
from app.schemas.route_capture import (
    RouteCaptureSessionCreate,
    RouteCaptureSessionRead,
    RouteCaptureStopRead,
    RouteCaptureStopUpdate,
)
from app.db.models.enums import RouteCaptureSessionStatus
from app.services import route_capture_service, route_optimizer_service
from app.services.route_capture_service import RouteCaptureReviewError, RouteCaptureSessionError
from app.services.route_screen_extraction_service import RouteCaptureExtractionError

router = APIRouter(prefix="/driver/route-capture")


async def _get_session_or_404(
    db: AsyncSession, identity: DriverIdentity, session_id: uuid.UUID
):
    session = await route_capture_service.get_session(db, identity.tenant_id, identity.driver_id, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    return session


@router.post("/sessions", response_model=RouteCaptureSessionRead)
async def create_session(
    data: RouteCaptureSessionCreate,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> RouteCaptureSessionRead:
    try:
        session = await route_capture_service.create_session(
            db, identity.tenant_id, identity.driver_id, data.platform
        )
    except RouteCaptureSessionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(session)
    return session


@router.post("/sessions/{session_id}/screenshots", response_model=list[RouteCaptureStopRead])
async def upload_screenshot(
    session_id: uuid.UUID,
    file: UploadFile,
    stop_id: uuid.UUID | None = None,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[RouteCaptureStopRead]:
    session = await _get_session_or_404(db, identity, session_id)
    image_bytes = await file.read()

    try:
        stops = await route_capture_service.upload_screenshot(db, settings, session, image_bytes, stop_id=stop_id)
    except RouteCaptureExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RouteCaptureSessionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    for stop in stops:
        await db.refresh(stop)
    return stops


@router.get("/sessions/{session_id}", response_model=RouteCaptureSessionRead)
async def get_session(
    session_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> RouteCaptureSessionRead:
    return await _get_session_or_404(db, identity, session_id)


@router.get("/sessions/{session_id}/stops", response_model=list[RouteCaptureStopRead])
async def list_stops(
    session_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> list[RouteCaptureStopRead]:
    await _get_session_or_404(db, identity, session_id)
    return await route_capture_service.list_session_stops(db, identity.tenant_id, session_id)


@router.patch("/sessions/{session_id}/stops/{stop_id}", response_model=RouteCaptureStopRead)
async def update_stop(
    session_id: uuid.UUID,
    stop_id: uuid.UUID,
    data: RouteCaptureStopUpdate,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> RouteCaptureStopRead:
    await _get_session_or_404(db, identity, session_id)
    stop = await route_capture_service.get_stop(db, identity.tenant_id, session_id, stop_id)
    if stop is None:
        raise HTTPException(status_code=404, detail="Parada não encontrada.")

    try:
        await route_capture_service.update_stop_fields(
            stop,
            customer_name=data.customer_name,
            customer_phone=data.customer_phone,
            customer_address=data.customer_address,
        )
    except RouteCaptureReviewError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(stop)
    return stop


@router.post("/sessions/{session_id}/stops/{stop_id}/confirm", response_model=RouteCaptureStopRead)
async def confirm_stop(
    session_id: uuid.UUID,
    stop_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> RouteCaptureStopRead:
    await _get_session_or_404(db, identity, session_id)
    stop = await route_capture_service.get_stop(db, identity.tenant_id, session_id, stop_id)
    if stop is None:
        raise HTTPException(status_code=404, detail="Parada não encontrada.")

    try:
        await route_capture_service.confirm_stop(stop)
    except RouteCaptureReviewError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(stop)
    return stop


@router.post("/sessions/{session_id}/stops/{stop_id}/reject", response_model=RouteCaptureStopRead)
async def reject_stop(
    session_id: uuid.UUID,
    stop_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> RouteCaptureStopRead:
    await _get_session_or_404(db, identity, session_id)
    stop = await route_capture_service.get_stop(db, identity.tenant_id, session_id, stop_id)
    if stop is None:
        raise HTTPException(status_code=404, detail="Parada não encontrada.")

    try:
        await route_capture_service.reject_stop(stop)
    except RouteCaptureReviewError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(stop)
    return stop


@router.post("/sessions/{session_id}/confirm", response_model=RouteCaptureSessionRead)
async def confirm_session(
    session_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RouteCaptureSessionRead:
    session = await _get_session_or_404(db, identity, session_id)
    tenant = await db.get(Tenant, identity.tenant_id)

    try:
        await route_capture_service.confirm_session(db, settings, tenant, session)
    except RouteCaptureSessionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(session)
    return session


@router.post("/sessions/{session_id}/route/optimize", response_model=RouteCaptureSessionRead)
async def optimize_route(
    session_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RouteCaptureSessionRead:
    session = await _get_session_or_404(db, identity, session_id)
    tenant = await db.get(Tenant, identity.tenant_id)

    try:
        await route_optimizer_service.optimize_session(db, settings, tenant, session)
    except RouteCaptureSessionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(session)
    return session


@router.get("/sessions/{session_id}/route", response_model=list[RouteCaptureStopRead])
async def get_route(
    session_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> list[RouteCaptureStopRead]:
    session = await _get_session_or_404(db, identity, session_id)
    if session.status != RouteCaptureSessionStatus.ROUTE_READY:
        raise HTTPException(status_code=409, detail=f"Sessão no estado '{session.status.value}' não tem rota pronta.")

    stops = await route_capture_service.list_session_stops(db, identity.tenant_id, session_id)
    return sorted(
        (s for s in stops if s.route_sequence is not None), key=lambda s: s.route_sequence
    )
