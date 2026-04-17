# 전파조사 경로 최적화 웹앱 구현 계획 (최소안)

## Context

KBS 라디오 전파 측정을 위해 전북 지역 75개 지점을 차량으로 방문.
2인 1조로 며칠에 걸쳐 전체 지점을 순회함.
**매일 방문할 지점을 지도에서 선택하면 최적 방문 순서와 예상 소요시간을 계산하고, 내비 앱으로 전송하는 웹앱.**

다른 지역 팀도 같은 코드를 각자 PC에서 실행해 사용 예정 (지점 파일만 교체).

### 핵심 기능 (이것만 한다)
1. 지도 위에 지점 전체 표시
2. 오늘 갈 지점 선택
3. 출발지 설정 (도착지는 선택)
4. **경로 최적화** (방문 순서 결정)
5. 결과: 지도 경로선 + 번호 마커 + 타임라인(구간/총 시간)
6. 카카오내비/T맵으로 전체 경로 일괄 전송

### 명시적으로 하지 않는 것
- 로그인/회원/팀 공유
- 프로젝트 개념 (단일 지점 파일 사용)
- 구글시트/엑셀 연동
- 방문 상태·메모·이력 저장
- 데이터베이스
- 지오코딩 (좌표는 이미 `locations.json`에 있음)
- 지점 수동 추가/삭제 UI
- 오프라인/PWA/백업

---

## 기술 스택

| 구분 | 선택 | 이유 |
|------|------|------|
| Backend | **Flask** (Python) | 최적화 API 1개만 제공, 경량 |
| Frontend | **Vanilla JS + Leaflet + Bootstrap 5** | CDN, API키 불필요, 반응형 |
| 지도 | **Leaflet + OpenStreetMap** | 무료, 키 불필요 |
| 거리 행렬 | **OSRM Table API** | 무료, NxN 1회 호출 |
| 경로 최적화 | **Google OR-Tools** | 무료, 20개 이하 < 1초, 최적해 |
| 내비 연동 | **카카오내비/T맵 딥링크** | 앱 URL scheme |

### 거리 행렬 전략
- 앱 시작 후 첫 최적화 시 **75x75 행렬 1회 계산** → 프로세스 메모리에 캐시
- 이후 최적화는 캐시 재사용 (서버 껐다 켜면 재계산, 수 초)
- OSRM 실패 시 **Haversine × 1.4 (도로 우회율)** 폴백

### 알려진 한계
- OSRM은 OSM 도로 데이터 → 한국 농촌 도로 시간 오차 10~30% 가능. 방문 **순서** 최적화에는 충분. 실제 운전은 카카오내비/T맵이 담당.
- OSRM 공개 데모 서버는 간헐적 지연 가능 → 폴백으로 대응.

---

## 데이터

### `locations.json` (앱 시작 시 로드)
```json
[
  {"id": 1, "seq": 1026, "name": "동촌경로당", "address": "전북...", "lat": 35.390246, "lng": 126.492559},
  {"id": 2, "seq": 1027, "name": "신평경로당", "address": "전북...", "lat": 35.391234, "lng": 126.493456},
  ...
]
```
- 전북용 파일은 최초 1회 수동 작성 (엑셀/구글시트에서 복사해 편집)
- 다른 지역 팀은 자기 지점들로 같은 구조의 파일만 교체하면 됨

### 서버 메모리 상태 (DB 없음)
- `LOCATIONS`: `locations.json` 로드값
- `DISTANCE_MATRIX_CACHE`: OSRM 계산 결과 (있을 때만)

---

## 워크플로우

```
브라우저 접속 → 75개 지점 마커 지도에 표시
    ↓
① 오늘 갈 지점 선택 (지도 마커 클릭 또는 사이드바 체크박스)
    ↓
② 출발지 설정 (지도 클릭 "여기서 출발" / GPS 버튼)
   (선택) 도착지 설정 — 비우면 Open TSP, 마지막 지점에서 끝
    ↓
③ 시작시각(기본 09:00) 및 체류시간(기본 20분/지점) 확인
    ↓
④ "경로 최적화" 버튼
    ↓
지도에 번호 마커(①②③…) + 경로선 + 하단 타임라인
    ↓
"내비로 보내기" → 카카오내비 또는 T맵 앱 열림 (전체 경로)
```

---

## 화면 (단일 페이지)

