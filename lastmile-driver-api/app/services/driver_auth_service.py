"""
Login do app do motorista: código de 6 dígitos de uso único enviado por
WhatsApp (canal já confiável, sem inventar SMS/senha) -> troca por token
assinado (app.core.driver_auth). Só motorista JÁ cadastrado por um operador
(app.services.driver_service) pode logar — este módulo nunca cria Driver.
"""
import datetime
import logging
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.db.models.driver import Driver
from app.db.models.driver_login_code import DriverLoginCode
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.client import EvolutionAPIError
from app.integrations.evolution_api.phone import normalize_br_phone
from app.services.message_templates import DRIVER_LOGIN_CODE, render_template
from app.services.occurrence_service import evolution_client_for, send_text_message

logger = logging.getLogger(__name__)

CODE_TTL_MINUTES = 10


async def get_active_driver(db: AsyncSession, tenant_id: uuid.UUID, phone: str) -> Driver | None:
    normalized = normalize_br_phone(phone)
    result = await db.execute(
        select(Driver).where(
            Driver.tenant_id == tenant_id, Driver.phone == normalized, Driver.is_active.is_(True)
        )
    )
    return result.scalars().first()


async def issue_login_code(db: AsyncSession, driver: Driver) -> str:
    """Gera e persiste (hasheado) um código de 6 dígitos. Retorna o código
    em texto claro só pra este call site enviar via WhatsApp — nunca fica
    gravado em texto claro."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    login_code = DriverLoginCode(
        driver_id=driver.id,
        code_hash=hash_password(code),
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(minutes=CODE_TTL_MINUTES),
    )
    db.add(login_code)
    await db.flush()
    return code


async def send_login_code(db: AsyncSession, settings: Settings, tenant: Tenant, driver: Driver, code: str) -> None:
    """Best-effort — chamado a partir de /auth/request-code, que sempre
    responde 204 mesmo se o motorista/tenant não existir (nunca revela
    cadastro). Uma falha real de envio (token expirado, rede) não pode
    virar 500 pro app: loga e segue, mesmo comportamento de
    _notify_driver_best_effort em occurrence_service. Bug real encontrado
    2026-07-12 testando o app de verdade: sem este try/except, um token
    expirado derrubava a rota inteira com 500."""
    text = render_template(tenant, DRIVER_LOGIN_CODE, code=code)
    if not text:
        return
    client = evolution_client_for(tenant, settings)
    try:
        await send_text_message(db, client, tenant, DRIVER_LOGIN_CODE, driver.phone, text, code=code)
    except EvolutionAPIError as exc:
        logger.warning("Falha ao enviar código de login pro motorista %s: %s", driver.id, exc)


async def verify_login_code(db: AsyncSession, driver: Driver, code: str) -> bool:
    """Confere contra qualquer código ainda válido (não usado, não expirado)
    desse motorista — marca como usado no primeiro match pra impedir replay."""
    result = await db.execute(
        select(DriverLoginCode).where(
            DriverLoginCode.driver_id == driver.id,
            DriverLoginCode.used_at.is_(None),
            DriverLoginCode.expires_at > datetime.datetime.now(datetime.timezone.utc),
        )
    )
    for login_code in result.scalars().all():
        if verify_password(code, login_code.code_hash):
            login_code.used_at = datetime.datetime.now(datetime.timezone.utc)
            return True
    return False
