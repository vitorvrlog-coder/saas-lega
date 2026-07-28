"""
Geocoding do novo endereço pedido pelo cliente final (etapa 5). Provider
default é o Nominatim (OpenStreetMap), público e sem API key — trocável via
GEOCODING_PROVIDER, mesma lógica de "nunca acoplar a um provedor específico"
usada em app.ai.
"""
from dataclasses import dataclass

import httpx

from app.core.config import Settings

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


class GeocodingError(Exception):
    pass


@dataclass
class Coordinates:
    lat: float
    lon: float


async def geocode_address(address: str, settings: Settings) -> Coordinates | None:
    """Retorna None quando o endereço não é encontrado (não é erro — o
    chamador decide o que fazer, ex: escalar para humano)."""

    if settings.GEOCODING_PROVIDER != "nominatim":
        raise GeocodingError(
            f"Provider de geocoding desconhecido: {settings.GEOCODING_PROVIDER}"
        )

    params = {"q": address, "format": "json", "limit": 1}
    headers = {"User-Agent": "lastmile-engine/1.0"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(NOMINATIM_URL, params=params, headers=headers)

    if response.status_code >= 400:
        raise GeocodingError(f"Nominatim retornou {response.status_code}: {response.text}")

    results = response.json()
    if not results:
        return None

    return Coordinates(lat=float(results[0]["lat"]), lon=float(results[0]["lon"]))
