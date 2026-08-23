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


def test_share_makes_location_visible_to_recipient(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    loc_id = resp.get_json()["id"]
    share_resp = client.post(f"/api/locations/{loc_id}/share", json={"email": "b@company.com"})
    assert share_resp.status_code == 200
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    resp = client.get("/api/locations")
    ids = [l["id"] for l in resp.get_json()["locations"]]
    assert loc_id in ids


def test_non_owner_cannot_share(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    loc_id = resp.get_json()["id"]
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    share_resp = client.post(f"/api/locations/{loc_id}/share", json={"email": "c@company.com"})
    assert share_resp.status_code == 403
    client.post("/auth/logout")

    # 공유가 실제로 생성되지 않았는지 확인: c@company.com은 여전히 볼 수 없어야 한다
    _login(client, "c@company.com", capsys)
    resp = client.get("/api/locations")
    ids = [l["id"] for l in resp.get_json()["locations"]]
    assert loc_id not in ids


def test_non_owner_cannot_unshare(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    loc_id = resp.get_json()["id"]
    share_resp = client.post(f"/api/locations/{loc_id}/share", json={"email": "c@company.com"})
    assert share_resp.status_code == 200
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    unshare_resp = client.delete(f"/api/locations/{loc_id}/share/c@company.com")
    assert unshare_resp.status_code == 403
    client.post("/auth/logout")

    # 공유가 실제로 제거되지 않았는지 확인: c@company.com은 여전히 볼 수 있어야 한다
    _login(client, "c@company.com", capsys)
    resp = client.get("/api/locations")
    ids = [l["id"] for l in resp.get_json()["locations"]]
    assert loc_id in ids


def test_non_owner_cannot_change_visibility(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "map_click",
    })
    loc_id = resp.get_json()["id"]
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    vis_resp = client.patch(f"/api/locations/{loc_id}/visibility", json={"is_public": True})
    assert vis_resp.status_code == 403
    client.post("/auth/logout")

    # is_public이 실제로 바뀌지 않았는지 확인: c@company.com(공유도 안 받은 제3자)에게는
    # 여전히 보이지 않아야 한다 (공개로 바뀌었다면 보였을 것)
    _login(client, "c@company.com", capsys)
    resp = client.get("/api/locations")
    ids = [l["id"] for l in resp.get_json()["locations"]]
    assert loc_id not in ids


def test_set_public_visibility(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "본사", "address": "서울", "lat": 37.5, "lng": 127.0, "source": "geocode",
    })
    loc_id = resp.get_json()["id"]
    vis_resp = client.patch(f"/api/locations/{loc_id}/visibility", json={"is_public": True})
    assert vis_resp.status_code == 200
    client.post("/auth/logout")

    _login(client, "c@company.com", capsys)
    resp = client.get("/api/locations")
    ids = [l["id"] for l in resp.get_json()["locations"]]
    assert loc_id in ids


def test_create_location_rejects_non_numeric_lat_lng(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.post("/api/locations", json={
        "name": "우리집", "address": "서울", "lat": "abc", "lng": "def", "source": "map_click",
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_geocode_returns_503_without_key(client, capsys, monkeypatch):
    import geocode
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "")
    _login(client, "a@company.com", capsys)
    resp = client.get("/api/geocode?q=전주역")
    assert resp.status_code == 503
