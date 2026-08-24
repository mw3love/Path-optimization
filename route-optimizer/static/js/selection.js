/**
 * selection.js — 지점 목록 체크박스, 시군구 필터, 검색, 마커 ↔ 사이드바 양방향 동기화
 */
import { getSigunguColor, setMarkerSelected, panToLocation } from "./map.js";
import { openShareDialog } from "./sharing_ui.js";

let _locations = [];
let _state = null;
let _callbacks = null;

// 현재 표시할 시군구 집합 (비어 있으면 전체 숨김, 전체 포함이면 전체 표시)
const _activeFilters = new Set();
let _allSigungu = [];

// Shift-클릭 범위 선택용: 마지막으로 클릭한 지점 ID
let _lastClickedId = null;

// 드래그 재정렬 중인 지점 ID
let _dragSourceId = null;

// 최적화/순서대로 실행 결과(실제 방문 순서). id(string) → 순번. 미실행/선택변경 시 null.
let _routeOrderMap = null;

// 시군구가 없는(빈 문자열) 지점은 필터 배지에서 공유 "기타" 그룹으로 묶는다
const OTHER_SGG = "기타";
function _filterKey(loc) {
  return loc.sigungu || OTHER_SGG;
}

export function initSelection(locations, state, callbacks) {
  _locations = locations;
  _state = state;
  _callbacks = callbacks;

  _buildFilters();
  _buildList();

  // 외부에서 toggleById 호출 가능하도록 등록
  window._selectionModule = { toggleById };
}

// ── 시군구 필터 ───────────────────────────────────────────────────────────────

function _buildFilters() {
  _allSigungu = [...new Set(_locations.map(_filterKey))].sort();
  // 초기 상태: 전체 표시
  _allSigungu.forEach((sgg) => _activeFilters.add(sgg));

  ["sigungu-filters", "sigungu-filters-m"].forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    // "전체" 배지 (다른 시군구 배지와 동일한 스타일)
    const allBadge = document.createElement("span");
    allBadge.className = "sigungu-badge sgg-all-badge";
    allBadge.textContent = "전체";
    allBadge.style.background = "#6c757d";
    allBadge.title = "전체 지역 토글";
    allBadge.addEventListener("click", _toggleAllSigungu);
    container.appendChild(allBadge);

    for (const sgg of _allSigungu) {
      const badge = document.createElement("span");
      badge.className = "sigungu-badge";
      badge.textContent = sgg;
      badge.style.background = getSigunguColor(sgg);
      badge.dataset.sgg = sgg;
      badge.title = `${sgg} 필터`;

      badge.addEventListener("click", () => _toggleFilter(sgg));
      container.appendChild(badge);
    }
  });

  // 장소 전체선택 체크박스
  ["cb-select-all", "cb-select-all-m"].forEach((id) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.addEventListener("change", () => {
      const shouldSelect = cb.checked;
      cb.blur();
      const visible = _visibleLocations();
      visible.forEach((loc) => _setSelected(loc.id, shouldSelect));
    });
  });
}

// 새 시군구 그룹 하나를 필터 배지에 추가 등록(기존 배지의 on/off 상태는 건드리지 않음)
function _registerFilterKey(sgg) {
  if (_allSigungu.includes(sgg)) return;
  _allSigungu.push(sgg);
  _allSigungu.sort();
  _activeFilters.add(sgg); // 새 그룹은 기본적으로 표시 상태

  ["sigungu-filters", "sigungu-filters-m"].forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const badge = document.createElement("span");
    badge.className = "sigungu-badge";
    badge.textContent = sgg;
    badge.style.background = getSigunguColor(sgg);
    badge.dataset.sgg = sgg;
    badge.title = `${sgg} 필터`;
    badge.addEventListener("click", () => _toggleFilter(sgg));
    container.appendChild(badge);
  });
}

function _toggleFilter(sgg) {
  if (_activeFilters.has(sgg)) {
    _activeFilters.delete(sgg);
  } else {
    _activeFilters.add(sgg);
  }
  _updateFilterBadges();
  _renderList();
}

