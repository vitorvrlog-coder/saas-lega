"""add driver_subscriptions and drivers.cpf

Revision ID: b7e2a9f4c3d5
Revises: a3d8f5c1e7b2
Create Date: 2026-07-10 23:30:00.000000

Assinatura paga do motorista no app low ticket ("adesão"), cobrada via
Asaas — ver app.services.driver_subscription_service. cpf em Driver é
exigido pelo Asaas pra criar o customer (só na hora de aderir, por isso
nullable — cadastro/login não dependem disso).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b7e2a9f4c3d5'
down_revision: Union[str, None] = 'a3d8f5c1e7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('drivers', sa.Column('cpf', sa.String(length=11), nullable=True))

    op.execute("CREATE TYPE driver_subscription_status AS ENUM ('pending', 'active', 'overdue', 'canceled')")

    op.create_table(
        'driver_subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('driver_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('asaas_customer_id', sa.String(length=64), nullable=False),
        sa.Column('asaas_subscription_id', sa.String(length=64), nullable=True),
        sa.Column(
            'status',
            postgresql.ENUM(name='driver_subscription_status', create_type=False),
            server_default='pending', nullable=False,
        ),
        sa.Column('value', sa.Numeric(10, 2), nullable=False),
        sa.Column('billing_type', sa.String(length=20), server_default='UNDEFINED', nullable=False),
        sa.Column('next_due_date', sa.Date(), nullable=True),
        sa.Column('checkout_url', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('canceled_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_driver_subscriptions'),
        sa.ForeignKeyConstraint(
            ['driver_id'], ['drivers.id'], name='fk_driver_subscriptions_driver_id_drivers', ondelete='CASCADE'
        ),
        sa.UniqueConstraint('driver_id', name='uq_driver_subscriptions_driver_id'),
    )


def downgrade() -> None:
    op.drop_table('driver_subscriptions')
    op.execute("DROP TYPE IF EXISTS driver_subscription_status")
    op.drop_column('drivers', 'cpf')
