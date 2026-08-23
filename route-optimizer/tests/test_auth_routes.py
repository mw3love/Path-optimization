import os
import tempfile
from pathlib import Path

import pytest


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


def test_request_link_returns_ok(client, capsys):
    resp = client.post("/auth/request-link", json={"email": "a@company.com"})
    assert resp.status_code == 200
    captured = capsys.readouterr()
    assert "a@company.com" in captured.out


def test_request_link_disallowed_domain_returns_same_response_as_success(client, monkeypatch, capsys):
    """이메일 열거 공격 방지: 허용되지 않은 도메인이어도 응답은 성공 시와 동일해야 한다(스펙 명시)."""
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAIN", "company.com")
    resp = client.post("/auth/request-link", json={"email": "a@other.com"})
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}
    captured = capsys.readouterr()
    assert "a@other.com" not in captured.out  # 토큰이 실제로 발급/발송되지 않았는지 확인


def test_verify_link_logs_in_and_session_endpoint_reflects_it(client, capsys):
    client.post("/auth/request-link", json={"email": "a@company.com"})
    out = capsys.readouterr().out
    token = out.split("token=")[1].strip().split()[0]

    resp = client.get(f"/auth/verify?token={token}")
    assert resp.status_code in (302, 200)

    session_resp = client.get("/api/session")
    assert session_resp.get_json()["email"] == "a@company.com"


def test_verify_rejects_invalid_token(client):
    resp = client.get("/auth/verify?token=bogus")
    assert resp.status_code == 400


def test_logout_clears_session(client, capsys):
    client.post("/auth/request-link", json={"email": "a@company.com"})
    token = capsys.readouterr().out.split("token=")[1].strip().split()[0]
    client.get(f"/auth/verify?token={token}")
    client.post("/auth/logout")
    session_resp = client.get("/api/session")
    assert session_resp.get_json()["email"] is None


def test_protected_api_requires_login(client):
    resp = client.get("/api/locations")
    assert resp.status_code == 401
