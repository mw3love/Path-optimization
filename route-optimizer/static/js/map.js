/**
 * map.js — Leaflet 초기화, 마커 렌더, 컨텍스트 메뉴(우클릭/롱프레스)
 *
 * 모바일 탭은 CSS에서 display:none 대신 visibility:hidden을 사용하므로
 * 두 지도 모두 앱 시작 시 초기화해도 컨테이너 크기가 올바르게 인식된다.
 */

// ── 시군구 색상 팔레트 ────────────────────────────────────────────────────────
const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231",
  "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
  "#fabebe", "#469990", "#e6beff", "#9a6324",
];

const _sigunguColorMap = {};
let _paletteIdx = 0;

export function getSigunguColor(sigungu) {
  if (!_sigunguColorMap[sigungu]) {
    _sigunguColorMap[sigungu] = PALETTE[_paletteIdx % PALETTE.length];
    _paletteIdx++;
  }
  return _sigunguColorMap[sigungu];
}

export function getAllSigunguColors() {
  return { ..._sigunguColorMap };
}

// ── 지도 인스턴스 ─────────────────────────────────────────────────────────────
let _map = null;
let _mapMobile = null;

// 마커 저장: id → { marker, markerM }
const _markers = {};

// 컨텍스트 메뉴 콜백
let _onContextMenu = null;

// ── 박스 선택 ─────────────────────────────────────────────────────────────────
let _boxSelectActive = false;
let _boxSelectLocations = [];
const _boxSelectListeners = [];

export function onBoxSelect(fn) { _boxSelectListeners.push(fn); }
function _fireBoxSelect(ids) { _boxSelectListeners.forEach((fn) => fn(ids)); }

// 인쇄 버튼에서 window.print() 호출 전 지도 준비
// → print CSS와 동일한 레이아웃을 미리 적용해 SVG 위치 고정
// → Promise 반환: 타일 로딩 완료 후 resolve
export function preparePrint() {
  return new Promise((resolve) => {
    if (!_map) { resolve(); return; }
    _map.closePopup();

    const sidebar = document.getElementById("sidebar");
    const mapEl   = _map.getContainer();

    // print CSS가 할 일을 미리 적용
    if (sidebar) sidebar.style.display = "none";
    mapEl.style.height = "560px";

    // 인쇄 후 원상복구
    window.addEventListener("afterprint", () => {
      if (sidebar) sidebar.style.display = "";
      mapEl.style.height = "";
      _map.invalidateSize({ animate: false });
    }, { once: true });

    // 2프레임 후 크기 재계산 → fitBounds → 타일 완전 로딩 대기 후 resolve
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _map.invalidateSize({ animate: false });

        if (_lastResultBounds) {
          _map.fitBounds(_lastResultBounds, { padding: [30, 30], animate: false });
        }

        // 타일이 모두 로딩될 때까지 대기 (최대 2초)
        const tileLayer = _map._layers && Object.values(_map._layers).find(l => l._url);
        let settled = false;

        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        if (tileLayer && tileLayer._loading) {
          tileLayer.once("load", done);
          setTimeout(done, 2000); // 최대 2초 타임아웃
        } else {
          // 타일 이미 로딩됨 — 한 프레임 더 기다려 페인트 완료 보장
          requestAnimationFrame(done);
        }
      });
    });
  });
}

export function enableBoxSelect(active) {
  _boxSelectActive = active;
  document.querySelectorAll(".box-select-capture").forEach((el) => {
    el.style.display = active ? "block" : "none";
  });
  [_map, _mapMobile].forEach((map) => {
    if (!map) return;
    if (active) map.dragging.disable();
    else map.dragging.enable();
  });
}

