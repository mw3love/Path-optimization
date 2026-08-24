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


def test_set_name_updates_location_name(db):
    a = get_or_create_user(db, "a@company.com")
    loc_id = repo.create_location(db, a, "위도 37.5, 경도 127.0", "", 37.5, 127.0, "paste")
    repo.set_name(db, loc_id, "우리 지사")
    updated = repo.get_location(db, loc_id)
    assert updated["name"] == "우리 지사"
