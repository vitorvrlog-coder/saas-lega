"""
Occurrence = registro central da máquina de estados: uma ocorrência de
insucesso de entrega, do reporte do motorista até o fechamento.

Os campos de rota/contato do cliente (route_id, customer_name,
customer_phone) começam nulos e são preenchidos na etapa de fila humana
(app.services.human_queue_service) — etapa desenhada para ser substituível
por integração direta com o TMS sem alterar este model ou o motor de
estados (quem preenche é plugável, o que é preenchido não muda).
"""
import datetime
import uuid

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import FailureReason, OccurrenceState

def _values(enum_cls):
    # Ver comentário equivalente em app.db.models.message_log — sem
    # values_callable, o SQLAlchemy usa .name em vez de .value e a leitura
    # real quebra contra o tipo ENUM do Postgres (criado com .value minúsculo).
    return [e.value for e in enum_cls]


occurrence_state_enum = PGEnum(
    OccurrenceState, name="occurrence_state", create_type=False, values_callable=_values
)
failure_reason_enum = PGEnum(
    FailureReason, name="failure_reason", create_type=False, values_callable=_values
)


class Occurrence(Base):
    __tablename__ = "occurrences"
    __table_args__ = (
        Index("ix_occurrences_tenant_id_state", "tenant_id", "state"),
        Index("ix_occurrences_driver_phone", "driver_phone"),
        Index("ix_occurrences_customer_phone", "customer_phone"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )

    state: Mapped[OccurrenceState] = mapped_column(
        occurrence_state_enum, nullable=False, server_default=OccurrenceState.REPORTED.value
    )

    # --- Classificação do motivo (etapa 2 do fluxo) ---
    failure_reason: Mapped[FailureReason | None] = mapped_column(failure_reason_enum, nullable=True)
    failure_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    requires_customer_contact: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # --- Motorista ---
    driver_phone: Mapped[str] = mapped_column(String(32), nullable=False)
    driver_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Referência opcional ao cadastro persistente (app.db.models.driver.Driver).
    # Aditivo: driver_phone/driver_name continuam sendo a fonte de verdade
    # do motor, isso é só enriquecimento (nome/veículo) — SET NULL porque
    # apagar o cadastro do motorista nunca deve apagar ou bloquear o
    # histórico de ocorrências já fechadas.
    driver_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True
    )

    # --- Preenchido na fila humana / futura integração TMS (etapa 3) ---
    route_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # --- Resposta do cliente / mudança de endereço (etapa 5) ---
    new_address_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_address_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    new_address_lon: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    within_radius: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # --- Controle de tentativas de contato (etapa 4/6) ---
    contact_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_contact_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # True depois do primeiro comentário de acompanhamento do motorista
    # numa ocorrência já aberta ("ok", "tranquilo") — garante que o aviso
    # de confirmação (driver_followup_ack) só sai UMA vez por ocorrência,
    # não a cada mensagem casual (ver occurrence_service.handle_driver_followup).
    driver_followup_acked: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    closed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Não faz parte do motor de estados — puramente visual: some da listagem
    # padrão do histórico (app.web.routes.occurrences_list) sem apagar nada,
    # pra manter a tela navegável depois de muitos testes/ocorrências antigas.
    archived_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
