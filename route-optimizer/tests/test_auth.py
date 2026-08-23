import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from db import init_db, get_connection
from auth import (
    is_allowed_email, create_token, verify_token,
    get_or_create_user,
)


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_connection(db_path)
        yield conn
        conn.close()


def test_is_allowed_email_no_domain_restriction(monkeypatch):
    monkeypatch.delenv("ALLOWED_EMAIL_DOMAIN", raising=False)
    assert is_allowed_email("anyone@example.com") is True


def test_is_allowed_email_with_domain_restriction(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAIN", "company.com")
    assert is_allowed_email("a@company.com") is True
    assert is_allowed_email("a@other.com") is False


def test_create_and_verify_token(db):
    token = create_token(db, "user@company.com")
    email = verify_token(db, token)
    assert email == "user@company.com"


def test_verify_token_rejects_reuse(db):
    token = create_token(db, "user@company.com")
    verify_token(db, token)
    assert verify_token(db, token) is None


def test_verify_token_rejects_unknown_token(db):
    assert verify_token(db, "does-not-exist") is None


def test_verify_token_rejects_expired(db):
    token = create_token(db, "user@company.com")
    expired = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    db.execute("UPDATE auth_tokens SET expires_at = ? WHERE token = ?", (expired, token))
    db.commit()
    assert verify_token(db, token) is None


def test_get_or_create_user_is_idempotent(db):
    uid1 = get_or_create_user(db, "user@company.com")
    uid2 = get_or_create_user(db, "user@company.com")
    assert uid1 == uid2
