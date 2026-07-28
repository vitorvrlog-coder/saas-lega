"""Regra de decisão da etapa 6: cliente não respondeu dentro do timeout
configurado pelo tenant. Tentativa 1 sem resposta dispara tentativa 2;
tentativa 2 sem resposta fecha como insucesso definitivo — exceto em modo
full (Tenant.full_autonomous_mode), onde não há operador pra assumir uma
ocorrência sem resposta: em vez de fechar, repete a tentativa 2
indefinidamente (reenvia a mesma mensagem de contato a cada timeout)."""
from app.db.models.enums import OccurrenceState


def decide_after_timeout(
    contact_attempt_count: int, full_autonomous_mode: bool = False
) -> OccurrenceState:
    if contact_attempt_count <= 1:
        return OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2
    if full_autonomous_mode:
        return OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2
    return OccurrenceState.CLOSED_DEFINITIVE_FAILURE
