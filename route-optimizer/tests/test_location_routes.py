import tempfile
from pathlib import Path

import pytest


def _login(client, email, capsys):
    client.post("/auth/request-link", json={"email": email})
    token = capsys.readouterr().out.split("token=")[1].strip().split()[0]
    client.get(f"/auth/verify?token={token}")


@pytest.fixture
def client(monkeypatch):
    tmp = tempfile.TemporaryDirectory()
    db_path = Path(tmp.name) / "test.db"
    monkeypatch.delenv("ALLOWED_EMAIL_DOMAIN", raising=False)

    import importlib
    import db as db_module
    importlib.reload(db_module)
    db_module.DB_PATH = db_path
    db_module.init_db(db_path)

    import app as app_module
    importlib.reload(app_module)
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c
    tmp.cleanup()


def test_create_and_list_own_location(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    assert resp.status_code == 201
    loc_id = resp.get_json()["id"]

    resp = client.get("/api/locations")
    ids = [l["id"] for l in resp.get_json()["locations"]]
    assert loc_id in ids


def test_other_user_does_not_see_private_location(client, capsys):
    _login(client, "a@company.com", capsys)
    client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    resp = client.get("/api/locations")
    assert resp.get_json()["locations"] == []


def test_create_location_rejects_non_numeric_lat_lng(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": "abc", "lng": "def", "source": "map_click",
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_geocode_falls_back_to_nominatim_without_kakao_key(client, capsys, monkeypatch):
    import geocode

    class _FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return [{
                "name": "Tour Eiffel",
                "display_name": "Tour Eiffel, Paris, France",
                "lat": "48.8584",
                "lon": "2.2945",
            }]

    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "")
    monkeypatch.setattr(geocode.requests, "get", lambda *a, **kw: _FakeResponse())
    _login(client, "a@company.com", capsys)
    resp = client.get("/api/geocode?q=eiffel")
    assert resp.status_code == 200
    assert resp.get_json()["results"][0]["name"] == "Tour Eiffel"


def test_create_location_accepts_paste_source(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "위도 37.5, 경도 127.0", "address": "", "lat": 37.5, "lng": 127.0, "source": "paste",
    })
    assert resp.status_code == 201


def test_owner_can_rename_location(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "위도 37.5, 경도 127.0", "address": "", "lat": 37.5, "lng": 127.0, "source": "paste",
    })
    loc_id = resp.get_json()["id"]
    rename_resp = client.patch(f"/api/locations/{loc_id}/name", json={"name": "우리 지사"})
    assert rename_resp.status_code == 200

    list_resp = client.get("/api/locations")
    names = {l["id"]: l["name"] for l in list_resp.get_json()["locations"]}
    assert names[loc_id] == "우리 지사"


def test_non_owner_cannot_rename_location(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    loc_id = resp.get_json()["id"]
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    rename_resp = client.patch(f"/api/locations/{loc_id}/name", json={"name": "가로채기"})
    assert rename_resp.status_code == 403


def test_rename_rejects_empty_name(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "위도 37.5, 경도 127.0", "address": "", "lat": 37.5, "lng": 127.0, "source": "paste",
    })
    loc_id = resp.get_json()["id"]
    rename_resp = client.patch(f"/api/locations/{loc_id}/name", json={"name": "  "})
    assert rename_resp.status_code == 400
