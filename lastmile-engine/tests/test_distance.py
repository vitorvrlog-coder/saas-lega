from app.geo.distance import haversine_km


def test_same_point_is_zero():
    assert haversine_km(-23.561, -46.656, -23.561, -46.656) == 0.0


def test_known_short_distance():
    # ~1.5km norte-sul na mesma longitude
    d = haversine_km(-23.561, -46.656, -23.575, -46.656)
    assert 1.0 < d < 2.0


def test_known_long_distance_sp_rj():
    d = haversine_km(-23.561, -46.656, -22.906, -43.172)
    assert 350 < d < 400
