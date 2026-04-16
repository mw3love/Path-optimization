/**
 * multiday.js — N일 경로 계획 UI 모듈
 *
 * initMultiday(state, locations) 를 호출해 모달·결과 이벤트를 바인딩한다.
 * 반환: { openModal }
 */
import { clearResultLayers, addNumberedMarker, drawPolyline } from "./map.js";
import { buildTimelineHtml } from "./timeline.js";
import { buildNavButtons } from "./nav.js";

// ── 날짜별 색상 팔레트 ────────────────────────────────────────────────────────
export const DAY_COLORS = [
  "#1a73e8", "#2e7d32", "#c62828", "#f57f17",
  "#6a1b9a", "#00838f", "#4e342e",
];

// ── 모듈 초기화 ───────────────────────────────────────────────────────────────
export function initMultiday(state, locations) {
  _state = state;
  _locations = locations;

  // 모달 닫기 버튼
  document.getElementById("md-modal-close")
    ?.addEventListener("click", _closeModal);
  document.getElementById("md-modal-backdrop")
    ?.addEventListener("click", _closeModal);

  // 일수 변경 → 카드 재생성
  document.getElementById("md-num-days")
    ?.addEventListener("input", _onNumDaysChange);

  // 일정 계산 버튼 (Phase 1)
  document.getElementById("md-estimate-btn")
    ?.addEventListener("click", _runEstimate);

  // 재계산 버튼
  document.getElementById("md-reestimate-btn")
    ?.addEventListener("click", _runEstimate);

  // 계획 생성 버튼
  document.getElementById("md-submit-btn")
    ?.addEventListener("click", _runMultidayOptimize);

  // 결과 패널 닫기
  document.getElementById("md-result-close")
    ?.addEventListener("click", _hideResult);

  return { openModal, runGrouping: _runGrouping };
}

// ── 모달 열기/닫기 ────────────────────────────────────────────────────────────
export function openModal() {
  const modal = document.getElementById("multiday-modal");
  if (!modal) return;

  // Phase 1으로 리셋: 추정 배너 숨김, submit 숨김, estimate 표시
  document.getElementById("md-estimate-banner")?.classList.add("d-none");
  document.getElementById("md-submit-btn")?.classList.add("d-none");
  document.getElementById("md-estimate-btn")?.classList.remove("d-none");

  // 날별 카드 초기화
  const dayRows = document.getElementById("md-day-rows");
  if (dayRows) dayRows.innerHTML = "";

  // stay_minutes 동기
  const stayEl = document.getElementById("stay-minutes")
    || document.getElementById("stay-minutes-m");
  const mdStay = document.getElementById("md-stay-minutes");
  if (stayEl && mdStay) {
    mdStay.value = stayEl.value || "20";
  }

  modal.classList.remove("d-none");
  modal.setAttribute("aria-hidden", "false");
}

function _closeModal() {
  const modal = document.getElementById("multiday-modal");
  if (modal) {
    modal.classList.add("d-none");
    modal.setAttribute("aria-hidden", "true");
  }
}

function _hideResult() {
  const panel = document.getElementById("multiday-result-panel");
  if (panel) panel.classList.add("d-none");
  clearResultLayers();
}

// ── 6단계 UX: 그룹 배분 → 지도 표시 → 패널 설정 ──────────────────────────────

