"""
Extração de dados do destinatário a partir do XML da NFe (determinístico,
schema fixo da SEFAZ) ou de foto de DANFe (OCR via Tesseract, com
confidence score — bem menos confiável). Módulo puro (sem acesso a
DB/sessão) pra ser testável isolado contra XML/imagem de exemplo.

Schema de referência do XML (namespace padrão da NFe):
  infNFe/dest/xNome           -> nome do cliente
  infNFe/dest/enderDest/fone  -> telefone (opcional, nem toda NF tem)
  infNFe/dest/enderDest/{xLgr,nro,xBairro,xMun,UF,CEP} -> endereço
  infNFe/ide/nNF              -> número da nota

extract_from_photo NUNCA extrai telefone — validado na Fase 0 (ver
samples/danfe/) contra DANFe reais: o Tesseract não respeita a borda das
células da tabela do bloco DESTINATÁRIO e gruda o texto da célula de bairro
com o da célula de telefone vizinha de forma inconsistente ("SOBRADINHOD99689-5763"),
tornando a extração de telefone por OCR não confiável o suficiente pra essa
fase. Nome e endereço extraem bem e por isso são suportados; telefone fica
sempre null, para o motorista preencher manualmente na revisão
(PATCH /invoices/{id}) antes de confirmar.
"""
import dataclasses
import os
import re
import xml.etree.ElementTree as ET
from io import BytesIO

import pytesseract
from PIL import Image

from app.core.config import Settings

NFE_NAMESPACE = {"nfe": "http://www.portalfiscal.inf.br/nfe"}

_PHONE_RE = re.compile(r"\(?\d{2}\)?\s?9?\d{4}[\s.-]?\d{4}")
_ORDER_NUMBER_RE = re.compile(r"N[°º]\.?\s*[:\s]?\s*(\d{3,})")


class InvoiceExtractionError(Exception):
    pass


@dataclasses.dataclass
class ExtractedInvoiceData:
    order_number: str | None
    customer_name: str | None
    customer_phone: str | None
    customer_address: str | None
    raw: dict
    # Só populado pro caminho de foto/OCR — XML é estruturado, não tem
    # confiança associada (ver InvoiceEntry.ocr_confidence).
    confidence: float | None = None


def _text(node: ET.Element | None, tag: str) -> str | None:
    if node is None:
        return None
    child = node.find(f"nfe:{tag}", NFE_NAMESPACE)
    return child.text.strip() if child is not None and child.text else None


def _build_address(ender: ET.Element | None) -> str | None:
    if ender is None:
        return None
    parts = [
        _text(ender, "xLgr"),
        _text(ender, "nro"),
        _text(ender, "xBairro"),
        _text(ender, "xMun"),
        _text(ender, "UF"),
    ]
    parts = [p for p in parts if p]
    return ", ".join(parts) if parts else None


def extract_from_xml(xml_bytes: bytes) -> ExtractedInvoiceData:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise InvoiceExtractionError(f"XML inválido: {exc}") from exc

    inf_nfe = root.find(".//nfe:infNFe", NFE_NAMESPACE)
    if inf_nfe is None:
        raise InvoiceExtractionError("XML não contém infNFe — não parece ser uma NFe válida.")

    dest = inf_nfe.find("nfe:dest", NFE_NAMESPACE)
    if dest is None:
        raise InvoiceExtractionError("XML não contém dados do destinatário (dest).")

    ender_dest = dest.find("nfe:enderDest", NFE_NAMESPACE)
    ide = inf_nfe.find("nfe:ide", NFE_NAMESPACE)

    return ExtractedInvoiceData(
        order_number=_text(ide, "nNF"),
        customer_name=_text(dest, "xNome"),
        customer_phone=_text(ender_dest, "fone"),
        customer_address=_build_address(ender_dest),
        raw={
            "order_number": _text(ide, "nNF"),
            "customer_name": _text(dest, "xNome"),
            "customer_phone": _text(ender_dest, "fone"),
            "cep": _text(ender_dest, "CEP"),
        },
    )


def _group_words_by_line(data: dict) -> list[list[dict]]:
    lines: dict[tuple, list[dict]] = {}
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if not text:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(
            {"text": text, "left": data["left"][i], "conf": data["conf"][i]}
        )
    return [sorted(words, key=lambda w: w["left"]) for words in lines.values()]


def _extract_destinatario_fields(lines: list[list[dict]]) -> tuple[str | None, str | None, list[int]]:
    """Retorna (nome, endereço, confidences das palavras usadas) — telefone
    deliberadamente fora daqui, ver docstring do módulo."""
    dest_idx = next(
        (i for i, words in enumerate(lines) if "DESTINAT" in " ".join(w["text"] for w in words).upper()),
        None,
    )
    if dest_idx is None:
        return None, None, []

    window = lines[dest_idx : dest_idx + 8]
    name = None
    address = None
    used_confidences: list[int] = []

    for j, words in enumerate(window):
        joined = " ".join(w["text"] for w in words).upper()

        if name is None and j > 0 and "NOME" not in joined and "RAZ" not in joined:
            name = " ".join(w["text"] for w in words)
            used_confidences += [int(w["conf"]) for w in words if w["conf"] not in ("-1", -1)]

        if address is None and "ENDERE" in joined:
            for k in range(j + 1, min(j + 3, len(window))):
                candidate_words = window[k]
                candidate = " ".join(w["text"] for w in candidate_words)
                if "ENDERE" in candidate.upper():
                    continue
                address = candidate
                used_confidences += [int(w["conf"]) for w in candidate_words if w["conf"] not in ("-1", -1)]
                break

    return name, address, used_confidences


def extract_from_photo(image_bytes: bytes, settings: Settings) -> ExtractedInvoiceData:
    pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
    if settings.TESSDATA_PREFIX:
        os.environ["TESSDATA_PREFIX"] = settings.TESSDATA_PREFIX

    try:
        image = Image.open(BytesIO(image_bytes))
    except Exception as exc:
        raise InvoiceExtractionError(f"Não foi possível abrir a imagem: {exc}") from exc

    try:
        data = pytesseract.image_to_data(image, lang="por", output_type=pytesseract.Output.DICT)
        full_text = pytesseract.image_to_string(image, lang="por")
    except pytesseract.TesseractError as exc:
        raise InvoiceExtractionError(f"Falha no OCR: {exc}") from exc

    lines = _group_words_by_line(data)
    name, address, used_confidences = _extract_destinatario_fields(lines)

    order_match = _ORDER_NUMBER_RE.search(full_text)
    order_number = order_match.group(1) if order_match else None

    confidence = (sum(used_confidences) / len(used_confidences) / 100) if used_confidences else 0.0

    return ExtractedInvoiceData(
        order_number=order_number,
        customer_name=name,
        customer_phone=None,
        customer_address=address,
        raw={"order_number": order_number, "customer_name": name, "customer_address": address},
        confidence=round(confidence, 3),
    )
