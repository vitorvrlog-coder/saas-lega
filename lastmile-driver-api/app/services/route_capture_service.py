"""
Orquestração de app.db.models.route_capture_session/route_capture_stop —
sessão de captura guiada de telas do app de entrega (ML/Shopee) via
MediaProjection, revisão pelo motorista, e disparo da pré-triagem.
Espelha app.services.invoice_service: funções async nunca commitam (só
flush() quando precisa do PK gerado), exceções tipadas, __all__ exportado.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.enums import DriverPlatform, RouteCaptureSessionStatus, RouteCaptureStopOcrStatus
from app.db.models.route_capture_session import RouteCaptureSession
from app.db.models.route_capture_stop import RouteCaptureStop
from app.services.route_screen_extraction_service import RouteCaptureExtractionError, extract_stops

__all__ = [
    "RouteCaptureExtractionError",
    "RouteCaptureSessionError",
    "RouteCaptureReviewError",
    "create_session",
    "upload_screenshot",
    "list_session_stops",
    "get_session",
    "get_stop",
    "update_stop_fields",
    "confirm_stop",
    "reject_stop",
    "confirm_session",
]


class RouteCaptureSessionError(Exception):
    pass


class RouteCaptureReviewError(Exception):
    pass


async def create_session(
    db: AsyncSession, tenant_id: uuid.UUID, driver_id: uuid.UUID, platform: DriverPlatform
) -> RouteCaptureSession:
    """DISTRIBUIDORA nunca cria sessão — reaproveita o fluxo de nota fiscal
    já existente (ver app.services.invoice_service). A checagem também
    existe na rota, mas fica aqui como backstop caso este serviço seja
    chamado de outro lugar no futuro."""
    if platform == DriverPlatform.DISTRIBUIDORA:
        raise RouteCaptureSessionError(
            "Plataforma DISTRIBUIDORA não usa captura de rota — use o fluxo de nota fiscal."
        )

    session = RouteCaptureSession(tenant_id=tenant_id, driver_id=driver_id, platform=platform)
    db.add(session)
    await db.flush()
    return session


async def upload_screenshot(
    db: AsyncSession,
    settings: Settings,
    session: RouteCaptureSession,
    image_bytes: bytes,
    stop_id: uuid.UUID | None = None,
) -> list[RouteCaptureStop]:
    """stop_id só é passado na 2ª captura do ML (tela pós-'Ligar', que só
    traz telefone) — o app Android sabe a qual parada aquela captura
    pertence, evitando fuzzy-matching por nome/endereço no backend. Sem
    stop_id, cada resultado da extração vira uma RouteCaptureStop nova
    (Shopee pode extrair várias de uma imagem só; ML normal extrai uma)."""
    if session.status != RouteCaptureSessionStatus.IN_PROGRESS:
        raise RouteCaptureSessionError(f"Sessão no estado '{session.status.value}' não aceita novas capturas.")

    screenshot_role = "phone" if stop_id is not None else "stop"
    extracted = extract_stops(session.platform, image_bytes, settings, screenshot_role=screenshot_role)

    if stop_id is not None:
        stop = await get_stop(db, session.tenant_id, session.id, stop_id)
        if stop is None:
            raise RouteCaptureSessionError("Parada não encontrada nesta sessão.")
        if extracted and extracted[0].customer_phone:
            stop.customer_phone = extracted[0].customer_phone
        stop.raw_extracted_json = {**stop.raw_extracted_json, "phone_capture": extracted[0].raw if extracted else {}}
        return [stop]

    stops = []
    for data in extracted:
        stop = RouteCaptureStop(
            tenant_id=session.tenant_id,
            session_id=session.id,
            ocr_status=RouteCaptureStopOcrStatus.PENDING_REVIEW,
            customer_name=data.customer_name,
            customer_phone=data.customer_phone,
            customer_address=data.customer_address,
            raw_extracted_json=data.raw,
            ocr_confidence=data.confidence,
        )
        db.add(stop)
        stops.append(stop)
    await db.flush()
    return stops


async def list_session_stops(
    db: AsyncSession, tenant_id: uuid.UUID, session_id: uuid.UUID
) -> list[RouteCaptureStop]:
    result = await db.execute(
        select(RouteCaptureStop)
        .where(RouteCaptureStop.tenant_id == tenant_id, RouteCaptureStop.session_id == session_id)
        .order_by(RouteCaptureStop.created_at.asc())
    )
    return list(result.scalars().all())


async def get_session(
    db: AsyncSession, tenant_id: uuid.UUID, driver_id: uuid.UUID, session_id: uuid.UUID
) -> RouteCaptureSession | None:
    result = await db.execute(
        select(RouteCaptureSession).where(
            RouteCaptureSession.id == session_id,
            RouteCaptureSession.tenant_id == tenant_id,
            RouteCaptureSession.driver_id == driver_id,
        )
    )
    return result.scalars().first()


async def get_stop(
    db: AsyncSession, tenant_id: uuid.UUID, session_id: uuid.UUID, stop_id: uuid.UUID
) -> RouteCaptureStop | None:
    result = await db.execute(
        select(RouteCaptureStop).where(
            RouteCaptureStop.id == stop_id,
            RouteCaptureStop.tenant_id == tenant_id,
            RouteCaptureStop.session_id == session_id,
        )
    )
    return result.scalars().first()


async def update_stop_fields(
    stop: RouteCaptureStop,
    customer_name: str | None = None,
    customer_phone: str | None = None,
    customer_address: str | None = None,
) -> RouteCaptureStop:
    if stop.ocr_status != RouteCaptureStopOcrStatus.PENDING_REVIEW:
        raise RouteCaptureReviewError(f"Parada no estado '{stop.ocr_status.value}' não pode ser editada.")

    if customer_name is not None:
        stop.customer_name = customer_name
    if customer_phone is not None:
        stop.customer_phone = customer_phone
    if customer_address is not None:
        stop.customer_address = customer_address

    return stop


async def confirm_stop(stop: RouteCaptureStop) -> RouteCaptureStop:
    if stop.ocr_status != RouteCaptureStopOcrStatus.PENDING_REVIEW:
        raise RouteCaptureReviewError(f"Parada no estado '{stop.ocr_status.value}' não pode ser confirmada.")
    if not stop.customer_phone or not stop.customer_address:
        raise RouteCaptureReviewError("Parada sem telefone ou endereço do cliente.")
    stop.ocr_status = RouteCaptureStopOcrStatus.CONFIRMED
    return stop


async def reject_stop(stop: RouteCaptureStop) -> RouteCaptureStop:
    if stop.ocr_status != RouteCaptureStopOcrStatus.PENDING_REVIEW:
        raise RouteCaptureReviewError(f"Parada no estado '{stop.ocr_status.value}' não pode ser rejeitada.")
    stop.ocr_status = RouteCaptureStopOcrStatus.REJECTED
    return stop


async def confirm_session(
    db: AsyncSession, settings: Settings, tenant, session: RouteCaptureSession
) -> RouteCaptureSession:
    """Ação explícita do motorista: fecha a revisão e dispara a
    pré-triagem via WhatsApp pra cada parada confirmada. Levanta se
    alguma parada ainda estiver PENDING_REVIEW — nenhuma leitura de OCR
    não revisada pode gerar contato com cliente, mesma disciplina de
    app.services.invoice_service.confirm_and_send_preventive_contact."""
    if session.status != RouteCaptureSessionStatus.IN_PROGRESS:
        raise RouteCaptureSessionError(f"Sessão no estado '{session.status.value}' não pode ser confirmada.")

    stops = await list_session_stops(db, session.tenant_id, session.id)
    if not stops:
        raise RouteCaptureSessionError("Sessão sem nenhuma parada capturada.")
    if any(stop.ocr_status == RouteCaptureStopOcrStatus.PENDING_REVIEW for stop in stops):
        raise RouteCaptureSessionError("Existem paradas ainda não revisadas nesta sessão.")

    import datetime

    session.status = RouteCaptureSessionStatus.CONFIRMED
    session.confirmed_at = datetime.datetime.now(datetime.timezone.utc)

    # Import local pra evitar ciclo, mesmo padrão de
    # invoice_service.confirm_and_send_preventive_contact.
    from app.services.route_prescreen_service import send_prescreen_for_session

    confirmed_stops = [s for s in stops if s.ocr_status == RouteCaptureStopOcrStatus.CONFIRMED]
    await send_prescreen_for_session(db, settings, tenant, confirmed_stops)

    return session