function _toggleAllSigungu() {
  const allActive = _allSigungu.every((sgg) => _activeFilters.has(sgg));
  if (allActive) {
    _activeFilters.clear();
  } else {
    _allSigungu.forEach((sgg) => _activeFilters.add(sgg));
  }
  _updateFilterBadges();
  _renderList();
}

function _updateFilterBadges() {
  // 개별 시군구 배지
  document.querySelectorAll(".sigungu-badge:not(.sgg-all-badge)").forEach((badge) => {
    badge.classList.toggle("inactive", !_activeFilters.has(badge.dataset.sgg));
  });
  // "전체" 배지: 모두 활성일 때만 활성
  const allActive = _allSigungu.every((sgg) => _activeFilters.has(sgg));
  document.querySelectorAll(".sgg-all-badge").forEach((badge) => {
    badge.classList.toggle("inactive", !allActive);
  });
}

// ── 지점 목록 렌더 ────────────────────────────────────────────────────────────

function _buildList() {
  _renderList();
}

function _visibleLocations() {
  return _locations.filter((loc) => _activeFilters.has(_filterKey(loc)));
}

// 선택된 지점에 한해 _locations 배열 순서대로 1,2,3... 부여(미선택은 null).
// "순서대로 보기" 모드가 이 순서를 그대로 방문 순서로 쓴다.
function _computeAndAssignSeq() {
  let n = 0;
  for (const loc of _locations) {
    loc.seq = _state.selected.has(loc.id) ? ++n : null;
  }
}

// 선택/순서 변경 시, 행 전체를 다시 그리지 않고 이름 텍스트(번호 포함)만 갱신.
// 이름 수정 중(<input>으로 교체된 상태)인 행은 건드리지 않는다.
function _refreshNameLabels() {
  _computeAndAssignSeq();
  document.querySelectorAll(".location-item").forEach((el) => {
    const nameEl = el.querySelector(".loc-name");
    if (!nameEl) return;
    const loc = _locations.find((l) => String(l.id) === el.dataset.id);
    if (!loc) return;
    nameEl.textContent = loc.seq ? `${loc.seq}. ${loc.name}` : loc.name;
  });
}

// 실행 결과(실제 방문 순서) 배지 갱신 — 결과 없으면 배지 숨김.
function _refreshRouteBadges() {
  document.querySelectorAll(".location-item").forEach((el) => {
    const badge = el.querySelector(".loc-route-badge");
    if (!badge) return;
    const n = _routeOrderMap ? _routeOrderMap.get(el.dataset.id) : null;
    badge.textContent = n || "";
    badge.classList.toggle("d-none", !n);
  });
}

// 최적화/순서대로 실행 직후 optimize.js가 호출 — 지도 번호 마커와 같은 순서를 좌측에도 표시.
export function setRouteOrder(orderIds) {
  _routeOrderMap = new Map();
  orderIds.forEach((id, i) => _routeOrderMap.set(String(id), i + 1));
  _refreshRouteBadges();
}

// 선택 변경 등으로 이전 실행 결과가 더 이상 유효하지 않을 때 호출.
export function clearRouteOrder() {
  _routeOrderMap = null;
  _refreshRouteBadges();
}

// 드래그 재정렬: sourceId를 targetId 위치로 옮긴다(목록 전체 순서 기준).
function _reorderLocations(sourceId, targetId) {
  const fromIdx = _locations.findIndex((l) => l.id === sourceId);
  const toIdx = _locations.findIndex((l) => l.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = _locations.splice(fromIdx, 1);
  _locations.splice(toIdx, 0, moved);
  _renderList();
}

function _renderList() {
  _computeAndAssignSeq();
  const visible = _visibleLocations();

  ["location-list", "location-list-m"].forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    for (const loc of visible) {
      const item = _createListItem(loc);
      container.appendChild(item);
    }
  });

  _syncSelectAllCheckbox();
  _refreshRouteBadges();
}

