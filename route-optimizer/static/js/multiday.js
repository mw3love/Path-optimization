/**
 * multiday.js — N일 경로 계획: 칸반 배분 UX
 *
 * 사용자가 지점을 그룹으로 드래그 배분 → 그룹별 최적화 → 완료 시 결과 패널 표시.
 * initMultiday(state, locations) 호출로 초기화. 반환: { runGrouping }
 */
import { clearResultLayers, addNumberedMarker, drawPolyline, onMapClick, offMapClick, getSigunguColor } from "./map.js";
import { buildTimelineHtml } from "./timeline.js";

// ── 날짜별 색상 팔레트 ────────────────────────────────────────────────────────
export const DAY_COLORS = [
  "#1a73e8", "#2e7d32", "#c62828", "#f57f17",
  "#6a1b9a", "#00838f", "#4e342e",
];

// ── 모듈 상태 ─────────────────────────────────────────────────────────────────
let _state     = null;
let _locations = [];
let _unassigned = new Set();  // 미배정 location id
let _groups    = [];          // [{id, name, color, locationIds[], start, end, optimized, result}]
let _groupCounter = 0;
let _mapPickCb = null;        // 지도 클릭 대기 콜백 참조 (offMapClick 제거용)

// Touch DnD 임시 상태
let _touchDragLocId  = null;
let _touchDragFromGid = null;
let _touchClone      = null;

// 그룹 순서 변경 DnD 임시 상태
let _groupDragging = null;

// id → location 빠른 조회 (N+1 방지)
let _locMap = {};
// 시군구 팝오버 외부클릭 핸들러 (누적 방지)
let _outsideClickHandler = null;

// ── 초기화 ────────────────────────────────────────────────────────────────────
export function initMultiday(state, locations) {
  _state     = state;
  _locations = locations;
  _locMap    = Object.fromEntries(locations.map((l) => [l.id, l]));

  document.getElementById("nday-close-btn")?.addEventListener("click", _closePanel);
  document.getElementById("nday-done-btn")?.addEventListener("click", _finish);
  document.getElementById("nday-add-group-btn")?.addEventListener("click", () => {
    _addGroup();
    _refreshUI();
  });
  document.getElementById("nday-optimize-all-btn")?.addEventListener("click", _optimizeAll);
  document.getElementById("nday-map-pick-cancel")?.addEventListener("click", _exitMapPickMode);
  document.getElementById("nday-map-back-btn")?.addEventListener("click", _exitTransparentMode);

  return { runGrouping: _runGrouping };
}

// ── 패널 열기 ─────────────────────────────────────────────────────────────────
function _runGrouping() {
  const locationIds = _state?.selected ? Array.from(_state.selected) : [];
  if (locationIds.length < 2) {
    alert("최소 2개 이상 지점을 선택하세요.");
    return;
  }

  // 상태 초기화
  _unassigned = new Set(locationIds);
  _groups = [];
  _groupCounter = 0;

  // 공통 설정값 동기 (사이드바 체류시간 → N일 패널)
  const stayEl = document.getElementById("stay-minutes") || document.getElementById("stay-minutes-m");
  if (stayEl) {
    const ndayStay = document.getElementById("nday-stay-minutes");
    if (ndayStay) ndayStay.value = stayEl.value || "20";
  }

  _addGroup(); // 기본 그룹 1개 생성
  _openPanel();
  _refreshUI();
}

function _openPanel() {
  document.getElementById("nday-panel")?.classList.remove("d-none");
}

function _closePanel() {
  _exitMapPickMode();
  _exitTransparentMode();
  clearResultLayers();
  document.getElementById("nday-panel")?.classList.add("d-none");
}

// ── 그룹 관리 ─────────────────────────────────────────────────────────────────
function _addGroup() {
  const id = `g${_groupCounter++}`;
  const name = `${_groups.length + 1}일차`;
  const color = DAY_COLORS[_groups.length % DAY_COLORS.length];
  const start = _state?.origin ? { ..._state.origin } : null;
  const end   = _state?.origin ? { ..._state.origin } : null;
  _groups.push({ id, name, color, locationIds: [], start, end, optimized: false, result: null });
}

