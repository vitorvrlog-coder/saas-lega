"""render_template: variações separadas por uma linha "===" — sorteia uma
por envio, pra "humanizar" sem abrir mão de mensagem pro motorista sempre
vir de template configurado (nunca texto livre da IA)."""
import uuid

from app.db.models.tenant import Tenant
from app.services.message_templates import render_template


def _tenant(templates: dict) -> Tenant:
    return Tenant(
        id=uuid.uuid4(), name="T", slug=f"t-{uuid.uuid4().hex[:8]}",
        evolution_instance="i", evolution_token="tok", message_templates=templates,
    )


def test_single_template_without_separator_always_returns_same_text():
    tenant = _tenant({"k": "Olá!"})
    for _ in range(10):
        assert render_template(tenant, "k") == "Olá!"


def test_variants_are_all_possible_outcomes():
    tenant = _tenant({"k": "Olá!\n===\nOi, tudo bem?\n===\nE aí!"})
    seen = {render_template(tenant, "k") for _ in range(60)}
    assert seen == {"Olá!", "Oi, tudo bem?", "E aí!"}


def test_variants_with_crlf_and_surrounding_spaces_still_split():
    tenant = _tenant({"k": "Primeira\r\n ===  \r\nSegunda"})
    seen = {render_template(tenant, "k") for _ in range(40)}
    assert seen == {"Primeira", "Segunda"}


def test_variant_formatting_applies_kwargs_to_chosen_variant():
    tenant = _tenant({"k": "Endereço {addr} aprovado\n===\nOk, {addr} confirmado"})
    for _ in range(20):
        result = render_template(tenant, "k", addr="Rua X")
        assert "Rua X" in result


def test_missing_template_returns_none():
    tenant = _tenant({})
    assert render_template(tenant, "k") is None