// 더블클릭으로 이름 수정(좌표만 있는 지점에 이름을 붙일 때 주로 사용)
function _buildNameEl(loc) {
  const nameEl = document.createElement("div");
  nameEl.className = "loc-name";
  nameEl.textContent = loc.seq ? `${loc.seq}. ${loc.name}` : loc.name;
  nameEl.title = "더블클릭으로 이름 수정";
  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    _startRename(loc, nameEl);
  });
  return nameEl;
}

function _startRename(loc, nameEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm loc-name-edit";
  input.value = loc.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("click", (e) => e.stopPropagation());

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const newName = input.value.trim();
      if (newName && newName !== loc.name) {
        const resp = await fetch(`/api/locations/${loc.id}/name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        }).catch(() => null);
        if (resp && resp.ok) loc.name = newName;
      }
    }
    input.replaceWith(_buildNameEl(loc));
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); input.blur(); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); input.blur(); }
  });
  input.addEventListener("blur", () => finish(true));
}

function _createListItem(loc) {
  const div = document.createElement("div");
  div.className = "location-item";
  div.dataset.id = loc.id;
  if (_state.selected.has(loc.id)) div.classList.add("highlighted");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = _state.selected.has(loc.id);
  cb.addEventListener("click", (e) => {
    if (e.shiftKey && _lastClickedId !== null) {
      _shiftSelect(loc.id);
    } else {
      _setSelected(loc.id, cb.checked);
      _lastClickedId = loc.id;
      panToLocation(loc.id);
    }
  });

  const dragHandle = document.createElement("span");
  dragHandle.className = "loc-drag-handle";
  dragHandle.textContent = "⋮⋮";
  dragHandle.title = "드래그해서 순서 변경";
  dragHandle.draggable = true;
  dragHandle.addEventListener("dragstart", (e) => {
    _dragSourceId = loc.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(loc.id));
    // 드래그 중인 행임을 시각적으로 표시(다음 tick에 적용 — 드래그 고스트 이미지에는 반영 안 되게)
    setTimeout(() => div.classList.add("dragging"), 0);
  });
  dragHandle.addEventListener("dragend", () => {
    div.classList.remove("dragging");
    document.querySelectorAll(".location-item.drag-over")
      .forEach((el) => el.classList.remove("drag-over"));
    _dragSourceId = null;
  });

  // dragenter/dragleave는 행 안 자식 요소 경계를 넘을 때도 발생해 단순 on/off로는
  // 살짝만 움직여도 깜빡인다 — 진입/이탈 횟수를 세어 0으로 돌아왔을 때만 표시 해제.
  let dragDepth = 0;
  div.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (_dragSourceId === null || _dragSourceId === loc.id) return;
    dragDepth++;
    div.classList.add("drag-over");
  });
  div.addEventListener("dragover", (e) => e.preventDefault());
  div.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) div.classList.remove("drag-over");
  });
  div.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    div.classList.remove("drag-over");
    if (_dragSourceId === null) return;
    _reorderLocations(_dragSourceId, loc.id);
    _dragSourceId = null;
  });

  const info = document.createElement("div");
  info.style.overflow = "hidden";

  const nameEl = _buildNameEl(loc);

  const subEl = document.createElement("div");
  subEl.className = "loc-sub";
  subEl.textContent = loc.sigungu || "";

  info.appendChild(nameEl);
  info.appendChild(subEl);

  // 최적화/순서대로 실행 결과의 실제 방문 순서(지도 번호 마커와 같은 색) — 실행 전엔 숨김.
  const routeBadge = document.createElement("span");
  routeBadge.className = "loc-route-badge d-none";
  const routeN = _routeOrderMap ? _routeOrderMap.get(String(loc.id)) : null;
  if (routeN) {
    routeBadge.textContent = routeN;
    routeBadge.classList.remove("d-none");
  }

  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className = "btn btn-link btn-sm p-0 loc-share-btn";
  shareBtn.title = "공유 설정";
  shareBtn.textContent = "🔗";
  shareBtn.style.cssText = "flex-shrink:0;text-decoration:none;";
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openShareDialog(loc.id, loc.is_public, loc.shares || []);
  });

  div.appendChild(dragHandle);
  div.appendChild(cb);
  div.appendChild(info);
  div.appendChild(routeBadge);
  div.appendChild(shareBtn);

  // 행 클릭(체크박스·공유 버튼 제외)으로도 토글
  div.addEventListener("click", (e) => {
    if (e.target === cb || e.target === shareBtn || e.target === dragHandle) return;
    if (e.shiftKey && _lastClickedId !== null) {
      _shiftSelect(loc.id);
    } else {
      cb.checked = !cb.checked;
      _setSelected(loc.id, cb.checked);
      _lastClickedId = loc.id;
      panToLocation(loc.id);
    }
  });

  return div;
}

// ── Shift-클릭 범위 선택 ──────────────────────────────────────────────────────

function _shiftSelect(targetId) {
  const visible = _visibleLocations();
  const ids = visible.map((l) => l.id);
  const fromIdx = ids.indexOf(_lastClickedId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  const shouldSelect = !_state.selected.has(targetId);

  for (let i = start; i <= end; i++) {
    _setSelected(ids[i], shouldSelect);
  }
  _lastClickedId = targetId;
}

// ── 선택 상태 관리 ────────────────────────────────────────────────────────────

function _setSelected(id, selected) {
  if (selected) {
    _state.selected.add(id);
  } else {
    _state.selected.delete(id);
  }
  setMarkerSelected(id, selected);
  _syncListHighlight(id, selected);
  _refreshNameLabels();
  clearRouteOrder();
  _callbacks.updateSelectionSummary();
  _syncSelectAllCheckbox();
}

function _syncSelectAllCheckbox() {
  const visible = _visibleLocations();
  const selectedCount = visible.filter((loc) => _state.selected.has(loc.id)).length;
  ["cb-select-all", "cb-select-all-m"].forEach((id) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    if (visible.length === 0 || selectedCount === 0) {
      cb.checked = false;
      cb.indeterminate = false;
    } else if (selectedCount === visible.length) {
      cb.checked = true;
      cb.indeterminate = false;
    } else {
      cb.checked = false;
      cb.indeterminate = true;
    }
  });
}

function _syncListHighlight(id, selected) {
  document.querySelectorAll(`.location-item[data-id="${id}"]`).forEach((el) => {
    el.classList.toggle("highlighted", selected);
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = selected;
  });
}

// 지점이 새로 추가된 뒤(locations_ui.js) 사이드바 목록/필터를 갱신할 때 사용.
// newLoc을 전달하면 새 시군구 필터 배지를 (기존 on/off 상태 보존하며) 등록한다.
export function refreshLocationList(newLoc) {
  if (newLoc) _registerFilterKey(_filterKey(newLoc));
  _renderList();
}

// 박스 선택 등 외부에서 ID 목록으로 선택
export function selectByIds(ids) {
  ids.forEach((id) => _setSelected(id, true));
}

// 전체 선택 해제
export function clearSelection() {
  for (const id of [..._state.selected]) {
    _setSelected(id, false);
  }
  ["location-search", "location-search-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

// 마커 클릭 → 체크박스 토글 (map.js 에서 호출)
export function toggleById(id) {
  const selected = !_state.selected.has(id);
  _setSelected(id, selected);

  // 해당 항목이 목록에 없으면(필터됨) 전체 지역 표시로 복원
  const loc = _locations.find((l) => l.id === id);
  if (loc && !_activeFilters.has(_filterKey(loc))) {
    _allSigungu.forEach((sgg) => _activeFilters.add(sgg));
    _updateFilterBadges();
    _renderList();
  }

  // 목록에서 해당 항목으로 스크롤
  setTimeout(() => {
    document.querySelectorAll(`.location-item[data-id="${id}"]`).forEach((el) => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, 50);
}