function _deleteGroup(gid) {
  const idx = _groups.findIndex((g) => g.id === gid);
  if (idx < 0) return;
  _groups[idx].locationIds.forEach((lid) => _unassigned.add(lid));
  _groups.splice(idx, 1);
  clearResultLayers();
  _refreshUI();
}

function _reorderGroup(fromGid, toGid) {
  const fromIdx = _groups.findIndex((g) => g.id === fromGid);
  const toIdx   = _groups.findIndex((g) => g.id === toGid);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = _groups.splice(fromIdx, 1);
  _groups.splice(toIdx, 0, moved);
  // N일차 패턴 이름은 위치 순서대로 재번호화 (사용자 지정 이름은 유지)
  _groups.forEach((g, i) => {
    if (/^\d+일차$/.test(g.name)) g.name = `${i + 1}일차`;
  });
  _refreshUI();
}

// ── 지점 이동 ─────────────────────────────────────────────────────────────────
function _moveLocation(locId, fromGid, toGid) {
  if (fromGid === toGid) return;

  // 소스에서 제거
  if (fromGid === "unassigned") {
    _unassigned.delete(locId);
  } else {
    const src = _groups.find((g) => g.id === fromGid);
    if (src) {
      const i = src.locationIds.indexOf(locId);
      if (i >= 0) src.locationIds.splice(i, 1);
      src.optimized = false;
      src.result = null;
    }
  }

  // 대상에 추가
  if (toGid === "unassigned") {
    _unassigned.add(locId);
  } else {
    const dst = _groups.find((g) => g.id === toGid);
    if (dst && !dst.locationIds.includes(locId)) {
      dst.locationIds.push(locId);
      dst.optimized = false;
      dst.result = null;
    }
  }

  _refreshUI();
}

// ── 전체 렌더 ─────────────────────────────────────────────────────────────────
function _renderAll() {
  _renderUnassigned();
  _renderGroups();
  _setupDragDrop();
}

function _refreshUI() {
  _renderAll();
  _updateDoneButton();
  _updateBatchButton();
}

function _renderUnassigned() {
  const zone    = document.getElementById("nday-unassigned-zone");
  const countEl = document.getElementById("nday-unassigned-count");
  const sggBar  = document.getElementById("nday-sgg-bar");
  if (!zone) return;

  zone.innerHTML = Array.from(_unassigned).map((id) => _buildChip(id, "unassigned")).join("");
  if (countEl) countEl.textContent = _unassigned.size;

  // 시군구 뱃지 바
  if (sggBar) {
    const counts = _getSigunguCounts();
    if (counts.size === 0) {
      sggBar.innerHTML = "";
    } else {
      sggBar.innerHTML = Array.from(counts.entries())
        .map(([sgg, n]) => {
          const color = getSigunguColor(sgg);
          return `<button class="nday-sgg-badge" data-sgg="${_esc(sgg)}" style="background:${color};border-color:${color};color:#fff">${_esc(sgg)} <span>${n}</span></button>`;
        }).join("");
      sggBar.querySelectorAll(".nday-sgg-badge").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          _showSigunguPopover(btn.dataset.sgg, btn);
        });
        btn.setAttribute("draggable", "true");
        btn.addEventListener("dragstart", (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", JSON.stringify({
            type: "sgg_batch", sigungu: btn.dataset.sgg,
          }));
          setTimeout(() => btn.classList.add("nday-sgg-badge--dragging"), 0);
        });
        btn.addEventListener("dragend", () => btn.classList.remove("nday-sgg-badge--dragging"));
      });
    }
  }
}

function _getSigunguCounts() {
  const map = new Map();
  for (const id of _unassigned) {
    const loc = _locMap[id];
    if (!loc?.sigungu) continue;
    map.set(loc.sigungu, (map.get(loc.sigungu) || 0) + 1);
  }
  return map;
}

