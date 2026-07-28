"""migrate evolution-go fields to WhatsApp Cloud API credentials

Revision ID: f4a7c1d9b2e6
Revises: c8b3d5f4a1e2
Create Date: 2026-07-09 15:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f4a7c1d9b2e6'
down_revision: Union[str, None] = 'c8b3d5f4a1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Sem migração de valor automática possível: evolution_instance/token
    # (nome de instância + token do gateway) não correspondem a nenhum
    # phone_number_id/access_token real da Meta — cada tenant precisa ser
    # reconfigurado manualmente com credenciais reais da Cloud API depois
    # que a migração de infraestrutura acontecer.
    op.alter_column('tenants', 'evolution_instance', new_column_name='whatsapp_phone_number_id')
    op.alter_column('tenants', 'evolution_token', new_column_name='whatsapp_access_token',
                     type_=sa.String(512), existing_type=sa.String(255))
    op.add_column(
        'tenants',
        sa.Column('whatsapp_template_names', postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default='{}'),
    )


def downgrade() -> None:
    op.drop_column('tenants', 'whatsapp_template_names')
    op.alter_column('tenants', 'whatsapp_access_token', new_column_name='evolution_token',
                     type_=sa.String(255), existing_type=sa.String(512))
    op.alter_column('tenants', 'whatsapp_phone_number_id', new_column_name='evolution_instance')
