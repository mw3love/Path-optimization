/**
 * selection.js — 지점 목록 체크박스, 시군구 필터, 검색, 마커 ↔ 사이드바 양방향 동기화
 */
import { getSigunguColor, setMarkerSelected, panToLocation } from "./map.js";

let _locations = [];
let _state = null;
let _callbacks = null;

// 현재 활성 시군구 필터 집합 (비어 있으면 전체 표시)
const _activeFilters = new Set();
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
  const sggs = [...new Set(_locations.map((l) => l.sigungu))].sort();

  ["sigungu-filters", "sigungu-filters-m"].forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    for (const sgg of sggs) {
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

function _updateFilterBadges() {
  document.querySelectorAll(".sigungu-badge").forEach((badge) => {
    const sgg = badge.dataset.sgg;
    const active = _activeFilters.size === 0 || _activeFilters.has(sgg);
    badge.classList.toggle("inactive", !active);
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
    if (_activeFilters.size > 0 && !_activeFilters.has(loc.sigungu)) return false;
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
}

function _syncListHighlight(id, selected) {
  document.querySelectorAll(`.location-item[data-id="${id}"]`).forEach((el) => {
    el.classList.toggle("highlighted", selected);
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = selected;
  });
}

// 마커 클릭 → 체크박스 토글 (map.js 에서 호출)
export function toggleById(id) {
  const selected = !_state.selected.has(id);
  _setSelected(id, selected);

  // 해당 항목이 목록에 없으면(필터됨) 필터 해제
  const loc = _locations.find((l) => l.id === id);
  if (loc && _activeFilters.size > 0 && !_activeFilters.has(loc.sigungu)) {
    _activeFilters.clear();
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