function _showSigunguPopover(sigungu, badgeEl) {
  document.querySelector(".nday-sgg-popover")?.remove();
  if (_groups.length === 0) return;

  const popover = document.createElement("div");
  popover.className = "nday-sgg-popover";

  const count = Array.from(_unassigned).filter((id) => {
    return _locMap[id]?.sigungu === sigungu;
  }).length;

  popover.innerHTML =
    `<div class="nday-sgg-popover-title">${_esc(sigungu)} ${count}개 이동 →</div>` +
    _groups.map((g) =>
      `<button class="nday-sgg-popover-item" data-gid="${g.id}">
        <span class="day-color-dot" style="background:${g.color}"></span>
        ${_esc(g.name)}
        <span class="nday-sgg-popover-count">${g.locationIds.length}개</span>
      </button>`
    ).join("");

  const rect = badgeEl.getBoundingClientRect();
  popover.style.top  = `${rect.bottom + 4}px`;
  popover.style.left = `${rect.left}px`;
  document.body.appendChild(popover);

  popover.querySelectorAll(".nday-sgg-popover-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      _moveSigunguBatch(sigungu, btn.dataset.gid);
      popover.remove();
    });
  });

  // 외부 클릭 시 닫기 (이전 핸들러 제거 후 등록)
  if (_outsideClickHandler) {
    document.removeEventListener("click", _outsideClickHandler);
    _outsideClickHandler = null;
  }
  _outsideClickHandler = (e) => {
    if (!popover.contains(e.target) && e.target !== badgeEl) {
      popover.remove();
      document.removeEventListener("click", _outsideClickHandler);
      _outsideClickHandler = null;
    }
  };
  setTimeout(() => document.addEventListener("click", _outsideClickHandler), 0);
}

function _moveSigunguBatch(sigungu, toGid) {
  const dst = _groups.find((g) => g.id === toGid);
  if (!dst) return;

  Array.from(_unassigned)
    .filter((id) => _locMap[id]?.sigungu === sigungu)
    .forEach((id) => {
      _unassigned.delete(id);
      if (!dst.locationIds.includes(id)) dst.locationIds.push(id);
    });

  dst.optimized = false;
  dst.result = null;
  _refreshUI();
}

function _renderGroups() {
  const container = document.getElementById("nday-groups-container");
  if (!container) return;
  container.innerHTML = _groups.map((g) => _buildGroupCardHtml(g)).join("");

  _groups.forEach((g) => {
    const card = container.querySelector(`[data-gid="${g.id}"]`);
    if (!card) return;

    card.querySelector(".nday-group-name-input")?.addEventListener("input", (e) => {
      g.name = e.target.value;
    });
    card.querySelector(".nday-group-del-btn")?.addEventListener("click", () => _deleteGroup(g.id));
    card.querySelector(".nday-gps-btn")?.addEventListener("click", () => _gpsToGroup(g.id, "start"));
    card.querySelector(".nday-gps-end-btn")?.addEventListener("click", () => _gpsToGroup(g.id, "end"));
    card.querySelector(".nday-map-start-btn")?.addEventListener("click", () => _enterMapPickMode(g.id, "start"));
    card.querySelector(".nday-map-end-btn")?.addEventListener("click", () => _enterMapPickMode(g.id, "end"));
    card.querySelector(".nday-end-clear-btn")?.addEventListener("click", () => {
      g.end = null; g.optimized = false; g.result = null;
      _refreshUI();
    });
    card.querySelector(".nday-optimize-btn")?.addEventListener("click", () => _optimizeGroup(g.id));
    card.querySelector(".nday-view-map-btn")?.addEventListener("click", () => _showGroupOnMap(g.id));
  });
}

