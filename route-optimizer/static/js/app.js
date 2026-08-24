/**
 * app.js — 엔트리포인트. 모듈 임포트 및 초기화 조율.
 */
import { initMaps, setOriginMarker, setDestMarker,
         clearDestMarker, clearOriginMarker, clearResultLayers,
         onMarkerClick, invalidateMobileMapSize,
         enableBoxSelect, onBoxSelect } from "./map.js";
import { initSelection, clearSelection, selectByIds, refreshLocationList, clearRouteOrder, refreshAnchorBadges } from "./selection.js";
import { initOptimize } from "./optimize.js";
import { initMultiday } from "./multiday.js";
import { fetchLocations, logout } from "./auth.js";
import { initLocationsUi, addLocationAtLatLng } from "./locations_ui.js";

let LOCATIONS = [];

document.getElementById("btn-logout")?.addEventListener("click", logout);

const LABEL_MAP_SELECTED = "지도에서 선택됨";
const LABEL_GPS_SELECTED = "현 위치로 선택됨";

// ── 전역 상태 ────────────────────────────────────────────────────────────────
export const state = {
  origin: null,       // { lat, lng, label }
  destination: null,  // { lat, lng, label } | null
  selected: new Set(),
};

// 출발지/도착지를 바꿀 때는 항상 이 두 헬퍼를 거친다 — 좌패널 지점 목록의
// 동기화 표시(①/🏁, 상/하단 고정 배치, selection.js)를 매번 갱신해야 하기 때문.
// 이미 값이 있어도 경고 없이 그냥 덮어쓴다(우클릭 "여기서 출발/종료"와 동일 동작).
function _setOrigin(origin) {
  state.origin = origin;
  refreshAnchorBadges();
}

function _setDestination(dest) {
  state.destination = dest;
  refreshAnchorBadges();
}

// ── 출발지/도착지 클리어 헬퍼 ────────────────────────────────────────────────
function _clearOrigin() {
  _setOrigin(null);
  clearOriginMarker();
  updateOriginLabel();
  updateOptimizeButton();
}

function _clearDest() {
  _setDestination(null);
  clearDestMarker();
  updateDestLabel();
}

// 좌패널 지점을 출발지/도착지로 설정할 때 selection.js가 호출(우클릭 메뉴와 동일 로직).
function _setOriginFromLocation(loc) {
  _setOrigin({ lat: loc.lat, lng: loc.lng, label: loc.name });
  setOriginMarker({ lat: loc.lat, lng: loc.lng }, _clearOrigin);
  updateOriginLabel();
  updateOptimizeButton();
}

function _setDestinationFromLocation(loc) {
  _setDestination({ lat: loc.lat, lng: loc.lng, label: loc.name });
  setDestMarker({ lat: loc.lat, lng: loc.lng }, _clearDest);
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
  _setOrigin({ lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: LABEL_MAP_SELECTED });
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
  _setDestination({ lat: _pendingCtxLatLng.lat, lng: _pendingCtxLatLng.lng, label: LABEL_MAP_SELECTED });
  setDestMarker(_pendingCtxLatLng, _clearDest);
  updateDestLabel();
  hideContextMenu();
  // 모바일: 도착지 설정 후 목록 탭으로 자동 복귀
  if (window.innerWidth < 768) {
    document.getElementById("tab-list-btn")?.click();
  }
});

document.getElementById("ctx-add-location")?.addEventListener("click", () => {
  if (!_pendingCtxLatLng) return;
  addLocationAtLatLng(_pendingCtxLatLng);
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
        _setOrigin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: LABEL_GPS_SELECTED,
        });
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
const COORD_LABELS = new Set([LABEL_MAP_SELECTED, LABEL_GPS_SELECTED]);
function _fmtCoord(o) {
  return COORD_LABELS.has(o.label)
    ? `${o.label} (${o.lat.toFixed(5)}, ${o.lng.toFixed(5)})`
    : o.label;
}

export function updateOriginLabel() {
  const text = state.origin
    ? `출발지: ${_fmtCoord(state.origin)}`
    : "출발지: 미지정";
  document.getElementById("label-origin").textContent = text;
  const m = document.getElementById("label-origin-m");
  if (m) m.textContent = text;
  const show = !!state.origin;
  ["btn-clear-origin", "btn-clear-origin-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("d-none", !show);
  });
}

export function updateDestLabel() {
  const text = state.destination
    ? `도착지: ${_fmtCoord(state.destination)}`
    : "도착지: 미지정";
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
  ["btn-optimize", "btn-optimize-m", "btn-fixed-order", "btn-fixed-order-m"].forEach((id) => {
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
  clearRouteOrder();
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
      if (runOptimize) runOptimize(false);
    });
  }
});

["btn-fixed-order", "btn-fixed-order-m"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("click", () => {
      const { runOptimize } = window._optimizeModule;
      if (runOptimize) runOptimize(true);
    });
  }
});

// ── 자동 현재 위치 설정 (페이지 로드 시) ────────────────────────────────────
// GPS 요청은 fetchLocations()/지도 초기화와 무관하므로 _init() 맨 앞에서 병렬로 쏘고,
// maximumAge로 최근 캐시된 위치가 있으면 즉시 반환받아 체감 속도를 줄인다.
// 단, 마커를 찍으려면 initMaps() 이후여야 하므로 좌표만 Promise로 넘기고
// 실제 반영(_applyCurrentLocation)은 지도 준비가 끝난 뒤 수행한다.
function _requestCurrentLocation() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: LABEL_GPS_SELECTED }),
      () => resolve(null), // 실패 시 조용히 무시
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

function _applyCurrentLocation(coord) {
  if (!coord) return;
  _setOrigin({ ...coord });
  _setDestination({ ...coord });
  setOriginMarker({ lat: coord.lat, lng: coord.lng }, _clearOrigin);
  setDestMarker({ lat: coord.lat, lng: coord.lng }, _clearDest);
  updateOriginLabel();
  updateDestLabel();
  updateOptimizeButton();
}

// ── 초기화 (비동기: 지점 목록을 먼저 받아온 뒤 지도/선택/최적화 모듈을 구성) ──
async function _init() {
  const gpsPromise = _requestCurrentLocation();
  LOCATIONS = await fetchLocations();

  initMaps(LOCATIONS, showContextMenu);

  document.getElementById("tab-map-btn")?.addEventListener("click", () => {
    setTimeout(() => invalidateMobileMapSize(), 50);
  });

  onMarkerClick((id) => {
    if (window._selectionModule) window._selectionModule.toggleById(id);
  });

  initSelection(LOCATIONS, state, {
    updateSelectionSummary,
    updateOptimizeButton,
    setOriginFromLocation: _setOriginFromLocation,
    setDestinationFromLocation: _setDestinationFromLocation,
  });
  // initSelection이 기본적으로 전체 지점을 선택 상태로 채우므로, 정적 템플릿의
  // "선택: 0개"/버튼 disabled 기본값을 실제 상태로 갱신해야 한다.
  updateSelectionSummary();
  updateOptimizeButton();

  initLocationsUi(() => LOCATIONS, (newLoc) => {
    refreshLocationList(newLoc);
    updateSelectionSummary();
  });

  window._optimizeModule = initOptimize(state, LOCATIONS);

  const _multidayModule = initMultiday(state, LOCATIONS);
  window._multidayModule = _multidayModule;

  ["btn-multiday", "btn-multiday-m"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => _multidayModule.runGrouping());
  });

  _applyCurrentLocation(await gpsPromise);
}

_init();

