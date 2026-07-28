from app.integrations.evolution_api.phone import normalize_br_phone


def test_adds_country_code_when_missing():
    assert normalize_br_phone("47999244786") == "5547999244786"


def test_keeps_country_code_when_already_present():
    assert normalize_br_phone("5547999244786") == "5547999244786"


def test_strips_formatting_characters():
    assert normalize_br_phone("(47) 99924-4786") == "5547999244786"


def test_handles_landline_length():
    assert normalize_br_phone("1140028922") == "551140028922"