async function _runGrouping() {
  const locationIds = _state?.selected ? Array.from(_state.selected) : [];
  if (locationIds.length < 2) {
    alert("최소 2개 이상 지점을 선택하세요.");
    return;
  }
  const origin = _state?.origin;
  if (!origin || origin.lat == null) {
    alert("출발지를 먼저 설정하세요.");
    return;
  }

  // 패널에 이미 렌더된 파라미터가 있으면 읽고, 없으면 기본값 사용
  const workStart = document.getElementById("md-panel-work-start")?.value || "09:00";
  const workEnd   = document.getElementById("md-panel-work-end")?.value   || "18:00";
  const stayMin   = parseInt(document.getElementById("md-panel-stay-minutes")?.value || "20", 10);

  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.remove("d-none");

  try {
    const res = await fetch("/api/estimate-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_ids: locationIds,
        start: { lat: origin.lat, lng: origin.lng, label: origin.label || "출발지" },
        work_start: workStart,
        work_end: workEnd,
        stay_minutes: stayMin,
        max_days: 14,
      }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "일정 계산 오류"); return; }

    _drawGroupMarkers(data.day_assignments || []);
    _showDayConfigPanel(data);
  } catch (e) {
    alert("서버 연결 오류: " + e.message);
  } finally {
    if (overlay) overlay.classList.add("d-none");
  }
}

function _drawGroupMarkers(dayAssignments) {
  clearResultLayers();
  const locMap = {};
  for (const loc of _locations) locMap[String(loc.id)] = loc;

  dayAssignments.forEach((ids, dayIdx) => {
    const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
    ids.forEach((id) => {
      const loc = locMap[String(id)];
      if (!loc) return;
      addNumberedMarker([loc.lat, loc.lng], dayIdx + 1, color);
    });
  });
}

function _buildDayConfigHtml(n, dayCounts) {
  const breakdown = dayCounts.map((c, i) => {
    const color = DAY_COLORS[i % DAY_COLORS.length];
    return `<span class="day-color-dot" style="background:${color};display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:3px;"></span>${i + 1}일차 ${c}개`;
  }).join(" &nbsp;·&nbsp; ");

  return `
    <div class="d-flex align-items-center justify-content-between mb-2">
      <strong>📅 ${n}일 계획 — 출발지/도착지 설정</strong>
      <button id="md-result-close" class="btn btn-link btn-sm p-0 text-secondary">✕</button>
    </div>
    <div class="md-estimate-info p-2 mb-2 small">${breakdown}</div>
    <div class="row g-2 mb-2">
      <div class="col-4">
        <label class="form-label small mb-1">업무 시작</label>
        <input type="time" id="md-panel-work-start" class="form-control form-control-sm" value="09:00" />
      </div>
      <div class="col-4">
        <label class="form-label small mb-1">업무 종료</label>
        <input type="time" id="md-panel-work-end" class="form-control form-control-sm" value="18:00" />
      </div>
      <div class="col-4">
        <label class="form-label small mb-1">체류(분)</label>
        <input type="number" id="md-panel-stay-minutes" class="form-control form-control-sm"
          value="20" min="1" max="120" />
      </div>
    </div>
    <div class="d-flex align-items-center gap-2 mb-2">
      <label class="form-label small mb-0">일수</label>
      <input type="number" id="md-num-days" class="form-control form-control-sm" style="width:64px"
        value="${n}" min="1" max="14" />
      <button id="md-reestimate-btn" class="btn btn-outline-secondary btn-sm">재계산</button>
    </div>
    <div id="md-day-rows"></div>
    <button id="md-panel-submit-btn" class="btn btn-success w-100 mt-2">계획 생성</button>
  `;
}

function _showDayConfigPanel(estData) {
  const panel = document.getElementById("multiday-result-panel");
  if (!panel) return;

  const n = estData.estimated_days;
  const dayCounts = estData.day_counts || [];

  panel.innerHTML = _buildDayConfigHtml(n, dayCounts);
  panel.classList.remove("d-none");

  panel.querySelector("#md-result-close")
    ?.addEventListener("click", _hideResult);
  panel.querySelector("#md-num-days")
    ?.addEventListener("input", _onNumDaysChange);
  panel.querySelector("#md-reestimate-btn")
    ?.addEventListener("click", _runGrouping);
  panel.querySelector("#md-panel-submit-btn")
    ?.addEventListener("click", _runMultidayOptimize);

  _buildDayRows(n);
}

