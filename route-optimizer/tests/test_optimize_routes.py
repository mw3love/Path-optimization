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


def test_index_redirects_when_not_logged_in(client):
    resp = client.get("/")
    assert resp.status_code == 302


def test_index_serves_without_inline_locations_when_logged_in(client, capsys):
    _login(client, "a@company.com", capsys)
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"window.LOCATIONS" not in resp.data


def test_optimize_uses_db_locations(client, capsys):
    _login(client, "a@company.com", capsys)
    ids = []
    for name, lat, lng in [("A", 35.82, 127.15), ("B", 35.83, 127.16)]:
        r = client.post("/api/locations", json={
            "name": name, "address": "", "lat": lat, "lng": lng, "source": "map_click",
        })
        ids.append(str(r.get_json()["id"]))

    resp = client.post("/api/optimize", json={
        "location_ids": ids,
        "start": {"lat": 35.82, "lng": 127.14, "label": "출발"},
        "end": None,
        "start_time": "09:00",
        "stay_minutes": 10,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert set(data["order"]) == set(ids)


def test_optimize_rejects_location_not_visible_to_user(client, capsys):
    _login(client, "a@company.com", capsys)
    r = client.post("/api/locations", json={
        "name": "A", "address": "", "lat": 35.82, "lng": 127.15, "source": "map_click",
    })
    loc_id = str(r.get_json()["id"])
    client.post("/auth/logout")

    _login(client, "b@company.com", capsys)
    resp = client.post("/api/optimize", json={
        "location_ids": [loc_id, loc_id],
        "start": {"lat": 35.82, "lng": 127.14, "label": "출발"},
        "end": None,
        "start_time": "09:00",
        "stay_minutes": 10,
    })
    assert resp.status_code == 400
