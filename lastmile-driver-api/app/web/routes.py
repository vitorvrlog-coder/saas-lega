"""Dashboard operacional server-rendered (Jinja2 + HTMX) — de acesso da
transportadora (tenant): fila humana, ocorrências, escalações e gestão dos
próprios operadores. A gestão de tenants em si (criar/configurar
transportadoras, uso interno da Heimdall) mora em app.web.backoffice_routes,
área separada. Reaproveita os mesmos services da API JSON (app.services),
nunca duplica lógica de negócio aqui.

Toda rota (exceto login) depende de current_user() pra saber QUEM está
pedindo — não só SE está autenticado. Um usuário comum (tenant_id
preenchido) só enxerga dados do próprio tenant."""
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import verify_password
from app.db.models.ai_decision_log import AIDecisionLog
from app.db.models.driver import Driver
from app.db.models.enums import FailureReason, OccurrenceState
from app.db.models.message_log import MessageLog
from app.db.models.occurrence import Occurrence
from app.db.models.route_manifest import RouteManifest, RouteManifestEntry
from app.db.models.state_transition import StateTransition
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_db
from app.integrations.whatsapp_cloud.client import WhatsAppAPIError
from app.schemas.ai_outputs import ReplyCategory
from app.schemas.occurrence import HumanQueueFillRequest
from app.services import tenant_service, user_service
from app.services.tenant_service import TenantProvisioningError
from app.services.driver_service import list_drivers, update_driver
from app.services.manifest_service import ManifestParseError, list_manifests, parse_manifest_file, store_manifest
from app.services.escalation_service import (
    InvalidEscalationStateError,
    resolve_classification_escalation,
    resolve_reply_escalation,
)
from app.services.human_queue_service import InvalidHumanQueueStateError, fill_human_queue
from app.services.message_templates import TEMPLATE_FIELDS
from app.services.occurrence_service import (
    archive_occurrence,
    delete_all_occurrence_history,
    delete_occurrence_history,
    send_contact_attempt,
    unarchive_occurrence,
)
from app.services.user_service import DuplicateEmailError
from app.web.auth import (
    SESSION_COOKIE_NAME,
    authenticate_user,
    create_session_cookie_value,
)
from app.web.deps import (
    current_user,
    owns_tenant,
    require_tenant_admin,
    require_tenant_member,
    scope_to_tenant,
    templates,
)
from app.web.stats import get_dashboard_stats

router = APIRouter(prefix="/web")