// ── 자동 일수 추정 ────────────────────────────────────────────────────────────
async function _runEstimate() {
  const locationIds = _state?.selected ? Array.from(_state.selected) : [];
  if (locationIds.length < 1) {
    alert("최소 1개 이상 지점을 선택하세요.");
    return;
  }

  const workStart = document.getElementById("md-work-start")?.value || "09:00";
  const workEnd   = document.getElementById("md-work-end")?.value   || "18:00";
  const stayMin   = parseInt(document.getElementById("md-stay-minutes")?.value || "20", 10);
  const origin    = _state?.origin;

  // 출발지 없으면 stay-only 프론트엔드 추정
  if (!origin || origin.lat == null) {
    const workMin = _parseWorkMinutes(workStart, workEnd);
    const estN = Math.max(1, Math.ceil((locationIds.length * stayMin) / workMin));
    _showEstimateResult(estN, null, locationIds.length);
    return;
  }

  const estimateBtn  = document.getElementById("md-estimate-btn");
  const reestBtn     = document.getElementById("md-reestimate-btn");
  if (estimateBtn) { estimateBtn.disabled = true; estimateBtn.textContent = "계산 중…"; }
  if (reestBtn)    { reestBtn.disabled = true; }

  try {
    const res = await fetch("/api/estimate-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_ids: locationIds,
        start: { lat: origin.lat, lng: origin.lng, label: origin.label || "출발지" },
        work_start: workStart,
        work_end: workEnd,
        stay_minutes: stayMin,
        max_days: 14,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const workMin = _parseWorkMinutes(workStart, workEnd);
      const estN = Math.max(1, Math.ceil((locationIds.length * stayMin) / workMin));
      _showEstimateResult(estN, null, locationIds.length);
      return;
    }
    _showEstimateResult(data.estimated_days, data.day_counts, data.total_locations);
  } catch (_e) {
    const workMin = _parseWorkMinutes(workStart, workEnd);
    const estN = Math.max(1, Math.ceil((locationIds.length * stayMin) / workMin));
    _showEstimateResult(estN, null, locationIds.length);
  } finally {
    if (estimateBtn) { estimateBtn.disabled = false; estimateBtn.textContent = "일정 계산"; }
    if (reestBtn)    { reestBtn.disabled = false; }
  }
}

function _parseWorkMinutes(workStart, workEnd) {
  try {
    const [sh, sm] = workStart.split(":").map(Number);
    const [eh, em] = workEnd.split(":").map(Number);
    return Math.max((eh * 60 + em) - (sh * 60 + sm), 1);
  } catch (_e) { return 540; }
}

function _showEstimateResult(n, dayCounts, totalLocs) {
  const textEl = document.getElementById("md-estimate-text");
  if (textEl) {
    let msg = `선택한 ${totalLocs}개 지점 → ${n}일 계획`;
    if (dayCounts && dayCounts.length > 0) {
      const breakdown = dayCounts.map((c, i) => `${i + 1}일차 ${c}개`).join(" · ");
      msg += `  (${breakdown})`;
    }
    textEl.textContent = msg;
  }

  const numDaysEl = document.getElementById("md-num-days");
  if (numDaysEl) numDaysEl.value = String(n);

  document.getElementById("md-estimate-banner")?.classList.remove("d-none");
  document.getElementById("md-estimate-btn")?.classList.add("d-none");
  document.getElementById("md-submit-btn")?.classList.remove("d-none");

  _buildDayRows(n);
}

// ── 일수 변경 핸들러 ──────────────────────────────────────────────────────────
function _onNumDaysChange() {
  const n = _getNumDays();
  _buildDayRows(n);
}

function _getNumDays() {
  const el = document.getElementById("md-num-days");
  return Math.max(1, Math.min(7, parseInt(el?.value || "2", 10) || 2));
}

function _syncDayRowsIfNeeded() {
  const n = _getNumDays();
  _buildDayRows(n);
}

