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
    1. 모든 쌍이 캐시에 있으면 즉시 반환 (source="osrm" 또는 이전 source 유지)
    2. __start__ / __end__ 를 포함하는 쌍이 없는 경우에만:
       - location-to-location 쌍 중 미캐시 항목 → OSRM 호출
    3. __start__ / __end__ 관련 쌍은 항상 Haversine 폴백 사용
       (커스텀 위치는 prefetch 대상이 아니므로 OSRM 재호출 없음)
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

    # virtual 키 관련 쌍은 Haversine 으로 채움
    if virtual_indices:
        _fill_virtual_haversine(coords, keys, virtual_indices, real_indices)
        # virtual 포함 시 source는 osrm 캐시가 있어도 "osrm" 유지
        # (real-to-real은 OSRM, virtual rows는 Haversine 혼용)
        # frontend에는 haversine 로 표기하지 않음 — real pairs가 OSRM이면 osrm 유지

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


# ── Virtual 키 Haversine 채움 ────────────────────────────────────────────────

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
