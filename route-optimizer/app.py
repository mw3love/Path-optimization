"""
app.py — Flask 엔트리포인트
  GET  /          → index.html (LOCATIONS를 window.LOCATIONS로 인라인)
  POST /api/optimize → 최적화
  GET  /api/health  → OSRM 연결 상태·캐시 상태
"""
import json
import math
import os
import socket
import ipaddress
import datetime as dt
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request
from distance_matrix import get_matrix, fetch_route_geometry
from optimizer import solve, assign_days


# ── 자동 SSL 인증서 생성 ────────────────────────────────────────────────────────

def _get_lan_ip() -> str:
    """현재 머신의 LAN IPv4 주소를 반환. 실패 시 '127.0.0.1'."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _cert_covers_ip(cert_path: Path, ip: str) -> bool:
    """cert.pem의 SAN에 ip가 포함되어 있는지 확인."""
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes(), default_backend())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        for addr in san.value.get_values_for_type(x509.IPAddress):
            if str(addr) == ip:
                return True
    except Exception:
        pass
    return False


def _generate_cert(cert_path: Path, key_path: Path, lan_ip: str):
    """LAN IP를 SAN에 포함한 자체 서명 인증서를 생성."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.backends import default_backend

    key = rsa.generate_private_key(
        public_exponent=65537, key_size=2048, backend=default_backend()
    )
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, lan_ip)])

    san_entries = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    if lan_ip != "127.0.0.1":
        san_entries.append(x509.IPAddress(ipaddress.ip_address(lan_ip)))

    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + dt.timedelta(days=825))  # ~2년
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256(), default_backend())
    )

    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    print(f"[SSL] 인증서 생성 완료 - SAN: {lan_ip}, 127.0.0.1, localhost")


def ensure_ssl_cert(base_dir: Path) -> str:
    """cert.pem/key.pem이 없거나 현재 IP가 SAN에 없으면 자동 재생성. LAN IP 반환."""
    cert_path = base_dir / "cert.pem"
    key_path  = base_dir / "key.pem"
    lan_ip = _get_lan_ip()

    try:
        import cryptography  # noqa: F401
    except ImportError:
        print("[SSL] cryptography 미설치 → pip install cryptography")
        return

    needs_regen = not cert_path.exists() or not key_path.exists()
    if not needs_regen and not _cert_covers_ip(cert_path, lan_ip):
        print(f"[SSL] 현재 IP({lan_ip})가 인증서 SAN에 없음 -> 재생성")
        needs_regen = True

    if needs_regen:
        _generate_cert(cert_path, key_path, lan_ip)
    else:
        print(f"[SSL] 인증서 유효 - {lan_ip} 포함 확인")
    return lan_ip

app = Flask(__name__)

@app.after_request
def no_cache_static(response):
    """개발 환경: iOS Safari 등의 공격적 캐시를 방지해 JS/CSS 변경사항이 즉시 반영되도록."""
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response

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
    end_key = "__end__" if has_end else None
    legs, summary = _build_legs(matrix, keys, ordered_ids, start_idx, end_key,
                                start_time_str, stay_minutes)

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


def _build_legs(matrix, keys, ordered_ids, start_idx, end_key, start_time_str, stay_minutes):
    """
    ordered_ids 방문 순서에 따라 legs 리스트와 summary 딕셔너리를 반환한다.

    matrix:      get_matrix() 반환값 {"durations": ..., "distances": ...}
    keys:        좌표 인덱스와 1:1 대응하는 키 리스트
    ordered_ids: 방문할 지점 id 순서 (출발/도착 제외)
    start_idx:   출발지 인덱스
    end_key:     도착지 키 ("__end__", "__day0_end__" 등) or None
    start_time_str: "HH:MM" 형식 시작 시각
    stay_minutes:   각 지점 체류 분
    """
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
    if end_key and end_key in keys:
        cur_idx = keys.index(end_key)
        dur_sec = matrix["durations"][prev_idx][cur_idx]
        dist_m = matrix["distances"][prev_idx][cur_idx]
        total_drive_sec += dur_sec
        total_dist_m += dist_m
        current_time += timedelta(seconds=dur_sec)
        legs.append({
            "id": end_key,
            "drive_min": round(dur_sec / 60),
            "drive_km": round(dist_m / 1000, 1),
            "arrive": current_time.strftime("%H:%M"),
            "depart": None,
        })

    summary = {
        "total_drive_min": round(total_drive_sec / 60),
        "total_dist_km": round(total_dist_m / 1000, 1),
        "total_stay_min": stay_minutes * len(ordered_ids),
        "end_time": current_time.strftime("%H:%M"),
        "location_count": len(ordered_ids),
    }
    return legs, summary


