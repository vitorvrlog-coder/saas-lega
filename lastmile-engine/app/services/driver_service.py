"""
Cadastro persistente de motorista (app.db.models.driver.Driver), por tenant.
Sem máquina de estados — motorista não tem fluxo, é só um perfil que
acumula identidade (nome, veículo) entre ocorrências, servindo de chave de
junção com a planilha de rota (app.services.manifest_service).
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver import Driver
from app.integrations.evolution_api.phone import normalize_br_phone


async def get_or_create_driver(
    db: AsyncSession, tenant_id: uuid.UUID, phone: str, name: str | None = None
) -> Driver:
    normalized = normalize_br_phone(phone)

    result = await db.execute(
        select(Driver).where(Driver.tenant_id == tenant_id, Driver.phone == normalized)
    )
    driver = result.scalars().first()

    if driver is None:
        driver = Driver(tenant_id=tenant_id, phone=normalized, name=name)
        db.add(driver)
        await db.flush()
        return driver

    # Nunca sobrescreve um nome já conhecido com None só porque esta
    # mensagem em particular não trouxe nome nenhum.
    if name and not driver.name:
        driver.name = name

    return driver


async def list_drivers(db: AsyncSession, tenant_id: uuid.UUID) -> list[Driver]:
    result = await db.execute(
        select(Driver).where(Driver.tenant_id == tenant_id).order_by(Driver.name, Driver.phone)
    )
    return list(result.scalars().all())


async def update_driver(
    db: AsyncSession,
    driver: Driver,
    name: str | None = None,
    vehicle_plate: str | None = None,
    vehicle_type: str | None = None,
) -> Driver:
    driver.name = name
    driver.vehicle_plate = vehicle_plate
    driver.vehicle_type = vehicle_type
    return driver
