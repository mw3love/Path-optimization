# 사내 경로 최적화 — 장소 공유 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사내 이메일 로그인 기반으로, 사용자가 웹에서 장소를 빠르게 추가하고 기본 비공개 → 선택적 공유(이메일 지정) → 전체 공개 3단계로 노출 범위를 조절할 수 있게 한다. 기존 OR-Tools/OSRM 경로 최적화 엔진은 그대로 두고 지점 소스만 정적 파일에서 DB로 바꾼다.

**Architecture:** Flask + SQLite(`route-optimizer/app.db`, 표준 라이브러리 `sqlite3`). 인증은 사내 이메일 매직링크(1회용 토큰, 세션 쿠키). 지오코딩은 카카오 로컬 API를 서버가 프록시. 프론트는 기존 Bootstrap5+Leaflet+Vanilla JS 구조를 유지하되, 지점 데이터를 페이지 로드 시 인라인 주입 대신 로그인 후 `/api/locations`에서 fetch하는 방식으로 바꾼다.

**Tech Stack:** Flask, sqlite3(stdlib), requests(카카오 API 호출), pytest(신규 도입 — 이 저장소에 테스트가 전혀 없었음, 접근 제어 로직은 회귀 테스트가 필요해 이번에 추가).

**Spec:** `docs/superpowers/specs/2026-08-23-location-sharing-design.md`

## Global Constraints

- `locations.json` 기반 기존 KBS 75개 지점은 폐기한다 — 새 구조로 마이그레이션하지 않는다(스펙 결정 사항).
- 조직도/부서 연동 없음 — 공유는 이메일 주소 직접 지정만(스펙 범위 밖 항목).
- 인증은 매직링크만 — SSO(Google/MS365)는 이번 범위 밖.
- 이메일 실제 발송 수단은 미정 — `send_magic_link(email, link)` 함수 하나로 추상화하고, 로컬/개발 환경에서는 콘솔 로그 출력으로 동작해야 한다(스펙의 "결정 보류" 항목).
- 카카오 API 키(`KAKAO_REST_API_KEY`)가 없어도 앱은 죽지 않아야 한다 — 지오코딩만 비활성화되고 GPS·지도클릭 추가는 계속 동작해야 한다.
- 백엔드(Python) 로직은 pytest로 TDD. 프론트(JS)는 이 저장소에 JS 테스트 도구가 전혀 없고 기존 관례가 수동 브라우저 검증이므로(`CLAUDE.md`), 프론트 작업은 각 태스크 끝에 구체적인 수동 검증 절차를 명시하는 것으로 대체한다.
- 모든 Python 변경 후 `python -m py_compile route-optimizer/app.py`(및 새로 만든 모듈)가 통과해야 한다.
- 각 Task에서 `app.py`의 "현재 N번째 줄" 표기는 **그 Task 시작 시점까지의 이전 Task들이 이미 반영된 상태** 기준이다(순서대로 실행한다는 전제). 어차피 편집은 줄 번호가 아니라 제시된 정확한 코드 블록(old_string)을 찾아 교체하는 방식이므로, 줄 번호가 몇 줄 어긋나 있어도 실제 코드 내용으로 위치를 확인할 것.

---

### Task 1: `requirements.txt`에 pytest 추가

**Files:**
- Modify: `route-optimizer/requirements.txt`

**Interfaces:**
- Consumes: 없음
- Produces: `pytest` 커맨드 사용 가능 — Task 2부터 모든 Python 테스트가 이를 전제로 한다.

- [ ] **Step 1: requirements.txt에 pytest 추가**

`route-optimizer/requirements.txt` (파일 끝에 추가):

```
flask>=2.3
ortools>=9.7
requests>=2.28
openpyxl>=3.1
cryptography>=3.0
gunicorn>=21.0
pytest>=7.4
```

- [ ] **Step 2: 설치 확인**

Run: `pip install -r route-optimizer/requirements.txt`
Expected: `pytest`가 설치됨 (`pytest --version` 정상 출력)

- [ ] **Step 3: 커밋**

```bash
git add route-optimizer/requirements.txt
git commit -m "chore: 테스트를 위해 pytest 의존성 추가"
```

---

### Task 2: DB 스키마 + 연결 헬퍼

**Files:**
- Create: `route-optimizer/db.py`
- Test: `route-optimizer/tests/test_db.py`

**Interfaces:**
- Consumes: 없음(최초 모듈)
- Produces: `get_connection(db_path=None) -> sqlite3.Connection`, `init_db(db_path=None) -> None`, `DB_PATH: Path`. 이후 모든 태스크가 `get_connection()`으로 DB에 접근한다. 행은 `sqlite3.Row`(딕셔너리처럼 `row["col"]` 접근 가능)로 반환된다.

- [ ] **Step 1: 테스트 디렉터리 생성 및 실패하는 테스트 작성**

`route-optimizer/tests/__init__.py` (빈 파일) 생성 후 `route-optimizer/tests/test_db.py`:

```python
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
        assert {"users", "locations", "location_shares", "auth_tokens"} <= tables


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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'db'`

- [ ] **Step 3: `db.py` 구현**

```python
"""
db.py — SQLite 연결 관리 + 스키마 초기화.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    address TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    source TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location_shares (
    location_id INTEGER NOT NULL REFERENCES locations(id),
    shared_with_email TEXT NOT NULL,
    PRIMARY KEY (location_id, shared_with_email)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
"""


def get_connection(db_path=None) -> sqlite3.Connection:
    path = db_path or DB_PATH
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path=None) -> None:
    conn = get_connection(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"[DB] 초기화 완료 -> {DB_PATH}")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/test_db.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/db.py`

```bash
git add route-optimizer/db.py route-optimizer/tests/__init__.py route-optimizer/tests/test_db.py
git commit -m "feat: SQLite 스키마 및 연결 헬퍼 추가"
```

---

### Task 3: 매직링크 토큰 발급/검증

**Files:**
- Create: `route-optimizer/auth.py`
- Test: `route-optimizer/tests/test_auth.py`

**Interfaces:**
- Consumes: `db.get_connection`, `db.init_db` (Task 2)
- Produces: `is_allowed_email(email:str)->bool`, `create_token(db, email:str)->str`, `verify_token(db, token:str)->str|None`, `send_magic_link(email:str, link:str)->None`, `get_or_create_user(db, email:str)->int`. Task 6(Flask 라우트)이 이 함수들을 그대로 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`route-optimizer/tests/test_auth.py`:

```python
import os
import tempfile
from datetime import datetime, timedelta
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
    expired = (datetime.utcnow() - timedelta(minutes=1)).isoformat()
    db.execute("UPDATE auth_tokens SET expires_at = ? WHERE token = ?", (expired, token))
    db.commit()
    assert verify_token(db, token) is None


def test_get_or_create_user_is_idempotent(db):
    uid1 = get_or_create_user(db, "user@company.com")
    uid2 = get_or_create_user(db, "user@company.com")
    assert uid1 == uid2
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'auth'`

- [ ] **Step 3: `auth.py` 구현**

