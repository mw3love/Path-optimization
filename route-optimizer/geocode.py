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
