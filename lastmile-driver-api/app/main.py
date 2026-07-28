from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import driver, health, occurrences, route_capture, webhooks
from app.core.logging import setup_logging
from app.web.auth import NotAuthenticatedError
from app.web.backoffice_routes import router as backoffice_router
from app.web.routes import router as web_router
from app.workers.timeout_checker import start_timeout_checker, stop_timeout_checker

setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_timeout_checker()
    yield
    stop_timeout_checker()


app = FastAPI(title="Lastmile Engine", lifespan=lifespan)

app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(webhooks.router, prefix="/api/v1", tags=["webhooks"])
app.include_router(occurrences.router, prefix="/api/v1", tags=["occurrences"])
app.include_router(driver.router, prefix="/api/v1", tags=["driver"])
app.include_router(route_capture.router, prefix="/api/v1", tags=["route-capture"])
app.include_router(web_router, tags=["web"])
app.include_router(backoffice_router, tags=["backoffice"])

app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.exception_handler(NotAuthenticatedError)
async def handle_not_authenticated(request: Request, exc: NotAuthenticatedError) -> RedirectResponse:
    return RedirectResponse(url="/web/login", status_code=303)
