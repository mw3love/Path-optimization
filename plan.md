# 전파조사 경로 최적화 웹앱 — 단계별 실행계획

## Context

KBS 전파측정팀이 **75개 지점을 차량으로 나눠 방문**하기 위한 일일 경로 최적화 단일 페이지 웹앱. 운영자 PC에서 Flask를 띄우고, 같은 와이파이의 스마트폰에서 접속해 당일 방문 지점을 지도에서 고른 뒤 OR-Tools로 최적 방문 순서를 계산하고 T맵/카카오내비로 일괄 전송한다.

원본 지점 데이터는 구글시트(`1cStO5DrZoFDOmZibuycWXapNuDLR1IWNwrnQh2RFFqo`) 및 그 다운로드본(`측정표(배포용)_전북.xlsx`)이다. 전북 외 지역 팀도 동일 코드 위에 자기 `locations.json`만 교체해 운영한다 — 따라서 지역 하드코딩 금지.

현재 리포지토리에는 [prd.md](prd.md), [CLAUDE.md](CLAUDE.md), 원본 엑셀만 있고 코드는 없다. 본 계획은 PRD의 4단계 로드맵을 그대로 따르되, 사용자 질의응답에서 확정된 세부 결정사항을 반영한다.

### 확정된 결정사항 (Q&A 요약)

| 항목 | 결정 |
|------|------|
| OSRM 호스트 | 환경변수로 교체 가능. 기본 공개 데모(`router.project-osrm.org`), 실패 시 Haversine×1.4 폴백 |
| `locations.json` 생성 | 구글시트/xlsx → JSON 변환 스크립트 **+** 수동 편집 둘 다 지원 |
| 내비 딥링크 | T맵 우선(다중 경유지), 카카오내비는 가능한 경유지 수 안에서 지원 |
| 출발지 UX | 지도 길게누르기/우클릭 메뉴 **+** GPS 버튼 |
| 도착지 UX | 지도 길게누르기/우클릭 메뉴 **+** 전용 설정 버튼. 미지정 시 Open TSP |
| 프리페치 | 서버 기동 시 백그라운드 스레드로 OSRM Table 미리 계산(선택 집합이 아니라 전체 75×75) |
| 시작시각/체류 | 09:00 / 20분 기본값 (사이드바에서 변경 가능) |
| 개발용 엔드포인트 | `GET /api/health`만 추가 (OSRM 연결 상태·캐시 상태 확인) |
| 시군구 색상 | 주소 `Address_2` 값을 키로, 고정 팔레트에서 순차 배정 (지역 독립) |
| 폴백 표시 | 응답에 `source: "osrm"|"haversine"` 포함 → 폴백일 때 결과 패널 상단에 "거리 근사치" 배너 |
| 모바일 지도 상호작용 | 길게누르기(500ms) == 데스크톱 우클릭 |
| JS 구조 | 역할별 ES module 분리(`map.js`/`selection.js`/`optimize.js`/`nav.js`/`timeline.js`) |
| OSRM 타임아웃 | 10초, 재시도 없음. 실패 즉시 Haversine 폴백 |
| 결과 공유 | 인쇄 미리보기(`window.print()` + print-only CSS) |
| 엑셀 스키마 | 헤더행 = `NA / Point_Name / Address_1..4 / Latitude / Longitude`. 4번째 데이터행부터 지점 |
| `address` 필드값 | `Address_4`(전체 주소). 추가로 `sigungu` = `Address_2`를 JSON에 포함 (색상 키용) |
| 변환 스크립트 입력 | 로컬 xlsx 경로 **및** 구글시트 ID+gid(csv export) 둘 다 |
| 변환 예외 | 오류 행은 스킵+경고 로그, `--strict`로 엄격 모드 전환 |

---

## 산출 파일 구조

```
route-optimizer/
├── app.py                   # Flask. GET / + POST /api/optimize + GET /api/health
├── optimizer.py             # OR-Tools TSP (Open / 종단 고정)
├── distance_matrix.py       # OSRM Table + in-memory cache + Haversine×1.4 폴백
├── prefetch.py              # 기동 시 백그라운드 전체 행렬 프리페치
├── locations.json           # 지점 데이터 (변환 스크립트 산출 or 수동)
├── requirements.txt         # flask, ortools, requests, openpyxl
├── tools/
│   └── xlsx_to_locations.py # xlsx/구글시트 → JSON 변환
├── templates/index.html     # Bootstrap 5 단일 페이지
└── static/
    ├── css/style.css        # + print 스타일
    └── js/
        ├── app.js           # 엔트리
        ├── map.js           # Leaflet 초기화, 마커, 우클릭/롱프레스 메뉴
        ├── selection.js     # 지점 목록 ↔ 지도 양방향 동기화, 필터/검색
        ├── optimize.js      # /api/optimize 호출, 결과 렌더
        ├── timeline.js      # 타임라인 패널 + 번호 DivIcon
        └── nav.js           # T맵/카카오내비 딥링크 빌더
```

---

## 단계별 실행 계획

