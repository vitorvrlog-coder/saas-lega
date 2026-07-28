"""Regra de decisão pós-geocoding: novo endereço dentro ou fora do raio
permitido do tenant (etapa 5). Não é uma decisão de IA — é aritmética
determinística (app.geo.distance.haversine_km) — mas segue registrada em
ai_decision_logs (ai_provider="system") para manter a auditoria completa."""
from app.db.models.enums import OccurrenceState


def decide_after_radius_check(within_radius: bool) -> OccurrenceState:
    return (
        OccurrenceState.CLOSED_RESOLVED
        if within_radius
        else OccurrenceState.CLOSED_DEFINITIVE_FAILURE
    )
