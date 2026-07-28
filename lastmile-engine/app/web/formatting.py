"""Rótulos e classes CSS pra exibir OccurrenceState no dashboard —
puramente de apresentação, não afeta o motor de estados."""
from datetime import datetime
from zoneinfo import ZoneInfo

from app.db.models.enums import OccurrenceState

BRASILIA_TZ = ZoneInfo("America/Sao_Paulo")


def local_dt(value: datetime | None, fmt: str = "%d/%m %H:%M") -> str:
    """Converte um datetime timezone-aware (armazenado em UTC no banco,
    ver DateTime(timezone=True) nos models) pro horário de Brasília antes
    de formatar — sem isso, todo timestamp exibido no dashboard aparecia
    em UTC (3h adiantado) sem nenhum aviso ao usuário."""
    if value is None:
        return ""
    return value.astimezone(BRASILIA_TZ).strftime(fmt)

STATE_LABELS: dict[OccurrenceState, str] = {
    OccurrenceState.REPORTED: "Reportado",
    OccurrenceState.CLASSIFYING: "Classificando",
    OccurrenceState.PENDING_HUMAN_QUEUE: "Aguardando fila humana",
    OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1: "Contatando cliente (1)",
    OccurrenceState.AWAITING_CUSTOMER_REPLY_1: "Aguardando resposta (1)",
    OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2: "Contatando cliente (2)",
    OccurrenceState.AWAITING_CUSTOMER_REPLY_2: "Aguardando resposta (2)",
    OccurrenceState.PROCESSING_REPLY: "Processando resposta",
    OccurrenceState.ESCALATED_TO_HUMAN: "Escalado",
    OccurrenceState.CLOSED_RESOLVED: "Resolvido",
    OccurrenceState.CLOSED_DEFINITIVE_FAILURE: "Insucesso definitivo",
}

STATE_BADGE_CLASS: dict[OccurrenceState, str] = {
    OccurrenceState.REPORTED: "badge-pending",
    OccurrenceState.CLASSIFYING: "badge-progress",
    OccurrenceState.PENDING_HUMAN_QUEUE: "badge-pending",
    OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1: "badge-progress",
    OccurrenceState.AWAITING_CUSTOMER_REPLY_1: "badge-waiting",
    OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2: "badge-progress",
    OccurrenceState.AWAITING_CUSTOMER_REPLY_2: "badge-waiting",
    OccurrenceState.PROCESSING_REPLY: "badge-progress",
    OccurrenceState.ESCALATED_TO_HUMAN: "badge-escalated",
    OccurrenceState.CLOSED_RESOLVED: "badge-resolved",
    OccurrenceState.CLOSED_DEFINITIVE_FAILURE: "badge-failed",
}


def state_label(state: OccurrenceState) -> str:
    return STATE_LABELS.get(state, state.value)


def state_badge_class(state: OccurrenceState) -> str:
    return STATE_BADGE_CLASS.get(state, "badge-pending")