```python
"""
auth.py — 매직링크 토큰 발급/검증 + 세션 헬퍼.
이메일 실제 발송 수단은 미정(스펙 참조) — send_magic_link()만 나중에 교체하면 된다.
"""
import os
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import session, redirect, url_for, request, jsonify

TOKEN_TTL_MINUTES = 15


def is_allowed_email(email: str) -> bool:
    domain = os.environ.get("ALLOWED_EMAIL_DOMAIN", "").strip()
    if not domain:
        return True  # 로컬 테스트: 도메인 제한 없음
    return email.lower().endswith("@" + domain.lower())


def create_token(db, email: str) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.utcnow() + timedelta(minutes=TOKEN_TTL_MINUTES)).isoformat()
    db.execute(
        "INSERT INTO auth_tokens (token, email, expires_at, used) VALUES (?, ?, ?, 0)",
        (token, email, expires_at),
    )
    db.commit()
    return token


def verify_token(db, token: str):
    row = db.execute(
        "SELECT email, expires_at, used FROM auth_tokens WHERE token = ?", (token,)
    ).fetchone()
    if not row or row["used"]:
        return None
    if datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
        return None
    db.execute("UPDATE auth_tokens SET used = 1 WHERE token = ?", (token,))
    db.commit()
    return row["email"]


def send_magic_link(email: str, link: str) -> None:
    """개발 모드: 콘솔에 링크 출력. 이메일 발송 수단 확정 후 이 함수만 교체."""
    print(f"[AUTH] {email} 로그인 링크: {link}")


def get_or_create_user(db, email: str) -> int:
    row = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if row:
        return row["id"]
    cur = db.execute("INSERT INTO users (email) VALUES (?)", (email,))
    db.commit()
    return cur.lastrowid


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_email" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "로그인이 필요합니다"}), 401
            return redirect(url_for("login_page"))
        return view(*args, **kwargs)
    return wrapped
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/test_auth.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/auth.py`

```bash
git add route-optimizer/auth.py route-optimizer/tests/test_auth.py
git commit -m "feat: 매직링크 토큰 발급/검증 로직 추가"
```

---

### Task 4: 지점 CRUD + 가시성 규칙

**Files:**
- Create: `route-optimizer/locations_repo.py` (`locations.py`는 기존 `templates`가 아닌 프론트 쪽과 이름이 겹치지 않도록 `_repo` 접미사)
- Test: `route-optimizer/tests/test_locations_repo.py`

**Interfaces:**
- Consumes: `db.get_connection`, `db.init_db` (Task 2)
- Produces: `create_location(db, owner_user_id, name, address, lat, lng, source) -> int`, `list_visible_locations(db, user_id, user_email) -> list[dict]`, `get_location(db, location_id) -> dict|None`, `is_owner(db, location_id, user_id) -> bool`, `add_share(db, location_id, email)`, `remove_share(db, location_id, email)`, `set_public(db, location_id, is_public: bool)`, `list_shares(db, location_id) -> list[str]`. Task 7(Flask 라우트)이 이 함수들을 그대로 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성 — 스펙의 가시성 시나리오 그대로**

`route-optimizer/tests/test_locations_repo.py`:

```python
import tempfile
from pathlib import Path

import pytest

from db import init_db, get_connection
from auth import get_or_create_user
import locations_repo as repo


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_connection(db_path)
        yield conn
        conn.close()


def test_owner_sees_own_private_location(db):
    a = get_or_create_user(db, "a@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    visible = repo.list_visible_locations(db, a, "a@company.com")
    assert any(l["id"] == loc_id for l in visible)


def test_other_user_cannot_see_private_location(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    visible = repo.list_visible_locations(db, b, "b@company.com")
    assert not any(l["id"] == loc_id for l in visible)


def test_shared_location_visible_to_recipient(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    repo.add_share(db, loc_id, "b@company.com")
    visible = repo.list_visible_locations(db, b, "b@company.com")
    assert any(l["id"] == loc_id for l in visible)


def test_public_location_visible_to_everyone(db):
    a = get_or_create_user(db, "a@company.com")
    c = get_or_create_user(db, "c@company.com")
    loc_id = repo.create_location(db, a, "본사", "서울", 37.5, 127.0, "geocode")
    repo.set_public(db, loc_id, True)
    visible = repo.list_visible_locations(db, c, "c@company.com")
    assert any(l["id"] == loc_id for l in visible)


def test_is_owner(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    assert repo.is_owner(db, loc_id, a) is True
    assert repo.is_owner(db, loc_id, b) is False


def test_remove_share_revokes_visibility(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    repo.add_share(db, loc_id, "b@company.com")
    repo.remove_share(db, loc_id, "b@company.com")
    visible = repo.list_visible_locations(db, b, "b@company.com")
    assert not any(l["id"] == loc_id for l in visible)


def test_list_shares(db):
    a = get_or_create_user(db, "a@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    repo.add_share(db, loc_id, "b@company.com")
    repo.add_share(db, loc_id, "c@company.com")
    assert set(repo.list_shares(db, loc_id)) == {"b@company.com", "c@company.com"}
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_locations_repo.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'locations_repo'`

- [ ] **Step 3: `locations_repo.py` 구현**

```python
"""
locations_repo.py — 지점 CRUD + 가시성(visibility) 규칙.
가시성: 소유자 본인 OR is_public=1 OR shared_with_email에 내 이메일 존재.
"""


def create_location(db, owner_user_id, name, address, lat, lng, source) -> int:
    cur = db.execute(
        "INSERT INTO locations (owner_user_id, name, address, lat, lng, source) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (owner_user_id, name, address, lat, lng, source),
    )
    db.commit()
    return cur.lastrowid


def list_visible_locations(db, user_id, user_email) -> list:
    rows = db.execute(
        """
        SELECT DISTINCT l.* FROM locations l
        LEFT JOIN location_shares s ON s.location_id = l.id
        WHERE l.owner_user_id = ?
           OR l.is_public = 1
           OR s.shared_with_email = ?
        ORDER BY l.created_at DESC
        """,
        (user_id, user_email),
    ).fetchall()
    return [dict(r) for r in rows]


def get_location(db, location_id):
    row = db.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
    return dict(row) if row else None


def is_owner(db, location_id, user_id) -> bool:
    row = db.execute(
        "SELECT 1 FROM locations WHERE id = ? AND owner_user_id = ?",
        (location_id, user_id),
    ).fetchone()
    return row is not None


def add_share(db, location_id, email) -> None:
    db.execute(
        "INSERT OR IGNORE INTO location_shares (location_id, shared_with_email) VALUES (?, ?)",
        (location_id, email),
    )
    db.commit()


def remove_share(db, location_id, email) -> None:
    db.execute(
        "DELETE FROM location_shares WHERE location_id = ? AND shared_with_email = ?",
        (location_id, email),
    )
    db.commit()


def set_public(db, location_id, is_public: bool) -> None:
    db.execute(
        "UPDATE locations SET is_public = ? WHERE id = ?",
        (1 if is_public else 0, location_id),
    )
    db.commit()


def list_shares(db, location_id) -> list:
    rows = db.execute(
        "SELECT shared_with_email FROM location_shares WHERE location_id = ?",
        (location_id,),
    ).fetchall()
    return [r["shared_with_email"] for r in rows]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/test_locations_repo.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/locations_repo.py`

```bash
git add route-optimizer/locations_repo.py route-optimizer/tests/test_locations_repo.py
git commit -m "feat: 지점 CRUD 및 공유 가시성 규칙 추가"
```

---

### Task 5: 카카오 지오코딩 프록시 모듈

**Files:**
- Create: `route-optimizer/geocode.py`
- Test: `route-optimizer/tests/test_geocode.py`

**Interfaces:**
- Consumes: `requests`(기존 의존성), 환경변수 `KAKAO_REST_API_KEY`
- Produces: `search(query: str) -> list[dict]` (각 dict: `{name, address, lat, lng}`), `is_configured() -> bool`. Task 7(Flask `/api/geocode` 라우트)이 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성 (requests.get을 monkeypatch로 대체 — 실제 API 호출 없음)**