// ── 일별 카드 동적 생성 ───────────────────────────────────────────────────────
function _buildDayRows(n) {
  const container = document.getElementById("md-day-rows");
  if (!container) return;

  // 기존 카드에서 값 보존
  const saved = _collectDayRowValues();

  container.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const color = DAY_COLORS[i % DAY_COLORS.length];
    const prev = saved[i] || {};

    // 1일차 출발지 기본값: state.origin
    const defStartLabel = (i === 0 && _state?.origin?.label) ? _state.origin.label : (prev.startLabel || "");
    const defStartLat   = (i === 0 && _state?.origin?.lat  != null) ? _state.origin.lat   : (prev.startLat   || "");
    const defStartLng   = (i === 0 && _state?.origin?.lng  != null) ? _state.origin.lng   : (prev.startLng   || "");
    const defEndLabel   = prev.endLabel  || "";
    const defEndLat     = prev.endLat    || "";
    const defEndLng     = prev.endLng    || "";

    const card = document.createElement("div");
    card.className = "md-day-card";
    card.style.borderLeftColor = color;
    card.innerHTML = `
      <div class="md-day-title">
        <span class="day-color-dot" style="background:${color}"></span>
        ${i + 1}일차
      </div>
      <div class="md-row-grid">
        <label class="small">출발지</label>
        <input type="text"  class="form-control form-control-sm" placeholder="명칭"
          data-field="startLabel" value="${_esc(String(defStartLabel))}">
        <input type="number" class="form-control form-control-sm" placeholder="위도"
          data-field="startLat" value="${_esc(String(defStartLat))}" step="0.000001">
        <input type="number" class="form-control form-control-sm" placeholder="경도"
          data-field="startLng" value="${_esc(String(defStartLng))}" step="0.000001">
        <button class="btn btn-outline-secondary btn-sm md-gps-btn" data-day="${i}" title="현재 위치 입력">📍</button>
      </div>
      <div class="md-row-grid">
        <label class="small">도착지<span class="text-muted">(선택)</span></label>
        <input type="text"  class="form-control form-control-sm" placeholder="명칭"
          data-field="endLabel" value="${_esc(String(defEndLabel))}">
        <input type="number" class="form-control form-control-sm" placeholder="위도"
          data-field="endLat" value="${_esc(String(defEndLat))}" step="0.000001">
        <input type="number" class="form-control form-control-sm" placeholder="경도"
          data-field="endLng" value="${_esc(String(defEndLng))}" step="0.000001">
        <span></span>
      </div>`;
    container.appendChild(card);

    // GPS 버튼
    card.querySelector(".md-gps-btn")?.addEventListener("click", () => _gpsToCard(i));
  }
}

function _collectDayRowValues() {
  const cards = document.querySelectorAll("#md-day-rows .md-day-card");
  return Array.from(cards).map((card) => {
    const get = (f) => card.querySelector(`[data-field="${f}"]`)?.value || "";
    return {
      startLabel: get("startLabel"), startLat: get("startLat"), startLng: get("startLng"),
      endLabel:   get("endLabel"),   endLat:   get("endLat"),   endLng:   get("endLng"),
    };
  });
}

function _gpsToCard(dayIdx) {
  if (!navigator.geolocation) { alert("위치 기능 미지원"); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    const cards = document.querySelectorAll("#md-day-rows .md-day-card");
    const card = cards[dayIdx];
    if (!card) return;
    card.querySelector('[data-field="startLat"]').value = pos.coords.latitude.toFixed(6);
    card.querySelector('[data-field="startLng"]').value = pos.coords.longitude.toFixed(6);
    if (!card.querySelector('[data-field="startLabel"]').value) {
      card.querySelector('[data-field="startLabel"]').value = "현재 위치";
    }
  }, () => alert("위치를 가져올 수 없습니다."), { timeout: 8000 });
}

