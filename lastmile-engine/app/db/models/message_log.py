"""
Log de toda mensagem trocada (motorista<->motor, cliente<->motor), para
auditoria. external_message_id é o id da mensagem no gateway WhatsApp
(evolution-go) e é usado, junto de tenant_id, como chave de idempotência
em app.db.models.processed_event — mensagens duplicadas em áreas de sinal
ruim não geram reprocessamento.
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import MessageContentType, MessageDirection, MessageParticipant


def _values(enum_cls):
    # Sem values_callable, o SQLAlchemy usa o .name do enum Python (ex:
    # "TEXT") para ler/gravar a coluna, mas o tipo ENUM do Postgres foi
    # criado com os .value minúsculos (ex: "text") — sem isso, toda
    # leitura/escrita real quebra com LookupError, mesmo a migration
    # rodando limpo (o --sql offline não pega isso, só o uso real do ORM).
    return [e.value for e in enum_cls]


message_direction_enum = PGEnum(
    MessageDirection, name="message_direction", create_type=False, values_callable=_values
)
message_participant_enum = PGEnum(
    MessageParticipant, name="message_participant", create_type=False, values_callable=_values
)
message_content_type_enum = PGEnum(
    MessageContentType, name="message_content_type", create_type=False, values_callable=_values
)


class MessageLog(Base):
    __tablename__ = "message_logs"
    __table_args__ = (
        Index("ix_message_logs_tenant_id", "tenant_id"),
        Index("ix_message_logs_occurrence_id", "occurrence_id"),
        Index("ix_message_logs_external_message_id", "external_message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    # Nullável: a 1ª mensagem do motorista chega antes de existir uma Occurrence.
    occurrence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("occurrences.id", ondelete="SET NULL"), nullable=True
    )

    direction: Mapped[MessageDirection] = mapped_column(message_direction_enum, nullable=False)
    participant: Mapped[MessageParticipant] = mapped_column(message_participant_enum, nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)

    content_type: Mapped[MessageContentType] = mapped_column(
        message_content_type_enum, nullable=False, server_default=MessageContentType.TEXT.value
    )
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    external_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    # Preenchido só pra outbound, a partir de eventos de Receipt do webhook
    # (ver app.api.v1.webhooks) — "sent" (gateway confirmou o POST, valor
    # inicial), "delivered" (celular do destinatário recebeu de verdade),
    # "read" (destinatário abriu). NULL pra inbound (não se aplica) ou pra
    # outbound de antes dessa coluna existir.
    delivery_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    delivery_updated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