function _buildGroupCardHtml(g) {
  const chipsHtml   = g.locationIds.map((id) => _buildChip(id, g.id)).join("");
  const startLabel  = g.start ? (g.start.label || `${g.start.lat.toFixed(4)},${g.start.lng.toFixed(4)}`) : "미지정";
  const endLabel    = g.end   ? (g.end.label   || `${g.end.lat.toFixed(4)},${g.end.lng.toFixed(4)}`)   : "없음";
  const canOptimize = g.locationIds.length >= 2 && !!g.start;

  let resultHtml = "";
  if (g.optimized && g.result) {
    const sum = g.result.summary || {};
    const lc  = sum.location_count || g.locationIds.length;
    const km  = (sum.total_dist_km || 0).toFixed(1);
    const driveMin = sum.total_drive_min || 0;
    const h = Math.floor(driveMin / 60), m = driveMin % 60;
    const timeStr = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    resultHtml = `
      <div class="nday-group-result">
        <div class="nday-result-summary">
          <span class="badge" style="background:${g.color}">${lc}지점</span>
          ${km}km · 이동 ${timeStr}
          ${sum.overtime ? '<span class="badge bg-warning text-dark ms-1">시간초과</span>' : ""}
        </div>
        <div class="nday-timeline-wrap">${buildTimelineHtml(g.result, _locations)}</div>
        <div class="nday-result-btns mt-2 d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-outline-primary nday-view-map-btn">🗺 지도로 보기</button>
        </div>
      </div>`;
  }

  return `
<div class="nday-group-card" data-gid="${g.id}">
  <div class="nday-group-header">
    <span class="nday-group-drag-handle" draggable="true" title="드래그하여 순서 변경">⠿</span>
    <span class="day-color-dot" style="background:${g.color}"></span>
    <input class="nday-group-name-input" type="text" value="${_esc(g.name)}" />
    <button class="nday-group-del-btn btn btn-link btn-sm p-0 text-danger ms-auto" title="그룹 삭제">✕</button>
  </div>
  <div class="nday-group-settings">
    <div class="nday-setting-row">
      <span class="nday-setting-lbl">출발</span>
      <span class="nday-loc-label text-truncate">${_esc(startLabel)}</span>
      <button class="nday-gps-btn btn btn-link btn-sm p-0 flex-shrink-0" title="현재 위치">📍</button>
      <button class="nday-map-start-btn btn btn-link btn-sm p-0 flex-shrink-0" title="지도에서 선택">🗺</button>
    </div>
    <div class="nday-setting-row">
      <span class="nday-setting-lbl">도착</span>
      <span class="nday-loc-label text-truncate">${_esc(endLabel)}</span>
      <button class="nday-gps-end-btn btn btn-link btn-sm p-0 flex-shrink-0" title="현재 위치">📍</button>
      <button class="nday-map-end-btn btn btn-link btn-sm p-0 flex-shrink-0" title="지도에서 선택">🗺</button>
      ${g.end ? `<button class="nday-end-clear-btn btn btn-link btn-sm p-0 flex-shrink-0 text-muted" title="도착지 제거">✕</button>` : `<span class="flex-shrink-0" style="width:1.5rem"></span>`}
    </div>
  </div>
  <div class="nday-drop-zone nday-group-drop-zone" data-gid="${g.id}">
    ${chipsHtml || '<span class="nday-drop-hint">여기로 드래그하세요</span>'}
  </div>
  <button class="nday-optimize-btn btn btn-primary btn-sm w-100 mt-2" ${canOptimize ? "" : "disabled"}>
    ${g.optimized ? "🔄 재최적화" : "⚡ 최적화"}
  </button>
  ${resultHtml}
</div>`;
}

function _buildChip(locId, groupId) {
  const loc = _locMap[locId];
  if (!loc) return "";
  const color = getSigunguColor(loc.sigungu);
  const sigungu = loc.sigungu
    ? `<span class="nday-chip-sgg" style="background:${color}">${_esc(loc.sigungu)}</span>`
    : "";
  return `<div class="nday-chip" draggable="true" data-loc-id="${locId}" data-from-gid="${groupId}" title="${_esc(loc.address)}">
  <span class="nday-chip-drag">⠿</span>
  ${sigungu}<span class="nday-chip-name">${_esc(loc.name)}</span>
  <button class="nday-chip-remove" data-loc-id="${locId}" data-from-gid="${groupId}" title="제거">✕</button>
</div>`;
}

