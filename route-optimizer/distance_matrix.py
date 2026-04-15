"""
distance_matrix.py
OSRM Table API 호출 + pairwise in-memory 캐시 + Haversine×1.4 폴백

반환 형식:
  {
    "durations": [[초, ...], ...],   # N×N
    "distances": [[미터, ...], ...], # N×N
    "source": "osrm" | "haversine"
  }
"""
import math
import os
import requests

OSRM_BASE_URL = os.environ.get("OSRM_BASE_URL", "http://router.project-osrm.org")
OSRM_TIMEOUT = 10  # 초

# pairwise 캐시: (key_i, key_j) → (duration_sec, distance_m)
CACHE: dict[tuple, tuple] = {}


# ── 공개 API ──────────────────────────────────────────────────────────────────

def get_matrix(coords: list[tuple], keys: list[str]) -> dict:
    """
    coords: [(lat, lng), ...]
    keys:   [str, ...] — 캐시 키. 좌표와 1:1 대응.

    전략:
    1. real-to-real 쌍 중 캐시 미스 → OSRM Table 호출해 캐시
    2. virtual(__start__/__end__) 관련 캐시는 매 요청마다 무효화 (위치가 바뀜)
    3. virtual 관련 쌍은 OSRM Table로 가져옴 (real-to-real과 동일 기준)
       OSRM 실패 시 Haversine × 1.4 폴백
    """
    n = len(coords)
    if n == 0:
        return {"durations": [], "distances": [], "source": "osrm"}

    # 가상 키 분리
    virtual = {"__start__", "__end__"}
    real_indices = [i for i, k in enumerate(keys) if k not in virtual]
    virtual_indices = [i for i, k in enumerate(keys) if k in virtual]

    # real-to-real 쌍 중 캐시 미스 확인
    real_keys = [keys[i] for i in real_indices]
    real_coords = [coords[i] for i in real_indices]

    if real_keys and _missing_pairs(real_keys):
        # real 지점 간 OSRM 호출 (prefetch 미완료 상황)
        source = _fetch_and_cache(real_coords, real_keys)
    else:
        source = "osrm" if real_keys else "haversine"

    # virtual 키 관련 캐시 무효화 — 요청마다 출발지/도착지가 바뀔 수 있음
    _invalidate_virtual_cache()

    # virtual 키 관련 쌍은 OSRM으로 채우고, 실패 시 Haversine 폴백
    if virtual_indices:
        source = _fill_virtual_osrm_or_haversine(
            coords, keys, virtual_indices, real_indices, source
        )

    return _build_matrix(keys, source)


# ── 캐시 조회 ─────────────────────────────────────────────────────────────────

def _missing_pairs(keys: list[str]) -> bool:
    """캐시에 없는 쌍이 하나라도 있으면 True"""
    for i in range(len(keys)):
        for j in range(len(keys)):
            if (keys[i], keys[j]) not in CACHE:
                return True
    return False


def _build_matrix(keys: list[str], source: str) -> dict:
    n = len(keys)
    durations = [[0.0] * n for _ in range(n)]
    distances = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            pair = CACHE.get((keys[i], keys[j]))
            if pair:
                durations[i][j], distances[i][j] = pair
    return {"durations": durations, "distances": distances, "source": source}


# ── OSRM 호출 ─────────────────────────────────────────────────────────────────

def _fetch_and_cache(coords: list[tuple], keys: list[str]) -> str:
    """OSRM Table API 호출. 실패 시 Haversine 폴백. 캐시 채움 후 source 반환."""
    try:
        source = _fetch_osrm(coords, keys)
    except Exception:
        source = _fallback_haversine(coords, keys)
    return source


def _fetch_osrm(coords: list[tuple], keys: list[str]) -> str:
    # OSRM 좌표 형식: lng,lat (경도,위도)
    coord_str = ";".join(f"{lng},{lat}" for lat, lng in coords)
    url = f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}?annotations=duration,distance"

    resp = requests.get(url, timeout=OSRM_TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"OSRM HTTP {resp.status_code}")

    data = resp.json()
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM code={data.get('code')}")

    dur_table = data["durations"]
    dist_table = data.get("distances")

    n = len(keys)
    for i in range(n):
        for j in range(n):
            dur = dur_table[i][j] if dur_table[i][j] is not None else 0.0
            dist = (dist_table[i][j] if dist_table and dist_table[i][j] is not None else 0.0)
            CACHE[(keys[i], keys[j])] = (dur, dist)

    return "osrm"