@router.get("/login", response_class=HTMLResponse)
async def login_form(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login")
async def login_submit(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = await authenticate_user(db, email, password)
    if user is None:
        return templates.TemplateResponse(
            request, "login.html", {"error": "E-mail ou senha inválidos."}, status_code=401
        )

    # Admin da plataforma não opera ocorrências de tenant nenhum — cai
    # direto na área de gestão de transportadoras (backoffice); o resto
    # (operador comum ou admin de tenant) cai no dashboard operacional.
    destination = "/backoffice/" if user.is_platform_admin else "/web/"
    response = RedirectResponse(url=destination, status_code=303)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        create_session_cookie_value(settings, user.id),
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 12,
    )
    return response


@router.post("/logout")
async def logout() -> RedirectResponse:
    response = RedirectResponse(url="/web/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return response


@router.get("/change-password", response_class=HTMLResponse)
async def change_password_form(
    request: Request, user: User = Depends(current_user)
) -> HTMLResponse:
    return templates.TemplateResponse(request, "change_password.html", {"error": None, "success": False})


@router.post("/change-password", response_class=HTMLResponse)
async def change_password_submit(
    request: Request,
    current_password: str = Form(...),
    new_password: str = Form(...),
    confirm_password: str = Form(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    def _error(message: str) -> HTMLResponse:
        return templates.TemplateResponse(
            request, "change_password.html", {"error": message, "success": False}, status_code=400
        )

    if user.id is None:
        # Modo dev bypass (INTERNAL_API_KEY vazio) — usuário "fantasma" não
        # existe no banco, não tem senha real pra trocar.
        return _error("Login de desenvolvimento (sem conta real) — não há senha pra trocar.")
    if not verify_password(current_password, user.password_hash):
        return _error("Senha atual incorreta.")
    if new_password != confirm_password:
        return _error("As senhas não coincidem.")
    if len(new_password) < 8:
        return _error("A nova senha precisa ter pelo menos 8 caracteres.")

    await user_service.set_user_password(db, user, new_password)
    await db.commit()
    return templates.TemplateResponse(request, "change_password.html", {"error": None, "success": True})


@router.get("/", response_class=HTMLResponse)
async def dashboard_home(
    request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> HTMLResponse:
    tenant_id = None if user.is_platform_admin else user.tenant_id
    stats = await get_dashboard_stats(db, tenant_id=tenant_id)
    return templates.TemplateResponse(request, "dashboard_home.html", {"stats": stats, "user": user})


@router.get("/human-queue/latest-notification")
async def human_queue_latest_notification(
    db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    """Pollado pelo nav (ver base.html) pra disparar um popup de nova
    chamada — retorna só a mais recente pendente (o front compara com o
    último ID visto em localStorage; se mudou, é uma chamada nova)."""
    query = (
        select(Occurrence)
        .where(Occurrence.state == OccurrenceState.PENDING_HUMAN_QUEUE)
        .order_by(Occurrence.created_at.desc())
        .limit(1)
    )
    query = scope_to_tenant(query, user, Occurrence.tenant_id)
    occurrence = (await db.execute(query)).scalar_one_or_none()
    if occurrence is None:
        return {"id": None}
    return {"id": str(occurrence.id), "driver_phone": occurrence.driver_phone}


@router.get("/human-queue", response_class=HTMLResponse)
async def human_queue_list(
    request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> HTMLResponse:
    query = (
        select(Occurrence, Tenant)
        .join(Tenant, Tenant.id == Occurrence.tenant_id)
        .where(Occurrence.state == OccurrenceState.PENDING_HUMAN_QUEUE)
    )
    query = scope_to_tenant(query, user, Occurrence.tenant_id).order_by(Occurrence.created_at.desc())
    rows = (await db.execute(query)).all()
    return templates.TemplateResponse(
        request, "human_queue_list.html", {"rows": rows}
    )


@router.get(
    "/human-queue/{occurrence_id}",
    response_class=HTMLResponse,
)
async def human_queue_form(
    request: Request,
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    occurrence = await db.get(Occurrence, occurrence_id)
    if (
        occurrence is None
        or occurrence.state != OccurrenceState.PENDING_HUMAN_QUEUE
        or not owns_tenant(user, occurrence.tenant_id)
    ):
        return RedirectResponse(url="/web/human-queue", status_code=303)
    return templates.TemplateResponse(
        request, "human_queue_form.html", {"occurrence": occurrence, "error": None}
    )


@router.post("/human-queue/{occurrence_id}")
async def human_queue_submit(
    request: Request,
    occurrence_id: uuid.UUID,
    route_id: str = Form(...),
    customer_name: str = Form(...),
    customer_phone: str = Form(...),
    original_address: str = Form(...),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
):
    occurrence = await db.get(Occurrence, occurrence_id)
    if occurrence is None or not owns_tenant(user, occurrence.tenant_id):
        return RedirectResponse(url="/web/human-queue", status_code=303)

    tenant = await db.get(Tenant, occurrence.tenant_id)
    data = HumanQueueFillRequest(
        route_id=route_id, customer_name=customer_name,
        customer_phone=customer_phone, original_address=original_address,
    )

    try:
        await fill_human_queue(db, occurrence, data)
        await send_contact_attempt(db, settings, tenant, occurrence, attempt_number=1)
    except InvalidHumanQueueStateError as exc:
        return templates.TemplateResponse(
            request, "human_queue_form.html", {"occurrence": occurrence, "error": str(exc)}
        )
    except WhatsAppAPIError as exc:
        # Já tentou reenviar (WhatsAppCloudClient) e mesmo assim falhou (ex: erro
        # 463 do WhatsApp — sessão recém-pareada limitando envio) — sem isso
        # o operador via uma tela de erro crua em vez de um aviso claro pra
        # tentar de novo. Nada foi commitado (rollback automático da sessão),
        # reenviar o formulário tenta tudo de novo do zero.
        return templates.TemplateResponse(
            request, "human_queue_form.html",
            {
                "occurrence": occurrence,
                "error": f"Falha ao enviar mensagem pro cliente pelo WhatsApp: {exc}. Tente novamente em alguns instantes.",
            },
        )

    await db.commit()
    return RedirectResponse(url="/web/human-queue", status_code=303)


@router.get("/occurrences", response_class=HTMLResponse)
async def occurrences_list(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
    state: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    show_archived: str | None = None,
) -> HTMLResponse:
    query = select(Occurrence, Tenant).join(Tenant, Tenant.id == Occurrence.tenant_id)
    query = scope_to_tenant(query, user, Occurrence.tenant_id)
    if state:
        query = query.where(Occurrence.state == OccurrenceState(state))
    if not show_archived:
        query = query.where(Occurrence.archived_at.is_(None))
    if date_from:
        query = query.where(Occurrence.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        # Fim do dia informado, senão "até dd/mm" excluiria o próprio dia
        # (created_at é timestamp, não date).
        query = query.where(
            Occurrence.created_at < datetime.fromisoformat(date_to) + timedelta(days=1)
        )
    query = query.order_by(Occurrence.created_at.desc()).limit(200)

    rows = (await db.execute(query)).all()
    return templates.TemplateResponse(
        request, "occurrences_list.html",
        {
            "rows": rows, "states": list(OccurrenceState), "selected_state": state,
            "date_from": date_from or "", "date_to": date_to or "",
            "show_archived": bool(show_archived), "can_delete": user.is_tenant_admin,
        },
    )


@router.post("/occurrences/{occurrence_id}/archive")
async def occurrence_archive(
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> RedirectResponse:
    occurrence = await db.get(Occurrence, occurrence_id)
    if occurrence is not None and owns_tenant(user, occurrence.tenant_id):
        await archive_occurrence(db, occurrence)
        await db.commit()
    return RedirectResponse(url="/web/occurrences", status_code=303)


@router.post("/occurrences/{occurrence_id}/unarchive")
async def occurrence_unarchive(
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> RedirectResponse:
    occurrence = await db.get(Occurrence, occurrence_id)
    if occurrence is not None and owns_tenant(user, occurrence.tenant_id):
        await unarchive_occurrence(db, occurrence)
        await db.commit()
    return RedirectResponse(url="/web/occurrences", status_code=303)


@router.post("/occurrences/{occurrence_id}/delete")
async def occurrence_delete(
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> RedirectResponse:
    """Exclusão definitiva do histórico — só admin do tenant (não qualquer
    operador), diferente de archive/unarchive que qualquer membro do
    tenant pode fazer."""
    occurrence = await db.get(Occurrence, occurrence_id)
    if occurrence is not None and user.is_tenant_admin and owns_tenant(user, occurrence.tenant_id):
        await delete_occurrence_history(db, occurrence)
        await db.commit()
    return RedirectResponse(url="/web/occurrences", status_code=303)


@router.post("/occurrences/clear-all")
async def occurrences_clear_all(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
) -> RedirectResponse:
    """Limpa todo o histórico do PRÓPRIO tenant do admin — nunca afeta
    outros tenants, mesmo pra quem tem acesso via backoffice, porque essa
    rota só existe no dashboard operacional (/web), sempre escopado a
    user.tenant_id."""
    await delete_all_occurrence_history(db, user.tenant_id)
    await db.commit()
    return RedirectResponse(url="/web/occurrences", status_code=303)


@router.get(
    "/occurrences/{occurrence_id}",
    response_class=HTMLResponse,
)
async def occurrence_detail(
    request: Request,
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    occurrence = await db.get(Occurrence, occurrence_id)
    if occurrence is None or not owns_tenant(user, occurrence.tenant_id):
        return RedirectResponse(url="/web/occurrences", status_code=303)

    tenant = await db.get(Tenant, occurrence.tenant_id)

    transitions = (
        await db.execute(
            select(StateTransition)
            .where(StateTransition.occurrence_id == occurrence_id)
            .order_by(StateTransition.created_at)
        )
    ).scalars().all()

    messages = (
        await db.execute(
            select(MessageLog)
            .where(MessageLog.occurrence_id == occurrence_id)
            .order_by(MessageLog.created_at)
        )
    ).scalars().all()

    ai_decisions = (
        await db.execute(
            select(AIDecisionLog)
            .where(AIDecisionLog.occurrence_id == occurrence_id)
            .order_by(AIDecisionLog.created_at)
        )
    ).scalars().all()

    next_contact_deadline = None
    if (
        occurrence.state in (OccurrenceState.AWAITING_CUSTOMER_REPLY_1, OccurrenceState.AWAITING_CUSTOMER_REPLY_2)
        and occurrence.last_contact_at is not None
    ):
        # Mesma fórmula do worker de timeout (app.workers.timeout_checker) —
        # só pra mostrar a contagem regressiva, não decide nada aqui.
        timeout_minutes = (
            tenant.timeout_attempt_1_minutes
            if occurrence.state == OccurrenceState.AWAITING_CUSTOMER_REPLY_1
            else tenant.timeout_attempt_2_minutes
        )
        next_contact_deadline = occurrence.last_contact_at + timedelta(minutes=timeout_minutes)

    return templates.TemplateResponse(
        request, "occurrence_detail.html",
        {
            "occurrence": occurrence, "tenant": tenant, "transitions": transitions,
            "messages": messages, "ai_decisions": ai_decisions,
            "next_contact_deadline": next_contact_deadline,
        },
    )


@router.get("/drivers", response_class=HTMLResponse)
async def drivers_list_view(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_member),
) -> HTMLResponse:
    drivers = await list_drivers(db, user.tenant_id)
    return templates.TemplateResponse(request, "drivers_list.html", {"drivers": drivers})


@router.get("/drivers/{driver_id}", response_class=HTMLResponse)
async def driver_detail(
    request: Request,
    driver_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_member),
) -> HTMLResponse:
    driver = await db.get(Driver, driver_id)
    if driver is None or not owns_tenant(user, driver.tenant_id):
        return RedirectResponse(url="/web/drivers", status_code=303)

    occurrences = (
        await db.execute(
            select(Occurrence)
            .where(Occurrence.driver_id == driver_id)
            .order_by(Occurrence.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    return templates.TemplateResponse(
        request, "driver_detail.html",
        {"driver": driver, "occurrences": occurrences, "error": None},
    )


@router.post("/drivers/{driver_id}")
async def driver_update(
    driver_id: uuid.UUID,
    name: str = Form(""),
    vehicle_plate: str = Form(""),
    vehicle_type: str = Form(""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
):
    driver = await db.get(Driver, driver_id)
    if driver is None or not owns_tenant(user, driver.tenant_id):
        return RedirectResponse(url="/web/drivers", status_code=303)

    await update_driver(
        db, driver,
        name=name or None, vehicle_plate=vehicle_plate or None, vehicle_type=vehicle_type or None,
    )
    await db.commit()
    return RedirectResponse(url=f"/web/drivers/{driver_id}", status_code=303)


@router.get("/manifests", response_class=HTMLResponse)
async def manifests_list_view(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_member),
) -> HTMLResponse:
    manifests = await list_manifests(db, user.tenant_id)
    return templates.TemplateResponse(request, "manifests_list.html", {"manifests": manifests})


@router.get("/manifests/new", response_class=HTMLResponse)
async def manifest_upload_form(
    request: Request, user: User = Depends(require_tenant_admin)
) -> HTMLResponse:
    return templates.TemplateResponse(
        request, "manifest_upload_form.html", {"error": None, "preview_rows": None}
    )


@router.post("/manifests/new", response_class=HTMLResponse)
async def manifest_upload_submit(
    request: Request,
    route_date: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
):
    file_bytes = await file.read()

    try:
        rows = parse_manifest_file(file_bytes, file.filename or "")
        parsed_date = datetime.fromisoformat(route_date).date()
    except ManifestParseError as exc:
        return templates.TemplateResponse(
            request, "manifest_upload_form.html", {"error": str(exc), "preview_rows": None}
        )
    except ValueError:
        return templates.TemplateResponse(
            request, "manifest_upload_form.html",
            {"error": "Data da rota inválida.", "preview_rows": None},
        )

    manifest = await store_manifest(
        db, user.tenant_id, user.id, file.filename or "planilha", parsed_date, rows
    )
    await db.commit()
    return RedirectResponse(url=f"/web/manifests/{manifest.id}", status_code=303)


@router.get("/manifests/{manifest_id}", response_class=HTMLResponse)
async def manifest_detail(
    request: Request,
    manifest_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_member),
) -> HTMLResponse:
    manifest = await db.get(RouteManifest, manifest_id)
    if manifest is None or not owns_tenant(user, manifest.tenant_id):
        return RedirectResponse(url="/web/manifests", status_code=303)

    entries = (
        await db.execute(
            select(RouteManifestEntry)
            .where(RouteManifestEntry.manifest_id == manifest_id)
            .order_by(RouteManifestEntry.stop_number)
        )
    ).scalars().all()

    return templates.TemplateResponse(
        request, "manifest_detail.html", {"manifest": manifest, "entries": entries}
    )


@router.get("/my-tenant", response_class=HTMLResponse)
async def my_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_member),
) -> HTMLResponse:
    """Info do próprio tenant (nome, WhatsApp conectado) — só leitura,
    sem config de negócio nem reconectar/QR, que continuam exclusivos do
    backoffice (área de uso interno da Heimdall)."""
    tenant = await db.get(Tenant, user.tenant_id)
    return templates.TemplateResponse(request, "my_tenant.html", {"tenant": tenant})


@router.get("/my-tenant/connection", response_class=HTMLResponse)
async def my_tenant_connection_partial(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(require_tenant_member),
) -> HTMLResponse:
    """Status da conta WhatsApp Business (Meta Cloud API) — nome
    verificado e quality_rating, informativo. Diferente do antigo gateway
    evolution-go, não há pareamento/QR/reconexão por aqui: número e token
    são cadastrados manualmente no Meta Business Manager."""
    tenant = await db.get(Tenant, user.tenant_id)
    status: dict = {}
    error: str | None = None
    try:
        status_result = await tenant_service.get_tenant_connection_status(settings, tenant)
        status = status_result if isinstance(status_result, dict) else {}
    except WhatsAppAPIError as exc:
        error = f"Falha ao consultar status na Meta: {exc}"

    return templates.TemplateResponse(
        request, "my_tenant_connection_partial.html",
        {"tenant": tenant, "status": status, "error": error},
    )


@router.get("/my-tenant/templates", response_class=HTMLResponse)
async def my_tenant_templates(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
) -> HTMLResponse:
    tenant = await db.get(Tenant, user.tenant_id)
    return templates.TemplateResponse(
        request, "my_tenant_templates.html",
        {"tenant": tenant, "template_fields": TEMPLATE_FIELDS},
    )


@router.post("/my-tenant/templates")
async def my_tenant_templates_submit(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
) -> RedirectResponse:
    tenant = await db.get(Tenant, user.tenant_id)
    form = await request.form()
    message_templates = dict(tenant.message_templates)
    for field in TEMPLATE_FIELDS:
        key = field["key"]
        value = form.get(f"template_{key}")
        if value is not None:
            value = value.strip()
            if value:
                message_templates[key] = value
            else:
                message_templates.pop(key, None)

    await tenant_service.update_tenant(db, tenant, message_templates=message_templates)
    await db.commit()
    return RedirectResponse(url="/web/my-tenant/templates", status_code=303)


ONLY_PRIMARY_ADMIN_ERROR = "Apenas o admin principal pode gerenciar outros admins."
USE_BACKOFFICE_FOR_SELF_ERROR = "Use o backoffice pra isso."
TRANSFER_PRIMARY_FIRST_ERROR = "Transfira o cargo de admin principal pelo backoffice antes."


async def _operators_page_context(db: AsyncSession, user: User, user_error: str | None = None) -> dict:
    operators = (
        await db.execute(select(User).where(User.tenant_id == user.tenant_id).order_by(User.email))
    ).scalars().all()
    tenant = await db.get(Tenant, user.tenant_id)
    return {
        "tenant": tenant, "operators": operators, "current_user_id": user.id,
        "current_user_is_primary_admin": user.is_primary_admin,
        "user_error": user_error,
    }


@router.get("/my-tenant/operators", response_class=HTMLResponse)
async def my_tenant_operators(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
) -> HTMLResponse:
    return templates.TemplateResponse(
        request, "my_tenant_operators.html", await _operators_page_context(db, user),
    )


@router.post("/my-tenant/operators")
async def my_tenant_operators_create(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
) -> HTMLResponse:
    try:
        # Admin de tenant nunca cria outro admin de tenant — só o admin da
        # plataforma promove alguém via o backoffice (evita escalada de
        # privilégio entre operadores do mesmo tenant).
        await user_service.create_tenant_operator(
            db, tenant_id=user.tenant_id, email=email, password=password, is_tenant_admin=False
        )
    except DuplicateEmailError as exc:
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error=str(exc)),
            status_code=400,
        )

    await db.commit()
    return RedirectResponse(url="/web/my-tenant/operators", status_code=303)


@router.post("/my-tenant/operators/{user_id}/toggle-active")
async def my_tenant_operator_toggle_active(
    request: Request,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
):
    if user_id == user.id:
        # Nunca deixa o admin de tenant se desativar sozinho — ficaria
        # travado fora sem ninguém pra reativar (só o admin da plataforma
        # tem esse poder, e é mais atrito do que vale a pena evitar aqui).
        return RedirectResponse(url="/web/my-tenant/operators", status_code=303)

    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == user.tenant_id:
        if operator.is_tenant_admin and not user.is_primary_admin:
            # Só o admin principal mexe em outro admin — admin comum só
            # gerencia operador não-admin.
            return templates.TemplateResponse(
                request, "my_tenant_operators.html",
                await _operators_page_context(db, user, user_error=ONLY_PRIMARY_ADMIN_ERROR),
                status_code=403,
            )
        await user_service.set_user_active(db, operator, not operator.is_active)
        await db.commit()
    return RedirectResponse(url="/web/my-tenant/operators", status_code=303)


@router.post("/my-tenant/operators/{user_id}/reset-password")
async def my_tenant_operator_reset_password(
    request: Request,
    user_id: uuid.UUID,
    new_password: str = Form(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
):
    """Reset por autoridade, restrito aos operadores do PRÓPRIO tenant —
    admin de tenant nunca reseta senha de gente de outro tenant."""
    operator = await db.get(User, user_id)
    if operator is None or operator.tenant_id != user.tenant_id:
        return RedirectResponse(url="/web/my-tenant/operators", status_code=303)

    if operator.is_tenant_admin and not user.is_primary_admin:
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error=ONLY_PRIMARY_ADMIN_ERROR),
            status_code=403,
        )
    if len(new_password) < 8:
        # POST direto contornando o minlength=8 do form — sem isso, o
        # reset falhava calado e a tela voltava igual a um sucesso.
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error="A nova senha precisa ter pelo menos 8 caracteres."),
            status_code=400,
        )

    await user_service.set_user_password(db, operator, new_password)
    await db.commit()
    return RedirectResponse(url="/web/my-tenant/operators", status_code=303)


@router.post("/my-tenant/operators/{user_id}/toggle-tenant-admin")
async def my_tenant_operator_toggle_tenant_admin(
    request: Request,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
):
    """Promover/rebaixar admin de tenant pelo próprio dashboard operacional
    (antes só existia no backoffice) — restrito ao admin principal, já que
    isso é controle sobre outros admins."""
    if not user.is_primary_admin:
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error=ONLY_PRIMARY_ADMIN_ERROR),
            status_code=403,
        )
    if user_id == user.id:
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error=USE_BACKOFFICE_FOR_SELF_ERROR),
            status_code=403,
        )

    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == user.tenant_id:
        if operator.is_primary_admin:
            # Não dá pra rebaixar o admin de tenant de quem é admin
            # principal sem primeiro tirar o cargo dele — senão fica um
            # admin principal que não é admin de tenant, contradição.
            return templates.TemplateResponse(
                request, "my_tenant_operators.html",
                await _operators_page_context(db, user, user_error=TRANSFER_PRIMARY_FIRST_ERROR),
                status_code=403,
            )
        await user_service.set_tenant_admin(db, operator, not operator.is_tenant_admin)
        await db.commit()
    return RedirectResponse(url="/web/my-tenant/operators", status_code=303)


@router.post("/my-tenant/operators/{user_id}/delete")
async def my_tenant_operator_delete(
    request: Request,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_tenant_admin),
):
    """Remover operador pelo dashboard operacional — restrito ao admin
    principal (antes só existia no backoffice)."""
    if not user.is_primary_admin:
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error=ONLY_PRIMARY_ADMIN_ERROR),
            status_code=403,
        )
    if user_id == user.id:
        return templates.TemplateResponse(
            request, "my_tenant_operators.html",
            await _operators_page_context(db, user, user_error=USE_BACKOFFICE_FOR_SELF_ERROR),
            status_code=403,
        )

    operator = await db.get(User, user_id)
    if operator is not None and operator.tenant_id == user.tenant_id:
        if operator.is_primary_admin:
            # Mesma guarda de toggle-tenant-admin — defesa em profundidade,
            # hoje inalcançável (só existe 1 admin principal por tenant e é
            # sempre quem está logado, já bloqueado acima), mas não custa
            # deixar de depender só desse invariante externo.
            return templates.TemplateResponse(
                request, "my_tenant_operators.html",
                await _operators_page_context(db, user, user_error=TRANSFER_PRIMARY_FIRST_ERROR),
                status_code=403,
            )
        await user_service.delete_user(db, operator)
        await db.commit()
    return RedirectResponse(url="/web/my-tenant/operators", status_code=303)


