"""Backoffice — área de uso interno da Heimdall (não da transportadora):
gestão de transportadoras (tenants) e visão geral de todas elas. Tudo aqui
é restrito a admin da plataforma (require_platform_admin). O dashboard
operacional que a transportadora usa mora em app.web.routes, separado."""
import uuid

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_db
from app.services import tenant_service, user_service
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


@router.get("/health", response_class=HTMLResponse)
async def backoffice_health(
    request: Request, db: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)
) -> HTMLResponse:
    health = await get_tenant_health(db, settings)
    return templates.TemplateResponse(request, "backoffice_health.html", {"health": health})


async def _get_tenant_or_404(db: AsyncSession, tenant_id: uuid.UUID) -> Tenant | None:
    return await db.get(Tenant, tenant_id)


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
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    values = {
        "name": name, "slug": slug, "allowed_radius_km": allowed_radius_km,
        "timeout_attempt_1_minutes": timeout_attempt_1_minutes,
        "timeout_attempt_2_minutes": timeout_attempt_2_minutes,
    }
    try:
        tenant = await tenant_service.create_tenant(
            db, settings,
            name=name, slug=slug.strip().lower(),
            allowed_radius_km=allowed_radius_km,
            timeout_attempt_1_minutes=timeout_attempt_1_minutes,
            timeout_attempt_2_minutes=timeout_attempt_2_minutes,
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

    operators = (
        await db.execute(
            select(User).where(User.tenant_id == tenant_id).order_by(User.email)
        )
    ).scalars().all()

    delete_error = (
        "Este tenant já tem ocorrências registradas — não pode ser removido. "
        "Use 'Desativar' pra impedir novo uso sem perder o histórico."
        if request.query_params.get("delete_blocked")
        else None
    )

    return templates.TemplateResponse(
        request, "tenant_detail.html",
        {"tenant": tenant, "operators": operators, "error": delete_error, "user_error": None},
    )


@router.post("/tenants/{tenant_id}")
async def tenant_update_submit(
    request: Request,
    tenant_id: uuid.UUID,
    name: str = Form(...),
    allowed_radius_km: float = Form(...),
    timeout_attempt_1_minutes: int = Form(...),
    timeout_attempt_2_minutes: int = Form(...),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Config de negócio (nome/raio/timeout) — templates de mensagem saíram
    daqui: quem edita agora é o admin do próprio tenant, no dashboard
    operacional (/web/my-tenant/templates), não o admin da plataforma."""
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant is None:
        return RedirectResponse(url="/backoffice/tenants", status_code=303)

    await tenant_service.update_tenant(
        db, tenant,
        name=name,
        allowed_radius_km=allowed_radius_km,
        timeout_attempt_1_minutes=timeout_attempt_1_minutes,
        timeout_attempt_2_minutes=timeout_attempt_2_minutes,
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
        operators = (
            await db.execute(select(User).where(User.tenant_id == tenant_id).order_by(User.email))
        ).scalars().all()
        return templates.TemplateResponse(
            request, "tenant_detail.html",
            {"tenant": tenant, "operators": operators, "error": None, "user_error": str(exc)},
            status_code=400,
        )

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
