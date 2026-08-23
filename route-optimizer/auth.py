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
