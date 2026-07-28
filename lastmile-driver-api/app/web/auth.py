"""
Sessão do dashboard web — cookie assinado (itsdangerous) carregando o id do
usuário logado (app.db.models.user.User). O escopo de acesso vem inteiro do
usuário: tenant_id=None + is_platform_admin=True enxerga e gerencia todos os
tenants (inclusive a tela de Tenants); tenant_id preenchido só enxerga o
próprio tenant.

Se INTERNAL_API_KEY não estiver configurada (modo dev local), a checagem de
sessão é pulada e um usuário admin "fantasma" (nunca persistido) é usado no
lugar — mantém o dashboard utilizável sem setup nenhum em dev, com o mesmo
tipo `User` que o resto do código já espera.
"""
import uuid

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import normalize_email, verify_password
from app.db.models.user import User

SESSION_COOKIE_NAME = "lastmile_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 12  # 12h

DEV_BYPASS_USER = User(
    email="dev@local", tenant_id=None, is_platform_admin=True, is_tenant_admin=False, is_active=True
)


class NotAuthenticatedError(Exception):
    pass


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt="lastmile-web-session")


def create_session_cookie_value(settings: Settings, user_id: uuid.UUID) -> str:
    return _serializer(settings).dumps({"user_id": str(user_id)})


def _extract_user_id(settings: Settings, cookie_value: str | None) -> str | None:
    if not cookie_value:
        return None
    try:
        data = _serializer(settings).loads(cookie_value, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("user_id")


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == normalize_email(email)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def get_user_from_session(
    db: AsyncSession, settings: Settings, cookie_value: str | None
) -> User:
    """Levanta NotAuthenticatedError se o cookie for inválido/expirado ou o
    usuário não existir mais / tiver sido desativado."""
    if settings.INTERNAL_API_KEY is None:
        return DEV_BYPASS_USER

    user_id = _extract_user_id(settings, cookie_value)
    if user_id is None:
        raise NotAuthenticatedError()

    try:
        user = await db.get(User, uuid.UUID(user_id))
    except ValueError:
        user = None

    if user is None or not user.is_active:
        raise NotAuthenticatedError()
    return user