### Step 0 — 변환 스크립트 먼저 (`tools/xlsx_to_locations.py`)

**이유**: Step 1부터 실제 75개 지점을 띄워 개발/검증하려면 `locations.json`이 먼저 있어야 한다. 수동 생성도 가능하지만, 엑셀이 원본이고 다른 지역 팀도 동일하게 써야 하므로 스크립트부터 만든다.

- CLI: `python tools/xlsx_to_locations.py --xlsx <path> [--out locations.json] [--strict]`
  또는 `--sheet <sheet_id> --gid <gid>` (구글시트 csv export로 다운로드)
- 엑셀/CSV 파싱: `openpyxl`(xlsx) / `csv`(구글시트). 3행을 헤더로 간주하고 `Point_Name`·`Address_1..4`·`Latitude`·`Longitude` 컬럼을 위치 대신 **이름으로 찾는다**(컬럼 순서 변경 대응).
- 출력 스키마 (지점 1건):
  ```json
  {
    "id": 1,
    "seq": 1026,
    "name": "동촌경로당",
    "address": "전라특별자치도 고창군 해리면 동촌리 550-1",
    "sigungu": "고창군",
    "lat": 35.390246,
    "lng": 126.492559
  }
  ```
  `id`는 유효 지점만 모은 후 1부터 재부여. `seq`는 엑셀 `NA` 값(원본 지점번호).
- 예외 처리: 좌표가 비었거나 숫자가 아닌 행 → 스킵 + `stderr`에 건수/seq 로그. `--strict`일 때는 즉시 종료.
- 이 단계는 코드 전 전북 데이터 1회 실행해 `locations.json` 생성 → Step 1부터 사용.

---

### Step 1 — 골격 + 지도 표시

**산출**: `app.py`, `templates/index.html`, `static/css/style.css`, `static/js/app.js`+`map.js`, `requirements.txt`

- `app.py`:
  - 기동 시 `locations.json` 로드 → `LOCATIONS` 전역.
  - `prefetch.py`의 백그라운드 프리페치 스레드 시작(Flask `before_first_request` 대신 앱 생성 시점에 `threading.Thread(daemon=True)`).
  - `GET /`: `index.html` 렌더, `LOCATIONS`를 `<script>window.LOCATIONS=...</script>`로 인라인 전달.
  - `GET /api/health`: `{"osrm": "ok|down|unknown", "matrix_cache": {"size": N, "prefetching": bool}}`.
  - `host="0.0.0.0", port=5000` (LAN 스마트폰 접속).
- `templates/index.html`: Bootstrap 5 CDN, 데스크톱 2열(사이드바/지도) + 모바일 nav-tabs(목록/경로/설정). Leaflet CSS/JS CDN.
- `static/js/map.js`:
  - Leaflet 지도 초기화, 중심은 `LOCATIONS` 평균 좌표.
  - 지점을 `CircleMarker`로 렌더. 색상은 `sigungu` → 팔레트 함수 결과. 팝업은 `seq / name / address`.
  - 데스크톱 우클릭 + 모바일 500ms 길게누르기 공통 핸들러 → 컨텍스트 메뉴(`여기서 출발` / `여기서 종료`).

---

### Step 2 — 지점 선택 + 설정 UI

**산출**: `selection.js`, 사이드바 완성.

- 사이드바 지점 목록: 체크박스 + 이름/시군구. 지도 마커 ↔ 체크박스 양방향 sync.
- 시군구 필터 버튼(팔레트 색상과 동일 배지)·텍스트 검색.
- 출발지 설정 UI:
  - 지도 우클릭/롱프레스 메뉴의 `여기서 출발`.
  - `GPS` 버튼 (`navigator.geolocation.getCurrentPosition`).
  - 설정된 출발지는 별 모양 마커(`L.divIcon`) 표시.
- 도착지 설정 UI: 우클릭 메뉴 `여기서 종료` **또는** 사이드바 `[도착지 설정]` 버튼(클릭 후 지도 1회 탭). 미설정 시 Open TSP.
- 시작시각(`<input type="time">`, 기본 09:00) · 체류시간(`<input type="number">`, 기본 20).
- 선택 개수 + 체류+직선추정 합으로 **대략 예상 시간** 실시간 표시.
- `[🔄 최적화]` 버튼 — 선택 ≥2이고 출발지 지정되어 있을 때 활성화.

---

### Step 3 — 최적화 엔진

**산출**: `distance_matrix.py`, `prefetch.py`, `optimizer.py`, `POST /api/optimize`.

- `distance_matrix.py`:
  - `get_matrix(coords: list[(lat,lng)]) -> {"durations":..., "distances":..., "source": "osrm"|"haversine"}`.
  - 내부 캐시: `dict[frozenset((lat,lng))_tuple] -> (dur, dist)` 페어의 pairwise dict. 실제로는 `(i_key, j_key) -> (sec, meter)` 1D 캐시 쓰고 조립 시 N×N 복원.
  - OSRM 호출: `http://router.project-osrm.org/table/v1/driving/{lng,lat;lng,lat;...}?annotations=duration,distance`, `timeout=10`, 재시도 없음. base URL은 `OSRM_BASE_URL` 환경변수로 override.
  - 실패(예외·HTTP≠200) 시 Haversine × 1.4, 평균속도 60km/h로 `dur`=거리/속도 계산, `source="haversine"` 표시.