def _build_polyline(keys, ordered_ids, coords, start, end):
    """OSRM Route API로 실제 도로 경로 좌표 반환. 실패 시 직선 연결 폴백."""
    route_coords = [(start["lat"], start["lng"])]
    for oid in ordered_ids:
        idx = keys.index(oid)
        route_coords.append(coords[idx])
    if end:
        route_coords.append((end["lat"], end["lng"]))

    geometry = fetch_route_geometry(route_coords)
    if geometry:
        return geometry

    # 폴백: 직선 연결
    return [[lat, lng] for lat, lng in route_coords]


@app.route("/api/optimize-multiday", methods=["POST"])
def optimize_multiday():
    """
    N일 경로 계획 엔드포인트.

    Request:
      {
        "location_ids": ["id1", ...],
        "days": [
          {"start": {lat, lng, label}, "end": {lat, lng, label} | null},
          ...
        ],
        "work_start": "09:00",
        "work_end":   "18:00",
        "stay_minutes": 20
      }

    Response:
      {
        "days": [
          {
            "day": 1, "label": "1일차",
            "order": [...], "legs": [...],
            "summary": {...}, "polyline": [...],
            "source": "osrm"|"haversine",
            "start": {...}, "end": {...}
          }, ...
        ]
      }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "empty body"}), 400

    location_ids = [str(i) for i in body.get("location_ids", [])]
    days_cfg = body.get("days", [])
    work_start_str = body.get("work_start", "09:00")
    work_end_str   = body.get("work_end",   "18:00")
    stay_minutes   = int(body.get("stay_minutes", 20))

    if len(location_ids) < 1:
        return jsonify({"error": "최소 1개 지점이 필요합니다"}), 400
    if not days_cfg:
        return jsonify({"error": "days 배열이 비어 있습니다"}), 400

    # 업무 가용 시간(분)
    try:
        ws = datetime.strptime(work_start_str, "%H:%M")
        we = datetime.strptime(work_end_str,   "%H:%M")
        work_minutes = max(int((we - ws).total_seconds() / 60), stay_minutes + 1)
    except ValueError:
        work_minutes = 540  # 09:00~18:00 = 540분

    # ── 좌표/키 목록 구성 ──────────────────────────────────────────────────
    loc_map = {loc["id"]: loc for loc in LOCATIONS}

    # 검증: 모든 지점 id 존재 여부
    for lid in location_ids:
        if lid not in loc_map:
            return jsonify({"error": f"알 수 없는 지점 id: {lid}"}), 400

    # 검증: 날별 출발지 좌표
    for i, dcfg in enumerate(days_cfg):
        s = dcfg.get("start")
        if not s or s.get("lat") is None or s.get("lng") is None:
            return jsonify({"error": f"{i+1}일차 출발지 좌표가 없습니다"}), 400

    # 전체 행렬에 쓸 좌표+키: 실제 지점 + 모든 날의 출발/도착
    coords = []
    keys   = []

    for lid in location_ids:
        loc = loc_map[lid]
        coords.append((loc["lat"], loc["lng"]))
        keys.append(lid)

    day_configs_for_assign = []
    for i, dcfg in enumerate(days_cfg):
        s = dcfg["start"]
        e = dcfg.get("end")
        start_key = f"__day{i}_start__"
        end_key   = f"__day{i}_end__" if (e and e.get("lat") and e.get("lng")) else None

        coords.append((s["lat"], s["lng"]))
        keys.append(start_key)

        if end_key:
            coords.append((e["lat"], e["lng"]))
            keys.append(end_key)

        day_configs_for_assign.append({"start_key": start_key, "end_key": end_key})

    # ── 전체 거리 행렬 1회 계산 ──────────────────────────────────────────
    full_matrix = get_matrix(coords, keys)
    source_global = full_matrix["source"]

    # ── 지점 배분 ──────────────────────────────────────────────────────────
    day_assignments = assign_days(
        full_matrix, keys, location_ids,
        day_configs_for_assign, work_minutes, stay_minutes
    )

    # ── 날별 TSP + legs 조립 ──────────────────────────────────────────────
    result_days = []

    for i, (dcfg, assignment) in enumerate(zip(days_cfg, day_assignments)):
        s = dcfg["start"]
        e = dcfg.get("end")
        start_key = f"__day{i}_start__"
        end_key   = f"__day{i}_end__" if (e and e.get("lat") and e.get("lng")) else None
        label = f"{i+1}일차"

        if not assignment:
            result_days.append({
                "day": i + 1, "label": label,
                "order": [], "legs": [],
                "summary": {
                    "total_drive_min": 0, "total_dist_km": 0.0,
                    "total_stay_min": 0, "end_time": work_start_str,
                    "location_count": 0,
                },
                "polyline": [], "source": "none",
                "start": s, "end": e,
            })
            continue

        # 서브행렬: 출발 + 배정지점 + (도착) 만 슬라이스
        sub_ids = [start_key] + assignment + ([end_key] if end_key else [])
        sub_idx = [keys.index(k) for k in sub_ids]
        n_sub = len(sub_ids)

        sub_dur  = [[full_matrix["durations"][sub_idx[r]][sub_idx[c]]  for c in range(n_sub)] for r in range(n_sub)]
        sub_dist = [[full_matrix["distances"][sub_idx[r]][sub_idx[c]] for c in range(n_sub)] for r in range(n_sub)]
        sub_matrix = {"durations": sub_dur, "distances": sub_dist, "source": source_global}

        sub_start_idx = 0
        sub_end_idx   = n_sub - 1 if end_key else None
        # 배정 지점만의 인덱스(서브행렬 기준): 1 ~ len(assignment)
        sub_pool_indices = list(range(1, 1 + len(assignment)))

        route_indices = solve(sub_matrix, start_idx=sub_start_idx, end_idx=sub_end_idx)
        # route_indices는 sub_matrix 기준 인덱스; 0=출발, n_sub-1=도착
        ordered_sub = [
            sub_ids[ri]
            for ri in route_indices
            if sub_ids[ri] not in (start_key, end_key)
        ]

        legs, summary = _build_legs(
            sub_matrix, sub_ids, ordered_sub,
            sub_start_idx, end_key, work_start_str, stay_minutes
        )

        # 마지막 날 시간 초과 경고
        overtime = False
        if i == len(days_cfg) - 1:
            try:
                end_dt = datetime.strptime(summary["end_time"], "%H:%M")
                work_end_dt = datetime.strptime(work_end_str, "%H:%M")
                overtime = end_dt > work_end_dt
            except Exception:
                pass
        summary["overtime"] = overtime

        # 폴리라인: sub_ids 순서로 coords 구성
        sub_coords = [coords[keys.index(k)] for k in sub_ids]
        start_coord = (s["lat"], s["lng"])
        end_coord   = (e["lat"], e["lng"]) if end_key else None

        ordered_coord = [start_coord]
        for oid in ordered_sub:
            oi = keys.index(oid)
            ordered_coord.append(coords[oi])
        if end_coord:
            ordered_coord.append(end_coord)

        geometry = fetch_route_geometry(ordered_coord)
        polyline = geometry if geometry else [[lat, lng] for lat, lng in ordered_coord]

        result_days.append({
            "day": i + 1, "label": label,
            "order": ordered_sub, "legs": legs,
            "summary": summary,
            "polyline": polyline,
            "source": source_global,
            "start": s, "end": e,
        })

    return jsonify({"days": result_days})


@app.route("/api/estimate-days", methods=["POST"])
def estimate_days():
    """
    빠른 N일 추정 엔드포인트.
    assign_days()로 greedy 배분하여 필요 일수와 날별 지점 수를 반환.
    TSP/폴리라인 없이 빠르게 동작.

    Request:
      {
        "location_ids": ["id1", ...],
        "start": {"lat": ..., "lng": ...},
        "work_start": "09:00",
        "work_end":   "18:00",
        "stay_minutes": 20,
        "max_days": 14
      }

    Response:
      {
        "estimated_days": 3,
        "day_counts": [8, 8, 7],
        "total_locations": 23,
        "work_minutes": 540
      }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "empty body"}), 400

    location_ids = [str(i) for i in body.get("location_ids", [])]
    start = body.get("start")
    work_start_str = body.get("work_start", "09:00")
    work_end_str   = body.get("work_end",   "18:00")
    stay_minutes   = int(body.get("stay_minutes", 20))
    max_days       = int(body.get("max_days", 14))

    if not location_ids:
        return jsonify({"error": "location_ids가 비어 있습니다"}), 400
    if not start or start.get("lat") is None or start.get("lng") is None:
        return jsonify({"error": "start 좌표가 없습니다"}), 400

    try:
        ws = datetime.strptime(work_start_str, "%H:%M")
        we = datetime.strptime(work_end_str,   "%H:%M")
        work_minutes = max(int((we - ws).total_seconds() / 60), stay_minutes + 1)
    except ValueError:
        work_minutes = 540

    loc_map = {loc["id"]: loc for loc in LOCATIONS}
    for lid in location_ids:
        if lid not in loc_map:
            return jsonify({"error": f"알 수 없는 지점 id: {lid}"}), 400

    # 좌표 + 키 구성: 실제 지점 + 출발지
    coords = []
    keys   = []
    for lid in location_ids:
        loc = loc_map[lid]
        coords.append((loc["lat"], loc["lng"]))
        keys.append(lid)

    start_key = "__est_start__"
    coords.append((start["lat"], start["lng"]))
    keys.append(start_key)

    full_matrix = get_matrix(coords, keys)

    # max_days 만큼 day_configs 생성 (모두 같은 출발지, 도착지 없음)
    day_configs = [{"start_key": start_key, "end_key": None} for _ in range(max_days)]

    assignments = assign_days(
        full_matrix, keys, location_ids,
        day_configs, work_minutes, stay_minutes
    )

    # 실제 사용된 날수 계산 (비어 있지 않은 날)
    non_empty = [a for a in assignments if a]
    estimated_days = len(non_empty)
    day_counts = [len(a) for a in non_empty]

    return jsonify({
        "estimated_days": estimated_days,
        "day_counts": day_counts,
        "day_assignments": non_empty,
        "total_locations": len(location_ids),
        "work_minutes": work_minutes,
    })


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

    # reloader 부모 프로세스에서만 인증서 생성 (자식에서 중복 실행 방지)
    lan_ip = _get_lan_ip()
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        lan_ip = ensure_ssl_cert(_BASE)

    # reloader는 부모(파일 감시)·자식(실제 앱) 2개 프로세스를 띄운다.
    # WERKZEUG_RUN_MAIN=true 는 자식에서만 설정되므로, prefetch는 자식에서만 실행.
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_prefetch(LOCATIONS)

    ssl_context = None
    if (_BASE / "cert.pem").exists() and (_BASE / "key.pem").exists():
        ssl_context = (str(_BASE / "cert.pem"), str(_BASE / "key.pem"))

    proto = "https" if ssl_context else "http"
    print(f"\n  접속 주소: {proto}://{lan_ip}:5000\n")

    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=True,
            ssl_context=ssl_context)