@router.get("/my-profile", response_class=HTMLResponse)
async def my_profile_form(
    request: Request, user: User = Depends(current_user)
) -> HTMLResponse:
    return templates.TemplateResponse(
        request, "my_profile.html", {"error": None, "success": False, "profile_user": user},
    )


@router.post("/my-profile", response_class=HTMLResponse)
async def my_profile_submit(
    request: Request,
    name: str = Form(""),
    phone: str = Form(""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    await user_service.update_own_profile(db, user, name, phone)
    await db.commit()
    return templates.TemplateResponse(
        request, "my_profile.html", {"error": None, "success": True, "profile_user": user},
    )


@router.get("/escalations", response_class=HTMLResponse)
async def escalations_list(
    request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> HTMLResponse:
    query = (
        select(Occurrence, Tenant)
        .join(Tenant, Tenant.id == Occurrence.tenant_id)
        .where(Occurrence.state == OccurrenceState.ESCALATED_TO_HUMAN)
    )
    query = scope_to_tenant(query, user, Occurrence.tenant_id).order_by(Occurrence.created_at.desc())
    rows = (await db.execute(query)).all()
    return templates.TemplateResponse(request, "escalations_list.html", {"rows": rows})


@router.get("/escalations/count-badge", response_class=HTMLResponse)
async def escalations_count_badge(
    request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> HTMLResponse:
    """Parcial HTMX pollado pelo nav (renderizado pra qualquer usuário
    logado, ver base.html) — alerta em tempo real de escalações abertas
    sem precisar entrar na tela pra saber que tem algo pendente. Escopado
    ao próprio tenant via scope_to_tenant (admin da plataforma, que não
    usa este nav — fica no backoffice —, veria todas)."""
    query = select(func.count()).select_from(Occurrence).where(
        Occurrence.state == OccurrenceState.ESCALATED_TO_HUMAN
    )
    query = scope_to_tenant(query, user, Occurrence.tenant_id)
    count = (await db.execute(query)).scalar_one()
    return templates.TemplateResponse(request, "escalations_count_badge.html", {"count": count})


async def _escalation_context(
    db: AsyncSession, occurrence_id: uuid.UUID, user: User
) -> dict | None:
    occurrence = await db.get(Occurrence, occurrence_id)
    if (
        occurrence is None
        or occurrence.state != OccurrenceState.ESCALATED_TO_HUMAN
        or not owns_tenant(user, occurrence.tenant_id)
    ):
        return None

    tenant = await db.get(Tenant, occurrence.tenant_id)
    messages = (
        await db.execute(
            select(MessageLog)
            .where(MessageLog.occurrence_id == occurrence_id)
            .order_by(MessageLog.created_at)
        )
    ).scalars().all()
    ai_decisions = (
        await db.execute(
            select(AIDecisionLog)
            .where(AIDecisionLog.occurrence_id == occurrence_id)
            .order_by(AIDecisionLog.created_at)
        )
    ).scalars().all()

    return {
        "occurrence": occurrence,
        "tenant": tenant,
        "messages": messages,
        "ai_decisions": ai_decisions,
        # etapa de classificação (2) enquanto customer_phone não foi
        # preenchido pela fila humana; etapa de resposta (5) depois disso.
        "is_classification_stage": occurrence.customer_phone is None,
        "failure_reasons": list(FailureReason),
        "reply_categories": [
            c for c in ReplyCategory if c != ReplyCategory.AMBIGUOUS
        ],
    }


@router.get(
    "/escalations/{occurrence_id}",
    response_class=HTMLResponse,
)
async def escalation_detail(
    request: Request,
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    context = await _escalation_context(db, occurrence_id, user)
    if context is None:
        return RedirectResponse(url="/web/escalations", status_code=303)
    context["error"] = None
    return templates.TemplateResponse(request, "escalation_resolve.html", context)


@router.post("/escalations/{occurrence_id}")
async def escalation_resolve_submit(
    request: Request,
    occurrence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
) -> HTMLResponse:
    context = await _escalation_context(db, occurrence_id, user)
    if context is None:
        return RedirectResponse(url="/web/escalations", status_code=303)

    occurrence = context["occurrence"]
    tenant = context["tenant"]
    form = await request.form()

    try:
        if context["is_classification_stage"]:
            failure_reason = FailureReason(form.get("failure_reason"))
            await resolve_classification_escalation(
                db, settings, tenant, occurrence, failure_reason=failure_reason
            )
        else:
            category = ReplyCategory(form.get("category"))
            new_address_text = (form.get("new_address_text") or "").strip() or None
            within_radius_raw = form.get("within_radius")
            within_radius = within_radius_raw == "true" if within_radius_raw else None
            await resolve_reply_escalation(
                db, settings, tenant, occurrence,
                category=category,
                new_address_text=new_address_text,
                within_radius=within_radius,
            )
    except (InvalidEscalationStateError, ValueError) as exc:
        context["error"] = str(exc)
        return templates.TemplateResponse(request, "escalation_resolve.html", context, status_code=400)
    except WhatsAppAPIError as exc:
        # Já tentou reenviar (WhatsAppCloudClient) e mesmo assim falhou (ex: erro
        # 463 do WhatsApp — sessão recém-pareada limitando envio) — sem isso
        # o operador via uma tela de erro crua em vez de um aviso claro pra
        # tentar de novo. Nada foi commitado (rollback automático da sessão),
        # reenviar o formulário tenta tudo de novo do zero.
        context["error"] = (
            f"Falha ao enviar mensagem pelo WhatsApp: {exc}. Tente novamente em alguns instantes."
        )
        return templates.TemplateResponse(request, "escalation_resolve.html", context, status_code=400)

    await db.commit()
    return RedirectResponse(url="/web/escalations", status_code=303)
