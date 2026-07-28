"""
Base declarativa e metadata compartilhada por todos os models.

Convenção de nomes de constraint é fixada aqui para que o autogenerate do
Alembic produza nomes previsíveis (ix_, uq_, ck_, fk_, pk_) em vez dos nomes
aleatórios que o Postgres geraria sozinho — isso importa para conseguir
escrever migrations de downgrade/alteração no futuro sem precisar descobrir
o nome da constraint em produção.
"""
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
