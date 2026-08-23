# 사내 경로 최적화 서비스 — 장소 공유 설계

## Context

전파조사 목적은 종료되었으나 경로 최적화 도구는 계속 사용한다. 대상은 회사 전체(수백~수천 명, 대부분 서로 모름) — 개인/출장 여행 경로를 각자 계획하는 사내 서비스로 전환한다. 기존 앱은 운영자 1인이 로컬 PC에서 Flask를 띄우고 `locations.json` 정적 파일 + 프로세스 메모리만 쓰는 구조(DB 없음)였다. 이번 설계는 그 위에 "장소를 웹에서 빠르게 추가하고, 기본은 나만 보되 원하는 사람에게 선택적으로 공유"하는 기능을 얹는다.

**국내 우선, 해외는 확장 여지만 남긴다.**

## 범위

### 이번에 하는 것
- 사내 이메일 매직링크 로그인 (계정 시스템 최초 도입)
- 장소 추가: 주소/장소명 검색(카카오 지오코딩), GPS 버튼, 지도 클릭 — 뒤 둘은 기존 우클릭/롱프레스 메뉴 확장
- 장소 공개 범위: 기본 비공개(작성자만) → 특정 이메일에 공유 → 회사 전체 공개, 3단계
- 경로 최적화(OR-Tools/OSRM)는 지점 소스만 DB로 바뀔 뿐 로직 변경 없음

### 이번에 하지 않는 것 (명시적 범위 밖)
- 부서/조직도 연동 — 공유는 이메일 주소 직접 지정만
- SSO(Google/MS365) — 매직링크만
- 기존 KBS 75개 지점 마이그레이션 — 폐기(사용자 결정)
- 이메일 실제 발송 연동 — 아래 "결정 보류" 참조
- 신고/레이트리밋 등 익명 대중 방어 장치 — 사내 폐쇄 서비스라 불필요

### 결정 보류 (구현 중 확정 필요)
- **이메일 발송 수단**: 사내 SMTP vs 외부 API(Resend 등) — 사용자가 "나중에 결정"으로 보류. 로컬 개발/테스트 단계에서는 실제 발송 대신 **매직링크를 서버 콘솔에 로그로 출력**하는 방식으로 임시 대체(아래 "인증 흐름" 참조). 이 인터페이스(`send_magic_link(email, link)`) 하나만 나중에 실제 발송 함수로 교체하면 되므로, 발송 수단 미정이 다른 설계를 막지 않는다.

## 아키텍처

```
브라우저 ── /auth/request-link (email) ──▶ Flask
                                              │ 토큰 생성 + (dev: 콘솔 로그 / prod: 이메일 발송)
브라우저 ◀── /auth/verify?token=... ──────────┘ 세션 쿠키 발급
                                              │
브라우저 ── /api/locations (GET/POST) ──▶ Flask ──▶ SQLite
                                              │        ├─ users
                                              │        ├─ locations
                                              │        └─ location_shares
브라우저 ── /api/geocode?q=... ──▶ Flask ──▶ 카카오 로컬 API (프록시, 키 서버 보관)
브라우저 ── /api/optimize (기존) ──▶ Flask ──▶ OR-Tools + OSRM (변경 없음)
```

DB는 SQLite 파일(`route-optimizer/app.db`)로 시작한다. 회사 규모(읽기 위주, 동시 쓰기 적음)에서는 충분하고, 로컬 테스트 우선이라는 현재 방침과도 맞다. 나중에 실제 배포처를 정하고 동시 쓰기 부하가 커지면 Postgres로 이관 — 스키마가 단순해 이관 비용은 작다.

## 데이터 모델

```sql
users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,       -- 사내 도메인만 허용 (검증은 애플리케이션 레벨)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

locations (
  id INTEGER PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  source TEXT NOT NULL,             -- 'geocode' | 'gps' | 'map_click'
  is_public INTEGER NOT NULL DEFAULT 0,  -- 회사 전체 공개 여부
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

location_shares (
  location_id INTEGER NOT NULL REFERENCES locations(id),
  shared_with_email TEXT NOT NULL,  -- 계정 존재 여부와 무관하게 저장 가능(초대 전 공유 허용)
  PRIMARY KEY (location_id, shared_with_email)
)

auth_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
)
```

