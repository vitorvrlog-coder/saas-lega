"""add awaiting_driver_clarification to occurrence_state enum

Revision ID: c9f2a4b6d8e1
Revises: b3d8e5a1c7f4
Create Date: 2026-07-09 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c9f2a4b6d8e1'
down_revision: Union[str, None] = 'b3d8e5a1c7f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE occurrence_state ADD VALUE IF NOT EXISTS 'awaiting_driver_clarification'")


def downgrade() -> None:
    # Postgres não suporta remover valor de enum diretamente — sem
    # downgrade real possível sem recriar o tipo inteiro (e migrar
    # qualquer linha que já use o valor novo). Deixado como no-op
    # documentado, igual ao padrão de outras migrations irreversíveis
    # deste projeto quando a operação inversa é impraticável.
    pass
