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
| 시군구 색상 | 주소 `sigungu` 값을 키로, 고정 팔레트에서 순차 배정 (지역 독립) |
| 폴백 표시 | 응답에 `source: "osrm"\|"haversine"` 포함 → 폴백일 때 결과 패널 상단에 "거리 근사치" 배너 |
| 모바일 지도 상호작용 | 길게누르기(500ms) == 데스크톱 우클릭 |
| JS 구조 | 역할별 ES module 분리(`map.js`/`selection.js`/`optimize.js`/`nav.js`/`timeline.js`) |
| OSRM 타임아웃 | 10초, 재시도 없음. 실패 즉시 Haversine 폴백 |
| 결과 공유 | 인쇄 미리보기(`window.print()` + print-only CSS) |
| 엑셀 스키마 | 헤더행 = `NA / Point_Name / Address_1..4 / Latitude / Longitude`. 4번째 데이터행부터 지점 |
| `address` 필드값 | `Address_4`(전체 주소). 추가로 `sigungu` = `Address_2`를 JSON에 포함 (색상 키용) |
| 변환 스크립트 입력 | 로컬 xlsx 경로 **및** 구글시트 ID+gid(csv export) 둘 다 |
| 변환 예외 | 오류 행은 스킵+경고 로그, `--strict`로 엄격 모드 전환 |
| Python 버전 | 3.8+ (OR-Tools 요구사항). requirements.txt에 명시 |
| Flask debug 모드 | 개발 시 `use_reloader=False` (prefetch 스레드 이중 실행 방지) |

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

> 진행 방식: Step별 새 대화 시작. 이 파일의 체크박스가 단계 간 핸드오프 기준.

---

### Step 0 — 변환 스크립트 (`tools/xlsx_to_locations.py`)

**이유**: Step 1부터 실제 75개 지점으로 개발/검증하려면 `locations.json`이 먼저 있어야 한다.

- [x] 실제 엑셀 파일 구조 확인 (헤더 행 위치, 컬럼명 일치 여부)
- [x] CLI argument parsing (`--xlsx`, `--out`, `--strict`, `--sheet`, `--gid`)
- [x] openpyxl xlsx 파싱 — 헤더 행 인식, 컬럼명 기반 탐색 (위치 기반 아님)
- [x] CSV (구글시트 csv export) 파싱
- [x] 출력 JSON 스키마 생성 (`id`, `seq`, `name`, `address`, `sigungu`, `lat`, `lng`)
- [x] 예외 처리: 오류 행 스킵 + stderr 로그, `--strict` 엄격 모드
- [x] 전북 xlsx 실행 → `locations.json` 생성, 75개 지점 확인

---

### Step 1 — 골격 + 지도 표시

**산출**: `app.py`, `requirements.txt`, `templates/index.html`, `static/css/style.css`, `static/js/app.js`, `static/js/map.js`

- [x] `requirements.txt` 작성 (flask, ortools, requests, openpyxl, Python>=3.8 명시)
- [x] `app.py`: 기동 시 `locations.json` 로드 → `LOCATIONS` 전역
- [x] `app.py`: `GET /` — `index.html` 렌더, `LOCATIONS`를 `window.LOCATIONS`로 인라인
- [x] `app.py`: `GET /api/health` — `{"osrm": "ok|down|unknown", "matrix_cache": {...}}`
- [x] `app.py`: `host="0.0.0.0", port=5000, use_reloader=False`
- [x] `prefetch.py`: `threading.Thread(daemon=True)` 기동 시 백그라운드 OSRM 호출 (stub — Step 3에서 완성)
- [x] `templates/index.html`: Bootstrap 5 CDN, Leaflet CDN, 데스크톱 2열(사이드바/지도)
- [x] `templates/index.html`: 모바일 nav-tabs (목록 / 경로 / 설정)
- [x] `static/css/style.css`: 기본 레이아웃 스타일
- [x] `static/js/map.js`: Leaflet 초기화, 중심 = `LOCATIONS` 평균 좌표
- [x] `static/js/map.js`: 전체 지점 `CircleMarker` 렌더 (색상은 `sigungu` → 팔레트)
- [x] `static/js/map.js`: 팝업 (seq / name / address)
- [x] `static/js/map.js`: 우클릭(데스크톱) + 롱프레스 500ms(모바일) 컨텍스트 메뉴 핸들러
- [ ] 검증: `python app.py` → 크롬 `localhost:5000`, 75개 마커 + 시군구별 색상 표시

---

### Step 2 — 지점 선택 + 설정 UI

**산출**: `static/js/selection.js`, 사이드바 완성

- [x] `selection.js`: 사이드바 지점 목록 체크박스 렌더 (이름/시군구)
- [x] 마커 클릭 → 체크박스 토글 (지도 → 사이드바)
- [x] 체크박스 클릭 → 마커 강조 (사이드바 → 지도)
- [x] 시군구 필터 버튼 (팔레트 색상 배지, 클릭 시 해당 시군구만 표시)
- [x] 텍스트 검색 (이름/주소 필터)
- [x] 출발지: 우클릭 메뉴 "여기서 출발" → 별 모양 마커 표시
- [x] 출발지: GPS 버튼 (`navigator.geolocation.getCurrentPosition`)
- [x] 도착지: 우클릭 메뉴 "여기서 종료" + 사이드바 `[도착지 설정]` 버튼
- [x] 시작시각 `<input type="time">` (기본 09:00) + 체류시간 `<input type="number">` (기본 20)
- [x] 선택 개수 + 대략 예상 시간 실시간 표시 (체류 + Haversine 직선 추정)
- [x] `[🔄 최적화]` 버튼: 선택 ≥2 이고 출발지 지정 시 활성화
- [ ] 검증: 마커 ↔ 사이드바 양방향 sync, 필터, GPS 동작