# ── Virtual 키 처리 ──────────────────────────────────────────────────────────

_VIRTUAL_KEYS = {"__start__", "__end__"}


def _invalidate_virtual_cache():
    """출발지/도착지 관련 캐시를 제거한다. 매 요청마다 위치가 바뀔 수 있으므로."""
    stale = [k for k in CACHE if k[0] in _VIRTUAL_KEYS or k[1] in _VIRTUAL_KEYS]
    for k in stale:
        del CACHE[k]


def _fill_virtual_osrm_or_haversine(
    coords: list[tuple],
    keys: list[str],
    virtual_indices: list[int],
    real_indices: list[int],
    current_source: str,
) -> str:
    """virtual 키와 실제 지점 간 거리를 OSRM으로 가져온다. 실패 시 Haversine 폴백.

    OSRM 호출 시 virtual + real 좌표를 함께 넘겨 한 번에 행렬을 얻는다.
    real-to-real 쌍은 이미 캐시돼 있으므로 덮어써도 무방(동일한 OSRM 값).
    """
    all_idx = virtual_indices + real_indices
    sub_coords = [coords[i] for i in all_idx]
    sub_keys = [keys[i] for i in all_idx]
    try:
        _fetch_osrm(sub_coords, sub_keys)
        return current_source  # real-to-real source 유지
    except Exception:
        _fill_virtual_haversine(coords, keys, virtual_indices, real_indices)
        return "haversine"


# ── Virtual 키 Haversine 채움 (폴백용) ───────────────────────────────────────

def _fill_virtual_haversine(
    coords: list[tuple],
    keys: list[str],
    virtual_indices: list[int],
    real_indices: list[int],
):
    """__start__/__end__ ↔ 모든 노드 쌍을 Haversine으로 채운다."""
    all_indices = list(range(len(keys)))
    for vi in virtual_indices:
        for j in all_indices:
            if (keys[vi], keys[j]) not in CACHE:
                lat1, lng1 = coords[vi]
                lat2, lng2 = coords[j]
                dist_m = _haversine_m(lat1, lng1, lat2, lng2) * 1.4
                dur_s = dist_m / _AVG_SPEED_MPS
                CACHE[(keys[vi], keys[j])] = (dur_s, dist_m)
            if (keys[j], keys[vi]) not in CACHE:
                lat1, lng1 = coords[j]
                lat2, lng2 = coords[vi]
                dist_m = _haversine_m(lat1, lng1, lat2, lng2) * 1.4
                dur_s = dist_m / _AVG_SPEED_MPS
                CACHE[(keys[j], keys[vi])] = (dur_s, dist_m)


# ── Haversine 폴백 ────────────────────────────────────────────────────────────

_AVG_SPEED_MPS = 60_000 / 3600  # 60 km/h → m/s


def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    R = 6_371_000  # 미터
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_route_geometry(coords: list[tuple]) -> list[list] | None:
    """
    OSRM Route API로 실제 도로 경로 좌표를 반환한다.
    coords: [(lat, lng), ...] — 전체 경로 순서(출발→경유→도착)
    반환: [[lat, lng], ...] (Leaflet용) | None (실패 시)
    """
    if len(coords) < 2:
        return None
    try:
        coord_str = ";".join(f"{lng},{lat}" for lat, lng in coords)
        url = (
            f"{OSRM_BASE_URL}/route/v1/driving/{coord_str}"
            "?overview=full&geometries=geojson"
        )
        resp = requests.get(url, timeout=OSRM_TIMEOUT)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        # GeoJSON 좌표는 [lng, lat] → Leaflet용 [lat, lng]으로 변환
        geo = data["routes"][0]["geometry"]["coordinates"]
        return [[lat, lng] for lng, lat in geo]
    except Exception as e:
        print(f"[fetch_route_geometry] 실패: {e}")
        return None


def _fallback_haversine(coords: list[tuple], keys: list[str]) -> str:
    n = len(coords)
    for i in range(n):
        for j in range(n):
            if i == j:
                CACHE[(keys[i], keys[j])] = (0.0, 0.0)
                continue
            lat1, lng1 = coords[i]
            lat2, lng2 = coords[j]
            dist_m = _haversine_m(lat1, lng1, lat2, lng2) * 1.4
            dur_s = dist_m / _AVG_SPEED_MPS
            CACHE[(keys[i], keys[j])] = (dur_s, dist_m)
    return "haversine"
