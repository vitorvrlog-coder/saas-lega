"""initial schema: tenants, occurrences, state_transitions, message_logs,
ai_decision_logs, processed_events

Revision ID: 202607020001
Revises:
Create Date: 2026-07-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "202607020001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enums nativos do Postgres. create_type=False em TODOS os usos (aqui e nas
# colunas abaixo) porque o tipo e criado uma unica vez via CREATE TYPE bruto
# dentro de upgrade() -- sem isso, o SQLAlchemy tenta recriar o tipo
# automaticamente toda vez que o mesmo Enum aparece numa nova tabela (ex:
# occurrence_state e usado em occurrences E state_transitions) e a migration
# quebraria com "type already exists".
OCCURRENCE_STATE = PGEnum(
    "reported",
    "classifying",
    "pending_human_queue",
    "contacting_customer_attempt_1",
    "awaiting_customer_reply_1",
    "contacting_customer_attempt_2",
    "awaiting_customer_reply_2",
    "processing_reply",
    "escalated_to_human",
    "closed_resolved",
    "closed_definitive_failure",
    name="occurrence_state",
    create_type=False,
)

FAILURE_REASON = PGEnum(
    "absent",
    "wrong_address",
    "refused",
    "damage",
    "risk_area",
    name="failure_reason",
    create_type=False,
)

TRANSITION_ACTOR = PGEnum(
    "driver",
    "customer",
    "ai",
    "system",
    "human_operator",
    name="transition_actor",
    create_type=False,
)

MESSAGE_DIRECTION = PGEnum(
    "inbound",
    "outbound",
    name="message_direction",
    create_type=False,
)

MESSAGE_PARTICIPANT = PGEnum(
    "driver",
    "customer",
    name="message_participant",
    create_type=False,
)

MESSAGE_CONTENT_TYPE = PGEnum(
    "text",
    "audio",
    "button",
    "image",
    "unknown",
    name="message_content_type",
    create_type=False,
)

AI_DECISION_TYPE = PGEnum(
    "failure_classification",
    "reply_classification",
    "radius_check",
    name="ai_decision_type",
    create_type=False,
)


def upgrade() -> None:
    # pgcrypto fornece gen_random_uuid(), usado como default de todas as PKs.
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    # CREATE TYPE bruto (nao Enum.create()) -- cada tipo e criado uma unica
    # vez aqui; as colunas abaixo usam create_type=False e so referenciam
    # o tipo ja existente, nunca tentam recria-lo.
    op.execute(
        "CREATE TYPE occurrence_state AS ENUM ("
        "'reported', 'classifying', 'pending_human_queue', "
        "'contacting_customer_attempt_1', 'awaiting_customer_reply_1', "
        "'contacting_customer_attempt_2', 'awaiting_customer_reply_2', "
        "'processing_reply', 'escalated_to_human', "
        "'closed_resolved', 'closed_definitive_failure')"
    )
    op.execute(
        "CREATE TYPE failure_reason AS ENUM "
        "('absent', 'wrong_address', 'refused', 'damage', 'risk_area')"
    )
    op.execute(
        "CREATE TYPE transition_actor AS ENUM "
        "('driver', 'customer', 'ai', 'system', 'human_operator')"
    )
    op.execute("CREATE TYPE message_direction AS ENUM ('inbound', 'outbound')")
    op.execute("CREATE TYPE message_participant AS ENUM ('driver', 'customer')")
    op.execute(
        "CREATE TYPE message_content_type AS ENUM "
        "('text', 'audio', 'button', 'image', 'unknown')"
    )
    op.execute(
        "CREATE TYPE ai_decision_type AS ENUM "
        "('failure_classification', 'reply_classification', 'radius_check')"
    )

    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("evolution_instance", sa.String(length=255), nullable=False),
        sa.Column("evolution_token", sa.String(length=255), nullable=False),
        sa.Column("allowed_radius_km", sa.Numeric(6, 2), server_default="2.00", nullable=False),
        sa.Column("timeout_attempt_1_minutes", sa.Integer(), server_default="30", nullable=False),
        sa.Column("timeout_attempt_2_minutes", sa.Integer(), server_default="60", nullable=False),
        sa.Column("message_templates", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_tenants"),
        sa.UniqueConstraint("slug", name="uq_tenants_slug"),
    )

    op.create_table(
        "occurrences",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", OCCURRENCE_STATE, server_default="reported", nullable=False),
        sa.Column("failure_reason", FAILURE_REASON, nullable=True),
        sa.Column("failure_confidence", sa.Numeric(4, 3), nullable=True),
        sa.Column("requires_customer_contact", sa.Boolean(), nullable=True),
        sa.Column("driver_phone", sa.String(length=32), nullable=False),
        sa.Column("driver_name", sa.String(length=255), nullable=True),
        sa.Column("original_address", sa.Text(), nullable=True),
        sa.Column("route_id", sa.String(length=100), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_phone", sa.String(length=32), nullable=True),
        sa.Column("new_address_text", sa.Text(), nullable=True),
        sa.Column("new_address_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("new_address_lon", sa.Numeric(9, 6), nullable=True),
        sa.Column("distance_km", sa.Numeric(6, 2), nullable=True),
        sa.Column("within_radius", sa.Boolean(), nullable=True),
        sa.Column("contact_attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closure_reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_occurrences_tenant_id_tenants", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_occurrences"),
    )
    op.create_index("ix_occurrences_tenant_id_state", "occurrences", ["tenant_id", "state"])
    op.create_index("ix_occurrences_driver_phone", "occurrences", ["driver_phone"])
    op.create_index("ix_occurrences_customer_phone", "occurrences", ["customer_phone"])

    op.create_table(
        "state_transitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("occurrence_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_state", OCCURRENCE_STATE, nullable=True),
        sa.Column("to_state", OCCURRENCE_STATE, nullable=False),
        sa.Column("triggered_by", TRANSITION_ACTOR, nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["occurrence_id"], ["occurrences.id"], name="fk_state_transitions_occurrence_id_occurrences", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_state_transitions"),
    )
    op.create_index("ix_state_transitions_occurrence_id", "state_transitions", ["occurrence_id"])

    op.create_table(
        "message_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occurrence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("direction", MESSAGE_DIRECTION, nullable=False),
        sa.Column("participant", MESSAGE_PARTICIPANT, nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("content_type", MESSAGE_CONTENT_TYPE, server_default="text", nullable=False),
        sa.Column("content_text", sa.Text(), nullable=True),
        sa.Column("external_message_id", sa.String(length=255), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_message_logs_tenant_id_tenants", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["occurrence_id"], ["occurrences.id"], name="fk_message_logs_occurrence_id_occurrences", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_message_logs"),
    )
    op.create_index("ix_message_logs_tenant_id", "message_logs", ["tenant_id"])
    op.create_index("ix_message_logs_occurrence_id", "message_logs", ["occurrence_id"])
    op.create_index("ix_message_logs_external_message_id", "message_logs", ["external_message_id"])

    op.create_table(
        "ai_decision_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occurrence_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decision_type", AI_DECISION_TYPE, nullable=False),
        sa.Column("ai_provider", sa.String(length=50), nullable=False),
        sa.Column("ai_model", sa.String(length=100), nullable=False),
        sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("output_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_valid_schema", sa.Boolean(), nullable=False),
        sa.Column("confidence", sa.Numeric(4, 3), nullable=True),
        sa.Column("is_ambiguous", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("escalated_to_human", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_ai_decision_logs_tenant_id_tenants", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["occurrence_id"], ["occurrences.id"], name="fk_ai_decision_logs_occurrence_id_occurrences", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_ai_decision_logs"),
    )
    op.create_index("ix_ai_decision_logs_tenant_id", "ai_decision_logs", ["tenant_id"])
    op.create_index("ix_ai_decision_logs_occurrence_id", "ai_decision_logs", ["occurrence_id"])

    op.create_table(
        "processed_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_message_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("occurrence_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_processed_events_tenant_id_tenants", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["occurrence_id"], ["occurrences.id"], name="fk_processed_events_occurrence_id_occurrences", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_processed_events"),
        sa.UniqueConstraint("tenant_id", "external_message_id", name="uq_processed_events_tenant_message"),
    )


def downgrade() -> None:
    op.drop_table("processed_events")
    op.drop_table("ai_decision_logs")
    op.drop_table("message_logs")
    op.drop_table("state_transitions")
    op.drop_table("occurrences")
    op.drop_table("tenants")

    op.execute("DROP TYPE IF EXISTS ai_decision_type")
    op.execute("DROP TYPE IF EXISTS message_content_type")
    op.execute("DROP TYPE IF EXISTS message_participant")
    op.execute("DROP TYPE IF EXISTS message_direction")
    op.execute("DROP TYPE IF EXISTS transition_actor")
    op.execute("DROP TYPE IF EXISTS failure_reason")
    op.execute("DROP TYPE IF EXISTS occurrence_state")

    op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
