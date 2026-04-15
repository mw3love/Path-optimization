# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태

코드 없음. [prd.md](prd.md)와 원본 데이터 엑셀(`측정표(배포용)_전북.xlsx`)만 존재. 구현은 PRD의 4단계 계획에 따라 진행한다.

## 프로젝트 개요

KBS 라디오 전파 측정을 위한 **차량 방문 경로 최적화 단일 페이지 웹앱**. 지도에서 오늘 방문할 지점을 선택 → OR-Tools로 방문 순서 최적화 → T맵/네이버지도로 경로 전송.

- 사용 환경: 운영자 본인 PC에서 Flask 실행, 같은 와이파이의 스마트폰에서 접속
- 배포 단위는 "코드 + `locations.json`" — 다른 지역 팀은 `locations.json`만 교체해서 같은 코드를 돌린다. 따라서 **지역/지점 하드코딩 금지**.

## 실행 / 개발 명령 (구현 후)

```bash
pip install -r requirements.txt
python app.py          # http://localhost:5000
```

LAN 스마트폰 접속을 전제로 하므로 Flask는 `host="0.0.0.0"`으로 바인딩해야 한다 (PRD의 "같은 와이파이 내 스마트폰: http://192.168.x.x:5000").

## 아키텍처

PRD가 지정한 파일 구조:

```
app.py              # Flask 엔트리. GET / + POST /api/optimize 두 개뿐.
optimizer.py        # OR-Tools TSP (pywrapcp). Open TSP / 종단 고정 분기.
distance_matrix.py  # OSRM Table API + 프로세스 메모리 캐시 + Haversine×1.4 폴백
locations.json      # 지점 데이터(수동 작성, 지역별 교체 대상)
templates/index.html
static/js/app.js    # Leaflet + 선택 UI + 결과 렌더 + 내비 딥링크
static/css/style.css
```

### 상태 저장 모델 — **DB 없음**
서버는 프로세스 메모리에만 상태를 둔다:
- `LOCATIONS`: 기동 시 `locations.json` 로드
- `DISTANCE_MATRIX_CACHE`: 최초 최적화 요청 때 전체 N×N(예: 75×75) OSRM Table을 1회 계산해 캐시. 이후 재사용. 프로세스 재시작 시 재계산(수 초).

방문 상태/메모/이력은 저장하지 않는다. 로그인/프로젝트/시트연동/지오코딩/지점 CRUD UI도 **명시적으로 범위 밖**이다 (PRD "명시적으로 하지 않는 것" 참조). 기능 추가 제안 전 이 목록을 확인할 것.

### 최적화 흐름
1. 프론트가 `POST /api/optimize`에 `location_ids[]`, `start{lat,lng,label}`, `end`(nullable), `start_time`, `stay_minutes` 전송.
2. `distance_matrix`가 필요한 좌표(출발+도착+선택지점)의 duration/distance 행렬을 캐시에서 조회하거나 OSRM Table 호출.
3. `optimizer`가 depot=출발지로 두고 OR-Tools로 TSP. `end`가 있으면 종단 노드 고정, 없으면 Open TSP.
4. 응답에 순서(`order`), 구간별 `legs`(drive_min/km, arrive/depart), 합계, `polyline`(도로 경로 좌표) 포함.

### 폴백 규칙
- **거리/시간 행렬**: OSRM Table API 실패 시 Haversine × 1.4, 평균 60km/h 추정.
- **경로선(polyline)**: `distance_matrix.fetch_route_geometry()`가 OSRM Route API(`/route/v1/driving/...?overview=full&geometries=geojson`)로 실제 도로 좌표를 가져옴. Route API 실패 시 직선 좌표 배열로 폴백. 어떤 경우에도 `polyline`은 빈 값 대신 프론트가 처리할 수 있는 형태로 반환.
- `source` 필드: `"osrm"` | `"haversine"` — 타임라인 배너로 사용자에게 표시.

### 프론트 규약
- 지도: Leaflet + OSM 타일. 지점은 CircleMarker, **시군구별 색상은 `address` 문자열에서 자동 추출**(예: "전북 고창군 …" → "고창군").
- 마커 ↔ 사이드바 체크박스는 양방향 동기화.
- 결과 마커는 번호 DivIcon(①②③…).
- 내비 딥링크: T맵 `tmap://route?...&viaX0=…&viaY0=…` (경유지 제한 없음), 네이버지도 `nmap://route/car?...&waypoints=lat,lng|…` (경유지 최대 5개). 데스크톱에서는 T맵 웹 길찾기 URL로 폴백. 경유지 초과 시 해당 버튼 비활성화.

## 문서 관리

- 루트 `CLAUDE.md`는 **200줄 미만** 유지.
- 200줄 초과 시 해당 폴더에 별도 `CLAUDE.md` 신설하고, 루트에 `→ [폴더명](폴더명/CLAUDE.md)` 형태로 참조.

## 진행 규칙

- 구현은 **`plan.md`의 단계 순서**대로.
- 모호한 요구사항은 구현 착수 전 관련 질문을 **한 번에 묶어** 확인할 것 — 가정으로 진행 금지.
- 각 단계 완료 후 **Explore 서브에이전트**로 검토:
  - `plan.md` 해당 단계 체크박스 전부 충족 여부
  - PRD + 이 파일 코딩 지침 준수 여부
  - `python -m py_compile` / 브라우저 콘솔 오류 없는지
- 검토 통과 후: `plan.md` 체크박스 업데이트 → `현재 상태` 섹션 갱신.

## 코딩 지침

- `locations.json` 스키마: `{id, seq, name, address, lat, lng}`. 필드명을 임의로 바꾸지 말 것(다른 지역 팀 파일과 호환 유지).
- OR-Tools 해는 20개 이하에서 1초 내 최적해가 목표. 탐색 전략을 바꿀 때는 이 성능 목표를 깨지 말 것.
- 오차 허용: OSRM 기반 총 시간은 실제 대비 10~30% 오차 허용(검증 기준 5번). 방문 **순서**가 맞는 것이 우선.
