"""
app.py — Flask 엔트리포인트
  GET  /          → index.html (LOCATIONS를 window.LOCATIONS로 인라인)
  POST /api/optimize → 최적화
  GET  /api/health  → OSRM 연결 상태·캐시 상태
"""
import json
import math
import os
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request
from distance_matrix import get_matrix
from optimizer import solve

app = Flask(__name__)

# ── 지점 데이터 로드 ────────────────────────────────────────────────────────────
_BASE = Path(__file__).parent
_LOCATIONS_PATH = _BASE / "locations.json"

with open(_LOCATIONS_PATH, encoding="utf-8") as f:
    LOCATIONS: list = json.load(f)

# ── 라우트 ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    template_path = _BASE / "templates" / "index.html"
    template_src = template_path.read_text(encoding="utf-8")
    locations_json = json.dumps(LOCATIONS, ensure_ascii=False)
    # Jinja2 delimiters를 피하기 위해 render_template_string 에 변수로 주입
    return render_template_string(
        template_src,
        locations_json=locations_json,
    )


@app.route("/api/optimize", methods=["POST"])
def optimize():
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "empty body"}), 400

    location_ids = [str(i) for i in body.get("location_ids", [])]
    start = body.get("start")  # {lat, lng, label}
    end = body.get("end")      # {lat, lng, label} | null
    start_time_str = body.get("start_time", "09:00")
    stay_minutes = int(body.get("stay_minutes", 20))

    if len(location_ids) < 2:
        return jsonify({"error": "최소 2개 지점이 필요합니다"}), 400
    if not start:
        return jsonify({"error": "출발지(start)가 없습니다"}), 400

    # ── 좌표 목록 구성 ──────────────────────────────────────────────────────
    # 인덱스: 0=출발지, 1..n=선택 지점, n+1=도착지(있을 때)
    loc_map = {loc["id"]: loc for loc in LOCATIONS}

    coords = [(start["lat"], start["lng"])]
    keys = ["__start__"]

    for lid in location_ids:
        loc = loc_map.get(lid)
        if not loc:
            return jsonify({"error": f"알 수 없는 지점 id: {lid}"}), 400
        coords.append((loc["lat"], loc["lng"]))
        keys.append(lid)

    has_end = end and end.get("lat") and end.get("lng")
    if has_end:
        coords.append((end["lat"], end["lng"]))
        keys.append("__end__")

    # ── 거리 행렬 ────────────────────────────────────────────────────────────
    matrix = get_matrix(coords, keys)
    source = matrix["source"]

    # ── OR-Tools TSP ─────────────────────────────────────────────────────────
    start_idx = 0
    end_idx = len(keys) - 1 if has_end else None

    route_indices = solve(matrix, start_idx=start_idx, end_idx=end_idx)

    # route_indices: 선택 지점 인덱스(1..n) 순서. 출발/도착 제외.
    ordered_ids = [keys[i] for i in route_indices if keys[i] not in ("__start__", "__end__")]

    # ── Legs 조립 ─────────────────────────────────────────────────────────────
    try:
        current_time = datetime.strptime(start_time_str, "%H:%M")
    except ValueError:
        current_time = datetime.strptime("09:00", "%H:%M")

    legs = []
    prev_idx = start_idx
    total_drive_sec = 0
    total_dist_m = 0

    for oid in ordered_ids:
        cur_idx = keys.index(oid)
        dur_sec = matrix["durations"][prev_idx][cur_idx]
        dist_m = matrix["distances"][prev_idx][cur_idx]

        drive_min = round(dur_sec / 60)
        drive_km = round(dist_m / 1000, 1)

        current_time += timedelta(seconds=dur_sec)
        arrive = current_time.strftime("%H:%M")
        depart = (current_time + timedelta(minutes=stay_minutes)).strftime("%H:%M")
        current_time += timedelta(minutes=stay_minutes)

        total_drive_sec += dur_sec
        total_dist_m += dist_m

        legs.append({
            "id": oid,
            "drive_min": drive_min,
            "drive_km": drive_km,
            "arrive": arrive,
            "depart": depart,
        })
        prev_idx = cur_idx

    # 도착지까지의 마지막 구간
    if has_end:
        cur_idx = keys.index("__end__")
        dur_sec = matrix["durations"][prev_idx][cur_idx]
        dist_m = matrix["distances"][prev_idx][cur_idx]
        total_drive_sec += dur_sec
        total_dist_m += dist_m
        current_time += timedelta(seconds=dur_sec)

    summary = {
        "total_drive_min": round(total_drive_sec / 60),
        "total_dist_km": round(total_dist_m / 1000, 1),
        "total_stay_min": stay_minutes * len(ordered_ids),
        "end_time": current_time.strftime("%H:%M"),
    }

    # ── Polyline ────────────────────────────────────────────────────────────
    polyline = _build_polyline(keys, ordered_ids, coords, start, end if has_end else None)

    return jsonify({
        "order": ordered_ids,
        "legs": legs,
        "summary": summary,
        "polyline": polyline,
        "source": source,
        "start": start,
        "end": end,
    })


def _build_polyline(keys, ordered_ids, coords, start, end):
    """순서대로 좌표 배열 반환 (OSRM geometry 미사용, 직선 연결)."""
    result = [[start["lat"], start["lng"]]]
    for oid in ordered_ids:
        idx = keys.index(oid)
        lat, lng = coords[idx]
        result.append([lat, lng])
    if end:
        result.append([end["lat"], end["lng"]])
    return result


@app.route("/api/health")
def health():
    osrm_status = "unknown"
    matrix_info = {}
    try:
        from distance_matrix import CACHE, OSRM_BASE_URL
        matrix_info = {
            "cached_pairs": len(CACHE),
            "osrm_base_url": OSRM_BASE_URL,
        }
        osrm_status = "ok" if len(CACHE) > 0 else "unknown"
    except ImportError:
        pass
    except Exception as e:
        osrm_status = "down"
        matrix_info["error"] = str(e)

    return jsonify({
        "osrm": osrm_status,
        "matrix_cache": matrix_info,
        "locations_count": len(LOCATIONS),
    })


# ── 기동 ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from prefetch import start_prefetch
    start_prefetch(LOCATIONS)
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
