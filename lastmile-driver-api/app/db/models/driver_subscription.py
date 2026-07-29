"""
DriverSubscription = assinatura paga do motorista no app low ticket
("adesão") — cobrada via Asaas (app.integrations.asaas), diretamente do
motorista, não da transportadora. Uma linha por motorista (não histórico
de ciclos): status e next_due_date são atualizados in-place a cada evento
de webhook do Asaas (app.services.driver_subscription_service).
"""
import datetime
import uuid

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import DriverSubscriptionStatus


def _values(enum_cls):
    return [e.value for e in enum_cls]


driver_subscription_status_enum = PGEnum(
    DriverSubscriptionStatus, name="driver_subscription_status", create_type=False, values_callable=_values
)


class DriverSubscription(Base):
    __tablename__ = "driver_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    asaas_customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    asaas_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    status: Mapped[DriverSubscriptionStatus] = mapped_column(
        driver_subscription_status_enum, nullable=False, server_default=DriverSubscriptionStatus.PENDING.value
    )
    value: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    # "PIX" | "CREDIT_CARD" | "UNDEFINED" (motorista escolhe no checkout) —
    # espelha o campo billingType da API Asaas, sem enum próprio porque o
    # valor só transita, nunca é decidido pelo nosso código.
    billing_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="UNDEFINED")
    next_due_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    # Link da NOSSA página de checkout (app.web.checkout_routes, token
    # assinado via app.core.driver_auth.create_checkout_token) — mandado
    # por WhatsApp assim que a assinatura é iniciada, antes de existir
    # qualquer cobrança no Asaas.
    checkout_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Token de cartão retornado por AsaasClient.tokenize_credit_card —
    # nunca o número do cartão em si, só a referência reutilizável que o
    # Asaas usa pra cobrar o ciclo seguinte sem pedir o cartão de novo.
    asaas_credit_card_token: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    canceled_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