// ── 최적화 실행 ───────────────────────────────────────────────────────────────
async function _runMultidayOptimize() {
  const locationIds = _state?.selected ? Array.from(_state.selected) : [];
  if (locationIds.length < 1) {
    alert("최소 1개 이상 지점을 선택하세요.");
    return;
  }

  const numDays = _getNumDays();
  const workStart = document.getElementById("md-panel-work-start")?.value || "09:00";
  const workEnd   = document.getElementById("md-panel-work-end")?.value   || "18:00";
  const stayMin   = parseInt(document.getElementById("md-panel-stay-minutes")?.value || "20", 10);

  const dayValues = _collectDayRowValues();
  const days = [];
  for (let i = 0; i < numDays; i++) {
    const v = dayValues[i] || {};
    const sLat = parseFloat(v.startLat);
    const sLng = parseFloat(v.startLng);
    if (isNaN(sLat) || isNaN(sLng)) {
      alert(`${i + 1}일차 출발지 좌표를 입력하세요.`);
      return;
    }
    const eLat = parseFloat(v.endLat);
    const eLng = parseFloat(v.endLng);
    const hasEnd = !isNaN(eLat) && !isNaN(eLng);
    days.push({
      start: { lat: sLat, lng: sLng, label: v.startLabel || `${i + 1}일차 출발` },
      end: hasEnd ? { lat: eLat, lng: eLng, label: v.endLabel || `${i + 1}일차 도착` } : null,
    });
  }

  // 로딩 표시
  const submitBtn = document.getElementById("md-panel-submit-btn");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "계획 생성 중..."; }
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.remove("d-none");

  try {
    const res = await fetch("/api/optimize-multiday", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location_ids: locationIds, days, work_start: workStart, work_end: workEnd, stay_minutes: stayMin }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "오류가 발생했습니다.");
      return;
    }
    _renderResult(data, _locations);
  } catch (e) {
    alert("서버 연결 오류: " + e.message);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "계획 생성"; }
    if (overlay) overlay.classList.add("d-none");
  }
}

// ── 결과 렌더 ─────────────────────────────────────────────────────────────────
function _renderResult(data, locations) {
  const daysData = data.days || [];

  // 지도 레이어 초기화
  clearResultLayers();

  // 날별 지도 렌더
  daysData.forEach((dayData, i) => {
    const color = DAY_COLORS[i % DAY_COLORS.length];
    const order = dayData.order || [];
    const locMap = {};
    for (const loc of locations) locMap[loc.id] = loc;

    // 폴리라인
    if (dayData.polyline && dayData.polyline.length >= 2) {
      drawPolyline(dayData.polyline, color);
    }

    // 번호 마커
    order.forEach((id, idx) => {
      const loc = locMap[String(id)];
      if (loc) {
        addNumberedMarker([loc.lat, loc.lng], idx + 1, color);
      }
    });
  });

  // 결과 패널 HTML 생성
  const panel = document.getElementById("multiday-result-panel");
  if (!panel) return;

  panel.innerHTML = _buildResultHtml(daysData, locations);
  panel.classList.remove("d-none");
  panel.querySelector("#md-result-close")?.addEventListener("click", _hideResult);

  // 아코디언 토글
  panel.querySelectorAll(".md-accordion-header").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const body = hdr.nextElementSibling;
      if (!body) return;
      const isOpen = body.classList.contains("show");
      // 모두 닫기
      panel.querySelectorAll(".md-accordion-body").forEach((b) => b.classList.remove("show"));
      panel.querySelectorAll(".md-accordion-header").forEach((h) => h.setAttribute("aria-expanded", "false"));
      if (!isOpen) {
        body.classList.add("show");
        hdr.setAttribute("aria-expanded", "true");
      }
    });
  });

  // nav 버튼 플레이스홀더 채우기
  panel.querySelectorAll(".md-nav-placeholder").forEach((el) => {
    const dayIdx = parseInt(el.dataset.day, 10);
    const dayData = daysData[dayIdx];
    if (dayData) el.innerHTML = buildNavButtons(dayData, locations);
  });

  // 인쇄 버튼
  panel.querySelectorAll(".md-print-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      // 모든 아코디언 열기
      panel.querySelectorAll(".md-accordion-body").forEach((b) => b.classList.add("show"));
      window.print();
    });
  });

  // 모바일 결과 패널 동기
  const mPanel = document.getElementById("result-panel-m");
  if (mPanel) {
    mPanel.innerHTML = panel.innerHTML;
    // 아코디언 이벤트 재등록
    mPanel.querySelectorAll(".md-accordion-header").forEach((hdr) => {
      hdr.addEventListener("click", () => {
        const body = hdr.nextElementSibling;
        if (!body) return;
        const isOpen = body.classList.contains("show");
        mPanel.querySelectorAll(".md-accordion-body").forEach((b) => b.classList.remove("show"));
        mPanel.querySelectorAll(".md-accordion-header").forEach((h) => h.setAttribute("aria-expanded", "false"));
        if (!isOpen) { body.classList.add("show"); hdr.setAttribute("aria-expanded", "true"); }
      });
    });
    mPanel.querySelectorAll(".md-nav-placeholder").forEach((el) => {
      const dayIdx = parseInt(el.dataset.day, 10);
      const dayData = daysData[dayIdx];
      if (dayData) el.innerHTML = buildNavButtons(dayData, locations);
    });
    mPanel.querySelectorAll(".md-print-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        mPanel.querySelectorAll(".md-accordion-body").forEach((b) => b.classList.add("show"));
        window.print();
      });
    });
  }
}

