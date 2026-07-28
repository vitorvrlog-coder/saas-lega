"""
Dependências compartilhadas entre app.web.routes (dashboard operacional,
usado pela transportadora) e app.web.backoffice_routes (gestão de
transportadoras, uso interno da Heimdall) — auth, escopo por tenant e o
Jinja2Templates comum aos dois.
"""
import os
import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models.user import User
from app.db.session import get_db
from app.web.auth import SESSION_COOKIE_NAME, get_user_from_session
from app.web.formatting import local_dt, state_badge_class, state_label

templates = Jinja2Templates(directory="app/templates")
templates.env.filters["state_label"] = state_label
templates.env.filters["state_badge_class"] = state_badge_class
templates.env.filters["local_dt"] = local_dt


def static_version(filename: str) -> int:
    """Versão pra cache-busting de estáticos (?v=<mtime>) — sem isso, o
    navegador pode continuar servindo um CSS/imagem antigo do cache mesmo
    depois de trocarmos o arquivo (foi exatamente o que causou uma logo
    gigante e mal posicionada aparecer em produção)."""
    path = os.path.join("app", "static", filename)
    try:
        return int(os.path.getmtime(path))
    except OSError:
        return 0


templates.env.globals["static_version"] = static_version


async def current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    user = await get_user_from_session(db, settings, request.cookies.get(SESSION_COOKIE_NAME))
    # Guardado em request.state pros layouts (base.html/backoffice_base.html)
    # decidirem o que mostrar no nav sem toda rota precisar passar "user"
    # explicitamente no contexto do template.
    request.state.user = user
    return user


def require_platform_admin(user: User = Depends(current_user)) -> User:
    if not user.is_platform_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito ao admin da plataforma.")
    return user


def require_tenant_admin(user: User = Depends(current_user)) -> User:
    """Admin de tenant (representa a transportadora) — gerencia só os
    operadores do PRÓPRIO tenant, nunca config de negócio/WhatsApp nem
    outros tenants. Admin da plataforma não usa esta tela (usa o
    backoffice, que já cobre tudo isso)."""
    if not user.is_tenant_admin or user.tenant_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito ao admin do tenant.")
    return user


def require_tenant_member(user: User = Depends(current_user)) -> User:
    """Qualquer usuário vinculado a UM tenant — operador comum ou admin do
    tenant, tanto faz — pra telas que só mostram dado do próprio tenant
    (sem editar nada). Admin da plataforma não pertence a tenant nenhum,
    então nunca passa aqui (usa o backoffice pra ver qualquer tenant)."""
    if user.tenant_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito a operadores de um tenant.")
    return user


def scope_to_tenant(query, user: User, tenant_id_column):
    """Restringe a query ao tenant do usuário, a menos que seja admin da
    plataforma (que enxerga todos os tenants)."""
    if user.is_platform_admin:
        return query
    return query.where(tenant_id_column == user.tenant_id)


def owns_tenant(user: User, tenant_id: uuid.UUID) -> bool:
    return user.is_platform_admin or user.tenant_id == tenant_id
