"""
Autenticação do app do motorista — token assinado (itsdangerous), no mesmo
estilo de app.web.auth (sessão do dashboard), mas com salt e payload
próprios (driver_id + tenant_id) porque Driver não é User: não tem senha,
a prova de identidade é o código de uso único mandado por WhatsApp (ver
app.services.driver_auth_service). Nenhum estado de revogação por ora —
token expira sozinho; suficiente para um produto de baixo risco/baixo
ticket, ver plano de arquitetura.
"""
import dataclasses
import uuid

from fastapi import Header, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import Settings, get_settings

DRIVER_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 dias

# Token do link de checkout de cartão (ver app.web.checkout_routes) — salt e
# validade PRÓPRIOS, distintos do token de sessão do app (30 dias): esse
# link é mandado uma vez por WhatsApp e clicado de um navegador comum, sem
# header Authorization disponível, então carrega só o id da assinatura,
# nunca driver_id/tenant_id direto (evita reaproveitar o link pra outra
# coisa além de completar aquele checkout específico).
CHECKOUT_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7  # 7 dias


@dataclasses.dataclass
class DriverIdentity:
    driver_id: uuid.UUID
    tenant_id: uuid.UUID


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt="lastmile-driver-token")


def _checkout_serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt="checkout-token")


def create_driver_token(settings: Settings, driver_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
    return _serializer(settings).dumps({"driver_id": str(driver_id), "tenant_id": str(tenant_id)})


def create_checkout_token(settings: Settings, subscription_id: uuid.UUID) -> str:
    return _checkout_serializer(settings).dumps({"subscription_id": str(subscription_id)})


def verify_checkout_token(settings: Settings, token: str) -> uuid.UUID | None:
    """None em qualquer falha (assinatura inválida, expirado, payload mal
    formado) — a rota de checkout trata isso como link inválido/expirado,
    nunca como erro 500."""
    try:
        data = _checkout_serializer(settings).loads(token, max_age=CHECKOUT_TOKEN_MAX_AGE_SECONDS)
        return uuid.UUID(data["subscription_id"])
    except (BadSignature, SignatureExpired, KeyError, ValueError):
        return None


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido ou expirado.")


async def require_driver_auth(
    authorization: str | None = Header(default=None),
) -> DriverIdentity:
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized()

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    try:
        data = _serializer(settings).loads(token, max_age=DRIVER_TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        raise _unauthorized()

    try:
        return DriverIdentity(
            driver_id=uuid.UUID(data["driver_id"]), tenant_id=uuid.UUID(data["tenant_id"])
        )
    except (KeyError, ValueError):
        raise _unauthorized()
