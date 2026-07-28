"""make drivers.tenant_id nullable

Revision ID: a3d8f5c1e7b2
Revises: f7c2e9a1b4d3
Create Date: 2026-07-10 23:00:00.000000

Motorista assinante do low ticket pode ser cadastrado no backoffice antes
de saber a qual transportadora ele pertence (fica "órfão" até alguém
vincular depois) — ver app.services.driver_service. A constraint UNIQUE
(tenant_id, phone) já existente trata múltiplos NULLs como não-duplicados
(comportamento padrão do Postgres), então adicionamos um índice único
parcial só pra telefone quando tenant_id é NULL, pra não deixar cadastrar
o mesmo motorista órfão duas vezes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3d8f5c1e7b2'
down_revision: Union[str, None] = 'f7c2e9a1b4d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('drivers', 'tenant_id', existing_type=sa.dialects.postgresql.UUID(as_uuid=True), nullable=True)
    op.create_index(
        'uq_drivers_orphan_phone',
        'drivers',
        ['phone'],
        unique=True,
        postgresql_where=sa.text('tenant_id IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_drivers_orphan_phone', table_name='drivers')
    op.alter_column('drivers', 'tenant_id', existing_type=sa.dialects.postgresql.UUID(as_uuid=True), nullable=False)
