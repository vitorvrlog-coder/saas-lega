"""
Cadastro persistente de motorista (app.db.models.driver.Driver), por tenant.
Sem máquina de estados — motorista não tem fluxo, é só um perfil que
acumula identidade (nome, veículo) entre ocorrências, servindo de chave de
junção com a planilha de rota (app.services.manifest_service).
"""
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver import Driver
from app.db.models.driver_login_code import DriverLoginCode
from app.db.models.invoice_entry import InvoiceEntry
from app.db.models.message_log import MessageLog
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.phone import normalize_br_phone


class DuplicateDriverPhoneError(Exception):
    """Já existe um motorista com esse telefone neste tenant."""


class DriverHasDataError(Exception):
    """Motorista tem ocorrências/notas vinculadas — não pode ser removido."""


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


async def create_driver(
    db: AsyncSession,
    tenant_id: uuid.UUID | None,
    phone: str,
    name: str | None = None,
    vehicle_plate: str | None = None,
    vehicle_type: str | None = None,
) -> Driver:
    """Cadastro explícito pelo backoffice — diferente de get_or_create_driver
    (que nasce implicitamente da 1ª mensagem recebida), aqui é sempre uma
    ação humana deliberada, então duplicidade é erro, não upsert silencioso.
    tenant_id é opcional: motorista pode ser cadastrado antes de saber a
    transportadora ("órfão", ver Driver) — nesse caso o dedup é só por
    telefone (a UniqueConstraint (tenant_id, phone) não pega duas linhas
    com tenant_id NULL, por isso o check é feito aqui em vez de deixar o
    banco rejeitar)."""
    normalized = normalize_br_phone(phone)

    dedup_query = select(Driver).where(Driver.phone == normalized)
    dedup_query = (
        dedup_query.where(Driver.tenant_id == tenant_id)
        if tenant_id is not None
        else dedup_query.where(Driver.tenant_id.is_(None))
    )
    existing = (await db.execute(dedup_query)).scalars().first()
    if existing is not None:
        raise DuplicateDriverPhoneError(f"Já existe um motorista cadastrado com o telefone {normalized}.")

    driver = Driver(
        tenant_id=tenant_id,
        phone=normalized,
        name=name or None,
        vehicle_plate=vehicle_plate or None,
        vehicle_type=vehicle_type or None,
    )
    db.add(driver)
    await db.flush()
    return driver


async def list_unlinked_drivers(db: AsyncSession) -> list[Driver]:
    """Motoristas cadastrados sem transportadora ainda — pra aba global do
    backoffice mostrar quem falta vincular."""
    result = await db.execute(
        select(Driver).where(Driver.tenant_id.is_(None)).order_by(Driver.name, Driver.phone)
    )
    return list(result.scalars().all())


async def assign_tenant(db: AsyncSession, driver: Driver, tenant_id: uuid.UUID) -> Driver:
    """Vincula um motorista órfão a uma transportadora — mesma checagem de
    duplicidade de create_driver, porque a UniqueConstraint só protege
    contra duplicata em UPDATE se não colidir com outra linha já existente
    daquele tenant."""
    existing = (
        await db.execute(
            select(Driver).where(Driver.tenant_id == tenant_id, Driver.phone == driver.phone, Driver.id != driver.id)
        )
    ).scalars().first()
    if existing is not None:
        raise DuplicateDriverPhoneError(
            f"Essa transportadora já tem um motorista cadastrado com o telefone {driver.phone}."
        )

    driver.tenant_id = tenant_id
    return driver


async def set_driver_active(db: AsyncSession, driver: Driver, is_active: bool) -> Driver:
    driver.is_active = is_active
    return driver


async def delete_driver(db: AsyncSession, driver: Driver) -> None:
    """Bloqueia remoção se o motorista já tem nota fiscal vinculada
    (invoice_entries.driver_id é RESTRICT) — nesse caso, orientamos
    desativar em vez de remover, pra não perder o histórico."""
    invoice_count = (
        await db.execute(
            select(func.count()).select_from(InvoiceEntry).where(InvoiceEntry.driver_id == driver.id)
        )
    ).scalar_one()
    if invoice_count > 0:
        raise DriverHasDataError(
            f"Este motorista tem {invoice_count} nota(s) vinculada(s) — não pode ser removido. "
            "Use 'Desativar' pra impedir novo uso sem perder o histórico."
        )

    try:
        await db.delete(driver)
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise DriverHasDataError("Este motorista tem dados vinculados — não pode ser removido.") from exc


