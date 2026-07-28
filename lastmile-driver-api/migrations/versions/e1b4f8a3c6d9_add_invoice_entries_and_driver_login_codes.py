"""add invoice_entries and driver_login_codes

Revision ID: e1b4f8a3c6d9
Revises: c9f2a4b6d8e1
Create Date: 2026-07-10 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e1b4f8a3c6d9'
down_revision: Union[str, None] = 'c9f2a4b6d8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INVOICE_ENTRY_SOURCE = PGEnum(
    "xml", "photo_ocr", name="invoice_entry_source", create_type=False
)
INVOICE_ENTRY_STATUS = PGEnum(
    "pending_review", "confirmed", "rejected", "contact_sent",
    name="invoice_entry_status", create_type=False,
)


def upgrade() -> None:
    op.execute("CREATE TYPE invoice_entry_source AS ENUM ('xml', 'photo_ocr')")
    op.execute(
        "CREATE TYPE invoice_entry_status AS ENUM "
        "('pending_review', 'confirmed', 'rejected', 'contact_sent')"
    )

    op.create_table(
        "invoice_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", INVOICE_ENTRY_SOURCE, nullable=False),
        sa.Column("status", INVOICE_ENTRY_STATUS, server_default="pending_review", nullable=False),
        sa.Column("order_number", sa.String(length=100), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_phone", sa.String(length=32), nullable=True),
        sa.Column("customer_address", sa.Text(), nullable=True),
        sa.Column("raw_extracted_json", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("ocr_confidence", sa.Numeric(4, 3), nullable=True),
        sa.Column("photo_storage_key", sa.String(length=512), nullable=True),
        sa.Column("xml_storage_key", sa.String(length=512), nullable=True),
        sa.Column("route_manifest_entry_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_invoice_entries_tenant_id_tenants", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"], name="fk_invoice_entries_driver_id_drivers", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["route_manifest_entry_id"], ["route_manifest_entries.id"],
            name="fk_invoice_entries_route_manifest_entry_id", ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_invoice_entries"),
    )
    op.create_index(
        "ix_invoice_entries_tenant_id_driver_id_status", "invoice_entries",
        ["tenant_id", "driver_id", "status"],
    )
    op.create_index(
        "ix_invoice_entries_tenant_id_order_number", "invoice_entries",
        ["tenant_id", "order_number"],
    )

    op.create_table(
        "driver_login_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"], name="fk_driver_login_codes_driver_id_drivers", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_driver_login_codes"),
    )
    op.create_index("ix_driver_login_codes_driver_id", "driver_login_codes", ["driver_id"])


def downgrade() -> None:
    op.drop_table("driver_login_codes")
    op.drop_table("invoice_entries")
    op.execute("DROP TYPE IF EXISTS invoice_entry_status")
    op.execute("DROP TYPE IF EXISTS invoice_entry_source")
