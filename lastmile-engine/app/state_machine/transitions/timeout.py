"""Regra de decisão da etapa 6: cliente não respondeu dentro do timeout
configurado pelo tenant. Tentativa 1 sem resposta dispara tentativa 2;
tentativa 2 sem resposta fecha como insucesso definitivo."""
from app.db.models.enums import OccurrenceState


def decide_after_timeout(contact_attempt_count: int) -> OccurrenceState:
    if contact_attempt_count <= 1:
        return OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2
    return OccurrenceState.CLOSED_DEFINITIVE_FAILURE
