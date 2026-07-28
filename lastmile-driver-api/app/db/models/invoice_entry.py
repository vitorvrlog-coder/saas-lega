"""
InvoiceEntry = nota fiscal enviada pelo motorista via app (XML estruturado
ou foto de DANFe com OCR), fonte alternativa dos mesmos dados que hoje vêm
de planilha (app.db.models.route_manifest.RouteManifestEntry).

Fica numa tabela própria, nunca grava direto em RouteManifestEntry — a
promoção só acontece na confirmação (status CONFIRMED -> CONTACT_SENT, ver
app.services.invoice_service.promote_to_route_manifest_entry), preservando
find_manifest_entry/_classify_and_proceed intocados.
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import InvoiceEntrySource, InvoiceEntryStatus


def _values(enum_cls):
    return [e.value for e in enum_cls]


invoice_entry_source_enum = PGEnum(
    InvoiceEntrySource, name="invoice_entry_source", create_type=False, values_callable=_values
)
invoice_entry_status_enum = PGEnum(
    InvoiceEntryStatus, name="invoice_entry_status", create_type=False, values_callable=_values
)


class InvoiceEntry(Base):
    __tablename__ = "invoice_entries"
    __table_args__ = (
        Index("ix_invoice_entries_tenant_id_driver_id_status", "tenant_id", "driver_id", "status"),
        Index("ix_invoice_entries_tenant_id_order_number", "tenant_id", "order_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    # Diferente de RouteManifestEntry.driver_phone (texto solto): aqui a
    # identidade do motorista já é conhecida via autenticação do app, então
    # a FK é segura e permite a listagem "minhas notas" sem depender de
    # casamento por telefone.
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False
    )

    source: Mapped[InvoiceEntrySource] = mapped_column(invoice_entry_source_enum, nullable=False)
    status: Mapped[InvoiceEntryStatus] = mapped_column(
        invoice_entry_status_enum, nullable=False, server_default=InvoiceEntryStatus.PENDING_REVIEW.value
    )

    order_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Payload completo extraído (todos os campos do XML/OCR, não só os 3
    # que o motor usa) — auditoria e depuração de qualidade de extração.
    raw_extracted_json: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # Só populado pra source=PHOTO_OCR; XML é estruturado, não tem confiança.
    ocr_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)

    photo_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    xml_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # name= explícito: o nome gerado pela naming convention padrão (ver
    # app.db.base) passaria de 63 caracteres (limite do Postgres) para essa
    # combinação de tabela/coluna/tabela referenciada.
    route_manifest_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "route_manifest_entries.id",
            ondelete="SET NULL",
            name="fk_invoice_entries_route_manifest_entry_id",
        ),
        nullable=True,
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