// ── 지도 초기화 ───────────────────────────────────────────────────────────────
export function initMap(containerId, locations, onContextMenu) {
  _onContextMenu = onContextMenu;

  const avgLat = locations.reduce((s, l) => s + l.lat, 0) / locations.length;
  const avgLng = locations.reduce((s, l) => s + l.lng, 0) / locations.length;

  const map = L.map(containerId, { zoomControl: true }).setView([avgLat, avgLng], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  map.on("click", (e) => _fireMapClick(e.latlng));

  map.on("contextmenu", (e) => {
    e.originalEvent.preventDefault();
    if (_onContextMenu) _onContextMenu(e.latlng, e.originalEvent.pageX, e.originalEvent.pageY);
  });

  _attachLongPress(map);
  return map;
}

export function initMaps(locations, onContextMenu) {
  _onContextMenu = onContextMenu;
  _boxSelectLocations = locations;
  _map = initMap("map", locations, onContextMenu);
  _mapMobile = initMap("map-mobile", locations, onContextMenu);
  _renderMarkers(locations);
  _attachBoxSelect(_map);
  _attachBoxSelect(_mapMobile);

  // Ctrl+P 직접 인쇄 시: 인쇄 버튼 경로와 동일하게 preparePrint() 호출
  // (beforeprint는 동기라 await 불가 — 최선의 동기 처리)
  window.addEventListener("beforeprint", () => {
    if (!_map) return;
    _map.closePopup();
    const mapEl = _map.getContainer();
    mapEl.style.height = "560px";
    _map.invalidateSize({ animate: false });
    if (_lastResultBounds) {
      _map.fitBounds(_lastResultBounds, { padding: [30, 30], animate: false });
    }
  });

  return { map: _map, mapMobile: _mapMobile };
}

export function invalidateMobileMapSize() {
  if (_mapMobile) _mapMobile.invalidateSize({ animate: false });
}

// ── 마커 렌더 ─────────────────────────────────────────────────────────────────
function _renderMarkers(locations) {
  for (const loc of locations) {
    getSigunguColor(loc.sigungu);
    _addLocationMarker(loc);
  }
}

function _addLocationMarker(loc) {
  const color = getSigunguColor(loc.sigungu);
  const opts = {
    radius: 7,
    color: color,
    fillColor: color,
    fillOpacity: 0.75,
    weight: 1.5,
  };

  const popup = `<b>${loc.seq}. ${loc.name}</b><br/><span class="text-muted small">${loc.sigungu}</span><br/><small>${loc.address}</small>`;

  const marker = L.circleMarker([loc.lat, loc.lng], opts)
    .addTo(_map)
    .bindPopup(popup);

  const markerM = L.circleMarker([loc.lat, loc.lng], { ...opts })
    .addTo(_mapMobile)
    .bindPopup(popup);

  marker.on("click", () => _fireMarkerClick(loc.id));
  markerM.on("click", () => _fireMarkerClick(loc.id));

  _markers[loc.id] = { marker, markerM };
}

// ── 마커 강조/해제 ────────────────────────────────────────────────────────────
export function setMarkerSelected(id, selected) {
  const entry = _markers[id];
  if (!entry) return;
  const color = selected ? "#ff6600" : getSigunguColor(
    window.LOCATIONS.find((l) => l.id === id)?.sigungu ?? ""
  );
  const weight = selected ? 3 : 1.5;
  const radius = selected ? 9 : 7;
  [entry.marker, entry.markerM].forEach((m) => {
    m.setStyle({ color, fillColor: color, weight, radius });
  });
}

export function panToLocation(id) {
  const entry = _markers[id];
  if (!entry) return;
  _map.panTo(entry.marker.getLatLng());
}

// ── 출발지/도착지 마커 ────────────────────────────────────────────────────────
let _originMarker  = null;
let _originMarkerM = null;
let _destMarker    = null;
let _destMarkerM   = null;

const _starIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:22px;line-height:1;">⭐</div>',
  iconAnchor: [11, 22],
});

const _flagIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:22px;line-height:1;">🏁</div>',
  iconAnchor: [11, 22],
});

export function setOriginMarker(latlng) {
  [_originMarker, _originMarkerM].forEach((m) => m && m.remove());
  _originMarker  = L.marker(latlng, { icon: _starIcon }).addTo(_map).bindPopup("⭐ 출발지");
  _originMarkerM = L.marker(latlng, { icon: _starIcon }).addTo(_mapMobile).bindPopup("⭐ 출발지");
  _map.flyTo(latlng, Math.max(_map.getZoom(), 13));
  _mapMobile.flyTo(latlng, Math.max(_mapMobile.getZoom(), 13));
}

