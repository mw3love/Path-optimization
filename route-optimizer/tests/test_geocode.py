import pytest
import geocode


class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_is_configured_false_without_key(monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "")
    assert geocode.is_configured() is False


def test_search_raises_without_key(monkeypatch):
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "")
    with pytest.raises(RuntimeError):
        geocode.search("전주역")


def test_search_parses_kakao_response(monkeypatch):
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "fake-key")

    def fake_get(url, params=None, headers=None, timeout=None):
        return _FakeResponse({
            "documents": [
                {
                    "place_name": "전주역",
                    "road_address_name": "전북 전주시 덕진구 동부대로 680",
                    "address_name": "전북 전주시 덕진구 우아동3가",
                    "x": "127.148",
                    "y": "35.824",
                }
            ]
        })

    monkeypatch.setattr(geocode.requests, "get", fake_get)
    results = geocode.search("전주역")
    assert results == [{
        "name": "전주역",
        "address": "전북 전주시 덕진구 동부대로 680",
        "lat": 35.824,
        "lng": 127.148,
    }]
