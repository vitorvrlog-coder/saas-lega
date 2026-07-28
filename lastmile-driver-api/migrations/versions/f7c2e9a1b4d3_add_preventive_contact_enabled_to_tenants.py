"""add preventive_contact_enabled to tenants

Revision ID: f7c2e9a1b4d3
Revises: e1b4f8a3c6d9
Create Date: 2026-07-10 01:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f7c2e9a1b4d3'
down_revision: Union[str, None] = 'e1b4f8a3c6d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tenants',
        sa.Column('preventive_contact_enabled', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('tenants', 'preventive_contact_enabled')