// ── 드래그앤드롭 ─────────────────────────────────────────────────────────────
function _setupDragDrop() {
  const panel = document.getElementById("nday-panel");
  if (!panel) return;

  // 칩 X 버튼 → 미배정으로 이동
  panel.querySelectorAll(".nday-chip-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const { locId, fromGid } = btn.dataset;
      if (fromGid !== "unassigned") _moveLocation(locId, fromGid, "unassigned");
    });
  });

  // Mouse DnD
  panel.querySelectorAll(".nday-chip").forEach((chip) => {
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({
        locId:   chip.dataset.locId,
        fromGid: chip.dataset.fromGid,
      }));
      setTimeout(() => chip.classList.add("nday-chip--dragging"), 0);
    });
    chip.addEventListener("dragend", () => chip.classList.remove("nday-chip--dragging"));
  });

  panel.querySelectorAll(".nday-drop-zone").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      if (_groupDragging) return; // 그룹 순서 변경 중에는 무시
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      if (_groupDragging) return; // 그룹 순서 변경 중에는 무시
      e.preventDefault();
      zone.classList.remove("drag-over");
      try {
        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
        const toGid = zone.dataset.gid || "unassigned";
        if (data.type === "sgg_batch") {
          _moveSigunguBatch(data.sigungu, toGid);
        } else {
          _moveLocation(data.locId, data.fromGid, toGid);
        }
      } catch (_) {}
    });
  });

  // 그룹 순서 변경 DnD
  panel.querySelectorAll(".nday-group-drag-handle").forEach((handle) => {
    const card = handle.closest(".nday-group-card");
    handle.addEventListener("dragstart", (e) => {
      _groupDragging = card.dataset.gid;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "group_reorder", gid: _groupDragging }));
      setTimeout(() => card.classList.add("nday-group-card--dragging"), 0);
    });
    handle.addEventListener("dragend", () => {
      _groupDragging = null;
      panel.querySelectorAll(".nday-group-card").forEach((c) => {
        c.classList.remove("nday-group-card--dragging", "nday-group-card--drag-over");
      });
    });
  });

  panel.querySelectorAll(".nday-group-card").forEach((card) => {
    card.addEventListener("dragover", (e) => {
      if (!_groupDragging || card.dataset.gid === _groupDragging) return;
      e.preventDefault();
      e.stopPropagation();
      panel.querySelectorAll(".nday-group-card").forEach((c) => c.classList.remove("nday-group-card--drag-over"));
      card.classList.add("nday-group-card--drag-over");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove("nday-group-card--drag-over");
    });
    card.addEventListener("drop", (e) => {
      if (!_groupDragging) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("nday-group-card--drag-over");
      _reorderGroup(_groupDragging, card.dataset.gid);
      _groupDragging = null;
    });
  });

  // Touch DnD
  panel.querySelectorAll(".nday-chip").forEach((chip) => {
    chip.addEventListener("touchstart", _onTouchStart, { passive: true });
  });
}

function _onTouchStart(e) {
  const chip = e.currentTarget;
  _touchDragLocId   = chip.dataset.locId;
  _touchDragFromGid = chip.dataset.fromGid;

  _touchClone = chip.cloneNode(true);
  _touchClone.classList.add("nday-chip--touch-clone");
  document.body.appendChild(_touchClone);
  _positionTouchClone(e.touches[0]);

  document.addEventListener("touchmove", _onTouchMove, { passive: false });
  document.addEventListener("touchend", _onTouchEnd, { once: true });
}

function _onTouchMove(e) {
  e.preventDefault();
  _positionTouchClone(e.touches[0]);
  _highlightDropZoneUnder(e.touches[0].clientX, e.touches[0].clientY);
}

function _onTouchEnd(e) {
  document.removeEventListener("touchmove", _onTouchMove);
  const touch = e.changedTouches[0];

  if (_touchClone) { _touchClone.remove(); _touchClone = null; }
  document.querySelectorAll(".nday-drop-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));

  const el   = document.elementFromPoint(touch.clientX, touch.clientY);
  const zone = el?.closest(".nday-drop-zone");
  if (zone && _touchDragLocId) {
    const toGid = zone.dataset.gid || "unassigned";
    _moveLocation(_touchDragLocId, _touchDragFromGid, toGid);
  }

  _touchDragLocId   = null;
  _touchDragFromGid = null;
}

function _positionTouchClone(touch) {
  if (!_touchClone) return;
  _touchClone.style.left = `${touch.clientX - 40}px`;
  _touchClone.style.top  = `${touch.clientY - 20}px`;
}

function _highlightDropZoneUnder(clientX, clientY) {
  document.querySelectorAll(".nday-drop-zone").forEach((z) => z.classList.remove("drag-over"));
  document.elementFromPoint(clientX, clientY)?.closest(".nday-drop-zone")?.classList.add("drag-over");
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function _gpsToGroup(gid, field = "start") {
  if (!navigator.geolocation) { alert("이 브라우저는 위치 기능을 지원하지 않습니다."); return; }
  const group = _groups.find((g) => g.id === gid);
  if (!group) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      group[field] = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "현 위치로 선택됨" };
      group.optimized = false; group.result = null;
      _refreshUI();
    },
    (err) => {
      if (err.code === 1 && location.protocol === "http:" && location.hostname !== "localhost") {
        alert("GPS를 사용하려면 HTTPS 연결이 필요합니다.");
      } else {
        alert("위치를 가져올 수 없습니다. 지도 클릭으로 위치를 선택해 주세요.");
      }
    },
    { timeout: 8000 }
  );
}