export function setDestMarker(latlng) {
  [_destMarker, _destMarkerM].forEach((m) => m && m.remove());
  _destMarker  = L.marker(latlng, { icon: _flagIcon }).addTo(_map).bindPopup("🏁 도착지");
  _destMarkerM = L.marker(latlng, { icon: _flagIcon }).addTo(_mapMobile).bindPopup("🏁 도착지");
}

export function clearDestMarker() {
  [_destMarker, _destMarkerM].forEach((m) => m && m.remove());
  _destMarker = null;
  _destMarkerM = null;
}

export function clearOriginMarker() {
  [_originMarker, _originMarkerM].forEach((m) => m && m.remove());
  _originMarker = null;
  _originMarkerM = null;
}

// ── 결과 마커/경로선 ──────────────────────────────────────────────────────────
const _resultLayers = [];
let _lastResultBounds = null; // 인쇄 시 fitBounds 재호출용

export function clearResultLayers() {
  _resultLayers.forEach((l) => {
    _map.removeLayer(l.d);
    _mapMobile.removeLayer(l.m);
  });
  _resultLayers.length = 0;
  _lastResultBounds = null;
}

export function addNumberedMarker(latlng, num, color = "#1a73e8") {
  const icon = L.divIcon({
    className: "numbered-icon",
    html: `<div class="num-marker" style="background:${color}">${num}</div>`,
    iconAnchor: [14, 14],
  });
  const d = L.marker(latlng, { icon }).addTo(_map);
  const m = L.marker(latlng, { icon: L.divIcon({ ...icon.options }) }).addTo(_mapMobile);
  _resultLayers.push({ d, m });
  // 인쇄 bounds에 번호 마커 좌표 포함
  if (!_lastResultBounds) _lastResultBounds = L.latLngBounds(latlng, latlng);
  else _lastResultBounds.extend(latlng);
}

export function drawPolyline(coords, color = "#1a73e8") {
  if (!coords || coords.length < 2) return;
  const style = { color, weight: 3, opacity: 0.7 };
  const d = L.polyline(coords, style).addTo(_map);
  const m = L.polyline(coords, style).addTo(_mapMobile);
  _resultLayers.push({ d, m });
  const pb = d.getBounds();
  if (!_lastResultBounds) _lastResultBounds = pb;
  else _lastResultBounds.extend(pb);
  _map.fitBounds(_lastResultBounds, { padding: [40, 40] });
  _mapMobile.fitBounds(m.getBounds(), { padding: [40, 40] });
}

// ── 내부 이벤트 ───────────────────────────────────────────────────────────────
const _markerClickListeners = [];
const _mapClickListeners    = [];

export function onMarkerClick(fn) { _markerClickListeners.push(fn); }
export function onMapClick(fn)    { _mapClickListeners.push(fn); }

function _fireMarkerClick(id)    { _markerClickListeners.forEach((fn) => fn(id)); }
function _fireMapClick(latlng)   { _mapClickListeners.forEach((fn) => fn(latlng)); }

// ── 롱프레스 (모바일) ─────────────────────────────────────────────────────────
function _attachLongPress(map) {
  let _longPressTimer  = null;
  let _longPressActive = false;

  map.on("touchstart", (e) => {
    if (_boxSelectActive) return; // 박스 선택 모드일 때는 롱프레스 비활성
    _longPressActive = false;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    _longPressTimer = setTimeout(() => {
      _longPressActive = true;
      const latlng = map.containerPointToLatLng(
        map.mouseEventToContainerPoint({ clientX: touch.clientX, clientY: touch.clientY })
      );
      if (_onContextMenu) _onContextMenu(latlng, touch.pageX, touch.pageY);
    }, 500);
  });

  map.on("touchend touchmove", () => clearTimeout(_longPressTimer));

  map.on("touchend", (e) => {
    if (_longPressActive) e.originalEvent.preventDefault();
  });
}

