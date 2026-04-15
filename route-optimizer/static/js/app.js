/**
 * app.js — 엔트리포인트. 모듈 임포트 및 초기화 조율.
 */
import { initMaps, getSigunguColor, setOriginMarker, setDestMarker,
         clearDestMarker, onMarkerClick } from "./map.js";
import { initSelection } from "./selection.js";
import { initOptimize } from "./optimize.js";

const LOCATIONS = window.LOCATIONS;

// ── 전역 상태 ────────────────────────────────────────────────────────────────
export const state = {
  origin: null,       // { lat, lng, label }
  destination: null,  // { lat, lng, label } | null
  selected: new Set(),
};

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
  setOriginMarker(_pendingCtxLatLng);
  updateOriginLabel();
  updateOptimizeButton();
  hideContextMenu();
});

ctxSetDest.addEventListener("click", () => {
  if (!_pendingCtxLatLng) return;
  state.destination = { lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: "지도 선택" };
  setDestMarker(_pendingCtxLatLng);
  updateDestLabel();
  hideContextMenu();
});

// ── GPS 버튼 ──────────────────────────────────────────────────────────────────
function setupGpsButton(btnId, labelUpdate) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("이 브라우저는 GPS를 지원하지 않습니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.origin = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "현재 위치",
        };
        setOriginMarker({ lat: state.origin.lat, lng: state.origin.lng });
        updateOriginLabel();
        updateOptimizeButton();
      },
      () => alert("GPS 위치를 가져올 수 없습니다.")
    );
  });
}

setupGpsButton("btn-gps");
setupGpsButton("btn-gps-m");

// ── 도착지 삭제 버튼 ─────────────────────────────────────────────────────────
function setupClearDest(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    state.destination = null;
    clearDestMarker();
    updateDestLabel();
  });
}

setupClearDest("btn-clear-dest");
setupClearDest("btn-clear-dest-m");

// ── 도착지 설정 버튼 (사이드바) ───────────────────────────────────────────────
// 클릭 후 다음 지도 클릭 지점을 도착지로 지정하는 "대기 모드"
let _waitingForDest = false;

function _enterDestMode() {
  _waitingForDest = true;
  document.body.style.cursor = "crosshair";
  alert("지도를 클릭해 도착지를 지정하세요. (우클릭 메뉴를 이용해도 됩니다)");
}

["btn-set-dest", "btn-set-dest-m"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", _enterDestMode);
});

// ── 라벨 업데이트 ─────────────────────────────────────────────────────────────
export function updateOriginLabel() {
  const text = state.origin
    ? `출발지: ${state.origin.label}`
    : "출발지: 미지정 (지도 우클릭)";
  document.getElementById("label-origin").textContent = text;
  const m = document.getElementById("label-origin-m");
  if (m) m.textContent = text.replace("우클릭", "길게누르기");
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
  ["btn-clear-dest", "btn-clear-dest-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("d-none", !show);
  });
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

  // 인접 선택 지점 간 직선 거리 합 × 1.4 / 60km/h → 분 (순서 무시 단순 추정)
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
const { map, mapMobile } = initMaps(LOCATIONS, showContextMenu);

onMarkerClick((id) => {
  // selection.js 에서 처리
  if (window._selectionModule) window._selectionModule.toggleById(id);
});

initSelection(LOCATIONS, state, { updateSelectionSummary, updateOptimizeButton });

window._optimizeModule = initOptimize(state, LOCATIONS);
