"""
Etapa 3 do fluxo (plugável/removível): operador humano preenche route_id +
contato do cliente final + endereço original (necessário para o cálculo de
raio na etapa 5). Único ponto de entrada humano no motor hoje — existe só
até a integração com o TMS da transportadora, e pode ser substituído sem
alterar Occurrence nem o motor de estados (quem preenche muda, o que é
preenchido não muda).
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import OccurrenceState, TransitionActor
from app.db.models.occurrence import Occurrence
from app.integrations.whatsapp_cloud.phone import normalize_br_phone
from app.schemas.occurrence import HumanQueueFillRequest
from app.state_machine.engine import transition


class InvalidHumanQueueStateError(Exception):
    pass


async def fill_human_queue(
    db: AsyncSession, occurrence: Occurrence, data: HumanQueueFillRequest
) -> Occurrence:
    if occurrence.state != OccurrenceState.PENDING_HUMAN_QUEUE:
        raise InvalidHumanQueueStateError(
            f"Occurrence {occurrence.id} não está em pending_human_queue "
            f"(está em {occurrence.state.value})"
        )

    occurrence.route_id = data.route_id
    occurrence.customer_name = data.customer_name
    # Normalizado pro mesmo formato que o WhatsApp resolve ao enviar (DDI +
    # DDD + número) — sem isso, a resposta do cliente (que chega com o
    # telefone já resolvido) não bate com o que foi digitado pelo operador
    # e a ocorrência nunca correlaciona a resposta (bug confirmado em teste
    # real: operador digitou sem DDI, resposta chegou com DDI).
    occurrence.customer_phone = normalize_br_phone(data.customer_phone)
    occurrence.original_address = data.original_address

    await transition(
        db,
        occurrence,
        OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1,
        TransitionActor.HUMAN_OPERATOR,
        reason="fila humana preenchida pelo operador",
    )
    return occurrence
