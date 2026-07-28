"""add is_primary_admin, name, phone to users

Revision ID: a5f21c9e0b3d
Revises: 233691e8df81
Create Date: 2026-07-08 17:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5f21c9e0b3d'
down_revision: Union[str, None] = '233691e8df81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_primary_admin', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('name', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(30), nullable=True))
    op.execute(
        "CREATE UNIQUE INDEX ix_users_one_primary_admin_per_tenant "
        "ON users (tenant_id) WHERE is_primary_admin = true"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_one_primary_admin_per_tenant")
    op.drop_column('users', 'phone')
    op.drop_column('users', 'name')
    op.drop_column('users', 'is_primary_admin')
