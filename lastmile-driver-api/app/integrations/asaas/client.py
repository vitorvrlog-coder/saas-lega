"""
Cliente HTTP pro Asaas — gateway de pagamento usado pra assinatura paga do
motorista no app low ticket ("adesão", ver
app.services.driver_subscription_service). Asaas processa PIX/cartão/
boleto de verdade porque é instituição de pagamento licenciada; nós só
consumimos a API dele, nunca tocamos em dado de cartão.

Mesmo padrão de erro/timeout do app.integrations.evolution_api.client —
qualquer falha de transporte também vira AsaasAPIError, pra não escapar
sem tratamento nas rotas web/webhook.
"""
import logging

import httpx

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 20.0


class AsaasAPIError(Exception):
    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        super().__init__(f"Asaas API retornou {status_code}: {body}")


async def _request(method: str, url: str, headers: dict, *, sensitive: bool = False, **kwargs) -> dict:
    """sensitive=True omite o corpo da resposta de erro do log e da exceção
    levantada — usado pelo endpoint de tokenização de cartão, cujo erro de
    validação às vezes ecoa de volta parte do payload enviado (dado de
    cartão). Nunca logamos o payload de SAÍDA aqui de propósito (nenhuma
    chamada atual precisa disso pra debug)."""
    logger.info("Asaas API → %s %s", method, url)
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.request(method, url, headers=headers, **kwargs)
    except httpx.HTTPError as exc:
        logger.warning("Asaas API ✗ %s %s falha de transporte: %s", method, url, exc)
        raise AsaasAPIError(0, f"falha de rede/timeout: {exc}") from exc

    if response.status_code >= 400:
        body = "[corpo omitido — endpoint sensível a dado de cartão]" if sensitive else response.text
        logger.warning("Asaas API ✗ %s %s status=%d body=%s", method, url, response.status_code, body)
        raise AsaasAPIError(response.status_code, body)

    parsed = response.json()
    logger.info("Asaas API ← %s %s status=%d", method, url, response.status_code)
    return parsed


class AsaasClient:
    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _headers(self) -> dict:
        # Asaas usa header próprio, não Bearer/Authorization — "access_token"
        # é o nome literal exigido pela API deles.
        return {"access_token": self.api_key, "Content-Type": "application/json"}

    async def find_customer_by_cpf(self, cpf: str) -> dict | None:
        """Evita criar customer duplicado se o motorista já existir no
        Asaas (ex: reenvio manual depois de uma falha) — cpfCnpj é
        pesquisável e único por conta Asaas."""
        url = f"{self.base_url}/customers?cpfCnpj={cpf}"
        result = await _request("GET", url, self._headers())
        data = result.get("data") if isinstance(result, dict) else None
        return data[0] if isinstance(data, list) and data else None

    async def create_customer(self, name: str, cpf: str, phone: str) -> dict:
        payload = {"name": name, "cpfCnpj": cpf, "mobilePhone": phone}
        url = f"{self.base_url}/customers"
        return await _request("POST", url, self._headers(), json=payload)

    async def create_subscription(
        self,
        customer_id: str,
        value: float,
        next_due_date: str,
        billing_type: str = "UNDEFINED",
        cycle: str = "MONTHLY",
        description: str = "Assinatura Heimdall Motorista",
        credit_card_token: str | None = None,
        remote_ip: str | None = None,
    ) -> dict:
        """billing_type="UNDEFINED" deixa o motorista escolher PIX ou
        cartão na tela de checkout hospedada pelo Asaas (invoiceUrl da
        resposta). Passar credit_card_token (de tokenize_credit_card) com
        billing_type="CREDIT_CARD" cria uma assinatura de cartão-em-arquivo
        que o Asaas cobra sozinho a cada ciclo, sem exigir creditCard/
        creditCardHolderInfo de novo. remote_ip: a documentação pública
        diverge sobre exigir isso no reuso de token — mandamos quando
        disponível, mas confirmar contra o sandbox real antes de assumir
        que é sempre obrigatório ou sempre opcional."""
        payload = {
            "customer": customer_id,
            "billingType": billing_type,
            "value": value,
            "nextDueDate": next_due_date,
            "cycle": cycle,
            "description": description,
        }
        if credit_card_token:
            payload["creditCardToken"] = credit_card_token
            if remote_ip:
                payload["remoteIp"] = remote_ip
        url = f"{self.base_url}/subscriptions"
        return await _request("POST", url, self._headers(), json=payload)

    async def tokenize_credit_card(
        self,
        customer_id: str,
        *,
        holder_name: str,
        number: str,
        expiry_month: str,
        expiry_year: str,
        ccv: str,
        holder_info: dict,
        remote_ip: str,
    ) -> dict:
        """POST /creditCard/tokenizeCreditCard — path e obrigatoriedade do
        remoteIp confirmados na doc oficial da Asaas (docs.asaas.com);
        remoteIp deve ser o IP do cliente, nunca o do servidor. Devolve um
        creditCardToken reutilizável em create_subscription (evita reenviar
        o cartão a cada cobrança). Dado de cartão nunca é persistido por
        nós — só passa por aqui."""
        payload = {
            "customer": customer_id,
            "creditCard": {
                "holderName": holder_name,
                "number": number,
                "expiryMonth": expiry_month,
                "expiryYear": expiry_year,
                "ccv": ccv,
            },
            "creditCardHolderInfo": holder_info,
            "remoteIp": remote_ip,
        }
        url = f"{self.base_url}/creditCard/tokenizeCreditCard"
        return await _request("POST", url, self._headers(), sensitive=True, json=payload)

    async def get_subscription(self, subscription_id: str) -> dict:
        url = f"{self.base_url}/subscriptions/{subscription_id}"
        return await _request("GET", url, self._headers())

    async def cancel_subscription(self, subscription_id: str) -> dict:
        url = f"{self.base_url}/subscriptions/{subscription_id}"
        return await _request("DELETE", url, self._headers())