`route-optimizer/tests/test_geocode.py`:

```python
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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_geocode.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'geocode'`

- [ ] **Step 3: `geocode.py` 구현**

```python
"""
geocode.py — 카카오 로컬 API 프록시 (키워드 검색).
KAKAO_REST_API_KEY 미설정 시 is_configured()가 False를 반환하고,
search()는 RuntimeError를 던진다 — 호출부(Flask 라우트)가 503으로 변환한다.
"""
import os
import requests

KAKAO_API_KEY = os.environ.get("KAKAO_REST_API_KEY", "")
KAKAO_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
TIMEOUT = 5


def is_configured() -> bool:
    return bool(KAKAO_API_KEY)


def search(query: str) -> list:
    if not KAKAO_API_KEY:
        raise RuntimeError("KAKAO_REST_API_KEY 미설정")

    resp = requests.get(
        KAKAO_SEARCH_URL,
        params={"query": query, "size": 8},
        headers={"Authorization": f"KakaoAK {KAKAO_API_KEY}"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    return [
        {
            "name": doc["place_name"],
            "address": doc.get("road_address_name") or doc.get("address_name", ""),
            "lat": float(doc["y"]),
            "lng": float(doc["x"]),
        }
        for doc in data.get("documents", [])
    ]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/test_geocode.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/geocode.py`

```bash
git add route-optimizer/geocode.py route-optimizer/tests/test_geocode.py
git commit -m "feat: 카카오 로컬 API 지오코딩 프록시 모듈 추가"
```

---

### Task 6: Flask 인증 라우트 (`/auth/request-link`, `/auth/verify`, `/auth/logout`)

**Files:**
- Modify: `route-optimizer/app.py`
- Test: `route-optimizer/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: `auth.is_allowed_email`, `auth.create_token`, `auth.verify_token`, `auth.send_magic_link`, `auth.get_or_create_user`, `auth.login_required` (Task 3), `db.get_connection` (Task 2)
- Produces: Flask 라우트 `POST /auth/request-link`, `GET /auth/verify`, `POST /auth/logout`, `GET /login` (엔드포인트 이름 `login_page`), `GET /api/session`. 세션에 `user_email`, `user_id` 저장 — 이후 모든 태스크가 `session["user_email"]`/`session["user_id"]`를 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`route-optimizer/tests/test_auth_routes.py`:

```python
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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_auth_routes.py -v`
Expected: FAIL — 라우트가 없어 404, 또는 `/api/locations`가 아직 없어 오류

- [ ] **Step 3: `app.py` 수정**

`app.py` 상단 import 블록(`from optimizer import solve, assign_days` 다음 줄)에 추가:

```python
from db import get_connection, init_db
import auth
import locations_repo as locrepo
```

`app.py`의 `app = Flask(__name__)` 직후(현재 25번째 줄 부근, `no_cache_static` 데코레이터 앞)에 삽입:

```python
app.secret_key = os.environ.get("SECRET_KEY", "dev-insecure-key-change-me")
if app.secret_key == "dev-insecure-key-change-me":
    print("[WARN] SECRET_KEY 환경변수가 설정되지 않아 개발용 기본값을 사용합니다. 운영 배포 전 반드시 설정하세요.")

init_db()


@app.before_request
def _open_db():
    from flask import g
    g.db = get_connection()


@app.teardown_appcontext
def _close_db(exception=None):
    from flask import g
    db = g.pop("db", None)
    if db is not None:
        db.close()
```

`app.py` 맨 아래, `# ── 관리 페이지 헬퍼 ──` 섹션(현재 662번째 줄) 바로 앞에 새 섹션 삽입:

```python
# ── 인증 라우트 ──────────────────────────────────────────────────────────────────

@app.route("/login")
def login_page():
    return render_template("login.html")


@app.route("/auth/request-link", methods=["POST"])
def auth_request_link():
    from flask import g
    body = request.get_json(force=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "올바른 이메일을 입력하세요"}), 400

    # 이메일 열거 공격 방지: 허용 도메인이 아니어도 응답은 성공 시와 동일하게 유지한다
    # (스펙의 에러 처리 항목 — 발급 여부로 사내 이메일 존재 여부를 노출하지 않기 위함).
    if auth.is_allowed_email(email):
        token = auth.create_token(g.db, email)
        link = f"{request.url_root.rstrip('/')}/auth/verify?token={token}"
        auth.send_magic_link(email, link)

    return jsonify({"ok": True})


@app.route("/auth/verify")
def auth_verify():
    from flask import g
    token = request.args.get("token", "")
    email = auth.verify_token(g.db, token)
    if not email:
        return "링크가 만료되었거나 이미 사용되었습니다. 다시 로그인해주세요.", 400

    user_id = auth.get_or_create_user(g.db, email)
    session["user_email"] = email
    session["user_id"] = user_id
    return redirect(url_for("index"))


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/session")
def api_session():
    return jsonify({
        "email": session.get("user_email"),
        "user_id": session.get("user_id"),
    })
```

`app.py` 상단 import 줄 `from flask import Flask, jsonify, render_template, render_template_string, request, Response`를 아래로 교체:

```python
from flask import (
    Flask, jsonify, render_template, render_template_string,
    request, Response, session, redirect, url_for,
)
```

- [ ] **Step 4: `templates/login.html` 생성 (최소 동작 버전)**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>로그인 — 경로 최적화</title>
  <link rel="stylesheet" href="/static/vendor/bootstrap.min.css" />
