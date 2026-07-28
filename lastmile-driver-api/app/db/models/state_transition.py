"""
Histórico imutável de mudança de estado da ocorrência — parte da trilha de
auditoria exigida para disputa comercial/jurídica. Nunca é atualizado ou
apagado, só inserido (append-only).
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import OccurrenceState, TransitionActor

def _values(enum_cls):
    # Ver comentário equivalente em app.db.models.message_log — sem
    # values_callable, o SQLAlchemy usa .name em vez de .value e a leitura
    # real quebra contra o tipo ENUM do Postgres (criado com .value minúsculo).
    return [e.value for e in enum_cls]


occurrence_state_enum = PGEnum(
    OccurrenceState, name="occurrence_state", create_type=False, values_callable=_values
)
transition_actor_enum = PGEnum(
    TransitionActor, name="transition_actor", create_type=False, values_callable=_values
)


class StateTransition(Base):
    __tablename__ = "state_transitions"
    __table_args__ = (
        Index("ix_state_transitions_occurrence_id", "occurrence_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    occurrence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("occurrences.id", ondelete="CASCADE"), nullable=False
    )

    from_state: Mapped[OccurrenceState | None] = mapped_column(occurrence_state_enum, nullable=True)
    to_state: Mapped[OccurrenceState] = mapped_column(occurrence_state_enum, nullable=False)

    triggered_by: Mapped[TransitionActor] = mapped_column(transition_actor_enum, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
