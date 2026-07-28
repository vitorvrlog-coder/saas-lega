"""make ai_decision_logs.occurrence_id nullable

Revision ID: f9a2c7e5b1d4
Revises: d4e8f1a2c9b7
Create Date: 2026-07-12 00:00:00.000000

Decisões de IA fora do fluxo de Occurrence (pré-triagem de Route Capture,
ver app.services.route_prescreen_service) não têm ocorrência associada —
mesmo padrão já usado em message_logs.occurrence_id.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f9a2c7e5b1d4'
down_revision: Union[str, None] = 'd4e8f1a2c9b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('ai_decision_logs', 'occurrence_id', existing_type=sa.dialects.postgresql.UUID(as_uuid=True), nullable=True)


def downgrade() -> None:
    op.alter_column('ai_decision_logs', 'occurrence_id', existing_type=sa.dialects.postgresql.UUID(as_uuid=True), nullable=False)
