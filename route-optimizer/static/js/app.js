/**
 * app.js — 엔트리포인트. 모듈 임포트 및 초기화 조율.
 */
import { initMaps, setOriginMarker, setDestMarker,
         clearDestMarker, clearOriginMarker, clearResultLayers,
         onMarkerClick } from "./map.js";
import { initSelection, clearSelection } from "./selection.js";
import { initOptimize } from "./optimize.js";

const LOCATIONS = window.LOCATIONS;

// ── 전역 상태 ────────────────────────────────────────────────────────────────
export const state = {
  origin: null,       // { lat, lng, label }
  destination: null,  // { lat, lng, label } | null
  selected: new Set(),
};

// ── 디폴트 설정 (localStorage) ───────────────────────────────────────────────
let _defaultOrigin = null;
let _defaultDestination = null;

function _loadDefaults() {
  try {
    const o = localStorage.getItem("route_default_origin");
    if (o) _defaultOrigin = JSON.parse(o);
    const d = localStorage.getItem("route_default_dest");
    if (d) _defaultDestination = JSON.parse(d);
  } catch (e) {}
}

function _saveDefaultOrigin() {
  if (!state.origin) return;
  _defaultOrigin = { ...state.origin };
  try { localStorage.setItem("route_default_origin", JSON.stringify(_defaultOrigin)); } catch (e) {}
  _updateDefaultButtons();
}

function _saveDefaultDest() {
  if (!state.destination) return;
  _defaultDestination = { ...state.destination };
  try { localStorage.setItem("route_default_dest", JSON.stringify(_defaultDestination)); } catch (e) {}
  _updateDefaultButtons();
}

function _applyDefaultOrigin() {
  if (!_defaultOrigin) return;
  state.origin = { ..._defaultOrigin };
  setOriginMarker({ lat: state.origin.lat, lng: state.origin.lng }, _clearOrigin);
  updateOriginLabel();
  updateOptimizeButton();
}

function _applyDefaultDest() {
  if (!_defaultDestination) return;
  state.destination = { ..._defaultDestination };
  setDestMarker({ lat: state.destination.lat, lng: state.destination.lng }, _clearDest);
  updateDestLabel();
}

function _updateDefaultButtons() {
  ["btn-apply-origin-default", "btn-apply-origin-default-m"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("d-none", !_defaultOrigin);
    if (_defaultOrigin) btn.title = `기본: ${_defaultOrigin.label}`;
  });
  ["btn-apply-dest-default", "btn-apply-dest-default-m"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("d-none", !_defaultDestination);
    if (_defaultDestination) btn.title = `기본: ${_defaultDestination.label}`;
  });
}

// ── 출발지/도착지 클리어 헬퍼 ────────────────────────────────────────────────
function _clearOrigin() {
  state.origin = null;
  clearOriginMarker();
  updateOriginLabel();
  updateOptimizeButton();
}

function _clearDest() {
  state.destination = null;
  clearDestMarker();
  updateDestLabel();
}

// ── 컨텍스트 메뉴 ─────────────────────────────────────────────────────────────
const ctxMenu = document.getElementById("ctx-menu");
const ctxSetOrigin = document.getElementById("ctx-set-origin");
const ctxSetDest = document.getElementById("ctx-set-dest");

let _pendingCtxLatLng = null;

function showContextMenu(latlng, pageX, pageY) {
  _pendingCtxLatLng = latlng;
  ctxMenu.style.left = `${pageX}px`;
  ctxMenu.style.top  = `${pageY}px`;
  ctxMenu.classList.remove("d-none");
}

function hideContextMenu() {
  ctxMenu.classList.add("d-none");
  _pendingCtxLatLng = null;
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("touchend", hideContextMenu);

ctxSetOrigin.addEventListener("click", () => {
  if (!_pendingCtxLatLng) return;
  state.origin = { lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: "지도 선택" };
  setOriginMarker(_pendingCtxLatLng, _clearOrigin);
  updateOriginLabel();
  updateOptimizeButton();
  hideContextMenu();
});

ctxSetDest.addEventListener("click", () => {
  if (!_pendingCtxLatLng) return;
  state.destination = { lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: "지도 선택" };
  setDestMarker(_pendingCtxLatLng, _clearDest);
  updateDestLabel();
  hideContextMenu();
});

// ── GPS 버튼 ──────────────────────────────────────────────────────────────────
function setupGpsButton(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("이 브라우저는 위치 기능을 지원하지 않습니다.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "⏳";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.disabled = false;
        btn.textContent = "📍";
        state.origin = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "현재 위치",
        };
        setOriginMarker({ lat: state.origin.lat, lng: state.origin.lng }, _clearOrigin);
        updateOriginLabel();
        updateOptimizeButton();
      },
      (err) => {
        btn.disabled = false;
        btn.textContent = "📍";
        if (err.code === 1) {
          alert("위치 권한이 거부되었습니다.\n브라우저 주소창 왼쪽 자물쇠 아이콘에서 위치 권한을 허용해주세요.");
        } else {
          alert("위치를 가져올 수 없습니다. 스마트폰에서 접속하면 더 잘 작동합니다.");
        }
      },
      { timeout: 8000 }
    );
  });
}