// ── 결과 HTML 빌더 ────────────────────────────────────────────────────────────
function _buildResultHtml(daysData, locations) {
  let grandDrive = 0, grandDist = 0, grandStay = 0, grandLocs = 0;
  daysData.forEach((d) => {
    grandDrive += d.summary?.total_drive_min || 0;
    grandDist  += d.summary?.total_dist_km   || 0;
    grandStay  += d.summary?.total_stay_min  || 0;
    grandLocs  += d.summary?.location_count  || 0;
  });

  let html = `
    <div class="d-flex align-items-center justify-content-between mb-2">
      <strong>N일 경로 계획</strong>
      <button id="md-result-close" class="btn btn-link btn-sm p-0">✕</button>
    </div>
    <div class="md-grand-summary mb-2">
      총 ${daysData.length}일 · ${grandLocs}개 지점 · 이동 ${grandDrive}분 · ${grandDist.toFixed(1)}km
    </div>`;

  daysData.forEach((dayData, i) => {
    const color = DAY_COLORS[i % DAY_COLORS.length];
    const summary = dayData.summary || {};
    const lc = summary.location_count || 0;
    const isOpen = i === 0;

    html += `
      <div class="md-accordion-item">
        <button class="md-accordion-header" aria-expanded="${isOpen}" style="border-left:4px solid ${color}">
          <span class="day-color-dot" style="background:${color}"></span>
          <span class="fw-bold">${_esc(dayData.label)}</span>
          <span class="text-muted small ms-1">
            ${lc > 0 ? `${lc}개 · 이동 ${summary.total_drive_min || 0}분 · ${(summary.total_dist_km || 0).toFixed(1)}km` : "배정된 지점 없음"}
          </span>
          ${summary.overtime ? '<span class="badge bg-warning text-dark ms-1">시간초과</span>' : ""}
        </button>
        <div class="md-accordion-body${isOpen ? " show" : ""}">`;

    if (lc === 0) {
      html += `<p class="text-muted small p-2">이 날 배정된 지점이 없습니다.</p>`;
    } else {
      html += buildTimelineHtml(dayData, locations);
      html += `<div class="md-nav-placeholder mt-2" data-day="${i}"></div>`;
    }

    html += `</div></div>`;
  });

  html += `
    <div class="d-flex gap-2 mt-3">
      <button class="btn btn-sm btn-outline-secondary flex-fill md-print-btn">🖨️ 인쇄</button>
    </div>`;

  return html;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function _esc(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 모듈 레벨 상태
let _state = null;
let _locations = [];
