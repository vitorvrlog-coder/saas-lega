"""exclude tenant_id IS NULL from primary admin unique index

Revision ID: c8b3d5f4a1e2
Revises: a5f21c9e0b3d
Create Date: 2026-07-08 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c8b3d5f4a1e2'
down_revision: Union[str, None] = 'a5f21c9e0b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres trata NULL como distinto em índice único — sem excluir
    # tenant_id IS NULL, várias linhas com tenant_id=NULL e
    # is_primary_admin=true (hipoteticamente, admin de plataforma) não
    # violariam o índice, quebrando o invariante "no máximo 1 admin
    # principal por tenant" pra esse caso.
    op.execute("DROP INDEX IF EXISTS ix_users_one_primary_admin_per_tenant")
    op.execute(
        "CREATE UNIQUE INDEX ix_users_one_primary_admin_per_tenant "
        "ON users (tenant_id) WHERE is_primary_admin = true AND tenant_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_one_primary_admin_per_tenant")
    op.execute(
        "CREATE UNIQUE INDEX ix_users_one_primary_admin_per_tenant "
        "ON users (tenant_id) WHERE is_primary_admin = true"
    )