async def list_subscriber_drivers_with_tenant(db: AsyncSession) -> list[tuple[Driver, Tenant]]:
    """Motoristas ASSINANTES do produto low ticket (app de nota fiscal) —
    de todas as transportadoras/distribuidoras juntas, pra aba global do
    backoffice. Dois filtros, os dois precisam valer:
    1. Tenant.preventive_contact_enabled=True — é o flag que liga o
       produto de nota fiscal por tenant; tenant só do produto principal
       (enterprise) fica de fora, mesmo tendo Driver cadastrado.
    2. Já entrou no app pelo menos uma vez (DriverLoginCode.used_at
       preenchido) — Driver cadastrado mas que nunca logou não é
       assinante de verdade, só um cadastro pendente."""
    result = await db.execute(
        select(Driver, Tenant)
        .join(Tenant, Tenant.id == Driver.tenant_id)
        .where(
            Tenant.preventive_contact_enabled.is_(True),
            select(DriverLoginCode.id)
            .where(DriverLoginCode.driver_id == Driver.id, DriverLoginCode.used_at.is_not(None))
            .exists(),
        )
        .order_by(Tenant.name, Driver.name, Driver.phone)
    )
    return [(row.Driver, row.Tenant) for row in result]


async def get_subscriber_driver_stats(db: AsyncSession) -> dict[uuid.UUID, dict[str, int]]:
    """Igual a get_driver_stats, mas pros motoristas assinantes de todas as
    transportadoras juntos — mensagens são casadas por (tenant_id, phone)
    e não só phone, já que o mesmo número pode existir em tenants
    diferentes."""
    invoice_rows = await db.execute(select(InvoiceEntry.driver_id, func.count()).group_by(InvoiceEntry.driver_id))
    occurrence_rows = await db.execute(
        select(Occurrence.driver_id, func.count())
        .where(Occurrence.driver_id.is_not(None))
        .group_by(Occurrence.driver_id)
    )
    message_rows = await db.execute(
        select(MessageLog.tenant_id, MessageLog.phone, func.count()).group_by(MessageLog.tenant_id, MessageLog.phone)
    )

    invoice_counts = dict(invoice_rows.all())
    occurrence_counts = dict(occurrence_rows.all())
    message_counts_by_tenant_phone = {(tenant_id, phone): count for tenant_id, phone, count in message_rows.all()}

    drivers_with_tenant = await list_subscriber_drivers_with_tenant(db)
    return {
        driver.id: {
            "invoices": invoice_counts.get(driver.id, 0),
            "occurrences": occurrence_counts.get(driver.id, 0),
            "messages": message_counts_by_tenant_phone.get((driver.tenant_id, driver.phone), 0),
        }
        for driver, _tenant in drivers_with_tenant
    }


async def get_driver_stats(db: AsyncSession, tenant_id: uuid.UUID) -> dict[uuid.UUID, dict[str, int]]:
    """Contagens por motorista pro backoffice: notas processadas, ocorrências
    do produto principal, e mensagens WhatsApp trocadas (por telefone, já
    que MessageLog não tem driver_id — só participant+phone)."""
    invoice_rows = await db.execute(
        select(InvoiceEntry.driver_id, func.count())
        .where(InvoiceEntry.tenant_id == tenant_id)
        .group_by(InvoiceEntry.driver_id)
    )
    occurrence_rows = await db.execute(
        select(Occurrence.driver_id, func.count())
        .where(Occurrence.tenant_id == tenant_id, Occurrence.driver_id.is_not(None))
        .group_by(Occurrence.driver_id)
    )
    drivers = await list_drivers(db, tenant_id)
    message_rows = await db.execute(
        select(MessageLog.phone, func.count())
        .where(MessageLog.tenant_id == tenant_id, MessageLog.phone.in_([d.phone for d in drivers]))
        .group_by(MessageLog.phone)
    )

    invoice_counts = dict(invoice_rows.all())
    occurrence_counts = dict(occurrence_rows.all())
    message_counts_by_phone = dict(message_rows.all())

    return {
        driver.id: {
            "invoices": invoice_counts.get(driver.id, 0),
            "occurrences": occurrence_counts.get(driver.id, 0),
            "messages": message_counts_by_phone.get(driver.phone, 0),
        }
        for driver in drivers
    }


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
