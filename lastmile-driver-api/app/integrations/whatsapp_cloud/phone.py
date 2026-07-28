"""
Normalização de telefone pro formato que a WhatsApp Cloud API espera (DDI +
DDD + número, só dígitos, sem "+" nem sufixo de JID).

Confirmado em teste real (herdado do gateway anterior): quando o operador
da fila humana digita o telefone sem DDI (ex: "47999244786"), o WhatsApp
resolve e envia a mensagem normalmente, mas se Occurrence.customer_phone
ficar salvo sem o DDI, a resposta do cliente (que chega com o telefone já
resolvido) nunca bate com o que está salvo — a ocorrência fica travada
esperando resposta que já chegou, e a resposta vira um novo relato de
motorista por engano.

Assume Brasil (único mercado do produto hoje) — DDI 55.
"""
import re

BR_COUNTRY_CODE = "55"
BR_LOCAL_LENGTHS = (10, 11)  # DDD (2) + número (8 fixo / 9 celular)
BR_FULL_LENGTHS = (12, 13)  # DDI (2) + DDD (2) + número (8 ou 9)


def normalize_br_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)

    if digits.startswith(BR_COUNTRY_CODE) and len(digits) in BR_FULL_LENGTHS:
        return digits

    if len(digits) in BR_LOCAL_LENGTHS:
        return BR_COUNTRY_CODE + digits

    return digits
