import sqlite3
import tempfile
from pathlib import Path

from db import init_db, get_connection


def test_init_db_creates_tables():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_connection(db_path)
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        conn.close()
        assert {"users", "locations", "auth_tokens"} <= tables


def test_get_connection_returns_row_factory():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_connection(db_path)
        conn.execute("INSERT INTO users (email) VALUES (?)", ("a@x.com",))
        conn.commit()
        row = conn.execute("SELECT * FROM users").fetchone()
        conn.close()
        assert row["email"] == "a@x.com"