### 데스크톱
```
┌──────────────────────────────────────────────────────┐
│ 전파조사 경로 최적화                                    │
├───────────────┬──────────────────────────────────────┤
│  사이드 패널    │              지도 영역                │
│               │                                       │
│ ── 필터 ──    │      🔴 🔴 🔴       ← 시군구별 색상    │
│ 시군구 버튼    │        🔵    🟢                      │
│               │      🔵                               │
│ ── 지점 목록 ──│            🟢                         │
│ ☑ 동촌경로당   │     🟡        🟠                      │
│   고창        │                                       │
│ ☑ 신평경로당   │   ★ 출발지                             │
│   고창        │                                       │
│ □ 대산게이트… │                                       │
│ …            │                                       │
│               │                                       │
│ 선택: 12개     │                                       │
│ 예상: ~6h30m  │                                       │
│               │                                       │
│ 출발지: [설정] │                                       │
│ 도착지: [선택] │                                       │
│ 시작: [09:00] │                                       │
│ 체류: [20분]  │                                       │
│               │                                       │
│ [🔄 최적화]    │                                       │
├───────────────┴──────────────────────────────────────┤
│  🚗 경로 결과                         [📱 내비로 보내기]│
│  ★ 출발  09:00                                         │
│  │  ↓ 35분 (28km)                                     │
│  ① 동촌경로당   09:35~09:55                             │
│  │  ↓ 15분 (12km)                                     │
│  ② 신평경로당   10:10~10:30                             │
│  …                                                    │
│  ⑫ 마지막지점   16:30~16:50                             │
│  총 이동 2h45m │ 총 체류 4h │ 종료 16:50 │ 총 142km      │
└──────────────────────────────────────────────────────┘
```

### 모바일
- 상단 55% 지도, 하단 탭(목록 / 경로 결과 / 설정)
- 탭 전환은 Bootstrap nav-tabs

---

## API

### `GET /`
단일 페이지 렌더링. `LOCATIONS`를 JSON으로 함께 내려줌.

### `POST /api/optimize`
**요청**
```json
{
  "location_ids": [1, 2, 5, 8, 12],
  "start": {"lat": 35.824, "lng": 127.148, "label": "전주역"},
  "end": null,
  "start_time": "09:00",
  "stay_minutes": 20
}
```

**응답**
```json
{
  "order": [5, 1, 2, 12, 8],
  "legs": [
    {"from": "전주역", "to": "동촌경로당", "drive_min": 35, "drive_km": 28,
     "arrive": "09:35", "depart": "09:55"}
  ],
  "total_drive_min": 165,
  "total_stay_min": 100,
  "total_duration_min": 265,
  "total_km": 142,
  "end_time": "16:50",
  "polyline": "<OSRM route geometry>"
}
```

---

## 파일 구조

```
route-optimizer/
├── app.py              # Flask: GET / + POST /api/optimize
├── optimizer.py        # OR-Tools TSP
├── distance_matrix.py  # OSRM Table API + 메모리 캐시 + Haversine 폴백
├── locations.json      # 지점 데이터 (수동 작성)
├── requirements.txt    # flask, ortools, requests
├── templates/
│   └── index.html      # 단일 페이지 (Bootstrap 5 CDN)
└── static/
    ├── css/style.css
    └── js/app.js       # Leaflet 지도 + 선택 + 최적화 요청 + 결과 렌더 + 내비 딥링크
```

---

## 구현 단계 (4단계)

### Step 1: 골격 + 지도 표시
- Flask 앱, `locations.json` 로드
- Bootstrap 5 베이스 템플릿 (반응형)
- Leaflet 지도에 전체 지점 **CircleMarker** 표시, 시군구별 색상(주소에서 자동 추출)
- 마커 클릭 시 팝업 (번호/이름/주소)
- **파일**: `app.py`, `templates/index.html`, `static/js/app.js`, `static/css/style.css`

### Step 2: 지점 선택 + 설정 UI
- 사이드바 지점 목록 (체크박스) ↔ 지도 마커 양방향 동기화
- 시군구 필터 버튼, 텍스트 검색
- 출발지 설정: 지도 우클릭 "여기서 출발" / GPS 버튼 / 주소 입력
- 도착지 선택 (선택 사항, 비우면 Open TSP)
- 시작시각/체류시간 입력
- 선택 개수 + 대략 예상 시간 실시간 표시

### Step 3: 최적화 엔진
- `distance_matrix.py`: OSRM Table API 호출, 결과를 딕셔너리 캐시
  - 엔드포인트: `http://router.project-osrm.org/table/v1/driving/{coords}?annotations=duration,distance`
  - 폴백: Haversine × 1.4, 평균속도 60km/h