</head>
<body class="d-flex align-items-center justify-content-center vh-100 bg-light">
  <div class="card shadow-sm" style="width: 320px;">
    <div class="card-body">
      <h5 class="card-title mb-3">사내 이메일로 로그인</h5>
      <input type="email" id="email-input" class="form-control mb-2" placeholder="you@company.com" />
      <button id="btn-request" class="btn btn-primary w-100">로그인 링크 받기</button>
      <div id="msg" class="small text-muted mt-2"></div>
    </div>
  </div>
  <script>
    document.getElementById("btn-request").addEventListener("click", async () => {
      const email = document.getElementById("email-input").value.trim();
      const msg = document.getElementById("msg");
      msg.textContent = "전송 중...";
      const resp = await fetch("/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      msg.textContent = resp.ok
        ? "로그인 링크를 발송했습니다. (개발 모드: 서버 콘솔 로그 확인)"
        : (data.error || "오류가 발생했습니다");
    });
  </script>
</body>
</html>
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/test_auth_routes.py -v`
Expected: 6개 중 5개 PASS, `test_protected_api_requires_login` 1개만 FAIL — 이 테스트는 Task 7에서 `/api/locations`를 만든 뒤에야 통과한다(현재는 그 라우트 자체가 없어 404가 나옴). 지금 단계에서는 이 한 건만 실패하는 게 정상이며, 나머지 5건(도메인 제한 없음/있음, 토큰 발급-검증, 재사용 거부, 도메인 외 이메일 응답 동일성 등)은 전부 통과해야 한다.

- [ ] **Step 6: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/app.py`

```bash
git add route-optimizer/app.py route-optimizer/templates/login.html route-optimizer/tests/test_auth_routes.py
git commit -m "feat: 매직링크 로그인 라우트 및 세션 처리 추가"
```

---

### Task 7: `/api/locations` CRUD + 공유 라우트, `/api/geocode` 라우트

**Files:**
- Modify: `route-optimizer/app.py`
- Test: `route-optimizer/tests/test_location_routes.py`

**Interfaces:**
- Consumes: `locations_repo.*` (Task 4), `geocode.*` (Task 5), `auth.login_required` (Task 3), Flask `session`
- Produces: `GET /api/locations`, `POST /api/locations`, `POST /api/locations/<id>/share`, `DELETE /api/locations/<id>/share/<email>`, `PATCH /api/locations/<id>/visibility`, `GET /api/geocode?q=`. 프론트(Task 10, 11)가 이 엔드포인트를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성 (인증 흐름은 test_auth_routes.py의 fixture 패턴 재사용)**

`route-optimizer/tests/test_location_routes.py`:

```python
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


def test_geocode_returns_503_without_key(client, capsys, monkeypatch):
    import geocode
    monkeypatch.setattr(geocode, "KAKAO_API_KEY", "")
    _login(client, "a@company.com", capsys)
    resp = client.get("/api/geocode?q=전주역")
    assert resp.status_code == 503
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_location_routes.py -v`
Expected: FAIL — 라우트 없음(404)

- [ ] **Step 3: `app.py`에 라우트 추가**

`app.py`의 `# ── 인증 라우트 ──` 섹션 바로 다음에 삽입(Task 6에서 만든 섹션 뒤):

```python
# ── 지점 라우트 ──────────────────────────────────────────────────────────────────

@app.route("/api/locations", methods=["GET"])
@auth.login_required
def api_locations_list():
    from flask import g
    rows = locrepo.list_visible_locations(g.db, session["user_id"], session["user_email"])
    return jsonify({"locations": rows})


@app.route("/api/locations", methods=["POST"])
@auth.login_required
def api_locations_create():
    from flask import g
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    lat, lng = body.get("lat"), body.get("lng")
    source = body.get("source", "map_click")
    if not name or lat is None or lng is None:
        return jsonify({"error": "name, lat, lng는 필수입니다"}), 400
    if source not in ("geocode", "gps", "map_click"):
        return jsonify({"error": f"알 수 없는 source: {source}"}), 400

    loc_id = locrepo.create_location(
        g.db, session["user_id"], name, body.get("address", ""), float(lat), float(lng), source
    )
    return jsonify({"id": loc_id}), 201


@app.route("/api/locations/<int:location_id>/share", methods=["POST"])
@auth.login_required
def api_locations_share(location_id):
    from flask import g
    if not locrepo.is_owner(g.db, location_id, session["user_id"]):
        return jsonify({"error": "본인 소유 지점만 공유할 수 있습니다"}), 403
    body = request.get_json(force=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "올바른 이메일을 입력하세요"}), 400
    locrepo.add_share(g.db, location_id, email)
    return jsonify({"ok": True})


@app.route("/api/locations/<int:location_id>/share/<string:email>", methods=["DELETE"])
@auth.login_required
def api_locations_unshare(location_id, email):
    from flask import g
    if not locrepo.is_owner(g.db, location_id, session["user_id"]):
        return jsonify({"error": "본인 소유 지점만 관리할 수 있습니다"}), 403
    locrepo.remove_share(g.db, location_id, email.strip().lower())
    return jsonify({"ok": True})


@app.route("/api/locations/<int:location_id>/visibility", methods=["PATCH"])
@auth.login_required
def api_locations_visibility(location_id):
    from flask import g
    if not locrepo.is_owner(g.db, location_id, session["user_id"]):
        return jsonify({"error": "본인 소유 지점만 관리할 수 있습니다"}), 403
    body = request.get_json(force=True) or {}
    locrepo.set_public(g.db, location_id, bool(body.get("is_public")))
    return jsonify({"ok": True})


@app.route("/api/geocode")
@auth.login_required
def api_geocode():
    import geocode
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})
    if not geocode.is_configured():
        return jsonify({"error": "주소 검색이 설정되지 않았습니다. GPS나 지도 클릭으로 추가하세요."}), 503
    try:
        results = geocode.search(q)
    except Exception as e:
        return jsonify({"error": f"검색 실패: {e}"}), 502
    return jsonify({"results": results})
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/test_location_routes.py tests/test_auth_routes.py -v`
Expected: PASS (전체 — `test_protected_api_requires_login`도 이제 통과)

- [ ] **Step 5: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/app.py`

```bash
git add route-optimizer/app.py route-optimizer/tests/test_location_routes.py
git commit -m "feat: 지점 CRUD/공유/지오코딩 API 라우트 추가"
```

---

### Task 8: `/`, `/api/optimize*` 를 DB 기반으로 전환하고 정적 `locations.json` 경로 제거

**Files:**
- Modify: `route-optimizer/app.py`
- Delete: `route-optimizer/locations.json`, `route-optimizer/data_source.json`, `route-optimizer/prefetch.py`
- Test: `route-optimizer/tests/test_optimize_routes.py`

**Interfaces:**
- Consumes: `locrepo.list_visible_locations` (Task 4)
- Produces: 기존 `/api/optimize`, `/api/optimize-multiday`, `/api/estimate-days` 시그니처(요청/응답 JSON 형식)는 **변경 없음** — 내부 지점 조회만 `LOCATIONS`(정적 리스트) 대신 `locrepo.get_location(g.db, lid)` 기반으로 바뀐다. `/` 는 로그인 필요 + `locations_json` 인라인 주입 제거.

- [ ] **Step 1: 실패하는 테스트 작성**

`route-optimizer/tests/test_optimize_routes.py`:

```python
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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd route-optimizer && python -m pytest tests/test_optimize_routes.py -v`
Expected: FAIL — `/`가 아직 로그인 없이도 200을 반환하고, `locations.json` 기반이라 새로 만든 지점 id를 못 찾음

- [ ] **Step 3: `app.py` 수정 — 정적 `LOCATIONS` 로드 제거**

`app.py`의 아래 블록(현재 135~157번째 줄, `# ── 지점 데이터 로드 ──` 섹션 전체)을 삭제:

```python
# ── 지점 데이터 로드 ────────────────────────────────────────────────────────────
_BASE = Path(__file__).parent
_LOCATIONS_PATH = _BASE / "locations.json"
_DATA_SOURCE_PATH = _BASE / "data_source.json"

with open(_LOCATIONS_PATH, encoding="utf-8") as f:
    LOCATIONS: list = json.load(f)

_locations_lock = threading.Lock()

# gunicorn 등 __main__ 블록이 실행되지 않는 환경에서 첫 요청 시 prefetch 시작
_prefetch_started = False
_prefetch_start_lock = threading.Lock()

@app.before_request
def _start_prefetch_once():
    global _prefetch_started
    if not _prefetch_started:
        with _prefetch_start_lock:
            if not _prefetch_started:
                from prefetch import start_prefetch
                start_prefetch(LOCATIONS)
                _prefetch_started = True


def _reload_locations(new_list: list):
    """LOCATIONS 전역 변수를 thread-safe하게 교체 (서버 재시작 불필요)."""
    global LOCATIONS
    with _locations_lock:
        LOCATIONS = new_list
```

대신 다음으로 교체(`_BASE`는 계속 필요하므로 유지):

```python
# ── 경로 상수 ────────────────────────────────────────────────────────────────────
_BASE = Path(__file__).parent
```

- [ ] **Step 4: `index()` 라우트 수정 — 로그인 요구 + 인라인 주입 제거**

`app.py`의 `index()` 함수(현재 168~177번째 줄)를 교체:

```python
@app.route("/")
@auth.login_required
def index():
    template_path = _BASE / "templates" / "index.html"
    template_src = template_path.read_text(encoding="utf-8")
    return render_template_string(template_src)
```

- [ ] **Step 5: `optimize()`, `optimize_multiday()`, `estimate_days()` 의 지점 조회를 DB 기반으로 교체**

세 함수(`optimize`, `optimize_multiday`, `estimate_days`) 모두 본문에 `loc_map = {loc["id"]: loc for loc in LOCATIONS}`라는 **완전히 동일한 줄**이 하나씩 있다(현재 199, 392, 577번째 줄). 교체할 내용도 세 곳 모두 동일하므로 `replace_all: true`로 한 번에 교체한다.

`app.py`의 `# ── 인증 라우트 ──` 섹션 바로 앞(Task 6·7에서 추가한 섹션들보다 위, 기존 `_build_polyline` 함수 다음)에 헬퍼 추가:

```python
def _visible_loc_map(db, user_id, user_email) -> dict:
    """현재 사용자가 볼 수 있는 지점만 {str(id): dict} 형태로 반환."""
    rows = locrepo.list_visible_locations(db, user_id, user_email)
    return {str(r["id"]): r for r in rows}
```

old_string (`replace_all: true`로 세 곳 모두 교체):
```python
    loc_map = {loc["id"]: loc for loc in LOCATIONS}
```

new_string:
```python
    from flask import g
    loc_map = _visible_loc_map(g.db, session["user_id"], session["user_email"])
```

세 라우트에 `@auth.login_required`를 추가한다. `@app.route(...)` 데코레이터는 그대로 두고 바로 아래 줄에 추가(각 함수 정의부 위 데코레이터 한 줄씩, 아래 세 곳 각각 별도 편집):

```python
@app.route("/api/optimize", methods=["POST"])
@auth.login_required
def optimize():
```

```python
@app.route("/api/optimize-multiday", methods=["POST"])
@auth.login_required
def optimize_multiday():
```

```python
@app.route("/api/estimate-days", methods=["POST"])
@auth.login_required
def estimate_days():
```

- [ ] **Step 6: `admin_status()`/`admin_import()`의 `LOCATIONS`/`_reload_locations`/`_LOCATIONS_PATH`/`_DATA_SOURCE_PATH` 참조 제거**

관리 페이지(엑셀 일괄 임포트)는 스펙의 "미해결 항목"이라 이번 범위에서 완전히 새로 설계하지 않는다. 다만 삭제한 전역 변수를 참조하는 코드가 남으면 `ImportError`가 나므로, `admin_status()`와 `admin_import()`를 다음처럼 임시로 비활성화한다(410 Gone — 추후 재설계 전까지):

`app.py`의 `admin_status()`(현재 816~824번째 줄)와 `admin_import()`(현재 871~922번째 줄)를 각각 다음으로 교체:

```python
@app.route("/api/admin/status")
def admin_status():
    return jsonify({"error": "관리 페이지는 새 지점 구조에 맞춰 재설계 중입니다"}), 410
```

```python
@app.route("/api/admin/import", methods=["POST"])
def admin_import():
    return jsonify({"error": "관리 페이지는 새 지점 구조에 맞춰 재설계 중입니다"}), 410
```

(`admin_preview()`는 파일/시트 파싱만 하고 `LOCATIONS`를 건드리지 않으므로 그대로 둔다.)

- [ ] **Step 7: 파일 삭제 및 `optimizer.py`/`prefetch.py` import 정리**

```bash
git rm route-optimizer/locations.json route-optimizer/data_source.json route-optimizer/prefetch.py
```

`app.py`의 `if __name__ == "__main__":` 블록(현재 927~957번째 줄)에서 `from prefetch import start_prefetch`와 `start_prefetch(LOCATIONS)` 호출 두 줄을 제거한다.

**정리(orphan 제거):** 이 Task에서 `json`/`threading` 모듈의 유일한 사용처(정적 `LOCATIONS` 로드, `_locations_lock`, prefetch 락, `admin_status`/`admin_import`의 json 직렬화)를 모두 제거했으므로, 두 import도 이제 완전히 죽은 코드다. `app.py` 상단 import 블록에서 `import json`과 `import threading` 두 줄을 삭제한다(다른 곳에서 쓰이지 않는지 `grep -n "json\.\|threading\." route-optimizer/app.py`로 한 번 더 확인한 뒤 지울 것).

- [ ] **Step 8: 테스트 통과 확인**

Run: `cd route-optimizer && python -m pytest tests/ -v`
Expected: PASS (전체 스위트)

- [ ] **Step 9: py_compile 확인 후 커밋**

Run: `python -m py_compile route-optimizer/app.py`

```bash
git add -u route-optimizer/app.py
git add route-optimizer/tests/test_optimize_routes.py
git commit -m "refactor: 지점 소스를 정적 locations.json에서 DB로 전환"
```

---

### Task 9: 프론트 — 로그인 게이팅 + `window.LOCATIONS` 인라인 주입을 fetch로 전환

**Files:**
- Modify: `route-optimizer/templates/index.html:251-254`
- Modify: `route-optimizer/static/js/app.js:1-22, 336-359`
- Create: `route-optimizer/static/js/auth.js`

**Interfaces:**
- Consumes: `/api/session`, `/api/locations`, `/auth/logout` (Task 6, 7)
- Produces: `fetchLocations() -> Promise<Array>` (auth.js에서 export), 이후 프론트 초기화가 로그인 확인 → 지점 fetch → 지도 초기화 순서로 바뀐다. Task 10(장소 추가 UI)이 같은 초기화 흐름 위에 얹힌다.

- [ ] **Step 1: `auth.js` 생성**

`route-optimizer/static/js/auth.js`:

```javascript
/**
 * auth.js — 세션 확인 + 지점 fetch + 로그아웃.
 */
export async function fetchSession() {
  const resp = await fetch("/api/session");
  return resp.json(); // { email, user_id } — 비로그인 시 둘 다 null
}

export async function fetchLocations() {
  const resp = await fetch("/api/locations");
  if (resp.status === 401) {
    window.location.href = "/login";
    return [];
  }
  const data = await resp.json();
  return data.locations;
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}
```

- [ ] **Step 2: `templates/index.html` 수정 — 인라인 주입 제거**

`templates/index.html`의 251~254번째 줄:

```html
<!-- window.LOCATIONS 인라인 주입 -->
<script>
  window.LOCATIONS = {{ locations_json | safe }};
</script>
```

를 삭제한다(빈 줄로 남기지 않고 완전히 제거).

사이드바 헤더(24~27번째 줄, `<h6 class="mb-0 fw-bold">전파조사 경로 최적화</h6>` 다음)에 로그아웃 버튼 추가:

```html
      <button id="btn-logout" class="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" style="font-size:0.75rem;">
        로그아웃
      </button>
```

- [ ] **Step 3: `static/js/app.js` 수정 — 비동기 초기화로 전환**

`app.js` 1~12번째 줄:

```javascript
/**
 * app.js — 엔트리포인트. 모듈 임포트 및 초기화 조율.
 */
import { initMaps, setOriginMarker, setDestMarker,
         clearDestMarker, clearOriginMarker, clearResultLayers,
         onMarkerClick, invalidateMobileMapSize,
         enableBoxSelect, onBoxSelect } from "./map.js";
import { initSelection, clearSelection, selectByIds } from "./selection.js";
import { initOptimize } from "./optimize.js";
import { initMultiday } from "./multiday.js";

const LOCATIONS = window.LOCATIONS;
```

를 아래로 교체:

```javascript
/**
 * app.js — 엔트리포인트. 모듈 임포트 및 초기화 조율.
 */
import { initMaps, setOriginMarker, setDestMarker,
         clearDestMarker, clearOriginMarker, clearResultLayers,
         onMarkerClick, invalidateMobileMapSize,
         enableBoxSelect, onBoxSelect } from "./map.js";
import { initSelection, clearSelection, selectByIds } from "./selection.js";
import { initOptimize } from "./optimize.js";
import { initMultiday } from "./multiday.js";
import { fetchLocations, logout } from "./auth.js";

let LOCATIONS = [];

document.getElementById("btn-logout")?.addEventListener("click", logout);
```

`app.js` 맨 아래 초기화 블록(336~359번째 줄):

```javascript
// ── 초기화 ────────────────────────────────────────────────────────────────────
initMaps(LOCATIONS, showContextMenu);

// 지도 탭 전환 시 invalidateSize (CSS visibility 방식에서도 안전을 위해 유지)
document.getElementById("tab-map-btn")?.addEventListener("click", () => {
  setTimeout(() => invalidateMobileMapSize(), 50);
});

onMarkerClick((id) => {
  if (window._selectionModule) window._selectionModule.toggleById(id);
});

initSelection(LOCATIONS, state, { updateSelectionSummary, updateOptimizeButton });

window._optimizeModule = initOptimize(state, LOCATIONS);

const _multidayModule = initMultiday(state, LOCATIONS);
window._multidayModule = _multidayModule;

["btn-multiday", "btn-multiday-m"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", () => _multidayModule.runGrouping());
});

_autoSetCurrentLocation();
```

를 아래로 교체:

```javascript
// ── 초기화 (비동기: 지점 목록을 먼저 받아온 뒤 지도/선택/최적화 모듈을 구성) ──
async function _init() {
  LOCATIONS = await fetchLocations();

  initMaps(LOCATIONS, showContextMenu);

  document.getElementById("tab-map-btn")?.addEventListener("click", () => {
    setTimeout(() => invalidateMobileMapSize(), 50);
  });

  onMarkerClick((id) => {
    if (window._selectionModule) window._selectionModule.toggleById(id);
  });

  initSelection(LOCATIONS, state, { updateSelectionSummary, updateOptimizeButton });

  window._optimizeModule = initOptimize(state, LOCATIONS);

  const _multidayModule = initMultiday(state, LOCATIONS);
  window._multidayModule = _multidayModule;

  ["btn-multiday", "btn-multiday-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => _multidayModule.runGrouping());
  });

  _autoSetCurrentLocation();
}

_init();
```

`updateSelectionSummary()` 함수(251~278번째 줄) 안의 `LOCATIONS.filter(...)` 참조는 이제 모듈 스코프의 `let LOCATIONS`(위에서 fetch 후 재할당됨)를 그대로 읽으므로 별도 수정이 필요 없다 — `const` → `let`으로 바뀐 것만 확인.

- [ ] **Step 4: 수동 브라우저 검증**

1. `cd route-optimizer && python app.py` 실행
2. 브라우저에서 `https://localhost:5000` 접속 → `/login`으로 리다이렉트되는지 확인
3. 이메일 입력 후 "로그인 링크 받기" 클릭 → 서버 콘솔에 `[AUTH] ... 로그인 링크: https://localhost:5000/auth/verify?token=...` 출력 확인
4. 그 링크를 브라우저 주소창에 붙여넣어 접속 → `/`로 리다이렉트되고 지도가 뜨는지 확인 (아직 지점 0개라 마커는 없어도 정상)
5. 콘솔(F12)에서 에러 없는지 확인, `document.title`이 정상 렌더되는지 확인
6. "로그아웃" 클릭 → `/login`으로 돌아가는지 확인

**🖼 자체확인 예정**: 이 Step은 구현 단계에서 담당 에이전트가 헤드리스 브라우저 대신 실제 GUI 브라우저를 열어 직접 확인할 것(로컬 대화형 세션이므로 offscreen 강제 없이 실행 가능).

- [ ] **Step 5: py_compile 확인(해당 없음 — JS만 변경) 후 커밋**

```bash
git add route-optimizer/templates/index.html route-optimizer/static/js/app.js route-optimizer/static/js/auth.js
git commit -m "feat: 로그인 게이팅 및 지점 목록 비동기 fetch로 전환"
```

---

### Task 10: 프론트 — "장소 추가" UI (검색/GPS/지도클릭 3경로)

**Files:**
- Modify: `route-optimizer/templates/index.html:236-242` (컨텍스트 메뉴), 사이드바 하단에 모달 추가
- Modify: `route-optimizer/static/js/map.js` (마커 추가 export, 컨텍스트 메뉴 항목)
- Create: `route-optimizer/static/js/locations_ui.js`

**Interfaces:**
- Consumes: `POST /api/locations`, `GET /api/geocode` (Task 7)
- Produces: `addLocationMarker(loc)` export from `map.js`(전역에서 재사용 가능하도록), `initLocationsUi(state, getLocations, setLocations)` export from `locations_ui.js`

- [ ] **Step 1: `templates/index.html` 수정 — 컨텍스트 메뉴에 항목 추가 + 추가 모달**

`templates/index.html`의 236~242번째 줄:

```html
<!-- 컨텍스트 메뉴 -->
<div id="ctx-menu" class="ctx-menu d-none">
  <ul class="list-unstyled mb-0">
    <li><button id="ctx-set-origin" class="ctx-menu-item">📍 여기서 출발</button></li>
    <li><button id="ctx-set-dest" class="ctx-menu-item">🏁 여기서 종료</button></li>
  </ul>
</div>
```

를 아래로 교체:

```html
<!-- 컨텍스트 메뉴 -->
<div id="ctx-menu" class="ctx-menu d-none">
  <ul class="list-unstyled mb-0">
    <li><button id="ctx-set-origin" class="ctx-menu-item">📍 여기서 출발</button></li>
    <li><button id="ctx-set-dest" class="ctx-menu-item">🏁 여기서 종료</button></li>
    <li><button id="ctx-add-location" class="ctx-menu-item">➕ 여기에 장소 추가</button></li>
  </ul>
</div>

<!-- 장소 추가 모달 -->
<div id="add-location-modal" class="d-none add-location-modal">
  <div class="add-location-card">
    <h6 class="mb-2">장소 추가</h6>
    <input type="search" id="add-loc-search" class="form-control form-control-sm mb-1"
      placeholder="주소·장소명 검색" />
    <div id="add-loc-search-results" class="add-loc-search-results"></div>
    <input type="text" id="add-loc-name" class="form-control form-control-sm mt-2" placeholder="장소 이름" />
    <input type="text" id="add-loc-address" class="form-control form-control-sm mt-1" placeholder="주소(선택)" />
    <div class="small text-muted mt-1" id="add-loc-coord"></div>
    <div class="d-flex gap-2 mt-2">
      <button id="add-loc-save" class="btn btn-primary btn-sm flex-grow-1">저장</button>
      <button id="add-loc-cancel" class="btn btn-outline-secondary btn-sm flex-grow-1">취소</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: `static/css/style.css`에 모달 스타일 추가 (파일 끝에 추가)**

```css
.add-location-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.add-location-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  width: 320px;
  max-width: 90vw;
}
.add-loc-search-results {
  max-height: 160px;
  overflow-y: auto;
}
.add-loc-search-results .result-item {
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.85rem;
}
.add-loc-search-results .result-item:hover {
  background: #f0f0f0;
}
```

- [ ] **Step 3: `map.js`에 단일 마커 추가 export**

`map.js`의 `_addLocationMarker(loc)` 함수 정의부 바로 다음에 export 래퍼 추가:

```javascript
// 외부(다른 모듈)에서 새로 추가된 지점 마커를 즉시 그릴 때 사용
export function addLocationMarker(loc) {
  getSigunguColor(loc.sigungu || "");
  _addLocationMarker(loc);
}
```

- [ ] **Step 4: `static/js/locations_ui.js` 생성**

```javascript
/**
 * locations_ui.js — 장소 추가 모달: 검색/GPS/지도클릭 3경로 → POST /api/locations
 */