// ── 지도 클릭 좌표 선택 ───────────────────────────────────────────────────────
function _enterMapPickMode(gid, field) {
  _exitMapPickMode(); // 이전 상태 정리

  document.getElementById("nday-panel")?.classList.add("nday-panel--transparent");
  document.getElementById("nday-map-pick-indicator")?.classList.remove("d-none");

  _mapPickCb = (latlng) => {
    const group = _groups.find((g) => g.id === gid);
    if (group) {
      const coord = { lat: latlng.lat, lng: latlng.lng, label: "지도에서 선택됨" };
      if (field === "start") group.start = coord;
      else group.end = coord;
      group.optimized = false; group.result = null;
    }
    _exitMapPickMode();
    _refreshUI();
  };

  onMapClick(_mapPickCb);
}

function _exitMapPickMode() {
  if (_mapPickCb) { offMapClick(_mapPickCb); _mapPickCb = null; }
  const indicator = document.getElementById("nday-map-pick-indicator");
  if (indicator && !indicator.classList.contains("d-none")) {
    indicator.classList.add("d-none");
    document.getElementById("nday-panel")?.classList.remove("nday-panel--transparent");
  }
}

// ── 지도 경로 보기 (반투명 모드) ──────────────────────────────────────────────
function _showGroupOnMap(gid) {
  const group = _groups.find((g) => g.id === gid);
  if (!group?.result) return;

  clearResultLayers();
  const { result: data, color } = group;

  if (data.polyline?.length >= 2) drawPolyline(data.polyline, color);
  (data.order || []).forEach((id, idx) => {
    const loc = _locMap[String(id)];
    if (loc) addNumberedMarker([loc.lat, loc.lng], idx + 1, color);
  });

  document.getElementById("nday-panel")?.classList.add("nday-panel--transparent");
  document.getElementById("nday-map-back-btn")?.classList.remove("d-none");
}

function _exitTransparentMode() {
  document.getElementById("nday-panel")?.classList.remove("nday-panel--transparent");
  document.getElementById("nday-map-back-btn")?.classList.add("d-none");
  clearResultLayers();
}

