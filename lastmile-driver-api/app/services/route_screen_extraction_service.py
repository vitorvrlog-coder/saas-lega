"""
Extração de paradas a partir de screenshots de telas do app oficial da
plataforma onde o motorista trabalha (Mercado Livre "Entregas", Shopee),
capturadas via MediaProjection no Android — nunca hooking, cada captura é
uma ação explícita do motorista. Módulo puro (sem acesso a DB), espelha
app.services.invoice_extraction_service.

A EXTRAÇÃO DE TELEFONE DO ML (_extract_meli_phone) JÁ É CALIBRADA — o
motorista chega nela tocando "Ligar" na tela de detalhe e escolhendo
"Número principal"/"Número alternativo", o que abre o DISCADOR NATIVO DO
ANDROID com o número preenchido (não uma tela do próprio app do ML). Como é
tela de sistema, o layout é extremamente padronizado entre aparelhos — o
número sempre aparece isolado numa linha própria, em fonte grande, acima do
teclado numérico — por isso uma única amostra real (ver
samples/route_capture/meli/phone_dialer_01.jpg) já é suficiente pra
calibrar com confiança, diferente do resto.

A EXTRAÇÃO DE DETALHE DO ML (_extract_meli_stop_detail) TAMBÉM JÁ FOI
IMPLEMENTADA, mas é PROVISÓRIA — calibrada contra 1 amostra só (ver
samples/route_capture/meli/detalhe_01.jpg). Heurístico puramente
posicional: acha a linha "Pendente" (cabeçalho), trata as linhas
seguintes como endereço até achar uma linha que seja exatamente um dos
marcadores de tipo conhecidos (Casa/Apartamento/Trabalho/Escritório/
Comercial), e a linha imediatamente após o marcador é o nome do cliente.
Funciona pra essa amostra, mas precisa de mais amostras reais pra validar
que a ordem (endereço -> marcador -> nome) é estável entre motoristas/
versões do app antes de confiar cegamente nisso em produção.

SHOPEE CONTINUA EM STUB — só 2 amostras de lista, 0 de detalhe utilizável
(a única veio borrada pelo motorista). Fica pra quando houver mais
material; não é bloqueio pra validar o fluxo do ML sozinho.
"""
import dataclasses
import re
from io import BytesIO

import pytesseract
from PIL import Image

from app.core.config import Settings
from app.db.models.enums import DriverPlatform
from app.services.invoice_extraction_service import _group_words_by_line

# Discador nativo do Android: número isolado numa linha própria, formato
# "DDD NNNNN-NNNN" ou variações sem espaço/traço — o Tesseract às vezes
# gruda tudo numa palavra só (ex: "6199134-8739"), por isso o regex aceita
# separador opcional em cada junção, não só espaço.
_MELI_PHONE_RE = re.compile(r"(\d{2})\s?(\d{4,5})-?(\d{4})")

# Marcadores de tipo de endereço na tela de detalhe do ML — usados como
# âncora pra separar bloco de endereço (antes) de nome do cliente (linha
# logo depois). Ver docstring do módulo: heurístico provisório, só 1
# amostra validada até agora.
_MELI_ADDRESS_TYPE_TAGS = {"CASA", "APARTAMENTO", "TRABALHO", "ESCRITÓRIO", "COMERCIAL"}


class RouteCaptureExtractionError(Exception):
    pass


@dataclasses.dataclass
class ExtractedStopData:
    customer_name: str | None
    customer_phone: str | None
    customer_address: str | None
    raw: dict
    confidence: float | None = None


def _run_ocr(image_bytes: bytes, settings: Settings) -> tuple[list[list[dict]], str]:
    """Compartilhado pelos extratores por plataforma: abre a imagem e roda
    o Tesseract, devolvendo linhas agrupadas por posição (mesmo formato de
    _group_words_by_line) e o texto corrido."""
    import os

    pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
    if settings.TESSDATA_PREFIX:
        os.environ["TESSDATA_PREFIX"] = settings.TESSDATA_PREFIX

    try:
        image = Image.open(BytesIO(image_bytes))
    except Exception as exc:
        raise RouteCaptureExtractionError(f"Não foi possível abrir a imagem: {exc}") from exc

    try:
        data = pytesseract.image_to_data(image, lang="por", output_type=pytesseract.Output.DICT)
        full_text = pytesseract.image_to_string(image, lang="por")
    except pytesseract.TesseractError as exc:
        raise RouteCaptureExtractionError(f"Falha no OCR: {exc}") from exc

    return _group_words_by_line(data), full_text