import { addLocationMarker } from "./map.js";

let _pendingLatLng = null;
let _debounceTimer = null;

function _el(id) {
  return document.getElementById(id);
}

async function _searchAddress(query) {
  const resp = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    return { error: data.error || "검색 실패" };
  }
  const data = await resp.json();
  return { results: data.results || [] };
}

function _renderSearchResults(results) {
  const box = _el("add-loc-search-results");
  box.innerHTML = "";
  results.forEach((r) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.textContent = `${r.name} — ${r.address}`;
    div.addEventListener("click", () => {
      _el("add-loc-name").value = r.name;
      _el("add-loc-address").value = r.address;
      _pendingLatLng = { lat: r.lat, lng: r.lng };
      _el("add-loc-coord").textContent = `좌표: ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
      box.innerHTML = "";
    });
    box.appendChild(div);
  });
}

function _openModal(latlng, sourceLabel) {
  _pendingLatLng = latlng;
  _el("add-loc-name").value = "";
  _el("add-loc-address").value = "";
  _el("add-loc-search").value = "";
  _el("add-loc-search-results").innerHTML = "";
  _el("add-loc-coord").textContent = latlng
    ? `좌표: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)} (${sourceLabel})`
    : "";
  _el("add-location-modal").classList.remove("d-none");
}

function _closeModal() {
  _el("add-location-modal").classList.add("d-none");
  _pendingLatLng = null;
}

export function initLocationsUi(getLocations, onLocationAdded) {
  _el("add-loc-search").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(_debounceTimer);
    if (q.length < 2) {
      _el("add-loc-search-results").innerHTML = "";
      return;
    }
    _debounceTimer = setTimeout(async () => {
      const { results, error } = await _searchAddress(q);
      if (error) {
        _el("add-loc-search-results").innerHTML = `<div class="text-muted small p-1">${error}</div>`;
        return;
      }
      _renderSearchResults(results);
    }, 300);
  });

  _el("add-loc-cancel").addEventListener("click", _closeModal);

  _el("add-loc-save").addEventListener("click", async () => {
    const name = _el("add-loc-name").value.trim();
    if (!name || !_pendingLatLng) {
      alert("장소 이름과 위치를 확인하세요.");
      return;
    }
    const resp = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: _el("add-loc-address").value.trim(),
        lat: _pendingLatLng.lat,
        lng: _pendingLatLng.lng,
        source: "map_click",
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || "저장 실패");
      return;
    }
    const { id } = await resp.json();
    const newLoc = {
      id, name, address: _el("add-loc-address").value.trim(),
      lat: _pendingLatLng.lat, lng: _pendingLatLng.lng, sigungu: "",
    };
    getLocations().push(newLoc);
    addLocationMarker(newLoc);
    onLocationAdded(newLoc);
    _closeModal();
  });

  document.getElementById("ctx-add-location")?.addEventListener("click", () => {
    if (window._pendingCtxLatLngForAdd) {
      _openModal(window._pendingCtxLatLngForAdd, "지도 클릭");
    }
  });
}

export function openAddLocationModalAt(latlng, sourceLabel) {
  _openModal(latlng, sourceLabel);
}
```

- [ ] **Step 5: `app.js`에 연결**

`app.js` 상단 import 블록에 추가:

```javascript
import { initLocationsUi, openAddLocationModalAt } from "./locations_ui.js";
```

`app.js`의 컨텍스트 메뉴 섹션(현재 39~93번째 줄)에서 `_pendingCtxLatLng` 변수를 컨텍스트 메뉴가 열릴 때 "장소 추가" 항목도 쓸 수 있게 노출한다. `showContextMenu` 함수 안(48~54번째 줄)에 한 줄 추가:

```javascript
function showContextMenu(latlng, pageX, pageY) {
  _pendingCtxLatLng = latlng;
  window._pendingCtxLatLngForAdd = latlng; // locations_ui.js에서 참조
  ctxMenu.style.left = `${pageX}px`;
  ctxMenu.style.top  = `${pageY}px`;
  ctxMenu.classList.remove("d-none");
  _ctxJustShown = true;
}
```

`_init()` 함수(Task 9에서 만든) 안, `initSelection(...)` 호출 다음 줄에 추가:

```javascript
  initLocationsUi(() => LOCATIONS, () => {
    updateSelectionSummary();
  });
```

- [ ] **Step 6: 수동 브라우저 검증**

1. 서버 실행 후 로그인
2. 지도에서 우클릭(또는 롱프레스) → "➕ 여기에 장소 추가" 클릭 → 모달이 뜨고 좌표가 채워지는지 확인
3. 이름 입력 후 "저장" → 모달이 닫히고 해당 위치에 새 마커가 즉시 표시되는지 확인
4. `KAKAO_REST_API_KEY` 환경변수 없이 검색창에 텍스트 입력 → "주소 검색이 설정되지 않았습니다..." 메시지가 뜨는지 확인(에러 없이 GPS/지도클릭 경로는 계속 동작해야 함)
5. (카카오 키가 있다면) 검색창에 주소 입력 → 자동완성 목록이 뜨고 클릭 시 이름/주소/좌표가 채워지는지 확인

**🖼 자체확인 예정**: Step 4(구현 담당 에이전트가 로컬 GUI 브라우저로 직접 확인, 카카오 키가 없는 게 기본 로컬 환경이므로 이 케이스가 최소 검증 대상).

- [ ] **Step 7: 커밋**

```bash
git add route-optimizer/templates/index.html route-optimizer/static/css/style.css route-optimizer/static/js/map.js route-optimizer/static/js/locations_ui.js route-optimizer/static/js/app.js
git commit -m "feat: 검색/GPS/지도클릭 3경로 장소 추가 UI 추가"
```

---

### Task 11: 프론트 — 공유 UI (지점 상세: 공유 대상 관리 + 전체공개 토글)

**Files:**
- Modify: `route-optimizer/static/js/selection.js` (지점 목록 항목에 "공유" 버튼 추가 지점 확인 필요 — 아래 Step 1에서 실제 구조 확인 후 진행)
- Create: `route-optimizer/static/js/sharing_ui.js`

**Interfaces:**
- Consumes: `POST /api/locations/<id>/share`, `DELETE /api/locations/<id>/share/<email>`, `PATCH /api/locations/<id>/visibility` (Task 7)
- Produces: `openShareDialog(locationId)` export — 아래 Step 1~2에서 `selection.js`의 지점 목록 클릭 핸들러에 직접 연결한다(다른 Task가 대신 호출하지 않음)

- [ ] **Step 1: `selection.js` 구조 확인**

이 Step은 코드 작성이 아니라 조사다 — `route-optimizer/static/js/selection.js`를 열어 지점 목록 항목(li/div) 렌더링 함수와 마커 클릭 핸들러 위치를 확인하고, "공유" 버튼을 어디에 넣을지(목록 항목 우측 아이콘 버튼 권장) 결정한 뒤 Step 2로 진행한다. 이 파일은 이번 계획에서 처음 읽는 파일이므로, 구현 담당 에이전트가 직접 `Read` 도구로 확인한 뒤 아래 Step들의 정확한 삽입 위치를 스스로 정한다(정확한 line 번호를 이 계획에 미리 박아두면 Task 9·10에서 이미 변경된 다른 파일들과 달리 selection.js는 손대지 않았으므로 원본 그대로일 가능성이 높지만, 확인 없이 가정하지 않는다).

- [ ] **Step 2: `sharing_ui.js` 생성**

```javascript
/**
 * sharing_ui.js — 지점 공유 대상 관리(이메일 추가/삭제) + 전체공개 토글.
 */

function _buildDialog() {
  const overlay = document.createElement("div");
  overlay.className = "add-location-modal"; // 기존 모달 스타일 재사용
  overlay.innerHTML = `
    <div class="add-location-card">
      <h6 class="mb-2">공유 설정</h6>
      <label class="form-check form-switch mb-2">
        <input class="form-check-input" type="checkbox" id="share-public-toggle" />
        <span class="form-check-label small">회사 전체 공개</span>
      </label>
      <div class="small text-muted mb-1">특정 이메일에 공유</div>
      <ul id="share-email-list" class="list-unstyled small mb-2"></ul>
      <div class="d-flex gap-1 mb-2">
        <input type="email" id="share-email-input" class="form-control form-control-sm" placeholder="email@company.com" />
        <button id="share-email-add" class="btn btn-outline-primary btn-sm">추가</button>
      </div>
      <button id="share-close" class="btn btn-secondary btn-sm w-100">닫기</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function _renderEmailList(overlay, locationId, emails) {
  const list = overlay.querySelector("#share-email-list");
  list.innerHTML = "";
  emails.forEach((email) => {
    const li = document.createElement("li");
    li.className = "d-flex justify-content-between align-items-center";
    li.innerHTML = `<span>${email}</span><button class="btn btn-link btn-sm p-0 text-danger">✕</button>`;
    li.querySelector("button").addEventListener("click", async () => {
      await fetch(`/api/locations/${locationId}/share/${encodeURIComponent(email)}`, { method: "DELETE" });
      li.remove();
    });
    list.appendChild(li);
  });
}

export async function openShareDialog(locationId, currentIsPublic, currentShares) {
  const overlay = _buildDialog();
  overlay.querySelector("#share-public-toggle").checked = !!currentIsPublic;
  _renderEmailList(overlay, locationId, currentShares || []);

  overlay.querySelector("#share-public-toggle").addEventListener("change", async (e) => {
    await fetch(`/api/locations/${locationId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: e.target.checked }),
    });
  });

  overlay.querySelector("#share-email-add").addEventListener("click", async () => {
    const input = overlay.querySelector("#share-email-input");
    const email = input.value.trim();
    if (!email || !email.includes("@")) return;
    const resp = await fetch(`/api/locations/${locationId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (resp.ok) {
      const list = overlay.querySelector("#share-email-list");
      const emails = Array.from(list.querySelectorAll("span")).map((s) => s.textContent);
      emails.push(email);
      _renderEmailList(overlay, locationId, emails);
      input.value = "";
    }
  });

  overlay.querySelector("#share-close").addEventListener("click", () => overlay.remove());
}
```

**참고:** 이 대화상자를 여는 진입점(지점 목록의 "공유" 버튼)은 Step 1에서 확인한 `selection.js`의 실제 구조에 맞춰 구현 담당 에이전트가 연결한다 — 지점 항목 클릭 시 `openShareDialog(loc.id, loc.is_public, sharesList)`를 호출하되, `sharesList`는 이 시점엔 서버에 없으므로(현재 `/api/locations` 응답에 `shares` 필드가 없음) 다이얼로그를 열 때 먼저 빈 배열로 표시하고 실제 삭제/추가는 그대로 동작한다. 정확한 현재 공유 목록을 처음부터 보여주려면 Task 7의 `GET /api/locations` 응답에 `shares` 배열을 포함하도록 `locations_repo.list_visible_locations` 결과에 `locrepo.list_shares(db, loc["id"])`를 덧붙이는 후속 개선이 필요하다 — 이번 범위에서는 생략(YAGNI: 소유자 본인이 자기 지점 상세를 열 때만 필요한 정보라 급하지 않음).

- [ ] **Step 3: 수동 브라우저 검증**

1. 로그인 후 장소 추가(Task 10) → 목록에서 방금 추가한 지점의 "공유" 진입점 클릭
2. "회사 전체 공개" 토글 켜기 → 다른 계정(다른 이메일)으로 로그인해 지점이 보이는지 확인
3. 토글을 끄고 특정 이메일 추가 → 그 이메일로 로그인 시 보이고, 추가하지 않은 다른 이메일로는 안 보이는지 확인
4. 공유 대상 이메일 옆 ✕ 클릭 → 삭제 후 해당 계정에서 안 보이는지 확인

**🖼 자체확인 예정**: 로컬 GUI 브라우저로 직접 확인(여러 이메일로 순차 로그인해야 하므로 세션/쿠키 전환 필요 — 시크릿 창 2개 활용).

- [ ] **Step 4: 커밋**

```bash
git add route-optimizer/static/js/sharing_ui.js
git commit -m "feat: 지점 공유 대상 관리 및 전체공개 토글 UI 추가"
```

---

### Task 12: 전체 테스트 스위트 + 수동 E2E 체크리스트로 마무리

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 pytest 스위트 실행**

Run: `cd route-optimizer && python -m pytest tests/ -v`
Expected: 전체 PASS

- [ ] **Step 2: 전체 py_compile 확인**

Run: `python -m py_compile route-optimizer/app.py route-optimizer/db.py route-optimizer/auth.py route-optimizer/locations_repo.py route-optimizer/geocode.py`
Expected: 오류 없음

- [ ] **Step 3: 수동 E2E — 스펙의 테스트 계획 6개 항목 재확인**

1. 매직링크 로그인 → 세션 쿠키 확인 → `/api/locations` 200
2. 지점 추가 3경로 각각 정상 동작(검색은 카카오 키 없으면 503 메시지, GPS/지도클릭은 항상 동작)
3. 가시성 시나리오: A 비공개 추가 → B 안 보임 → A가 B에게 공유 → B 보임 → A가 전체공개 → C도 보임
4. 기존 `/api/optimize` 흐름이 DB 기반 지점으로 정상 동작(선택 → 최적화 → 타임라인)
5. 만료된 토큰으로 `/auth/verify` 시도 시 거부
6. `CLAUDE.md` 규칙대로 `python -m py_compile route-optimizer/app.py` 재확인

- [ ] **Step 4: `CLAUDE.md`/`prd.md` 갱신 필요 여부 확인**

이 구현으로 `CLAUDE.md`의 "상태 저장 모델 — DB 없음" 섹션과 `prd.md`의 "명시적으로 하지 않는 것"(로그인/회원, 지오코딩, 지점 수동 추가 UI, DB) 목록이 더 이상 사실과 맞지 않는다. `doc-sync` 스킬을 호출해 두 문서를 갱신할지 사용자에게 확인한다(`CLAUDE.md`의 사후 안전망 규칙과 별개로, 이번 작업은 push 이전에 반드시 한 번 검토가 필요한 규모다).

- [ ] **Step 5: 최종 커밋**

이전 Task들에서 이미 커밋했다면 이 Step은 생략 가능. 남은 변경사항이 있다면:

```bash
git add -A
git commit -m "docs: 장소 공유 기능 구현 완료에 따른 문서 동기화"
```
