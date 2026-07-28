"""Schemas de request/response da API (app.api.v1.occurrences)."""
import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import FailureReason, OccurrenceState


class OccurrenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    state: OccurrenceState
    failure_reason: FailureReason | None
    failure_confidence: float | None
    requires_customer_contact: bool | None

    driver_phone: str
    driver_name: str | None
    original_address: str | None

    route_id: str | None
    customer_name: str | None
    customer_phone: str | None

    new_address_text: str | None
    new_address_lat: float | None
    new_address_lon: float | None
    distance_km: float | None
    within_radius: bool | None

    contact_attempt_count: int
    last_contact_at: datetime.datetime | None

    closed_at: datetime.datetime | None
    closure_reason: str | None
    archived_at: datetime.datetime | None

    created_at: datetime.datetime
    updated_at: datetime.datetime


class HumanQueueFillRequest(BaseModel):
    """
    Preenchimento manual do operador na fila de monitoramento (etapa 3,
    plugável) — route_id + contato do cliente final. Único ponto de entrada
    humano no fluxo; será substituído por integração com TMS no futuro sem
    mudar o resto do motor.
    """

    route_id: str = Field(min_length=1, max_length=100)
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str = Field(min_length=8, max_length=32)
    # Necessário como ponto de origem para o cálculo de raio da etapa 5
    # (distância até o novo endereço pedido pelo cliente). Preenchido pelo
    # operador porque hoje é a única etapa humana do fluxo, até existir
    # integração com o TMS da transportadora.
    original_address: str = Field(min_length=1)