def _extract_meli_stop_detail(image_bytes: bytes, settings: Settings) -> list[ExtractedStopData]:
    """Provisório — ver docstring do módulo. Endereço = linhas entre
    'Pendente' e o marcador de tipo; nome = linha imediatamente após o
    marcador. Telefone nunca sai daqui — vem só de _extract_meli_phone,
    numa captura separada (tela pós-'Ligar')."""
    lines, _full_text = _run_ocr(image_bytes, settings)

    pendente_idx = next(
        (i for i, words in enumerate(lines) if "PENDENTE" in " ".join(w["text"] for w in words).upper()),
        None,
    )
    if pendente_idx is None:
        raise RouteCaptureExtractionError(
            "Tela não reconhecida como detalhe de parada do ML (sem cabeçalho 'Pendente')."
        )

    type_idx = next(
        (
            i for i in range(pendente_idx + 1, len(lines))
            if " ".join(w["text"] for w in lines[i]).strip().upper() in _MELI_ADDRESS_TYPE_TAGS
        ),
        None,
    )
    if type_idx is None:
        raise RouteCaptureExtractionError(
            "Não encontrou marcador de tipo de endereço (Casa/Apartamento/Trabalho/...) "
            "— heurístico provisório não reconhece esse layout."
        )

    address_lines = lines[pendente_idx + 1 : type_idx]
    address = ", ".join(" ".join(w["text"] for w in words) for words in address_lines) or None

    name = None
    confidences: list[int] = []
    if type_idx + 1 < len(lines):
        name_words = lines[type_idx + 1]
        name = " ".join(w["text"] for w in name_words)
        confidences += [int(w["conf"]) for w in name_words if w["conf"] not in ("-1", -1)]
    for words in address_lines:
        confidences += [int(w["conf"]) for w in words if w["conf"] not in ("-1", -1)]

    confidence = (sum(confidences) / len(confidences) / 100) if confidences else 0.0

    return [
        ExtractedStopData(
            customer_name=name,
            customer_phone=None,
            customer_address=address,
            raw={
                "address_lines": [" ".join(w["text"] for w in wl) for wl in address_lines],
                "name": name,
            },
            confidence=round(confidence, 3),
        )
    ]


def _extract_meli_phone(image_bytes: bytes, settings: Settings) -> str | None:
    """Tela do discador nativo do Android (após o motorista tocar 'Ligar'
    -> escolher 'Número principal'/'Número alternativo' na tela de
    detalhe do ML). Retorna só os dígitos, sem DDI — normalização de
    formato fica a cargo de quem grava no banco, mesma disciplina do resto
    do projeto (ver app.integrations.whatsapp_cloud.phone.normalize_br_phone,
    aplicado no momento de uso, não na extração)."""
    _lines, full_text = _run_ocr(image_bytes, settings)
    match = _MELI_PHONE_RE.search(full_text)
    if match is None:
        return None
    ddd, prefix, suffix = match.groups()
    return f"{ddd}{prefix}{suffix}"


def _extract_shopee_stops(image_bytes: bytes, settings: Settings) -> list[ExtractedStopData]:
    raise RouteCaptureExtractionError(
        "Heurístico do Shopee ainda não calibrado — Fase 0 incompleta, ver docstring deste módulo."
    )


def extract_stops(
    platform: DriverPlatform, image_bytes: bytes, settings: Settings, screenshot_role: str = "stop"
) -> list[ExtractedStopData]:
    """Dispatcher por plataforma. screenshot_role diferencia a 2ª captura
    do ML (tela pós-'Ligar', só telefone) da captura normal de parada —
    nesse caso o chamador (route_capture_service.upload_screenshot) deve
    fundir o telefone retornado com o stop_id existente, não criar um novo."""
    if platform == DriverPlatform.DISTRIBUIDORA:
        raise RouteCaptureExtractionError(
            "DISTRIBUIDORA não usa este extrator — reaproveita o fluxo de nota fiscal existente."
        )
    if platform == DriverPlatform.MELI:
        if screenshot_role == "phone":
            phone = _extract_meli_phone(image_bytes, settings)
            return [ExtractedStopData(customer_name=None, customer_phone=phone, customer_address=None, raw={})]
        return _extract_meli_stop_detail(image_bytes, settings)
    if platform == DriverPlatform.SHOPEE:
        return _extract_shopee_stops(image_bytes, settings)
    raise RouteCaptureExtractionError(f"Plataforma '{platform}' não suportada.")
