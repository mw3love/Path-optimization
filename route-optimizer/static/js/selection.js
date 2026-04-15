/**
 * selection.js — 지점 목록 체크박스, 시군구 필터, 검색, 마커 ↔ 사이드바 양방향 동기화
 */
import { getSigunguColor, setMarkerSelected, panToLocation } from "./map.js";

let _locations = [];
let _state = null;
let _callbacks = null;

// 현재 표시할 시군구 집합 (비어 있으면 전체 숨김, 전체 포함이면 전체 표시)
const _activeFilters = new Set();
let _allSigungu = [];
let _searchQuery = "";

export function initSelection(locations, state, callbacks) {
  _locations = locations;
  _state = state;
  _callbacks = callbacks;

  _buildFilters();
  _buildList();
  _bindSearch();

  // 외부에서 toggleById 호출 가능하도록 등록
  window._selectionModule = { toggleById };
}

// ── 시군구 필터 ───────────────────────────────────────────────────────────────

function _buildFilters() {
  _allSigungu = [...new Set(_locations.map((l) => l.sigungu))].sort();
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

// ── 검색 ─────────────────────────────────────────────────────────────────────

function _bindSearch() {
  ["location-search", "location-search-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", (e) => {
      _searchQuery = e.target.value.toLowerCase();
      _renderList();
    });
  });
}

// ── 지점 목록 렌더 ────────────────────────────────────────────────────────────

function _buildList() {
  _renderList();
}

function _visibleLocations() {
  return _locations.filter((loc) => {
    if (!_activeFilters.has(loc.sigungu)) return false;
    if (_searchQuery) {
      const haystack = (loc.name + " " + loc.address + " " + loc.sigungu).toLowerCase();
      if (!haystack.includes(_searchQuery)) return false;
    }
    return true;
  });
}

function _renderList() {
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
}

function _createListItem(loc) {
  const div = document.createElement("div");
  div.className = "location-item";
  div.dataset.id = loc.id;
  if (_state.selected.has(loc.id)) div.classList.add("highlighted");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = _state.selected.has(loc.id);
  cb.addEventListener("change", () => {
    _setSelected(loc.id, cb.checked);
    panToLocation(loc.id);
  });

  const colorDot = document.createElement("span");
  colorDot.style.cssText = `
    display:inline-block;width:10px;height:10px;border-radius:50%;
    background:${getSigunguColor(loc.sigungu)};flex-shrink:0;
  `;

  const info = document.createElement("div");
  info.style.overflow = "hidden";

  const nameEl = document.createElement("div");
  nameEl.className = "loc-name";
  nameEl.textContent = `${loc.seq}. ${loc.name}`;

  const subEl = document.createElement("div");
  subEl.className = "loc-sub";
  subEl.textContent = loc.sigungu;

  info.appendChild(nameEl);
  info.appendChild(subEl);

  div.appendChild(cb);
  div.appendChild(colorDot);
  div.appendChild(info);

  // 행 클릭(체크박스 제외)으로도 토글
  div.addEventListener("click", (e) => {
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    _setSelected(loc.id, cb.checked);
    panToLocation(loc.id);
  });

  return div;
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

// 전체 선택 해제
export function clearSelection() {
  for (const id of [..._state.selected]) {
    _setSelected(id, false);
  }
  _searchQuery = "";
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
  if (loc && !_activeFilters.has(loc.sigungu)) {
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
