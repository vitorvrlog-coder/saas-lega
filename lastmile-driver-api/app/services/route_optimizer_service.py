"""
Roteirizador da Route Capture: geocodifica as paradas confirmadas na
pré-triagem (app.services.route_prescreen_service) e calcula a sequência
mais eficiente via nearest-neighbor + 2-opt — aproximação simples,
suficiente pro N pequeno esperado (dezenas de paradas por rota diária), sem
dependência de solver pesado. VRP com janela de horário fica fora de
escopo v1 (ver plano).

Paradas que não confirmaram na pré-triagem (indisponível/endereço
errado/timeout) ficam de fora da rota, mas continuam visíveis na sessão
pro motorista.
"""
import asyncio
import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.enums import RouteCapturePrescreenStatus, RouteCaptureSessionStatus
from app.db.models.route_capture_session import RouteCaptureSession
from app.db.models.route_capture_stop import RouteCaptureStop
from app.geo.distance import haversine_km
from app.geo.geocoding import GeocodingError, geocode_address
from app.services.route_capture_service import RouteCaptureSessionError

__all__ = ["optimize_session", "nearest_neighbor_order", "two_opt_improve"]

# Nominatim (plano gratuito) pede no máximo 1 requisição/segundo — geocoding
# sequencial com esse intervalo entre chamadas, aceitável pro volume
# esperado de uma rota diária (dezenas de paradas, não milhares).
_GEOCODE_DELAY_SECONDS = 1.0


def nearest_neighbor_order(points: list[tuple[float, float]]) -> list[int]:
    """Retorna os ÍNDICES de points na ordem visitada, começando do
    índice 0. Puro/determinístico, sem I/O — testável com coordenadas
    sintéticas."""
    if not points:
        return []
    remaining = set(range(1, len(points)))
    order = [0]
    current = 0
    while remaining:
        nxt = min(remaining, key=lambda i: haversine_km(*points[current], *points[i]))
        order.append(nxt)
        remaining.remove(nxt)
        current = nxt
    return order


def _route_length(order: list[int], points: list[tuple[float, float]]) -> float:
    return sum(
        haversine_km(*points[order[i]], *points[order[i + 1]]) for i in range(len(order) - 1)
    )


def two_opt_improve(order: list[int], points: list[tuple[float, float]]) -> list[int]:
    """2-opt clássico: troca pares de arestas enquanto reduzir a distância
    total, até não haver mais melhoria. O(n²) por passada — aceitável pro
    N pequeno esperado aqui."""
    if len(order) < 4:
        return order

    best = list(order)
    improved = True
    while improved:
        improved = False
        for i in range(1, len(best) - 2):
            for j in range(i + 1, len(best) - 1):
                candidate = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
                if _route_length(candidate, points) < _route_length(best, points):
                    best = candidate
                    improved = True
    return best


async def _geocode_stops(
    db: AsyncSession, settings: Settings, stops: list[RouteCaptureStop]
) -> list[RouteCaptureStop]:
    geocoded = []
    for stop in stops:
        try:
            coords = await geocode_address(stop.customer_address, settings)
        except GeocodingError:
            coords = None
        if coords is not None:
            stop.lat = coords.lat
            stop.lon = coords.lon
            geocoded.append(stop)
        await asyncio.sleep(_GEOCODE_DELAY_SECONDS)
    return geocoded


async def optimize_session(
    db: AsyncSession, settings: Settings, tenant, session: RouteCaptureSession
) -> RouteCaptureSession:
    """Ação explícita do motorista (botão "Otimizar rota"), só depois da
    pré-triagem ter rodado. Levanta RouteCaptureSessionError se a sessão
    não estiver CONFIRMED ou não tiver nenhuma parada confirmada na
    pré-triagem — sem isso, "otimizar" uma rota vazia não faz sentido."""
    if session.status != RouteCaptureSessionStatus.CONFIRMED:
        raise RouteCaptureSessionError(f"Sessão no estado '{session.status.value}' não pode ser otimizada.")

    result = await db.execute(
        select(RouteCaptureStop).where(
            RouteCaptureStop.session_id == session.id,
            RouteCaptureStop.prescreen_status == RouteCapturePrescreenStatus.CONFIRMED,
        )
    )
    stops = list(result.scalars().all())
    if not stops:
        raise RouteCaptureSessionError("Nenhuma parada confirmada na pré-triagem para otimizar.")

    geocoded_stops = await _geocode_stops(db, settings, stops)
    if not geocoded_stops:
        raise RouteCaptureSessionError("Não foi possível geocodificar nenhum endereço confirmado.")

    points = [(float(s.lat), float(s.lon)) for s in geocoded_stops]
    order = two_opt_improve(nearest_neighbor_order(points), points)

    for sequence, idx in enumerate(order, start=1):
        geocoded_stops[idx].route_sequence = sequence

    session.status = RouteCaptureSessionStatus.ROUTE_READY
    session.route_ready_at = datetime.datetime.now(datetime.timezone.utc)

    # Import local pra evitar ciclo, mesmo padrão do resto do módulo.
    from app.db.models.driver import Driver
    from app.services.route_prescreen_service import notify_driver_of_route

    driver = await db.get(Driver, session.driver_id)
    if driver is not None:
        await notify_driver_of_route(db, settings, tenant, driver, session, geocoded_stops)

    return session