---

### Step 3 — 최적화 엔진

**산출**: `distance_matrix.py`, `prefetch.py` (완성), `optimizer.py`, `POST /api/optimize`

- [x] `distance_matrix.py`: `get_matrix(coords)` 함수 시그니처 확정
- [x] OSRM Table API 호출 (`/table/v1/driving/{coords}?annotations=duration,distance`)
- [x] `OSRM_BASE_URL` 환경변수 override 지원 (기본 `http://router.project-osrm.org`)
- [x] pairwise 캐시 구조: `(key_i, key_j) -> (sec, meter)`, 조회 시 N×N 복원
- [x] timeout=10초, 실패(예외·HTTP≠200) 즉시 Haversine×1.4 폴백
- [x] Haversine 폴백: 평균속도 60km/h로 `dur` 계산, `source="haversine"` 표시
- [x] 반환 형식: `{"durations": [[...]], "distances": [[...]], "source": "osrm"|"haversine"}`
- [x] `prefetch.py` 완성: 전체 `LOCATIONS` 좌표로 `get_matrix` 1회 호출 → 캐시 채움
- [x] `optimizer.py`: OR-Tools `pywrapcp.RoutingModel` 초기화
- [x] depot=0, 비용 callback = `durations[i][j]` (초)
- [x] 탐색: `PATH_CHEAPEST_ARC` 초기해 + 시간 제한 (소규모 ≤12노드 즉시 응답)
- [x] Open TSP (도착지 미지정) vs 종단 노드 고정 (도착지 지정) 분기 처리
- [x] `legs` 조립: `drive_min`, `drive_km`, `arrive`(누적), `depart`(arrive+stay)
- [x] `POST /api/optimize` 엔드포인트 구현 (PRD 명세 + `source` 필드)
- [x] `polyline`: 직선 좌표 배열 (`[[lat,lng],...]`)
- [x] 검증: 고창군 4개 지점 최적화, warm 캐시 기준 응답 14ms
- [x] 검증: Open TSP vs 종단 고정 — 순서 차이 확인
- [x] 검증: `OSRM_BASE_URL=http://127.0.0.1:1` → Haversine 폴백 동작

---

### Step 4 — 결과 렌더 + 내비 연동 + 인쇄

**산출**: `optimize.js` (확장), `timeline.js`, `nav.js`, print CSS

- [x] `optimize.js`: `POST /api/optimize` 호출 + 로딩 스피너
- [x] `optimize.js`: 응답 받으면 `timeline.js` / `map.js` 결과 렌더 트리거
- [x] `timeline.js`: 타임라인 패널 — 출발 → 각 지점 도착/출발 → 합계
- [x] `timeline.js`: 합계 행 (총 이동·총 체류·종료시각·총 km)
- [x] `timeline.js`: `source="haversine"` 시 "거리 근사치" 배너 표시
- [x] `map.js`: 번호 DivIcon 마커 추가, 기존 선택 마커 dim 처리
- [x] `map.js`: `L.polyline(polyline_coords)` 경로선 렌더
- [x] `nav.js`: T맵 딥링크 빌더 (`tmap://route?...&viaX0=...`) — 경유지 전체 지원
- [x] `nav.js`: 카카오내비 딥링크 빌더 — 경유지 3개 초과 시 disabled + 툴팁
- [x] `nav.js`: 데스크톱 웹 길찾기 URL 폴백 (앱 스킴 실행 불가)
- [x] 내비 버튼 2개 (T맵 / 카카오) + 카카오 경유지 초과 시 disabled + 툴팁
- [x] 인쇄 버튼 (`window.print()`) + `@media print` CSS (사이드바/버튼 숨기기, 1페이지)
- [ ] 검증: 스마트폰 LAN 접속, 롱프레스, 탭 네비 동작 (실 기기 필요)
- [ ] 검증: T맵/카카오 앱에서 경유지 포함 열림 (실 기기 필요)
- [x] 검증: 20개 경유지 → 카카오 버튼 비활성 (waypoints > 3 시 exceeded=True 확인)
- [ ] 검증: 인쇄 미리보기 1페이지 확인 (브라우저 필요)

---

## 최종 E2E 검증

- [ ] `python tools/xlsx_to_locations.py --xlsx "측정표(배포용)_전북.xlsx" --out locations.json` → 75개 지점
- [ ] `pip install -r requirements.txt && python app.py` → 로그에 `prefetch started`, 수초 내 `prefetch done`
- [ ] 크롬 `localhost:5000`: 75개 마커 + 시군구별 색상 + 필터 동작
- [ ] 마커 클릭 ↔ 사이드바 체크박스 양방향 sync
- [ ] 고창군 4개 선택 + 우클릭 출발지 → [최적화] → 번호 마커 + 경로선 + 타임라인, 1초 이내
- [ ] Open TSP(도착지 미지정) vs 도착지 지정 — 종단에 맞게 순서 변화 확인
- [ ] `OSRM_BASE_URL=http://127.0.0.1:1` → Haversine 폴백 + 근사치 배너 노출
- [ ] 실제 카카오맵 경로 대비 총 시간 오차 10~30% 이내
- [ ] 스마트폰 LAN 접속: 지도 롱프레스 메뉴, 탭 네비 동작
- [ ] T맵/카카오 앱 딥링크 → 경유지 포함 열림
- [ ] 20개 경유지 → 카카오 버튼 비활성 + 툴팁
- [ ] 인쇄 미리보기 1페이지
- [ ] `GET /api/health` → OSRM 상태·캐시 크기 반환
- [ ] `locations.json` 교체 후 지역 하드코딩 `grep "전북"` 0건
