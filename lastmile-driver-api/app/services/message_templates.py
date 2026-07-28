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

# Modo full (Tenant.full_autonomous_mode) — repergunta em vez de escalar
# pra operador humano (ver app.state_machine.transitions).
DRIVER_CLARIFICATION_REQUEST = "driver_clarification_request"
DRIVER_REQUEST_CONTACT_INFO = "driver_request_contact_info"
CUSTOMER_CLARIFICATION_REQUEST = "customer_clarification_request"

# App do motorista (upload de nota fiscal) — ver app.services.driver_auth_service.
DRIVER_LOGIN_CODE = "driver_login_code"
# Contato preventivo com o cliente, disparado na confirmação da nota fiscal
# no app — antes da tentativa de entrega, não depois de um insucesso. Ver
# app.services.invoice_service / app.api.v1.driver.
PREVENTIVE_ORDER_CONFIRMATION = "preventive_order_confirmation"

# Assinatura paga do motorista no app (adesão) — ver
# app.services.driver_subscription_service / app.integrations.asaas.
SUBSCRIPTION_PAYMENT_LINK = "subscription_payment_link"

# Captura de rota (ML/Shopee) — pré-triagem com o cliente antes da
# tentativa de entrega, e notificações ao motorista sobre o andamento. Ver
# app.services.route_prescreen_service / route_optimizer_service.
ROUTE_CAPTURE_PRESCREEN_CUSTOMER = "route_capture_prescreen_customer"
ROUTE_CAPTURE_DRIVER_NOTIFY_REPLY = "route_capture_driver_notify_reply"
ROUTE_CAPTURE_DRIVER_NOTIFY_ROUTE = "route_capture_driver_notify_route"


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
    {
        "key": DRIVER_CLARIFICATION_REQUEST,
        "label": "Motorista — modo full: motivo do insucesso ficou ambíguo, repergunta (acompanha botões de resposta rápida)",
        "variables": [],
    },
    {
        "key": DRIVER_REQUEST_CONTACT_INFO,
        "label": "Motorista — modo full: motivo ok, mas falta telefone/endereço do cliente, pede pra ele mandar",
        "variables": [],
    },
    {
        "key": CUSTOMER_CLARIFICATION_REQUEST,
        "label": "Cliente — modo full: resposta ficou ambígua, repergunta",
        "variables": [],
    },
    {
        "key": DRIVER_LOGIN_CODE,
        "label": "Motorista — código de login do app (upload de nota fiscal)",
        "variables": ["code"],
    },
    {
        "key": PREVENTIVE_ORDER_CONFIRMATION,
        "label": "Cliente — confirmação preventiva de pedido/endereço (antes da tentativa de entrega)",
        "variables": ["customer_name", "order_number", "address", "map_link"],
    },
    {
        "key": SUBSCRIPTION_PAYMENT_LINK,
        "label": "Motorista — link de pagamento da assinatura (adesão)",
        "variables": ["value", "payment_link"],
    },
    {
        "key": ROUTE_CAPTURE_PRESCREEN_CUSTOMER,
        "label": "Cliente — pré-triagem de rota (confirmar disponibilidade/endereço antes da entrega)",
        "variables": ["customer_name", "address"],
    },
    {
        "key": ROUTE_CAPTURE_DRIVER_NOTIFY_REPLY,
        "label": "Motorista — cliente de uma parada da rota respondeu à pré-triagem",
        "variables": ["stop_label", "customer_reply_text", "status_label"],
    },
    {
        "key": ROUTE_CAPTURE_DRIVER_NOTIFY_ROUTE,
        "label": "Motorista — rota otimizada pronta",
        "variables": ["route_summary_text"],
    },
]


_VARIABLES_BY_KEY = {field["key"]: field["variables"] for field in TEMPLATE_FIELDS}


def build_template_components(key: str, **kwargs) -> list[dict] | None:
    """Monta o `components` no formato da Graph API pra preencher as
    variáveis posicionais {{1}}, {{2}}... de um template aprovado —
    reaproveita a MESMA ordem de variáveis já documentada em
    TEMPLATE_FIELDS pra cada chave, pra não manter uma segunda lista
    desalinhada. Quem cadastra o template no Meta Business Manager
    precisa seguir essa mesma ordem ao escrever o corpo aprovado."""
    variables = _VARIABLES_BY_KEY.get(key, [])
    if not variables:
        return None
    return [
        {
            "type": "body",
            "parameters": [{"type": "text", "text": str(kwargs.get(var, ""))} for var in variables],
        }
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
