"""add route capture sessions/stops and drivers.platform

Revision ID: d4e8f1a2c9b7
Revises: b7e2a9f4c3d5
Create Date: 2026-07-12 00:00:00.000000

Terceiro produto do app de motoristas: captura guiada de telas do app
oficial da plataforma (Mercado Livre/Shopee) via MediaProjection, OCR em
lote, pré-triagem via WhatsApp e roteirizador. drivers.platform indica qual
heurístico de OCR usar; DISTRIBUIDORA nunca cria RouteCaptureSession,
reaproveita o fluxo de nota fiscal existente (ver invoice_entries).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4e8f1a2c9b7'
down_revision: Union[str, None] = 'b7e2a9f4c3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DRIVER_PLATFORM = PGEnum(
    "meli", "shopee", "distribuidora", name="driver_platform", create_type=False,
)
ROUTE_CAPTURE_SESSION_STATUS = PGEnum(
    "in_progress", "review", "confirmed", "route_ready", "canceled",
    name="route_capture_session_status", create_type=False,
)
ROUTE_CAPTURE_STOP_OCR_STATUS = PGEnum(
    "pending_review", "confirmed", "rejected",
    name="route_capture_stop_ocr_status", create_type=False,
)
ROUTE_CAPTURE_PRESCREEN_STATUS = PGEnum(
    "not_sent", "sent", "confirmed", "unavailable", "address_wrong", "no_response_timeout",
    name="route_capture_prescreen_status", create_type=False,
)


def upgrade() -> None:
    op.execute("CREATE TYPE driver_platform AS ENUM ('meli', 'shopee', 'distribuidora')")
    op.execute(
        "CREATE TYPE route_capture_session_status AS ENUM "
        "('in_progress', 'review', 'confirmed', 'route_ready', 'canceled')"
    )
    op.execute(
        "CREATE TYPE route_capture_stop_ocr_status AS ENUM "
        "('pending_review', 'confirmed', 'rejected')"
    )
    op.execute(
        "CREATE TYPE route_capture_prescreen_status AS ENUM "
        "('not_sent', 'sent', 'confirmed', 'unavailable', 'address_wrong', 'no_response_timeout')"
    )

    op.add_column("drivers", sa.Column("platform", DRIVER_PLATFORM, nullable=True))

    op.create_table(
        "route_capture_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform", DRIVER_PLATFORM, nullable=False),
        sa.Column("status", ROUTE_CAPTURE_SESSION_STATUS, server_default="in_progress", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("route_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"],
            name="fk_route_capture_sessions_tenant_id_tenants", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["driver_id"], ["drivers.id"],
            name="fk_route_capture_sessions_driver_id_drivers", ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_route_capture_sessions"),
    )
    op.create_index(
        "ix_route_capture_sessions_tenant_id_driver_id_status", "route_capture_sessions",
        ["tenant_id", "driver_id", "status"],
    )

    op.create_table(
        "route_capture_stops",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("screenshot_storage_key", sa.String(length=512), nullable=True),
        sa.Column("screenshot_storage_key_phone", sa.String(length=512), nullable=True),
        sa.Column("ocr_status", ROUTE_CAPTURE_STOP_OCR_STATUS, server_default="pending_review", nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_phone", sa.String(length=32), nullable=True),
        sa.Column("customer_address", sa.Text(), nullable=True),
        sa.Column("raw_extracted_json", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("ocr_confidence", sa.Numeric(4, 3), nullable=True),
        sa.Column("prescreen_status", ROUTE_CAPTURE_PRESCREEN_STATUS, server_default="not_sent", nullable=False),
        sa.Column("prescreen_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("prescreen_responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("lon", sa.Numeric(9, 6), nullable=True),
        sa.Column("route_sequence", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"],
            name="fk_route_capture_stops_tenant_id_tenants", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["route_capture_sessions.id"],
            name="fk_route_capture_stops_session_id_route_capture_sessions", ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_route_capture_stops"),
    )
    op.create_index("ix_route_capture_stops_session_id", "route_capture_stops", ["session_id"])
    op.create_index(
        "ix_route_capture_stops_tenant_id_prescreen_status", "route_capture_stops",
        ["tenant_id", "prescreen_status"],
    )


def downgrade() -> None:
    op.drop_table("route_capture_stops")
    op.drop_table("route_capture_sessions")
    op.drop_column("drivers", "platform")
    op.execute("DROP TYPE IF EXISTS route_capture_prescreen_status")
    op.execute("DROP TYPE IF EXISTS route_capture_stop_ocr_status")
    op.execute("DROP TYPE IF EXISTS route_capture_session_status")
    op.execute("DROP TYPE IF EXISTS driver_platform")
