"""
Guarda de idempotência: antes de processar qualquer mensagem inbound do
gateway WhatsApp, o webhook tenta inserir aqui (tenant_id, external_message_id).
Se a constraint única acusar duplicata, a mensagem já foi tratada e é
descartada sem gerar nova ocorrência nem novo contato ao cliente — cobre o
caso de reentrega de webhook em áreas de sinal ruim.
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProcessedEvent(Base):
    __tablename__ = "processed_events"
    __table_args__ = (
        UniqueConstraint("tenant_id", "external_message_id", name="uq_processed_events_tenant_message"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    external_message_id: Mapped[str] = mapped_column(String(255), nullable=False)

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    occurrence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("occurrences.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