**가시성 조회 규칙** (지도/목록에 표시할 지점):
```sql
WHERE owner_user_id = :current_user_id
   OR is_public = 1
   OR id IN (SELECT location_id FROM location_shares WHERE shared_with_email = :current_user_email)
```

`sigungu`(시군구) 필드는 기존처럼 색상 키로 계속 쓰되, 값이 없는 사용자 입력 지점은 주소 문자열에서 자동 추출하거나 공란 처리(팔레트 fallback 색상 1개 지정). 해외 확장 시 이 개념 자체를 `region`으로 일반화해야 하지만 지금은 손대지 않는다.

## 인증 흐름

1. `POST /auth/request-link {email}` — 이메일 도메인이 허용 목록(`.env`의 `ALLOWED_EMAIL_DOMAIN`)과 일치하는지 확인 → `auth_tokens`에 1회용 토큰(만료 15분) 저장 → `send_magic_link(email, link)` 호출
   - dev 모드: 콘솔에 링크 출력 (`ALLOWED_EMAIL_DOMAIN` 설정 없으면 전체 허용, 로컬 테스트 편의)
   - prod 모드: 이메일 발송 수단 확정 후 구현 (결정 보류 항목)
2. `GET /auth/verify?token=...` — 토큰 유효성(만료·1회성) 확인 → `users` 테이블에 email upsert → 서명된 세션 쿠키 발급 (Flask `session`, `SECRET_KEY` 필요) → 토큰 소모 처리
3. 이후 모든 `/api/*` 요청은 세션 쿠키로 `current_user` 식별. 미로그인 시 401.

## 장소 추가 흐름

1. **검색**: 프론트에서 `/api/geocode?q=` 호출(디바운스) → 카카오 키워드/주소 검색 결과 자동완성 리스트 → 선택 시 좌표 확정
2. **GPS**: 기존 `navigator.geolocation` 버튼 재사용, 좌표를 이름 입력 폼에 바로 채움
3. **지도 클릭**: 기존 우클릭/롱프레스 메뉴에 "여기에 장소 추가" 항목 추가
4. 셋 다 공통 폼(이름 필수, 주소/좌표 자동, 공개범위 기본 "비공개")으로 수렴 → `POST /api/locations`
5. 지점 상세에서 "공유" 버튼 → 이메일 입력 여러 개 추가/삭제, "회사 전체 공개" 토글

## 에러 처리

- 카카오 API 실패/쿼터 초과: 검색 결과 없음으로 표시 + "주소 검색 실패, 지도에서 직접 선택하세요" 안내(기존 OSRM 폴백 배너와 같은 패턴)
- 매직링크 만료/재사용: "링크가 만료되었습니다. 다시 요청하세요" + 재요청 버튼
- 허용 도메인 외 이메일로 로그인 시도: 요청 단계에서 거부, 토큰 발급 안 함(발급 여부로 사내 이메일 존재를 노출하지 않기 위해 응답 메시지는 성공 시와 동일하게 유지 — 이메일 열거 공격 방지)

## 테스트 계획

1. `python -m py_compile` 전체 모듈 통과
2. 매직링크: 콘솔 로그 링크로 로그인 → 세션 쿠키 확인 → `/api/locations` 200
3. 지점 추가 3경로(검색/GPS/지도클릭) 각각 DB에 정확한 owner_user_id로 저장되는지 확인
4. 가시성: 사용자 A가 비공개로 추가 → 사용자 B 조회 시 안 보임 → A가 B 이메일로 공유 → B 조회 시 보임 → A가 공개 전환 → 제3의 사용자 C도 보임
5. 기존 `/api/optimize` 흐름이 DB 기반 지점으로도 그대로 동작(선택 → 최적화 → 타임라인)
6. 만료된 토큰으로 `/auth/verify` 시도 시 거부 확인

## 미해결 항목 (구현 착수 전 재확인)

- 이메일 발송 수단 (사내 SMTP vs 외부 API vs 계속 콘솔 로그로 임시 운영)
- 실제 배포처 (Railway 무료 종료 → 대안 미정, 로컬 우선 진행)
- `admin.html`(엑셀 일괄 임포트)을 새 구조에서 어떤 용도로 남길지 — 관리자용 "회사 공개 지점" 대량 등록 도구로 재활용할지, 폐기할지