// ── 그룹 최적화 ───────────────────────────────────────────────────────────────
async function _optimizeGroup(gid, skipRender = false) {
  const group = _groups.find((g) => g.id === gid);
  if (!group) return;
  if (!group.start?.lat) { alert(`"${group.name}"의 출발지를 설정해주세요.`); return; }
  if (group.locationIds.length < 2) { alert("최소 2개 이상의 지점이 필요합니다."); return; }

  const workStart  = document.getElementById("nday-work-start")?.value || "09:00";
  const stayMin    = parseInt(document.getElementById("nday-stay-minutes")?.value || "20", 10);

  const card = document.querySelector(`#nday-groups-container [data-gid="${gid}"]`);
  const btn  = card?.querySelector(".nday-optimize-btn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ 최적화 중..."; }

  try {
    const resp = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_ids: group.locationIds,
        start:        group.start,
        end:          group.end || null,
        start_time:   workStart,
        stay_minutes: stayMin,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "최적화 실패");

    group.result    = data;
    group.optimized = true;
    if (!skipRender) _refreshUI();
  } catch (err) {
    alert(`최적화 오류: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = group.optimized ? "🔄 재최적화" : "⚡ 최적화"; }
  }
}

// ── 완료 버튼 상태 ────────────────────────────────────────────────────────────
function _updateDoneButton() {
  const btn = document.getElementById("nday-done-btn");
  if (!btn) return;
  btn.disabled = !(_groups.length > 0 && _groups.every((g) => g.optimized));
}

function _updateBatchButton() {
  const btn = document.getElementById("nday-optimize-all-btn");
  if (!btn) return;
  const optimizable = _groups.filter((g) => g.locationIds.length >= 2 && g.start?.lat);
  btn.disabled = optimizable.length === 0;
}

// ── 전체 최적화 ───────────────────────────────────────────────────────────────
async function _optimizeAll() {
  const btn = document.getElementById("nday-optimize-all-btn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ 최적화 중..."; }

  const targets = _groups.filter((g) => g.locationIds.length >= 2 && g.start?.lat);
  await Promise.all(targets.map((g) => _optimizeGroup(g.id, true)));

  if (btn) { btn.textContent = "⚡ 전체 최적화"; }
  _refreshUI();
}

// ── 완료: 결과 패널 표시 ─────────────────────────────────────────────────────
function _finish() {
  const multidayData = {
    days: _groups
      .filter((g) => g.optimized && g.result)
      .map((g, i) => ({
        day:   i + 1,
        label: g.name,
        ...g.result,
        start: g.start,
        end:   g.end,
      })),
  };
  if (multidayData.days.length === 0) return;
  _closePanel();
  _renderResult(multidayData, _locations);
}

// ── 결과 렌더 (기존 로직 유지) ────────────────────────────────────────────────
function _renderResult(data, locations) {
  const daysData = data.days || [];
  clearResultLayers();

  daysData.forEach((dayData, i) => {
    const color  = DAY_COLORS[i % DAY_COLORS.length];
    if (dayData.polyline?.length >= 2) drawPolyline(dayData.polyline, color);
    (dayData.order || []).forEach((id, idx) => {
      const loc = _locMap[String(id)];
      if (loc) addNumberedMarker([loc.lat, loc.lng], idx + 1, color);
    });
  });

  const panel = document.getElementById("multiday-result-panel");
  if (!panel) return;
  panel.innerHTML = _buildResultHtml(daysData, locations);
  panel.classList.remove("d-none");
  panel.querySelector("#md-result-close")?.addEventListener("click", _hideResult);

  _bindAccordion(panel, daysData, locations);

  const mPanel = document.getElementById("result-panel-m");
  if (mPanel) {
    mPanel.innerHTML = panel.innerHTML;
    _bindAccordion(mPanel, daysData, locations);
  }
}

function _bindAccordion(panel, daysData, locations) {
  panel.querySelectorAll(".md-accordion-header").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const body   = hdr.nextElementSibling;
      if (!body) return;
      const isOpen = body.classList.contains("show");
      panel.querySelectorAll(".md-accordion-body").forEach((b) => b.classList.remove("show"));
      panel.querySelectorAll(".md-accordion-header").forEach((h) => h.setAttribute("aria-expanded", "false"));
      if (!isOpen) { body.classList.add("show"); hdr.setAttribute("aria-expanded", "true"); }
    });
  });
}

function _hideResult() {
  document.getElementById("multiday-result-panel")?.classList.add("d-none");
  clearResultLayers();
}

// ── 결과 HTML 빌더 ────────────────────────────────────────────────────────────
function _buildResultHtml(daysData, locations) {
  let grandDrive = 0, grandDist = 0, grandLocs = 0;
  daysData.forEach((d) => {
    grandDrive += d.summary?.total_drive_min || 0;
    grandDist  += d.summary?.total_dist_km   || 0;
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
    const color   = DAY_COLORS[i % DAY_COLORS.length];
    const summary = dayData.summary || {};
    const lc      = summary.location_count || 0;
    const isOpen  = i === 0;
    html += `
      <div class="md-accordion-item">
        <button class="md-accordion-header" aria-expanded="${isOpen}" style="border-left:4px solid ${color}">
          <span class="day-color-dot" style="background:${color}"></span>
          <span class="fw-bold">${_esc(dayData.label)}</span>
          <span class="text-muted small ms-1">
            ${lc > 0
              ? `${lc}개 · 이동 ${summary.total_drive_min || 0}분 · ${(summary.total_dist_km || 0).toFixed(1)}km`
              : "배정된 지점 없음"}
          </span>
          ${summary.overtime ? '<span class="badge bg-warning text-dark ms-1">시간초과</span>' : ""}
        </button>
        <div class="md-accordion-body${isOpen ? " show" : ""}">
          ${lc === 0
            ? '<p class="text-muted small p-2">이 날 배정된 지점이 없습니다.</p>'
            : buildTimelineHtml(dayData, locations)}
        </div>
      </div>`;
  });


  return html;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function _esc(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
