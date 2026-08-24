"""
locations_repo.py — 지점 CRUD + 가시성(visibility) 규칙.
가시성: 소유자 본인만(완전 개인화 — 공유/전체공개 기능 없음).
"""


def create_location(db, owner_user_id, name, address, lat, lng, source, sigungu="") -> int:
    cur = db.execute(
        "INSERT INTO locations (owner_user_id, name, address, lat, lng, source, sigungu) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (owner_user_id, name, address, lat, lng, source, sigungu or ""),
    )
    db.commit()
    return cur.lastrowid


def list_visible_locations(db, user_id) -> list:
    rows = db.execute(
        "SELECT * FROM locations WHERE owner_user_id = ? ORDER BY created_at DESC",
        (user_id,),
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


def set_name(db, location_id, name: str) -> None:
    db.execute(
        "UPDATE locations SET name = ? WHERE id = ?",
        (name, location_id),
    )
    db.commit()


def delete_location(db, location_id) -> None:
    db.execute("DELETE FROM locations WHERE id = ?", (location_id,))
    db.commit()


def delete_all_locations(db, user_id) -> int:
    cur = db.execute("DELETE FROM locations WHERE owner_user_id = ?", (user_id,))
    db.commit()
    return cur.rowcount
