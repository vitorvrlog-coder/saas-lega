"""Endpoints internos, usados por operadores humanos — protegidos por
INTERNAL_API_KEY (app.core.security)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import require_internal_api_key
from app.db.models.enums import OccurrenceState
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.db.session import get_db
from app.schemas.occurrence import HumanQueueFillRequest, OccurrenceRead
from app.services.human_queue_service import InvalidHumanQueueStateError, fill_human_queue
from app.services.occurrence_service import send_contact_attempt

router = APIRouter(dependencies=[Depends(require_internal_api_key)])


async def _get_occurrence_or_404(db: AsyncSession, occurrence_id: uuid.UUID) -> Occurrence:
    occurrence = await db.get(Occurrence, occurrence_id)
    if occurrence is None:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada.")
    return occurrence


@router.get("/occurrences", response_model=list[OccurrenceRead])
async def list_human_queue(db: AsyncSession = Depends(get_db)) -> list[Occurrence]:
    """Fila de monitoramento humano (etapa 3, plugável) — ocorrências
    aguardando operador preencher rota/contato do cliente."""
    result = await db.execute(
        select(Occurrence)
        .where(Occurrence.state == OccurrenceState.PENDING_HUMAN_QUEUE)
        .order_by(Occurrence.created_at)
    )
    return list(result.scalars().all())


@router.get("/occurrences/{occurrence_id}", response_model=OccurrenceRead)
async def get_occurrence(occurrence_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Occurrence:
    return await _get_occurrence_or_404(db, occurrence_id)


@router.post("/occurrences/{occurrence_id}/human-queue", response_model=OccurrenceRead)
async def fill_occurrence_human_queue(
    occurrence_id: uuid.UUID,
    data: HumanQueueFillRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Occurrence:
    """Operador preenche route_id + contato do cliente + endereço original
    e o motor dispara automaticamente a tentativa de contato 1."""
    occurrence = await _get_occurrence_or_404(db, occurrence_id)
    tenant = await db.get(Tenant, occurrence.tenant_id)

    try:
        await fill_human_queue(db, occurrence, data)
    except InvalidHumanQueueStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await send_contact_attempt(db, settings, tenant, occurrence, attempt_number=1)
    await db.commit()
    await db.refresh(occurrence)
    return occurrence
