"""
Guarda de idempotência (app.db.models.processed_event). Usa SAVEPOINT
(begin_nested) para tentar inserir o registro atomicamente: se a
constraint única (tenant_id, external_message_id) acusar duplicata, a
inserção é revertida sem abortar a transação externa, e o chamador sabe
que deve descartar o evento sem reprocessar.
"""
import logging
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.processed_event import ProcessedEvent

logger = logging.getLogger(__name__)


async def is_duplicate_event(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    external_message_id: str | None,
    event_type: str,
) -> bool:
    """Devolve True se o evento já tinha sido processado (duplicata —
    descartar sem gerar ocorrência/contato novo); False se é a primeira vez
    (e já grava o registro de idempotência nesta chamada).

    Sem external_message_id não há como garantir idempotência (a
    constraint é sobre esse campo) — nesse caso sempre trata como novo e
    loga um aviso, em vez de bloquear tudo ou assumir duplicata às cegas.
    """
    if external_message_id is None:
        logger.warning(
            "Webhook sem external_message_id (tenant_id=%s) — idempotência não garantida.",
            tenant_id,
        )
        return False

    try:
        async with db.begin_nested():
            db.add(
                ProcessedEvent(
                    tenant_id=tenant_id,
                    external_message_id=external_message_id,
                    event_type=event_type,
                )
            )
            await db.flush()
        return False
    except IntegrityError:
        return True