- `prefetch.py`: 기동 시 `LOCATIONS` 전 좌표로 `get_matrix` 1회 호출 → 캐시 채움. 실패해도 앱은 기동(요청 시 재시도).
- `optimizer.py`:
  - OR-Tools `pywrapcp.RoutingModel`.
  - 노드: `[start] + selected_locations + ([end] if end else [])`.
  - depot = 0. end 지정 시 종단 노드 고정(`SetFixedCostOfAllVehicles` 대신 `SetEnd` 경로). 미지정 시 Open TSP — 마지막 노드를 자유롭게.
  - 비용 callback = `durations[i][j]`(초). 탐색 전략 = `PATH_CHEAPEST_ARC`, 메타휴리스틱 = `GUIDED_LOCAL_SEARCH`, 시간 제한 2초.
  - 결과 순서대로 `legs` 조립: `drive_min`(≈ duration/60 반올림), `drive_km`(distance/1000), `arrive`(누적), `depart`=arrive+stay.
- `POST /api/optimize` 스키마: PRD 명세 그대로. 응답에 `source` 추가. `polyline`은 OSRM route geometry(폴백일 때는 좌표 배열을 `LineString`으로 내려주고 프론트가 동일하게 렌더).
- 20개 이하 지점에서 총 응답 1초 이내 목표(프리페치로 warm 캐시 전제).

---

### Step 4 — 결과 렌더 + 내비 연동 + 인쇄

**산출**: `timeline.js`, `nav.js`, `optimize.js` 확장, print CSS.

- 결과 렌더:
  - 지도에 번호 DivIcon(①②③…) 마커 + `L.polyline(polyline_coords)` 경로선. 기존 선택 마커는 dim.
  - 하단 타임라인 패널: 출발 → 각 지점 도착/출발 → 합계(총 이동·총 체류·종료시각·총 km). `source="haversine"`이면 "거리 근사치" 배너.
- 내비 딥링크(`nav.js`):
  - T맵: `tmap://route?goalname={last_name}&goalx={lng}&goaly={lat}` + `viaX0/viaY0/viaName0…` 반복. 경유지 전체 지원.
  - 카카오내비: 공식 스킴 경유지 제한(공식 문서상 경유지 3~4개) 안에서 넣고, 초과분은 경고 모달 표시 후 **T맵 사용 권장**.
  - 데스크톱은 각각 웹 길찾기 URL로 폴백(앱 스킴이 실행 불가).
  - 앱 선택 버튼 2개(T맵 / 카카오). 카카오 버튼은 경유지 수에 따라 disabled + 툴팁.
- 인쇄 미리보기: 툴바 `🖨 인쇄` 버튼 → `window.print()`. `@media print`로 사이드바/버튼 숨기고 타임라인 + 지도 축소본 1장에 맞추기.

---

## 검증 (End-to-end)

1. `python tools/xlsx_to_locations.py --xlsx "측정표(배포용)_전북.xlsx" --out locations.json` → 75개 지점 생성 확인.
2. `pip install -r requirements.txt && python app.py` → 로그에 `prefetch started`, 수초 내 `prefetch done (N cells)`.
3. 크롬 `localhost:5000`: 75개 마커 + 시군구별 색상, 범례 필터 동작.
4. 마커 클릭 ↔ 사이드바 체크박스 양방향 sync.
5. 고창군 4개 선택 + 지도 우클릭 `여기서 출발` → `[최적화]` → 번호 마커 ①②③④ + 경로선 + 타임라인 표시. 응답 1초 이내.
6. Open TSP(도착지 미지정) vs 도착지 지정 비교 — 순서가 종단에 맞게 변하는지.
7. `OSRM_BASE_URL=http://127.0.0.1:1` 로 실행 → Haversine 폴백 + 근사치 배너 노출.
8. 스마트폰(LAN 접속): 지도 길게누르기 메뉴, 탭 네비 동작, `내비로 보내기`로 T맵 앱에서 경유지 포함 열림.
9. 20개 경유지 선택 후 카카오 버튼 비활성 + 툴팁 확인.
10. 인쇄 미리보기로 타임라인이 1페이지에 깔끔히 나오는지.
11. `GET /api/health` → `osrm` 상태·캐시 크기 반환.

## 인수 기준 (PRD 검증 항목 재확인)

- 지점 마커/색상/동기화 정상.
- 실제 카카오맵 경로와 총 시간 오차 10~30% 이내(방문 **순서**가 맞는지가 핵심).
- OSRM 차단 시에도 앱 정상 동작.
- `locations.json`만 교체하면 다른 지역에서도 기동 가능 (지역/전북 하드코딩 grep 0건).
