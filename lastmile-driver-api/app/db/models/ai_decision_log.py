"""
Log de toda decisão de IA — o que foi mandado pro modelo, o que voltou,
se o schema foi respeitado, e se a ocorrência foi escalada para humano.
É o registro que permite provar, numa disputa, por que o sistema tomou
(ou não tomou) uma decisão automática.
"""
import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import AIDecisionType

def _values(enum_cls):
    # Ver comentário equivalente em app.db.models.message_log — sem
    # values_callable, o SQLAlchemy usa .name em vez de .value e a leitura
    # real quebra contra o tipo ENUM do Postgres (criado com .value minúsculo).
    return [e.value for e in enum_cls]


ai_decision_type_enum = PGEnum(
    AIDecisionType, name="ai_decision_type", create_type=False, values_callable=_values
)


class AIDecisionLog(Base):
    __tablename__ = "ai_decision_logs"
    __table_args__ = (
        Index("ix_ai_decision_logs_tenant_id", "tenant_id"),
        Index("ix_ai_decision_logs_occurrence_id", "occurrence_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    # Nullable: decisões de IA fora do fluxo de Occurrence (ex: pré-triagem
    # de Route Capture, ver app.services.route_prescreen_service) não têm
    # ocorrência associada — mesmo padrão de MessageLog.occurrence_id.
    occurrence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("occurrences.id", ondelete="CASCADE"), nullable=True
    )

    decision_type: Mapped[AIDecisionType] = mapped_column(ai_decision_type_enum, nullable=False)

    ai_provider: Mapped[str] = mapped_column(String(50), nullable=False)
    ai_model: Mapped[str] = mapped_column(String(100), nullable=False)

    input_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Nulo quando o provedor não retornou um JSON válido — o erro fica em error_message
    # e is_valid_schema=False, nunca assumimos um valor default silenciosamente.
    output_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    is_valid_schema: Mapped[bool] = mapped_column(Boolean, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    is_ambiguous: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    escalated_to_human: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
