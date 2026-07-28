"""
Fixtures de teste de integração — usam o Postgres real (DATABASE_URL do
.env), não um banco em memória: os models usam tipos específicos do
Postgres (ENUM nativo, JSONB, gen_random_uuid()) que não existem em SQLite,
então "unitário puro sem banco" não é uma opção fiel para essa camada.

Cada teste roda dentro de uma sessão que nunca é commitada — só flush — e é
revertida no final, então nada fica de resíduo no banco entre execuções.
"""
import pytest

from app.core.config import get_settings
from app.db.session import AsyncSessionLocal


@pytest.fixture
async def db_session():
    async with AsyncSessionLocal() as session:
        yield session
        await session.rollback()


@pytest.fixture(autouse=True)
def _dev_bypass_by_default(monkeypatch):
    """A suíte assume o bypass de dev do dashboard (INTERNAL_API_KEY=None)
    por padrão, independente do que o .env real tiver configurado (produção
    exige login de verdade) — testes que precisam do caminho de login real
    ligam isso explicitamente via o fixture `real_auth`
    (tests/test_access_control.py)."""
    monkeypatch.setattr(get_settings(), "INTERNAL_API_KEY", None)
