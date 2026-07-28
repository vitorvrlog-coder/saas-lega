"""
Planilha de rota (app.db.models.route_manifest) — upload manual do operador
como ponte até existir integração direta com o TMS da transportadora, no
mesmo espírito plugável de app.services.human_queue_service (quem alimenta
o dado é substituível, o que é usado pelo motor não muda).

parse_manifest_file nunca adivinha: linha com coluna obrigatória ausente ou
stop_number não numérico levanta ManifestParseError citando o número da
linha, em vez de silenciosamente pular ou inventar um valor.
"""
import csv
import io
import uuid
from datetime import date

import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.route_manifest import RouteManifest, RouteManifestEntry
from app.integrations.whatsapp_cloud.phone import normalize_br_phone

REQUIRED_COLUMNS = {"stop_number", "driver_phone", "customer_name", "customer_phone", "address"}
OPTIONAL_COLUMNS = {"route_id"}


class ManifestParseError(Exception):
    pass


def _normalize_header(raw: str) -> str:
    return (raw or "").strip().lower().replace(" ", "_")


def _parse_xlsx(file_bytes: bytes) -> list[dict]:
    workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows_iter = sheet.iter_rows(values_only=True)

    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise ManifestParseError("Planilha vazia — sem nem o cabeçalho.")

    headers = [_normalize_header(str(h)) for h in header_row]
    rows = []
    for row in rows_iter:
        if all(cell is None for cell in row):
            continue
        rows.append({headers[i]: row[i] for i in range(len(headers)) if i < len(row)})
    return rows


def _parse_csv(file_bytes: bytes) -> list[dict]:
    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ManifestParseError("Planilha vazia — sem nem o cabeçalho.")
    reader.fieldnames = [_normalize_header(h) for h in reader.fieldnames]
    return list(reader)


def parse_manifest_file(file_bytes: bytes, filename: str) -> list[dict]:
    lower_name = filename.lower()
    if lower_name.endswith(".xlsx"):
        rows = _parse_xlsx(file_bytes)
    elif lower_name.endswith(".csv"):
        rows = _parse_csv(file_bytes)
    else:
        raise ManifestParseError("Formato não suportado — envie um arquivo .xlsx ou .csv.")

    if not rows:
        raise ManifestParseError("Planilha sem nenhuma linha de dado.")

    found_columns = set(rows[0].keys())
    missing = REQUIRED_COLUMNS - found_columns
    if missing:
        raise ManifestParseError(
            f"Coluna(s) obrigatória(s) ausente(s): {', '.join(sorted(missing))}."
        )

    parsed_rows = []
    for i, row in enumerate(rows, start=2):  # linha 1 = cabeçalho
        stop_number_raw = row.get("stop_number")
        driver_phone_raw = row.get("driver_phone")
        if stop_number_raw in (None, "") or driver_phone_raw in (None, ""):
            raise ManifestParseError(
                f"Linha {i}: stop_number e driver_phone são obrigatórios."
            )
        try:
            stop_number = int(str(stop_number_raw).strip())
        except (TypeError, ValueError):
            raise ManifestParseError(f"Linha {i}: stop_number '{stop_number_raw}' não é um número.")

        parsed_rows.append({
            "stop_number": stop_number,
            "driver_phone": normalize_br_phone(str(driver_phone_raw)),
            "customer_name": (str(row.get("customer_name")).strip() if row.get("customer_name") else None),
            "customer_phone": (
                normalize_br_phone(str(row["customer_phone"])) if row.get("customer_phone") else None
            ),
            "address": (str(row.get("address")).strip() if row.get("address") else None),
            "route_id": (str(row.get("route_id")).strip() if row.get("route_id") else None),
        })

    return parsed_rows


async def store_manifest(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    uploaded_by_user_id: uuid.UUID | None,
    filename: str,
    route_date: date,
    rows: list[dict],
) -> RouteManifest:
    manifest = RouteManifest(
        tenant_id=tenant_id, uploaded_by_user_id=uploaded_by_user_id,
        filename=filename, route_date=route_date,
    )
    db.add(manifest)
    await db.flush()

    for row in rows:
        db.add(RouteManifestEntry(manifest_id=manifest.id, **row))

    await db.flush()
    return manifest


async def list_manifests(db: AsyncSession, tenant_id: uuid.UUID) -> list[RouteManifest]:
    result = await db.execute(
        select(RouteManifest)
        .where(RouteManifest.tenant_id == tenant_id)
        .order_by(RouteManifest.created_at.desc())
    )
    return list(result.scalars().all())


async def find_manifest_entry(
    db: AsyncSession, tenant_id: uuid.UUID, driver_phone: str, stop_number: int
) -> RouteManifestEntry | None:
    """Manifesto mais recente daquele tenant que contenha essa combinação
    (telefone do motorista, número da parada) — se o operador subir uma
    correção no mesmo dia, o upload mais novo vence."""
    normalized_phone = normalize_br_phone(driver_phone)

    result = await db.execute(
        select(RouteManifestEntry)
        .join(RouteManifest, RouteManifest.id == RouteManifestEntry.manifest_id)
        .where(
            RouteManifest.tenant_id == tenant_id,
            RouteManifestEntry.driver_phone == normalized_phone,
            RouteManifestEntry.stop_number == stop_number,
        )
        .order_by(RouteManifest.created_at.desc())
    )
    return result.scalars().first()
