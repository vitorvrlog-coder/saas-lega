"""Backoffice — área de uso interno da Heimdall (não da transportadora):
gestão de transportadoras (tenants) e visão geral de todas elas. Tudo aqui
é restrito a admin da plataforma (require_platform_admin). O dashboard
operacional que a transportadora usa mora em app.web.routes, separado."""
import uuid

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models.driver import Driver
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_db
from app.services import driver_service, driver_subscription_service, tenant_service, user_service
from app.services.driver_service import DriverHasDataError, DuplicateDriverPhoneError
from app.services.driver_subscription_service import (
    DriverMissingCPFError,
    DriverNotLinkedError,
    SubscriptionAlreadyExistsError,
)
from app.services.tenant_service import DuplicateTenantSlugError, TenantHasDataError, TenantProvisioningError
from app.services.user_service import DuplicateEmailError
from app.web.backoffice_health import get_tenant_health
from app.web.backoffice_stats import get_backoffice_overview
from app.web.deps import require_platform_admin, templates

router = APIRouter(prefix="/backoffice", dependencies=[Depends(require_platform_admin)])


@router.get("/", response_class=HTMLResponse)
async def backoffice_overview(request: Request, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    overview = await get_backoffice_overview(db)
    return templates.TemplateResponse(request, "backoffice_overview.html", {"overview": overview})


@router.get("/drivers", response_class=HTMLResponse)
async def backoffice_drivers(request: Request, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    """Aba global de motoristas assinantes — todas as transportadoras
    juntas, visão da Heimdall (diferente da seção de motoristas dentro de
    /backoffice/tenants/{id}, que é só daquele tenant)."""
    context = await _backoffice_drivers_context(db, driver_error=None)
    return templates.TemplateResponse(request, "backoffice_drivers.html", context)


@router.get("/health", response_class=HTMLResponse)
async def backoffice_health(
    request: Request, db: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)
) -> HTMLResponse:
    health = await get_tenant_health(db, settings)
    return templates.TemplateResponse(request, "backoffice_health.html", {"health": health})


async def _get_tenant_or_404(db: AsyncSession, tenant_id: uuid.UUID) -> Tenant | None:
    return await db.get(Tenant, tenant_id)


async def _tenant_detail_context(
    db: AsyncSession,
    tenant: Tenant,
    *,
    error: str | None = None,
    user_error: str | None = None,
    driver_error: str | None = None,
    subscription_error: str | None = None,
) -> dict:
    """Contexto completo de tenant_detail.html — centralizado pra todo
    render_response (sucesso ou erro de qualquer um dos 3 formulários da
    página) sempre passar as mesmas chaves. Duplicar isso em cada rota é
    como um branch de erro acabou ficando sem 'drivers'/'subscriptions'
    antes, quebrando o template só nesse caminho."""
    operators = (
        await db.execute(select(User).where(User.tenant_id == tenant.id).order_by(User.email))
    ).scalars().all()
    drivers = await driver_service.list_drivers(db, tenant.id)
    driver_stats = await driver_service.get_driver_stats(db, tenant.id)
    subscriptions = await driver_subscription_service.get_subscriptions_by_driver(db, [d.id for d in drivers])
    return {
        "tenant": tenant, "operators": operators, "error": error, "user_error": user_error,
        "drivers": drivers, "driver_stats": driver_stats, "driver_error": driver_error,
        "subscriptions": subscriptions, "subscription_error": subscription_error,
    }


@router.get("/tenants", response_class=HTMLResponse)
async def tenants_list(request: Request, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    result = await db.execute(select(Tenant).order_by(Tenant.name))
    tenants = result.scalars().all()
    return templates.TemplateResponse(request, "tenants_list.html", {"tenants": tenants})


@router.get("/tenants/new", response_class=HTMLResponse)
async def tenant_new_form(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request, "tenant_form.html", {"error": None, "values": {}}
    )


@router.post("/tenants/new")
async def tenant_new_submit(
    request: Request,
    name: str = Form(...),
    slug: str = Form(...),
    allowed_radius_km: float = Form(...),
    timeout_attempt_1_minutes: int = Form(...),
    timeout_attempt_2_minutes: int = Form(...),
    full_autonomous_mode: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    values = {
        "name": name, "slug": slug,
        "allowed_radius_km": allowed_radius_km,
        "timeout_attempt_1_minutes": timeout_attempt_1_minutes,
        "timeout_attempt_2_minutes": timeout_attempt_2_minutes,
        "full_autonomous_mode": bool(full_autonomous_mode),
    }
    try:
        tenant = await tenant_service.create_tenant(
            db, settings,
            name=name, slug=slug.strip().lower(),
            allowed_radius_km=allowed_radius_km,
            timeout_attempt_1_minutes=timeout_attempt_1_minutes,
            timeout_attempt_2_minutes=timeout_attempt_2_minutes,
            full_autonomous_mode=bool(full_autonomous_mode),
        )
    except (DuplicateTenantSlugError, TenantProvisioningError) as exc:
        return templates.TemplateResponse(
            request, "tenant_form.html", {"error": str(exc), "values": values}, status_code=400
        )

    await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant.id}", status_code=303)


@router.get("/tenants/{tenant_id}", response_class=HTMLResponse)
async def tenant_detail(
    request: Request, tenant_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> HTMLResponse:
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    delete_error = (
        "Este tenant já tem ocorrências registradas — não pode ser removido. "
        "Use 'Desativar' pra impedir novo uso sem perder o histórico."
        if request.query_params.get("delete_blocked")
        else None
    )
    driver_error = (
        "Este motorista tem nota(s) vinculada(s) — não pode ser removido. "
        "Use 'Desativar' pra impedir novo uso sem perder o histórico."
        if request.query_params.get("driver_delete_blocked")
        else None
    )

    context = await _tenant_detail_context(db, tenant, error=delete_error, driver_error=driver_error)
    return templates.TemplateResponse(request, "tenant_detail.html", context)


@router.post("/tenants/{tenant_id}")
async def tenant_update_submit(
    request: Request,
    tenant_id: uuid.UUID,
    name: str = Form(...),
    allowed_radius_km: float = Form(...),
    timeout_attempt_1_minutes: int = Form(...),
    timeout_attempt_2_minutes: int = Form(...),
    full_autonomous_mode: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Config de negócio (nome/raio/timeout) — templates de mensagem saíram
    daqui: quem edita agora é o admin do próprio tenant, no dashboard
    operacional (/web/my-tenant/templates), não o admin da plataforma.
    instance/token do evolution-go não são editáveis aqui — só via
    'Reconectar' (recria a instância mantendo o mesmo nome/token)."""
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    await tenant_service.update_tenant(
        db, tenant,
        name=name,
        allowed_radius_km=allowed_radius_km,
        timeout_attempt_1_minutes=timeout_attempt_1_minutes,
        timeout_attempt_2_minutes=timeout_attempt_2_minutes,
        full_autonomous_mode=bool(full_autonomous_mode),
    )
    await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/delete")
async def tenant_delete(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    try:
        await tenant_service.delete_tenant(db, settings, tenant)
    except TenantHasDataError:
        await db.rollback()
        return RedirectResponse(
            url=f"/backoffice/tenants/{tenant_id}?delete_blocked=1", status_code=303
        )

    await db.commit()
    return RedirectResponse(url="/backoffice/tenants", status_code=303)


@router.post("/tenants/{tenant_id}/toggle-active")
async def tenant_toggle_active(
    tenant_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is not None:
        await tenant_service.set_tenant_active(db, tenant, not tenant.is_active)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.get("/tenants/{tenant_id}/connection", response_class=HTMLResponse)
async def tenant_connection_partial(
    request: Request,
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    """Parcial HTMX, pollado periodicamente pela tela de detalhe do tenant:
    checa status da instância no gateway e, se ainda não conectada, busca um
    QR code novo (expira em ~40s, por isso a busca a cada poll em vez de
    cachear). Lógica de status/QR/corrida pós-pareamento centralizada em
    tenant_service.get_tenant_connection_view (compartilhada com a tela
    equivalente do admin de tenant em app.web.routes)."""
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return HTMLResponse("Tenant não encontrado.", status_code=404)

    view = await tenant_service.get_tenant_connection_view(settings, tenant)

    return templates.TemplateResponse(
        request, "tenant_qr_partial.html",
        {"tenant": tenant, **view},
    )


@router.post("/tenants/{tenant_id}/reconnect", response_class=HTMLResponse)
async def tenant_reconnect_whatsapp(
    request: Request,
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    """Apaga e recria a instância no gateway (mesmo nome/token) — único jeito
    de destravar um cliente que desconectou sozinho e ficou preso retornando
    "client disconnected" pra tudo, inclusive pedidos de QR novo."""
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    try:
        await tenant_service.reconnect_tenant_whatsapp(settings, tenant)
    except TenantProvisioningError as exc:
        return templates.TemplateResponse(
            request, "tenant_qr_partial.html",
            {
                "tenant": tenant, "status": {}, "qr_data_url": None,
                "error": str(exc), "stuck_disconnected": True,
            },
            status_code=400,
        )

    return templates.TemplateResponse(
        request, "tenant_qr_partial.html",
        {"tenant": tenant, "status": {}, "qr_data_url": None, "error": None, "stuck_disconnected": False},
    )


@router.post("/tenants/{tenant_id}/users")
async def tenant_create_operator(
    request: Request,
    tenant_id: uuid.UUID,
    email: str = Form(...),
    password: str = Form(...),
    is_tenant_admin: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    try:
        await user_service.create_tenant_operator(
            db, tenant_id=tenant_id, email=email, password=password,
            is_tenant_admin=bool(is_tenant_admin),
        )
    except DuplicateEmailError as exc:
        context = await _tenant_detail_context(db, tenant, user_error=str(exc))
        return templates.TemplateResponse(request, "tenant_detail.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/users/{user_id}/toggle-active")
async def tenant_operator_toggle_active(
    tenant_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == tenant_id:
        await user_service.set_user_active(db, operator, not operator.is_active)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/users/{user_id}/toggle-tenant-admin")
async def tenant_operator_toggle_tenant_admin(
    tenant_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == tenant_id:
        await user_service.set_tenant_admin(db, operator, not operator.is_tenant_admin)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/users/{user_id}/toggle-primary-admin")
async def tenant_operator_toggle_primary_admin(
    tenant_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == tenant_id:
        await user_service.set_primary_admin(db, operator, not operator.is_primary_admin)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/users/{user_id}/delete")
async def tenant_operator_delete(
    tenant_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == tenant_id:
        await user_service.delete_user(db, operator)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/users/{user_id}/reset-password")
async def tenant_operator_reset_password(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    new_password: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Reset por autoridade — admin da plataforma define uma senha nova
    pro operador sem precisar da senha atual dele (diferente da troca
    autoatendida em /web/change-password)."""
    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == tenant_id and len(new_password) >= 8:
        await user_service.set_user_password(db, operator, new_password)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


async def _backoffice_drivers_context(db: AsyncSession, driver_error: str | None) -> dict:
    drivers_with_tenant = await driver_service.list_subscriber_drivers_with_tenant(db)
    driver_stats = await driver_service.get_subscriber_driver_stats(db)
    unlinked_drivers = await driver_service.list_unlinked_drivers(db)
    subscriptions = await driver_subscription_service.get_subscriptions_by_driver(
        db, [driver.id for driver, _tenant in drivers_with_tenant]
    )
    tenants = (await db.execute(select(Tenant).where(Tenant.is_active.is_(True)).order_by(Tenant.name))).scalars().all()
    return {
        "drivers_with_tenant": drivers_with_tenant, "driver_stats": driver_stats,
        "unlinked_drivers": unlinked_drivers, "tenants": tenants, "driver_error": driver_error,
        "subscriptions": subscriptions,
    }


@router.post("/drivers")
async def backoffice_create_driver(
    request: Request,
    tenant_name: str | None = Form(None),
    phone: str = Form(...),
    name: str | None = Form(None),
    vehicle_plate: str | None = Form(None),
    vehicle_type: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Mesma criação de /tenants/{id}/drivers, mas disparada a partir da
    aba global. tenant_name é digitado com autocomplete (datalist) em vez
    de um <select> obrigatório — combina com o nome de alguma transportadora
    cadastrada (resolve pra tenant_id) ou fica em branco/sem match, e nesse
    caso o motorista nasce "órfão" (sem tenant_id), pra ser vinculado
    depois. Não travamos o cadastro esperando a transportadora existir."""
    tenant_id: uuid.UUID | None = None
    if tenant_name and tenant_name.strip():
        matched = (
            await db.execute(select(Tenant).where(func.lower(Tenant.name) == tenant_name.strip().lower()))
        ).scalars().first()
        tenant_id = matched.id if matched is not None else None

    try:
        await driver_service.create_driver(
            db, tenant_id=tenant_id, phone=phone, name=name, vehicle_plate=vehicle_plate, vehicle_type=vehicle_type,
        )
    except DuplicateDriverPhoneError as exc:
        await db.rollback()
        context = await _backoffice_drivers_context(db, driver_error=str(exc))
        return templates.TemplateResponse(request, "backoffice_drivers.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url="/backoffice/drivers", status_code=303)


@router.post("/drivers/{driver_id}/assign-tenant")
async def backoffice_driver_assign_tenant(
    request: Request,
    driver_id: uuid.UUID,
    tenant_id: uuid.UUID = Form(...),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    driver = await db.get(Driver, driver_id)
    if driver is None:
        return RedirectResponse(url="/backoffice/drivers", status_code=303)

    try:
        await driver_service.assign_tenant(db, driver, tenant_id)
    except DuplicateDriverPhoneError as exc:
        await db.rollback()
        context = await _backoffice_drivers_context(db, driver_error=str(exc))
        return templates.TemplateResponse(request, "backoffice_drivers.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url="/backoffice/drivers", status_code=303)


@router.post("/drivers/{driver_id}/toggle-active")
async def backoffice_driver_toggle_active(driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    """Própria da aba global — não usa a rota /tenants/{id}/drivers/... de
    propósito, pra uma ação aqui nunca redirecionar pra dentro da tela de
    Transportadoras (planos/telas diferentes, não misturar)."""
    driver = await db.get(Driver, driver_id)
    if driver is not None:
        await driver_service.set_driver_active(db, driver, not driver.is_active)
        await db.commit()
    return RedirectResponse(url="/backoffice/drivers", status_code=303)


@router.post("/drivers/{driver_id}/delete")
async def backoffice_driver_delete(request: Request, driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    driver = await db.get(Driver, driver_id)
    if driver is None:
        return RedirectResponse(url="/backoffice/drivers", status_code=303)

    try:
        await driver_service.delete_driver(db, driver)
    except DriverHasDataError as exc:
        await db.rollback()
        context = await _backoffice_drivers_context(db, driver_error=str(exc))
        return templates.TemplateResponse(request, "backoffice_drivers.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url="/backoffice/drivers", status_code=303)


@router.post("/drivers/{driver_id}/start-subscription")
async def backoffice_driver_start_subscription(
    request: Request,
    driver_id: uuid.UUID,
    cpf: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    driver = await db.get(Driver, driver_id)
    if driver is None:
        return RedirectResponse(url="/backoffice/drivers", status_code=303)

    digits_only = "".join(ch for ch in (cpf or "") if ch.isdigit())
    if digits_only:
        driver.cpf = digits_only

    tenant = await db.get(Tenant, driver.tenant_id) if driver.tenant_id else None
    if tenant is None:
        await db.rollback()
        context = await _backoffice_drivers_context(db, driver_error="Este motorista não tem transportadora vinculada.")
        return templates.TemplateResponse(request, "backoffice_drivers.html", context, status_code=400)

    try:
        await driver_subscription_service.start_subscription(db, settings, tenant, driver)
    except (DriverNotLinkedError, DriverMissingCPFError, SubscriptionAlreadyExistsError) as exc:
        await db.rollback()
        context = await _backoffice_drivers_context(db, driver_error=str(exc))
        return templates.TemplateResponse(request, "backoffice_drivers.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url="/backoffice/drivers", status_code=303)


@router.post("/tenants/{tenant_id}/drivers")
async def tenant_create_driver(
    request: Request,
    tenant_id: uuid.UUID,
    phone: str = Form(...),
    name: str | None = Form(None),
    vehicle_plate: str | None = Form(None),
    vehicle_type: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    try:
        await driver_service.create_driver(
            db, tenant_id=tenant_id, phone=phone, name=name, vehicle_plate=vehicle_plate, vehicle_type=vehicle_type,
        )
    except DuplicateDriverPhoneError as exc:
        await db.rollback()
        context = await _tenant_detail_context(db, tenant, driver_error=str(exc))
        return templates.TemplateResponse(request, "tenant_detail.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/drivers/{driver_id}/start-subscription")
async def tenant_driver_start_subscription(
    request: Request,
    tenant_id: uuid.UUID,
    driver_id: uuid.UUID,
    cpf: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    tenant = await _get_tenant_or_404(db, tenant_id)
    driver = await db.get(Driver, driver_id)
    if tenant is None or driver is None or driver.tenant_id != tenant_id:
        return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)

    digits_only = "".join(ch for ch in (cpf or "") if ch.isdigit())
    if digits_only:
        driver.cpf = digits_only

    try:
        await driver_subscription_service.start_subscription(db, settings, tenant, driver)
    except (DriverNotLinkedError, DriverMissingCPFError, SubscriptionAlreadyExistsError) as exc:
        await db.rollback()
        context = await _tenant_detail_context(db, tenant, subscription_error=str(exc))
        return templates.TemplateResponse(request, "tenant_detail.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/drivers/{driver_id}/toggle-active")
async def tenant_driver_toggle_active(
    tenant_id: uuid.UUID, driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    driver = await db.get(Driver, driver_id)
    if driver is not None and driver.tenant_id == tenant_id:
        await driver_service.set_driver_active(db, driver, not driver.is_active)
        await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)


@router.post("/tenants/{tenant_id}/drivers/{driver_id}/delete")
async def tenant_driver_delete(
    tenant_id: uuid.UUID, driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    driver = await db.get(Driver, driver_id)
    if driver is None or driver.tenant_id != tenant_id:
        return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)

    try:
        await driver_service.delete_driver(db, driver)
    except DriverHasDataError:
        return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}?driver_delete_blocked=1", status_code=303)

    await db.commit()
    return RedirectResponse(url=f"/backoffice/tenants/{tenant_id}", status_code=303)
