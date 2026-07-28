"""
RouteManifest/RouteManifestEntry = planilha de rota do dia, importada pelo
operador (stop_number, telefone do motorista, contato do cliente,
endereço). Existe pra fechar a lacuna de app.services.human_queue_service:
quando o motorista relata insucesso sem telefone/endereço do cliente na
própria mensagem, o motor busca aqui por (driver_phone, stop_number) antes
de cair na fila humana — ver app.services.manifest_service.find_manifest_entry
e o gancho em app.services.occurrence_service.handle_driver_report.

driver_phone/customer_phone ficam desnormalizados como texto na entrada
(não FK pra Driver) de propósito: o casamento acontece por telefone puro no
momento do webhook, sem depender de o cadastro em Driver já existir.
"""
import datetime
import uuid

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RouteManifest(Base):
    __tablename__ = "route_manifests"
    __table_args__ = (Index("ix_route_manifests_tenant_id", "tenant_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    # Preserva o manifesto mesmo se a conta do operador que subiu for
    # excluída depois — é só rastro de auditoria, não dono do dado.
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    route_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RouteManifestEntry(Base):
    __tablename__ = "route_manifest_entries"
    __table_args__ = (
        Index("ix_route_manifest_entries_manifest_id", "manifest_id"),
        Index(
            "ix_route_manifest_entries_driver_phone_stop",
            "manifest_id", "driver_phone", "stop_number",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    manifest_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("route_manifests.id", ondelete="CASCADE"), nullable=False
    )

    stop_number: Mapped[int] = mapped_column(Integer, nullable=False)
    driver_phone: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    route_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
