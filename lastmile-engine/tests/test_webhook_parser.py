from app.db.models.enums import MessageContentType
from app.integrations.evolution_api.webhook_parser import parse_inbound_webhook
from app.schemas.evolution_webhook import EvolutionWebhookPayload


def _payload(**data_overrides):
    raw = {
        "event": "Message",
        "instanceName": "inst1",
        "data": {
            "Info": {"Sender": "5511999999999@s.whatsapp.net", "IsFromMe": False, "ID": "MSG-1"},
            "Message": {"conversation": "cliente ausente"},
        },
    }
    raw["data"].update(data_overrides)
    return raw


def test_parses_text_message():
    raw = _payload()
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)

    assert parsed is not None
    assert parsed.phone == "5511999999999"
    assert parsed.content_type == MessageContentType.TEXT
    assert parsed.content_text == "cliente ausente"
    assert parsed.external_message_id == "MSG-1"


def test_ignores_message_from_me():
    raw = _payload(Info={"Sender": "x@s.whatsapp.net", "IsFromMe": True})
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)
    assert parsed is None


def test_ignores_non_message_event():
    raw = {"event": "Connection", "instanceName": "inst1"}
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)
    assert parsed is None


def test_parses_button_response():
    raw = _payload(
        Message={
            "buttonsResponseMessage": {
                "selectedButtonID": "btn_1",
                "selectedDisplayText": "Ausente",
            }
        }
    )
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)

    assert parsed.content_type == MessageContentType.BUTTON
    assert parsed.content_text == "Ausente"


def test_parses_audio_message_without_transcription():
    raw = _payload(
        Message={"audioMessage": {"URL": "https://example.com/audio.ogg", "mimetype": "audio/ogg"}}
    )
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)

    assert parsed.content_type == MessageContentType.AUDIO
    assert parsed.content_text is None
    assert parsed.audio_url == "https://example.com/audio.ogg"


def test_parses_button_response_falls_back_to_id_without_display_text():
    raw = _payload(Message={"buttonsResponseMessage": {"selectedButtonID": "btn_absent"}})
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)

    assert parsed.content_type == MessageContentType.BUTTON
    assert parsed.content_text == "btn_absent"


def test_missing_external_message_id_is_none():
    raw = _payload(Info={"Sender": "5511999999999@s.whatsapp.net", "IsFromMe": False})
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)
    assert parsed.external_message_id is None


def test_ignores_sender_in_lid_format():
    raw = _payload(Info={"Sender": "239414395584641@lid", "IsFromMe": False})
    parsed = parse_inbound_webhook(EvolutionWebhookPayload.model_validate(raw), raw)
    assert parsed is None
