"""
Logging operacional da aplicação (stdout/stderr) — não confundir com a
trilha de auditoria de negócio, que vive nas tabelas state_transitions,
message_logs e ai_decision_logs. Isto aqui é só para debug/operação.
"""
import logging
import sys

from app.core.config import get_settings

_LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s [%(message)s]"


def setup_logging() -> None:
    settings = get_settings()

    root = logging.getLogger()
    root.setLevel(settings.LOG_LEVEL)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))

    root.handlers.clear()
    root.addHandler(handler)

    # Bibliotecas barulhentas em nível INFO — deixa em WARNING por padrão.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
