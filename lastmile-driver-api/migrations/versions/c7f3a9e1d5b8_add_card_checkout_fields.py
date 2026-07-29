"""add card checkout fields (driver email, subscription card token, card_declined status)

Revision ID: c7f3a9e1d5b8
Revises: a1c4e8f2b9d6
Create Date: 2026-07-29 12:00:00.000000

Suporte a checkout de cartão próprio (tokenização via Asaas) pra assinatura
do motorista: e-mail do motorista (exigido pelo creditCardHolderInfo do
Asaas), token de cartão reutilizável na assinatura, e um novo status pra
cobrança recusada — hoje esses eventos caem no `else` silencioso de
handle_webhook_event.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c7f3a9e1d5b8'
down_revision: Union[str, None] = 'a1c4e8f2b9d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('drivers', sa.Column('email', sa.String(length=255), nullable=True))
    op.add_column(
        'driver_subscriptions',
        sa.Column('asaas_credit_card_token', sa.String(length=64), nullable=True),
    )
    op.execute("ALTER TYPE driver_subscription_status ADD VALUE IF NOT EXISTS 'card_declined'")


def downgrade() -> None:
    # Postgres não suporta remover valor de enum diretamente — sem
    # downgrade real possível sem recriar o tipo inteiro (e migrar
    # qualquer linha que já use o valor novo). Deixado como no-op
    # documentado, igual ao padrão de outras migrations irreversíveis
    # deste projeto quando a operação inversa é impraticável.
    pass
