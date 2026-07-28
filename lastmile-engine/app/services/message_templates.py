"""
Chaves de Tenant.message_templates (JSONB) e helper de renderização. O
CONTEÚDO de cada template é responsabilidade de cada tenant — nunca
hardcoded aqui, só as chaves que o motor sabe procurar.

Quando um tenant não configurou uma chave, a mensagem correspondente
simplesmente não é enviada (loga aviso) — não inventamos texto de negócio
como fallback.
"""
import logging
import random
import re

logger = logging.getLogger(__name__)

# Separador de variações dentro do MESMO template — uma linha só com "==="
# (aceita \r\n do textarea do navegador e espaços em volta) divide o texto
# em várias frases equivalentes, e render_template sorteia uma a cada
# envio. Convenção deliberada pra "humanizar" sem abrir mão da regra do
# projeto de que mensagem pro motorista SEMPRE vem de template configurado
# (nunca texto livre gerado pela IA, ver docstring do topo de
# occurrence_service.py) — variar a frase evita a sensação de bot batendo
# a mesma resposta sempre, sem perder previsibilidade/controle de conteúdo.
_TEMPLATE_VARIANT_SEPARATOR_RE = re.compile(r"\r?\n[ \t]*===[ \t]*\r?\n")

CONTACT_CUSTOMER_ATTEMPT_1 = "contact_customer_attempt_1"
CONTACT_CUSTOMER_ATTEMPT_2 = "contact_customer_attempt_2"
RADIUS_APPROVED_CUSTOMER = "radius_approved_customer"
RADIUS_DENIED_CUSTOMER = "radius_denied_customer"
CUSTOMER_RESCHEDULE_CONFIRMED = "customer_reschedule_confirmed"
DRIVER_REPORT_RECEIVED_NOTICE = "driver_report_received_notice"
DRIVER_REPORT_ESCALATED_NOTICE = "driver_report_escalated_notice"
DRIVER_CONTACTING_CUSTOMER_NOTICE = "driver_contacting_customer_notice"
DRIVER_CUSTOMER_REPLIED_NOTICE = "driver_customer_replied_notice"
DRIVER_NEW_INSTRUCTION_APPROVED = "driver_new_instruction_approved"
DRIVER_KEEP_AS_FAILURE_DENIED = "driver_keep_as_failure_denied"
DRIVER_DEFINITIVE_FAILURE = "driver_definitive_failure"
DRIVER_REFUSED_CLOSED = "driver_refused_closed"
DRIVER_FOLLOWUP_ACK = "driver_followup_ack"


# Metadados pra UI de edição (app.web) — chave, rótulo amigável e as
# variáveis que o motor de fato passa em cada render_template(...) (ver
# app.services.occurrence_service). Mantido aqui, junto das chaves, pra não
# desalinhar quando um novo kwarg for adicionado numa chamada.
TEMPLATE_FIELDS = [
    {
        "key": CONTACT_CUSTOMER_ATTEMPT_1,
        "label": "Contato com cliente — tentativa 1",
        "variables": ["failure_reason", "original_address"],
    },
    {
        "key": CONTACT_CUSTOMER_ATTEMPT_2,
        "label": "Contato com cliente — tentativa 2",
        "variables": ["failure_reason", "original_address"],
    },
    {
        "key": RADIUS_APPROVED_CUSTOMER,
        "label": "Cliente — novo endereço aprovado (dentro do raio)",
        "variables": ["new_address"],
    },
    {
        "key": RADIUS_DENIED_CUSTOMER,
        "label": "Cliente — novo endereço fora do raio permitido",
        "variables": ["allowed_radius_km"],
    },
    {
        "key": CUSTOMER_RESCHEDULE_CONFIRMED,
        "label": "Cliente — confirmação de reagendamento (ex: \"estarei em casa em X minutos\", sem endereço novo)",
        "variables": ["customer_message"],
    },
    {
        "key": DRIVER_REPORT_RECEIVED_NOTICE,
        "label": "Motorista — aviso de relato recebido",
        "variables": ["failure_reason"],
    },
    {
        "key": DRIVER_REPORT_ESCALATED_NOTICE,
        "label": "Motorista — relato foi encaminhado para análise humana (ex: áudio, dúvida da IA)",
        "variables": [],
    },
    {
        "key": DRIVER_CONTACTING_CUSTOMER_NOTICE,
        "label": "Motorista — aviso de contato com cliente iniciado",
        "variables": ["failure_reason"],
    },
    {
        "key": DRIVER_CUSTOMER_REPLIED_NOTICE,
        "label": "Motorista — aviso de resposta do cliente recebida",
        "variables": [],
    },
    {
        "key": DRIVER_NEW_INSTRUCTION_APPROVED,
        "label": "Motorista — nova instrução aprovada",
        "variables": ["new_address"],
    },
    {
        "key": DRIVER_KEEP_AS_FAILURE_DENIED,
        "label": "Motorista — mantido como insucesso (raio negado)",
        "variables": [],
    },
    {
        "key": DRIVER_DEFINITIVE_FAILURE,
        "label": "Motorista — insucesso definitivo",
        "variables": [],
    },
    {
        "key": DRIVER_REFUSED_CLOSED,
        "label": "Motorista — cliente recusou, ocorrência encerrada",
        "variables": [],
    },
    {
        "key": DRIVER_FOLLOWUP_ACK,
        "label": "Motorista — confirmação curta de comentário casual (\"ok\", \"tranquilo\") numa ocorrência já em andamento, enviada só uma vez",
        "variables": [],
    },
]


def render_template(tenant, key: str, **kwargs) -> str | None:
    template = tenant.message_templates.get(key)
    if not template:
        logger.warning(
            "Tenant %s sem template '%s' configurado — mensagem não enviada.", tenant.slug, key
        )
        return None
    variants = [v.strip() for v in _TEMPLATE_VARIANT_SEPARATOR_RE.split(template) if v.strip()]
    chosen = random.choice(variants) if variants else template
    try:
        return chosen.format(**kwargs)
    except (KeyError, IndexError) as exc:
        logger.error("Template '%s' do tenant %s mal formatado: %s", key, tenant.slug, exc)
        return None