- `optimizer.py`: OR-Tools `pywrapcp`
  - 출발지 = depot (0번 노드), 도착지 지정 시 종단 노드 고정
  - 도착지 없으면 Open TSP (종단 제약 없음)
  - 체류시간 포함 총 소요시간 계산
- `/api/optimize` 엔드포인트 구현

### Step 4: 결과 렌더 + 내비 연동
- 지도에 번호 DivIcon 마커(①②③…) + Polyline (OSRM 경로 geometry)
- 타임라인 패널: 구간별 이동/체류 + 합계
- **내비 딥링크 (전체 경로)**:
  - T맵 (경유지 지원): `tmap://route?goalname={last}&goalx={lng}&goaly={lat}&viaX0=…&viaY0=…`
  - 카카오내비: 다중 경유지 지원 범위 내에서 URL 구성
  - 모바일: 앱 자동 열림, 데스크톱: 해당 웹 길찾기 URL 폴백
  - 사용자가 선택한 지점만 묶어서 전송

---

## 배포

```bash
pip install -r requirements.txt
python app.py
# 본인 PC 접속: http://localhost:5000
# 같은 와이파이 내 스마트폰: http://192.168.x.x:5000
```
- 사용 시에만 서버 가동
- 다른 지역 팀: 같은 코드 받아서 `locations.json`만 교체

---

## 검증 계획

1. `python app.py` → 크롬에서 `localhost:5000` 접속
2. 75개 지점 마커 + 시군구별 색상 표시 확인
3. 지도 마커 ↔ 사이드바 선택 동기화 확인
4. 고창군 4개 지점 + 출발지 설정 → 최적화 → 번호/경로선/타임라인 확인
5. 실제 카카오맵 경로와 총 시간 비교, 오차 10~30% 내 확인
6. 스마트폰 브라우저 → 반응형 + 터치 선택 동작
7. "내비로 보내기" → 카카오내비/T맵 실제 앱 경유지 포함 열림 확인
8. OSRM 공개 서버 차단 시 폴백(Haversine) 동작 확인

---

## 구현 변경사항 (원안 대비)

> 원안은 위에 그대로 유지. 실제 구현 과정에서 원안과 달라진 내용을 여기에 기록.

### 변경사항

| 항목 | 원안 | 실제 구현 |
|------|------|-----------|
| JS 파일 구조 | `static/js/app.js` 단일 파일 | 역할별 모듈 분리: `app.js`, `map.js`, `selection.js`, `optimize.js`, `timeline.js`, `admin.js` |
| SSL 인증서 | 수동으로 `cert.pem`/`key.pem` 준비 | 앱 시작 시 LAN IP SAN 포함 자체 서명 인증서 자동 생성 |
| `locations.json` 스키마 | `{id, seq, name, address, lat, lng}` | `sigungu` 필드 추가 — 시군구 색상 키로 사용 |
| 카카오내비 경유지 | "가능한 범위 내" (미정) | 3개 초과 시 버튼 비활성 + 초과 안내 툴팁 |
| 배포 프로토콜 | `http://` | `https://` (자동 인증서, GPS 기능 HTTPS 필수) |
| 시군구 색상 키 | `address` 문자열에서 추출 | `sigungu` 필드 직접 사용 |

### 추가 파일 (원안에 없던 것)

- `prefetch.py`: 서버 기동 시 백그라운드 스레드로 전체 75×75 OSRM Table 미리 계산
- `data_source.json`: 데이터 소스 메타데이터
- `tools/xlsx_to_locations.py`: Excel/Google Sheets → `locations.json` 변환 CLI (`--xlsx`, `--gid`, `--strict` 등)
- `templates/admin.html` + `static/js/admin.js`: 관리 페이지

---

## 추가 확장 기능 (원래 범위 밖)

아래 기능은 PRD 원안의 "명시적으로 하지 않는 것" 범위를 넘지만, 운영 편의를 위해 추가됨.

### N일 경로 계획 (`POST /api/optimize-multiday`)

전체 미방문 지점을 N일에 걸쳐 자동 배분하고 각 날의 최적 순서를 계산.

- `optimizer.py`의 `assign_days()`: Greedy Nearest-Neighbor로 날짜별 지점 배분
- 프론트: `multiday.js` — 그룹 표시 → 날짜별 패널 설정 → 최종 계산 6단계 흐름

### 관리 페이지 (`GET /admin`)

서버 재시작 없이 지점 데이터를 교체할 수 있는 웹 UI.

- Excel 파일 업로드 또는 Google Sheets ID 입력 → `locations.json` 즉시 갱신
- `templates/admin.html` + `static/js/admin.js`
- 내부용(운영자만 사용). 인증 없음.
