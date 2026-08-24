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
    visible = repo.list_visible_locations(db, a)
    assert any(l["id"] == loc_id for l in visible)


def test_other_user_cannot_see_private_location(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    visible = repo.list_visible_locations(db, b)
    assert not any(l["id"] == loc_id for l in visible)


def test_is_owner(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    assert repo.is_owner(db, loc_id, a) is True
    assert repo.is_owner(db, loc_id, b) is False


def test_set_name_updates_location_name(db):
    a = get_or_create_user(db, "a@company.com")
    loc_id = repo.create_location(db, a, "위도 37.5, 경도 127.0", "", 37.5, 127.0, "paste")
    repo.set_name(db, loc_id, "우리 지사")
    updated = repo.get_location(db, loc_id)
    assert updated["name"] == "우리 지사"


def test_delete_location_removes_it(db):
    a = get_or_create_user(db, "a@company.com")
    loc_id = repo.create_location(db, a, "우리집", "서울", 37.5, 127.0, "map_click")
    repo.delete_location(db, loc_id)
    assert repo.get_location(db, loc_id) is None


def test_delete_all_locations_only_affects_owner(db):
    a = get_or_create_user(db, "a@company.com")
    b = get_or_create_user(db, "b@company.com")
    repo.create_location(db, a, "지점1", "", 37.5, 127.0, "map_click")
    repo.create_location(db, a, "지점2", "", 37.6, 127.1, "map_click")
    b_loc_id = repo.create_location(db, b, "b의 지점", "", 35.1, 129.0, "map_click")

    deleted = repo.delete_all_locations(db, a)
    assert deleted == 2
    assert repo.list_visible_locations(db, a) == []
    assert repo.get_location(db, b_loc_id) is not None
