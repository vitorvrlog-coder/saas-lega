"""Página de checkout de cartão da assinatura do motorista — o único lugar
do app acessível sem login algum (nem sessão de dashboard, nem token do
app Android): o motorista chega aqui de um link clicado no WhatsApp, num
navegador comum de celular. Autenticação própria via token assinado de uso
restrito (app.core.driver_auth.verify_checkout_token), não current_user."""
from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.driver_auth import verify_checkout_token
from app.db.models.driver_subscription import DriverSubscription
from app.db.session import get_db
from app.integrations.asaas.client import AsaasAPIError
from app.services.driver_subscription_service import capture_subscription_card
from app.web.deps import templates

router = APIRouter(prefix="/checkout")


def _client_ip(request: Request) -> str:
    """IP real do motorista pra mandar como remoteIp pro Asaas — a doc deles
    exige explicitamente que não seja o IP do servidor. uvicorn roda sem
    --proxy-headers atrás do Nginx, então request.client.host é sempre o IP
    interno do proxy; usar X-Real-IP (setado pelo Nginx) primeiro."""
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


async def _load_subscription(db: AsyncSession, settings: Settings, token: str) -> DriverSubscription | None:
    subscription_id = verify_checkout_token(settings, token)
    if subscription_id is None:
        return None
    return await db.get(DriverSubscription, subscription_id)


@router.get("/{token}", response_class=HTMLResponse)
async def checkout_form(
    request: Request,
    token: str,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    subscription = await _load_subscription(db, settings, token)
    if subscription is None:
        return templates.TemplateResponse(
            request, "checkout.html", {"invalid": True, "subscription": None, "error": None, "success": False},
            status_code=404,
        )
    return templates.TemplateResponse(
        request, "checkout.html",
        {
            "invalid": False, "subscription": subscription, "error": None, "success": False,
            "value_display": f"{subscription.value:.2f}".replace(".", ","), "token": token,
        },
    )


@router.post("/{token}", response_class=HTMLResponse)
async def checkout_submit(
    request: Request,
    token: str,
    holder_name: str = Form(...),
    number: str = Form(...),
    expiry_month: str = Form(...),
    expiry_year: str = Form(...),
    ccv: str = Form(...),
    email: str = Form(...),
    cpf: str = Form(...),
    postal_code: str = Form(...),
    address_number: str = Form(...),
    phone: str = Form(...),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    subscription = await _load_subscription(db, settings, token)
    if subscription is None:
        return templates.TemplateResponse(
            request, "checkout.html", {"invalid": True, "subscription": None, "error": None, "success": False},
            status_code=404,
        )

    # Link já usado (assinatura já capturada) — mostra sucesso de novo em
    # vez de tentar tokenizar outro cartão por cima da mesma assinatura.
    if subscription.asaas_subscription_id is not None:
        return templates.TemplateResponse(
            request, "checkout.html",
            {
                "invalid": False, "subscription": subscription, "error": None, "success": True,
                "value_display": f"{subscription.value:.2f}".replace(".", ","),
            },
        )

    remote_ip = _client_ip(request)
    try:
        await capture_subscription_card(
            db, settings, subscription,
            holder_name=holder_name, number=number.replace(" ", ""),
            expiry_month=expiry_month, expiry_year=expiry_year, ccv=ccv,
            email=email, cpf=cpf, postal_code=postal_code,
            address_number=address_number, phone=phone, remote_ip=remote_ip,
        )
    except AsaasAPIError:
        await db.rollback()
        return templates.TemplateResponse(
            request, "checkout.html",
            {
                "invalid": False, "subscription": subscription, "success": False,
                "error": "Não foi possível processar o cartão. Confira os dados e tente novamente.",
                "value_display": f"{subscription.value:.2f}".replace(".", ","), "token": token,
            },
            status_code=400,
        )

    await db.commit()
    return templates.TemplateResponse(
        request, "checkout.html",
        {
            "invalid": False, "subscription": subscription, "error": None, "success": True,
            "value_display": f"{subscription.value:.2f}".replace(".", ","),
        },
    )
