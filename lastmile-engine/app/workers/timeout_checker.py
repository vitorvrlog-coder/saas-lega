"""
Worker de timeout da etapa 6: verifica periodicamente ocorrências
aguardando resposta do cliente (tentativa 1 ou 2) cujo prazo (configurável
por tenant) expirou, e dispara a tentativa seguinte ou o fechamento
definitivo. Roda embutido no processo da API via APScheduler — não sobe
Celery+Redis à parte, dado o volume esperado (não milhões de ocorrências
simultâneas).
"""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models.enums import OccurrenceState
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.db.session import AsyncSessionLocal
from app.services.occurrence_service import handle_contact_timeout

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 60

_scheduler: AsyncIOScheduler | None = None


async def _check_timeouts() -> None:
    """Cada ocorrência é processada na SUA PRÓPRIA sessão/transação — não dá
    pra reaproveitar uma sessão pra todas e só dar rollback da que falhar:
    rollback expira TODOS os objetos já carregados naquela sessão (mesmo com
    expire_on_commit=False, que só afeta commit, não rollback) — o acesso a
    atributo de uma ocorrência seguinte no loop então dispara um reload
    implícito fora do contexto async/greenlet certo, quebrando com
    "MissingGreenlet: greenlet_spawn has not been called" (erro real batido
    em produção, repetindo a cada execução do job pra mesma ocorrência).
    Isolar por ocorrência também é semanticamente melhor: uma falha não deve
    travar o processamento das outras."""
    settings = get_settings()

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Occurrence.id).where(
                Occurrence.state.in_(
                    [OccurrenceState.AWAITING_CUSTOMER_REPLY_1, OccurrenceState.AWAITING_CUSTOMER_REPLY_2]
                )
            )
        )
        occurrence_ids = [row[0] for row in result.all()]

    for occurrence_id in occurrence_ids:
        async with AsyncSessionLocal() as db:
            occurrence = await db.get(Occurrence, occurrence_id)
            if occurrence is None or occurrence.state not in (
                OccurrenceState.AWAITING_CUSTOMER_REPLY_1, OccurrenceState.AWAITING_CUSTOMER_REPLY_2,
            ):
                continue  # mudou de estado por outro caminho entre a query e agora

            if occurrence.last_contact_at is None:
                continue

            tenant = await db.get(Tenant, occurrence.tenant_id)
            timeout_minutes = (
                tenant.timeout_attempt_1_minutes
                if occurrence.state == OccurrenceState.AWAITING_CUSTOMER_REPLY_1
                else tenant.timeout_attempt_2_minutes
            )
            deadline = occurrence.last_contact_at + timedelta(minutes=timeout_minutes)
            if datetime.now(timezone.utc) < deadline:
                continue

            try:
                await handle_contact_timeout(db, settings, tenant, occurrence)
                await db.commit()
            except Exception:
                logger.exception("Falha ao processar timeout da occurrence %s", occurrence_id)
                await db.rollback()


def start_timeout_checker() -> AsyncIOScheduler:
    global _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_check_timeouts, "interval", seconds=CHECK_INTERVAL_SECONDS, id="timeout_checker")
    _scheduler.start()
    logger.info("Timeout checker iniciado (intervalo: %ss)", CHECK_INTERVAL_SECONDS)
    return _scheduler


def stop_timeout_checker() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
