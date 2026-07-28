"""add full_autonomous_mode to tenants

Revision ID: b3d8e5a1c7f4
Revises: f4a7c1d9b2e6
Create Date: 2026-07-09 19:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b3d8e5a1c7f4'
down_revision: Union[str, None] = 'f4a7c1d9b2e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tenants',
        sa.Column('full_autonomous_mode', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('tenants', 'full_autonomous_mode')
