/**
 * app.js — 엔트리포인트. 모듈 임포트 및 초기화 조율.
 */
import { initMaps, setOriginMarker, setDestMarker,
         clearDestMarker, clearOriginMarker, clearResultLayers,
         onMarkerClick, invalidateMobileMapSize,
         enableBoxSelect, onBoxSelect } from "./map.js";
import { initSelection, clearSelection, selectByIds } from "./selection.js";
import { initOptimize } from "./optimize.js";
import { initMultiday } from "./multiday.js";

const LOCATIONS = window.LOCATIONS;

// ── 전역 상태 ────────────────────────────────────────────────────────────────
export const state = {
  origin: null,       // { lat, lng, label }
  destination: null,  // { lat, lng, label } | null
  selected: new Set(),
};

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

// 롱프레스로 메뉴가 방금 열렸을 때, 손을 떼는 touchend가 즉시 닫지 않도록 방지
let _ctxJustShown = false;

function showContextMenu(latlng, pageX, pageY) {
  _pendingCtxLatLng = latlng;
  ctxMenu.style.left = `${pageX}px`;
  ctxMenu.style.top  = `${pageY}px`;
  ctxMenu.classList.remove("d-none");
  _ctxJustShown = true;
}

function hideContextMenu() {
  if (_ctxJustShown) {
    _ctxJustShown = false;
    return; // 롱프레스 직후 touchend는 무시
  }
  ctxMenu.classList.add("d-none");
  _pendingCtxLatLng = null;
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("touchend", hideContextMenu);
// 메뉴 안에서 touchend가 document로 버블링되지 않도록 — 항목 탭 시 메뉴가 즉시 닫히는 것 방지
ctxMenu.addEventListener("touchend", (e) => e.stopPropagation());

ctxSetOrigin.addEventListener("click", () => {
  if (!_pendingCtxLatLng) return;
  state.origin = { lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: "지도 선택" };
  setOriginMarker(_pendingCtxLatLng, _clearOrigin);
  updateOriginLabel();
  updateOptimizeButton();
  hideContextMenu();
  // 모바일: 출발지 설정 후 목록 탭으로 자동 복귀
  if (window.innerWidth < 768) {
    document.getElementById("tab-list-btn")?.click();
  }
});

ctxSetDest.addEventListener("click", () => {
  if (!_pendingCtxLatLng) return;
  state.destination = { lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: "지도 선택" };
  setDestMarker(_pendingCtxLatLng, _clearDest);
  updateDestLabel();
  hideContextMenu();
  // 모바일: 도착지 설정 후 목록 탭으로 자동 복귀
  if (window.innerWidth < 768) {
    document.getElementById("tab-list-btn")?.click();
  }
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
          // HTTP(비localhost)에서는 브라우저 보안 정책으로 위치 접근 자체가 차단됨
          if (location.protocol === "http:" && location.hostname !== "localhost") {
            alert("GPS를 사용하려면 HTTPS 연결이 필요합니다.\n\n현재 HTTP로 접속 중이므로 브라우저가 위치 접근을 차단합니다.\n\n대신: 지도 탭 → 현재 위치 근처 길게 누르기로 출발지를 설정하세요.");
          } else {
            alert("위치 권한이 거부되었습니다.\n\n브라우저 설정에서 이 사이트의 위치 권한을 허용한 후 다시 시도하세요.\n또는 지도 탭에서 길게 눌러 출발지를 설정할 수 있습니다.");
          }
        } else {
          alert("위치를 가져올 수 없습니다.\n지도 탭에서 길게 눌러 출발지를 설정해주세요.");
        }
      },
      { timeout: 8000 }
    );
  });
}

setupGpsButton("btn-gps");
setupGpsButton("btn-gps-m");

// ── 박스 선택 버튼 ────────────────────────────────────────────────────────────
function _setBoxSelectActive(active) {
  enableBoxSelect(active);
  ["btn-box-select", "btn-box-select-m"].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.toggle("active", active);
    btn.title = active ? "선택 취소 (클릭)" : "영역 선택 (드래그)";
  });
}

["btn-box-select", "btn-box-select-m"].forEach((btnId) => {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const nowActive = !btn.classList.contains("active");
    _setBoxSelectActive(nowActive);
  });
});

onBoxSelect((ids) => {
  _setBoxSelectActive(false); // 모드 종료 + 버튼 원복
  if (ids.length > 0) selectByIds(ids);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (["btn-box-select", "btn-box-select-m"].some((id) => document.getElementById(id)?.classList.contains("active"))) {
    // 박스 선택 모드 중 → 모드만 취소
    _setBoxSelectActive(false);
  } else if (state.selected.size > 0) {
    // 선택 완료 후 → 선택 전체 해제
    clearSelection();
    updateOptimizeButton();
    updateSelectionSummary();
  }
});

// ── 출발지/도착지 사이드바 버튼 ──────────────────────────────────────────────
["btn-clear-origin", "btn-clear-origin-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _clearOrigin);
});

["btn-clear-dest", "btn-clear-dest-m"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", _clearDest);
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
  ["btn-clear-origin", "btn-clear-origin-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("d-none", !show);
  });
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
  // N일 계획 버튼: 지점 2개 이상 + 출발지 설정 시 활성화
  const mdEnabled = state.selected.size >= 2 && !!state.origin;
  ["btn-multiday", "btn-multiday-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !mdEnabled;
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

  // 데스크톱 패널만 숨김 (모바일은 탭 내부라 별도 처리 불필요)
  const desktopPanel = document.getElementById("result-panel");
  if (desktopPanel) desktopPanel.classList.add("d-none");
  const mobilePanel = document.getElementById("result-panel-m");
  if (mobilePanel) mobilePanel.innerHTML = '<p class="text-muted small text-center mt-4">최적화 후 결과가 표시됩니다.</p>';
  // multiday 결과 패널 숨김
  const mdPanel = document.getElementById("multiday-result-panel");
  if (mdPanel) mdPanel.classList.add("d-none");
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

// 지도 탭 전환 시 invalidateSize (CSS visibility 방식에서도 안전을 위해 유지)
document.getElementById("tab-map-btn")?.addEventListener("click", () => {
  setTimeout(() => invalidateMobileMapSize(), 50);
});

onMarkerClick((id) => {
  if (window._selectionModule) window._selectionModule.toggleById(id);
});

initSelection(LOCATIONS, state, { updateSelectionSummary, updateOptimizeButton });

window._optimizeModule = initOptimize(state, LOCATIONS);

const _multidayModule = initMultiday(state, LOCATIONS);
window._multidayModule = _multidayModule;

["btn-multiday", "btn-multiday-m"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", () => _multidayModule.runGrouping());
});

