"""
locations_repo.py — 지점 CRUD + 가시성(visibility) 규칙.
가시성: 소유자 본인 OR is_public=1 OR shared_with_email에 내 이메일 존재.
"""


def create_location(db, owner_user_id, name, address, lat, lng, source, sigungu="") -> int:
    cur = db.execute(
        "INSERT INTO locations (owner_user_id, name, address, lat, lng, source, sigungu) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (owner_user_id, name, address, lat, lng, source, sigungu or ""),
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