setupGpsButton("btn-gps");
setupGpsButton("btn-gps-m");

// ── 출발지/도착지 사이드바 버튼 ──────────────────────────────────────────────
["btn-clear-origin", "btn-clear-origin-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _clearOrigin);
});

["btn-clear-dest", "btn-clear-dest-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _clearDest);
});

["btn-save-origin-default", "btn-save-origin-default-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _saveDefaultOrigin);
});

["btn-save-dest-default", "btn-save-dest-default-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _saveDefaultDest);
});

["btn-apply-origin-default", "btn-apply-origin-default-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _applyDefaultOrigin);
});

["btn-apply-dest-default", "btn-apply-dest-default-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _applyDefaultDest);
});

// ── 라벨 업데이트 ─────────────────────────────────────────────────────────────
export function updateOriginLabel() {
  const text = state.origin
    ? `출발지: ${state.origin.label}`
    : "출발지: 미지정 (지도 우클릭)";
  document.getElementById("label-origin").textContent = text;
  const m = document.getElementById("label-origin-m");
  if (m) m.textContent = text.replace("우클릭", "길게누르기");
  const show = !!state.origin;
  ["btn-clear-origin", "btn-clear-origin-m",
   "btn-save-origin-default", "btn-save-origin-default-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("d-none", !show);
  });
  // apply 버튼은 _defaultOrigin 유무로 별도 관리 (_updateDefaultButtons)
}

export function updateDestLabel() {
  const text = state.destination
    ? `도착지: ${state.destination.label}`
    : "도착지: 미지정 (Open TSP)";
  ["label-destination", "label-destination-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  const show = !!state.destination;
  ["btn-clear-dest", "btn-clear-dest-m",
   "btn-save-dest-default", "btn-save-dest-default-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("d-none", !show);
  });
  // apply 버튼은 _defaultDestination 유무로 별도 관리 (_updateDefaultButtons)
}

export function updateOptimizeButton() {
  const enabled = state.selected.size >= 2 && !!state.origin;
  ["btn-optimize", "btn-optimize-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function updateSelectionSummary() {
  const n = state.selected.size;
  const stay = parseInt(
    document.getElementById("stay-minutes")?.value
    || document.getElementById("stay-minutes-m")?.value
    || "20", 10
  );
  const stayTotal = n * stay;

  let driveEstMin = 0;
  const selLocs = LOCATIONS.filter((l) => state.selected.has(l.id));
  for (let i = 0; i + 1 < selLocs.length; i++) {
    const km = _haversineKm(selLocs[i].lat, selLocs[i].lng, selLocs[i+1].lat, selLocs[i+1].lng);
    driveEstMin += Math.round((km * 1.4) / 60 * 60);
  }

  const totalMin = stayTotal + driveEstMin;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const timeStr = h > 0 ? `약 ${h}시간 ${m}분` : `약 ${m}분`;

  const text = n > 0 ? `선택: ${n}개 / ${timeStr} (추정)` : "선택: 0개";
  ["selection-summary", "selection-summary-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  updateOptimizeButton();
}

// ── 초기화 버튼 ───────────────────────────────────────────────────────────────
function resetAll() {
  clearSelection();
  _clearOrigin();
  _clearDest();
  clearResultLayers();

  // 디폴트 복원
  if (_defaultOrigin) {
    state.origin = { ..._defaultOrigin };
    setOriginMarker({ lat: state.origin.lat, lng: state.origin.lng }, _clearOrigin);
    updateOriginLabel();
  }
  if (_defaultDestination) {
    state.destination = { ..._defaultDestination };
    setDestMarker({ lat: state.destination.lat, lng: state.destination.lng }, _clearDest);
    updateDestLabel();
  }

  ["result-panel", "result-panel-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("d-none");
  });
  updateOriginLabel();
  updateDestLabel();
  updateSelectionSummary();
}

["btn-reset", "btn-reset-m"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", resetAll);
});

// ── 최적화 버튼 ───────────────────────────────────────────────────────────────
["btn-optimize", "btn-optimize-m"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("click", () => {
      const { runOptimize } = window._optimizeModule;
      if (runOptimize) runOptimize();
    });
  }
});

// ── 초기화 ────────────────────────────────────────────────────────────────────
initMaps(LOCATIONS, showContextMenu);

onMarkerClick((id) => {
  if (window._selectionModule) window._selectionModule.toggleById(id);
});

initSelection(LOCATIONS, state, { updateSelectionSummary, updateOptimizeButton });

window._optimizeModule = initOptimize(state, LOCATIONS);

// 디폴트 출발지/도착지 적용
_loadDefaults();
_updateDefaultButtons();
if (_defaultOrigin) {
  state.origin = { ..._defaultOrigin };
  setOriginMarker({ lat: state.origin.lat, lng: state.origin.lng }, _clearOrigin);
  updateOriginLabel();
  updateOptimizeButton();
}
if (_defaultDestination) {
  state.destination = { ..._defaultDestination };
  setDestMarker({ lat: state.destination.lat, lng: state.destination.lng }, _clearDest);
  updateDestLabel();
}
