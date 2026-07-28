"""Testes de app.services.manifest_service — parsing de planilha de rota
(csv/xlsx) e busca de entrada por (driver_phone, stop_number)."""
import datetime
import io
import uuid

import openpyxl
import pytest

from app.db.models.tenant import Tenant
from app.services.manifest_service import (
    ManifestParseError,
    find_manifest_entry,
    parse_manifest_file,
    store_manifest,
)

CSV_HEADER = "stop_number,driver_phone,customer_name,customer_phone,address,route_id\n"


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-manifest-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Planilha Teste", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


def _xlsx_bytes(rows: list[list]) -> bytes:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["stop_number", "driver_phone", "customer_name", "customer_phone", "address", "route_id"])
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_parse_manifest_file_csv_valid():
    csv_bytes = (
        CSV_HEADER + "3,47999998888,Maria,47988887777,Rua A 123,ROTA-1\n"
    ).encode("utf-8")

    rows = parse_manifest_file(csv_bytes, "rota.csv")

    assert len(rows) == 1
    assert rows[0]["stop_number"] == 3
    assert rows[0]["driver_phone"] == "5547999998888"
    assert rows[0]["customer_phone"] == "5547988887777"
    assert rows[0]["route_id"] == "ROTA-1"


def test_parse_manifest_file_xlsx_valid():
    xlsx_bytes = _xlsx_bytes([[5, "47999998888", "Maria", "47988887777", "Rua A 123", "ROTA-2"]])

    rows = parse_manifest_file(xlsx_bytes, "rota.xlsx")

    assert len(rows) == 1
    assert rows[0]["stop_number"] == 5
    assert rows[0]["driver_phone"] == "5547999998888"


def test_parse_manifest_file_missing_required_column_raises():
    csv_bytes = b"stop_number,driver_phone\n1,47999998888\n"

    with pytest.raises(ManifestParseError, match="obrigat"):
        parse_manifest_file(csv_bytes, "rota.csv")


def test_parse_manifest_file_invalid_stop_number_raises():
    csv_bytes = (CSV_HEADER + "abc,47999998888,Maria,47988887777,Rua A,ROTA-1\n").encode("utf-8")

    with pytest.raises(ManifestParseError, match="não é um número"):
        parse_manifest_file(csv_bytes, "rota.csv")


def test_parse_manifest_file_unsupported_extension_raises():
    with pytest.raises(ManifestParseError, match="não suportado"):
        parse_manifest_file(b"qualquer coisa", "rota.pdf")


def test_parse_manifest_file_empty_raises():
    with pytest.raises(ManifestParseError):
        parse_manifest_file(CSV_HEADER.encode("utf-8"), "rota.csv")


async def test_find_manifest_entry_matches_by_phone_and_stop(db_session):
    tenant = await _make_tenant(db_session)
    rows = parse_manifest_file(
        (CSV_HEADER + "3,47999998888,Maria,47988887777,Rua A 123,ROTA-1\n").encode("utf-8"),
        "rota.csv",
    )
    await store_manifest(db_session, tenant.id, None, "rota.csv", datetime.date.today(), rows)

    entry = await find_manifest_entry(db_session, tenant.id, "47999998888", 3)

    assert entry is not None
    assert entry.customer_name == "Maria"
    assert entry.address == "Rua A 123"


async def test_find_manifest_entry_no_match_returns_none(db_session):
    tenant = await _make_tenant(db_session)
    rows = parse_manifest_file(
        (CSV_HEADER + "3,47999998888,Maria,47988887777,Rua A 123,ROTA-1\n").encode("utf-8"),
        "rota.csv",
    )
    await store_manifest(db_session, tenant.id, None, "rota.csv", datetime.date.today(), rows)

    assert await find_manifest_entry(db_session, tenant.id, "47999998888", 99) is None
    assert await find_manifest_entry(db_session, tenant.id, "47900000000", 3) is None


async def test_find_manifest_entry_most_recent_manifest_wins(db_session):
    """Reupload de correção no mesmo dia — o manifesto mais novo deve
    vencer na busca, não o antigo. created_at é setado manualmente aqui
    porque func.now() do Postgres é hora da TRANSAÇÃO, não da instrução —
    dois inserts no mesmo teste (mesma transação, sem commit entre eles)
    ficariam com o mesmo timestamp; em produção cada upload é uma
    transação/requisição separada, então isso nunca ocorre de verdade."""
    tenant = await _make_tenant(db_session)

    old_rows = parse_manifest_file(
        (CSV_HEADER + "3,47999998888,Maria Antiga,47988887777,Endereço Antigo,ROTA-1\n").encode("utf-8"),
        "rota_v1.csv",
    )
    old_manifest = await store_manifest(
        db_session, tenant.id, None, "rota_v1.csv", datetime.date.today(), old_rows
    )
    old_manifest.created_at = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)

    new_rows = parse_manifest_file(
        (CSV_HEADER + "3,47999998888,Maria Nova,47988887777,Endereço Novo,ROTA-1\n").encode("utf-8"),
        "rota_v2.csv",
    )
    new_manifest = await store_manifest(
        db_session, tenant.id, None, "rota_v2.csv", datetime.date.today(), new_rows
    )
    new_manifest.created_at = datetime.datetime(2026, 1, 2, tzinfo=datetime.timezone.utc)
    await db_session.flush()

    entry = await find_manifest_entry(db_session, tenant.id, "47999998888", 3)

    assert entry.customer_name == "Maria Nova"
