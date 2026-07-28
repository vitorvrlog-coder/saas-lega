"""revert WhatsApp Cloud API credentials back to evolution-go fields

Revision ID: a1c4e8f2b9d6
Revises: f9a2c7e5b1d4
Create Date: 2026-07-28 15:00:00.000000

Reversão da migração f4a7c1d9b2e6: a aprovação de templates da Meta nunca
saiu do estágio "pendente" e travou o lançamento, então o gateway volta a
ser o evolution-go (mesmo usado pelo lastmile-engine) — texto livre, sem
exigência de template pré-aprovado. Sem migração de valor automática:
cada tenant precisa ser reconfigurado manualmente com instance/token reais
do evolution-go depois que a migração de infraestrutura acontecer.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1c4e8f2b9d6'
down_revision: Union[str, None] = 'f9a2c7e5b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('tenants', 'whatsapp_template_names')
    op.alter_column('tenants', 'whatsapp_access_token', new_column_name='evolution_token',
                     type_=sa.String(255), existing_type=sa.String(512))
    op.alter_column('tenants', 'whatsapp_phone_number_id', new_column_name='evolution_instance')


def downgrade() -> None:
    op.alter_column('tenants', 'evolution_instance', new_column_name='whatsapp_phone_number_id')
    op.alter_column('tenants', 'evolution_token', new_column_name='whatsapp_access_token',
                     type_=sa.String(512), existing_type=sa.String(255))
    op.add_column(
        'tenants',
        sa.Column('whatsapp_template_names', sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default='{}'),
    )