// ── 박스 선택 드래그 ──────────────────────────────────────────────────────────
// 드래그 중인 인스턴스 상태를 모듈 레벨에서 관리해 document 리스너를 1회만 등록
let _boxDragging = false;
let _boxStartX = 0, _boxStartY = 0;
let _boxActiveCapture = null; // 현재 드래그 중인 captureLayer
let _boxActiveRect = null;    // 현재 드래그 중인 rectEl
let _boxActiveMap = null;     // 현재 드래그 중인 Leaflet map

function _boxGetRelPos(clientX, clientY) {
  const r = _boxActiveCapture.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function _boxOnMove(clientX, clientY) {
  if (!_boxDragging) return;
  const p = _boxGetRelPos(clientX, clientY);
  const x = Math.min(p.x, _boxStartX);
  const y = Math.min(p.y, _boxStartY);
  _boxActiveRect.style.left   = x + "px";
  _boxActiveRect.style.top    = y + "px";
  _boxActiveRect.style.width  = Math.abs(p.x - _boxStartX) + "px";
  _boxActiveRect.style.height = Math.abs(p.y - _boxStartY) + "px";
}

function _boxOnEnd(clientX, clientY) {
  if (!_boxDragging) return;
  _boxDragging = false;
  _boxActiveRect.style.display = "none";

  const p = _boxGetRelPos(clientX, clientY);
  const dx = Math.abs(p.x - _boxStartX);
  const dy = Math.abs(p.y - _boxStartY);

  if (dx < 5 && dy < 5) {
    // 거의 드래그 없음 — 취소로 간주, 빈 배열 전달
    _fireBoxSelect([]);
    return;
  }

  const ll1 = _boxActiveMap.containerPointToLatLng(L.point(_boxStartX, _boxStartY));
  const ll2 = _boxActiveMap.containerPointToLatLng(L.point(p.x, p.y));
  const bounds = L.latLngBounds(ll1, ll2);

  const ids = _boxSelectLocations
    .filter((loc) => bounds.contains([loc.lat, loc.lng]))
    .map((loc) => loc.id);

  _fireBoxSelect(ids);
}

// document 리스너는 최초 1회만 등록
document.addEventListener("mousemove", (e) => _boxOnMove(e.clientX, e.clientY));
document.addEventListener("mouseup",   (e) => { if (_boxDragging) _boxOnEnd(e.clientX, e.clientY); });

function _attachBoxSelect(map) {
  const container = map.getContainer();

  // 캡처 레이어: 지도 위에 투명하게 덮어 마우스/터치 이벤트를 독점
  const captureLayer = document.createElement("div");
  captureLayer.className = "box-select-capture";
  container.appendChild(captureLayer);

  // 드래그 사각형
  const rectEl = document.createElement("div");
  rectEl.className = "box-select-rect";
  captureLayer.appendChild(rectEl);

  function onStart(clientX, clientY) {
    _boxDragging = true;
    _boxActiveCapture = captureLayer;
    _boxActiveRect    = rectEl;
    _boxActiveMap     = map;
    const r = captureLayer.getBoundingClientRect();
    _boxStartX = clientX - r.left;
    _boxStartY = clientY - r.top;
    rectEl.style.cssText = `left:${_boxStartX}px;top:${_boxStartY}px;width:0;height:0;display:block;`;
  }

  // 마우스: mousedown만 captureLayer에 등록 (move/up은 모듈 레벨에서 처리)
  captureLayer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onStart(e.clientX, e.clientY);
  });

  // 터치 이벤트 (touchmove는 원래 타깃에서 계속 발생하므로 document 불필요)
  captureLayer.addEventListener("touchstart", (e) => {
    e.preventDefault();
    onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  captureLayer.addEventListener("touchmove", (e) => {
    e.preventDefault();
    _boxOnMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  captureLayer.addEventListener("touchend", (e) => {
    _boxOnEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  });
}
