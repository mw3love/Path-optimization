"""
geocode.py — 카카오 로컬 API 프록시 (키워드 검색) + Nominatim(OSM) 폴백.
카카오 키가 없거나, 있어도 결과가 없으면(주로 국외 주소) Nominatim으로 폴백한다.
Nominatim은 키가 필요 없어 KAKAO_REST_API_KEY 미설정 상태에서도 검색 자체는 항상 동작한다.
"""
import os
import requests

KAKAO_API_KEY = os.environ.get("KAKAO_REST_API_KEY", "")
KAKAO_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
NOMINATIM_URL = os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
NOMINATIM_USER_AGENT = os.environ.get("NOMINATIM_USER_AGENT", "path-optimization-route-planner")
TIMEOUT = 5


def search(query: str) -> list:
    if KAKAO_API_KEY:
        results = _search_kakao(query)
        if results:
            return results
    return _search_nominatim(query)


def _search_kakao(query: str) -> list:
    resp = requests.get(
        KAKAO_SEARCH_URL,
        params={"query": query, "size": 15},  # 카카오 키워드 검색 size 파라미터의 단일 요청 상한
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


def _search_nominatim(query: str) -> list:
    resp = requests.get(
        NOMINATIM_URL,
        params={"q": query, "format": "json", "limit": 40},  # Nominatim limit 파라미터의 상한(v4.2+)
        headers={"User-Agent": NOMINATIM_USER_AGENT},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    return [
        {
            "name": item["display_name"].split(",")[0],
            "address": item["display_name"],
            "lat": float(item["lat"]),
            "lng": float(item["lon"]),
        }
        for item in data
    ]
