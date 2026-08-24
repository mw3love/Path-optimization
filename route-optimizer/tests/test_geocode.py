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


def test_search_falls_back_to_nominatim_without_kakao_key(monkeypatch):
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "")

    def fake_get(url, params=None, headers=None, timeout=None):
        assert url == geocode.NOMINATIM_URL
        return _FakeResponse([
            {
                "name": "Tour Eiffel",
                "display_name": "Tour Eiffel, 5, Avenue Anatole France, Paris, France",
                "lat": "48.8584",
                "lon": "2.2945",
            }
        ])

    monkeypatch.setattr(geocode.requests, "get", fake_get)
    results = geocode.search("에펠탑")
    assert results == [{
        "name": "Tour Eiffel",
        "address": "Tour Eiffel, 5, Avenue Anatole France, Paris, France",
        "lat": 48.8584,
        "lng": 2.2945,
    }]


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


def test_search_falls_back_to_nominatim_when_kakao_empty(monkeypatch):
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "fake-key")

    def fake_get(url, params=None, headers=None, timeout=None):
        if url == geocode.KAKAO_SEARCH_URL:
            return _FakeResponse({"documents": []})
        assert url == geocode.NOMINATIM_URL
        assert "User-Agent" in headers
        return _FakeResponse([
            {
                "name": "Tour Eiffel",
                "display_name": "Tour Eiffel, 5, Avenue Anatole France, Paris, France",
                "lat": "48.8584",
                "lon": "2.2945",
            }
        ])

    monkeypatch.setattr(geocode.requests, "get", fake_get)
    results = geocode.search("에펠탑")
    assert results == [{
        "name": "Tour Eiffel",
        "address": "Tour Eiffel, 5, Avenue Anatole France, Paris, France",
        "lat": 48.8584,
        "lng": 2.2945,
    }]


def test_nominatim_falls_back_to_display_name_when_name_field_empty(monkeypatch):
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "fake-key")

    def fake_get(url, params=None, headers=None, timeout=None):
        if url == geocode.KAKAO_SEARCH_URL:
            return _FakeResponse({"documents": []})
        return _FakeResponse([
            {
                "name": "",
                "display_name": "350, 5th Avenue, New York, United States",
                "lat": "42.7096",
                "lon": "-73.7106",
            }
        ])

    monkeypatch.setattr(geocode.requests, "get", fake_get)
    results = geocode.search("350 5th avenue")
    assert results[0]["name"] == "350"


def test_search_does_not_call_nominatim_when_kakao_has_results(monkeypatch):
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "fake-key")
    nominatim_called = []

    def fake_get(url, params=None, headers=None, timeout=None):
        if url == geocode.NOMINATIM_URL:
            nominatim_called.append(True)
            return _FakeResponse([])
        return _FakeResponse({
            "documents": [{
                "place_name": "전주역",
                "road_address_name": "전북 전주시 덕진구 동부대로 680",
                "address_name": "전북 전주시 덕진구 우아동3가",
                "x": "127.148",
                "y": "35.824",
            }]
        })

    monkeypatch.setattr(geocode.requests, "get", fake_get)
    geocode.search("전주역")
    assert nominatim_called == []
