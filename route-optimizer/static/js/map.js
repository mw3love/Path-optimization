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

// 마커 저장: id → { marker, markerM, sigungu }
const _markers = {};

// 컨텍스트 메뉴 콜백
let _onContextMenu = null;

// ── 박스 선택 ─────────────────────────────────────────────────────────────────
let _boxSelectActive = false;
let _boxSelectLocations = [];
const _boxSelectListeners = [];

export function onBoxSelect(fn) { _boxSelectListeners.push(fn); }
function _fireBoxSelect(ids) { _boxSelectListeners.forEach((fn) => fn(ids)); }

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

  // 지점이 하나도 없으면(신규 사용자 등) 평균 좌표가 NaN이 되어 지도가
  // 깨지므로, 이 경우 대한민국 중심 좌표로 기본 표시한다.
  let center = [36.5, 127.8];
  let zoom = 7;
  if (locations.length > 0) {
    const avgLat = locations.reduce((s, l) => s + l.lat, 0) / locations.length;
    const avgLng = locations.reduce((s, l) => s + l.lng, 0) / locations.length;
    center = [avgLat, avgLng];
    zoom = 10;
  }

  const map = L.map(containerId, { zoomControl: true }).setView(center, zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  map.on("click", (e) => _fireMapClick(e.latlng));

  // 우클릭: 이동 없이 누르고 떼면 컨텍스트 메뉴, 누른 채 움직이면 지도 팬(이동).
  // 좌클릭 드래그/휠클릭 드래그와 별개의 팬 경로이므로 상태를 map 인스턴스별로 분리한다.
  let _rmbDown = false;
  let _rmbMoved = false;
  let _rmbLastX = 0, _rmbLastY = 0;
  let _rmbStartX = 0, _rmbStartY = 0;
  const container = map.getContainer();

  container.addEventListener("mousedown", (e) => {
    if (e.button !== 2 || _boxSelectActive) return;
    _rmbDown = true;
    _rmbMoved = false;
    _rmbLastX = _rmbStartX = e.clientX;
    _rmbLastY = _rmbStartY = e.clientY;
  });

  document.addEventListener("mousemove", (e) => {
    if (!_rmbDown) return;
    const dx = e.clientX - _rmbLastX;
    const dy = e.clientY - _rmbLastY;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(e.clientX - _rmbStartX) > 3 || Math.abs(e.clientY - _rmbStartY) > 3) {
      _rmbMoved = true;
    }
    map.panBy([-dx, -dy], { animate: false });
    _rmbLastX = e.clientX;
    _rmbLastY = e.clientY;
  });

  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    _rmbDown = false;
  });

  map.on("contextmenu", (e) => {
    e.originalEvent.preventDefault();
    if (_rmbMoved) { _rmbMoved = false; return; }
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

  const title = loc.seq ? `${loc.seq}. ${loc.name}` : loc.name;
  const popup = `<b>${title}</b><br/><span class="text-muted small">${loc.sigungu || ""}</span><br/><small>${loc.address}</small>`;

  const marker = L.circleMarker([loc.lat, loc.lng], opts)
    .addTo(_map)
    .bindPopup(popup);

  const markerM = L.circleMarker([loc.lat, loc.lng], { ...opts })
    .addTo(_mapMobile)
    .bindPopup(popup);

  marker.on("click", () => _fireMarkerClick(loc.id));
  markerM.on("click", () => _fireMarkerClick(loc.id));

  _markers[loc.id] = { marker, markerM, sigungu: loc.sigungu || "" };
}

// 외부(다른 모듈)에서 새로 추가된 지점 마커를 즉시 그릴 때 사용
export function addLocationMarker(loc) {
  getSigunguColor(loc.sigungu || "");
  _addLocationMarker(loc);
}

// 지점 삭제 시 지도에서 마커를 제거
export function removeLocationMarker(id) {
  const entry = _markers[id];
  if (!entry) return;
  if (_map.hasLayer(entry.marker)) _map.removeLayer(entry.marker);
  if (_mapMobile.hasLayer(entry.markerM)) _mapMobile.removeLayer(entry.markerM);
  delete _markers[id];
}

// ── 마커 강조/해제 ────────────────────────────────────────────────────────────
export function setMarkerSelected(id, selected) {
  const entry = _markers[id];
  if (!entry) return;
  const color = selected ? "#ff6600" : getSigunguColor(entry.sigungu ?? "");
  const weight = selected ? 3 : 1.5;
  const radius = selected ? 9 : 7;
  [entry.marker, entry.markerM].forEach((m) => {
    m.setStyle({ color, fillColor: color, weight, radius });
  });
}

// 지점이 출발지/도착지 역할을 하는 동안, 그 지점 고유의 원형 마커를 숨겨
// 출발/도착 핀 아이콘과 겹쳐 보이지 않게 한다(selection.js가 매 렌더마다 호출).
export function setLocationMarkerVisible(id, visible) {
  const entry = _markers[id];
  if (!entry) return;
  if (visible) {
    if (!_map.hasLayer(entry.marker)) entry.marker.addTo(_map);
    if (!_mapMobile.hasLayer(entry.markerM)) entry.markerM.addTo(_mapMobile);
  } else {
    if (_map.hasLayer(entry.marker)) _map.removeLayer(entry.marker);
    if (_mapMobile.hasLayer(entry.markerM)) _mapMobile.removeLayer(entry.markerM);
  }
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

// 물방울(핀) 모양 아이콘 — 지도 타일의 빨간 "+" 기호나 지점 원형 마커와
// 실루엣이 달라 눈에 잘 띈다. 안은 라벨(출발지="1", 도착지="🏁")로 구분.
function _pinIcon(color, label, fontSize) {
  return L.divIcon({
    className: "",
    html: `<div class="anchor-pin-wrap">
      <div class="anchor-pin" style="background:${color};"></div>
      <div class="anchor-pin-label" style="font-size:${fontSize};">${label}</div>
    </div>`,
    iconAnchor: [14, 34],
  });
}

const _originIcon = _pinIcon("#34a853", "1", "14px");
const _destIcon    = _pinIcon("#ea8600", "🏁", "13px");
const _gpsIcon     = _pinIcon("#4285f4", "📍", "13px");

export function setOriginMarker(latlng) {
  [_originMarker, _originMarkerM].forEach((m) => m && m.remove());
  _originMarker  = L.marker(latlng, { icon: _originIcon }).addTo(_map).bindPopup("출발지");
  _originMarkerM = L.marker(latlng, { icon: _originIcon }).addTo(_mapMobile).bindPopup("출발지");
  _map.flyTo(latlng, Math.max(_map.getZoom(), 13));
  _mapMobile.flyTo(latlng, Math.max(_mapMobile.getZoom(), 13));
}

export function setDestMarker(latlng) {
  [_destMarker, _destMarkerM].forEach((m) => m && m.remove());
  _destMarker  = L.marker(latlng, { icon: _destIcon }).addTo(_map).bindPopup("도착지");
  _destMarkerM = L.marker(latlng, { icon: _destIcon }).addTo(_mapMobile).bindPopup("도착지");
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

// ── GPS 현재 위치 마커 ────────────────────────────────────────────────────────
// GPS는 출발/도착지를 자동으로 지정하지 않고 이 마커만 찍는다 — 사용자가
// 우클릭으로 직접 "출발지로 설정"/"도착지로 설정"을 골라야 좌패널에 반영된다.
let _gpsMarker  = null;
let _gpsMarkerM = null;

// 모바일 롱프레스: Leaflet 1.1.1은 touchstart를 _handleDOMEvent로 포워딩하지
// 않아 map.on("touchstart", ...)/marker.on("touchstart", ...) 자체가 발화하지
// 않는다(Playwright로 실측 확인 — 지도 레벨 _attachLongPress도 같은 이유로
// 마커 위에서는 원래 동작하지 않았음). 그래서 마커 DOM 요소에 네이티브
// addEventListener로 직접 붙인다 — 박스선택 캡처레이어(_attachBoxSelect)가
// 쓰는 것과 같은 패턴.
function _attachMarkerLongPress(marker, latlng, onContextMenu) {
  const el = marker.getElement();
  if (!el) return;
  let timer = null;
  let active = false;

  el.addEventListener("touchstart", (e) => {
    if (_boxSelectActive || e.touches.length !== 1) return;
    active = false;
    e.stopPropagation();
    const touch = e.touches[0];
    timer = setTimeout(() => {
      active = true;
      if (onContextMenu) onContextMenu(latlng, touch.pageX, touch.pageY);
    }, 500);
  });

  el.addEventListener("touchmove", () => clearTimeout(timer));

  el.addEventListener("touchend", (e) => {
    clearTimeout(timer);
    if (active) e.preventDefault();
  });
}

// onContextMenu(latlng, pageX, pageY) — 마커 우클릭/롱프레스 시 호출.
// stopPropagation으로 지도 자체의 빈 공간 우클릭 핸들러(마우스 커서 픽셀을
// 위경도로 역산해 부정확함)로 새지 않게 막고, 마커에 저장된 정확한 좌표를 그대로 넘긴다.
export function setGpsMarker(latlng, onContextMenu) {
  [_gpsMarker, _gpsMarkerM].forEach((m) => m && m.remove());
  _gpsMarker  = L.marker(latlng, { icon: _gpsIcon }).addTo(_map).bindPopup("현재 위치");
  _gpsMarkerM = L.marker(latlng, { icon: _gpsIcon }).addTo(_mapMobile).bindPopup("현재 위치");
  [_gpsMarker, _gpsMarkerM].forEach((m) => {
    m.on("contextmenu", (e) => {
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
      if (onContextMenu) onContextMenu(latlng, e.originalEvent.pageX, e.originalEvent.pageY);
    });
    _attachMarkerLongPress(m, latlng, onContextMenu);
  });
  _map.flyTo(latlng, Math.max(_map.getZoom(), 13));
  _mapMobile.flyTo(latlng, Math.max(_mapMobile.getZoom(), 13));
}

export function clearGpsMarker() {
  [_gpsMarker, _gpsMarkerM].forEach((m) => m && m.remove());
  _gpsMarker = null;
  _gpsMarkerM = null;
}

// ── 결과 마커/경로선 ──────────────────────────────────────────────────────────
const _resultLayers = [];

export function clearResultLayers() {
  _resultLayers.forEach((l) => {
    _map.removeLayer(l.d);
    _mapMobile.removeLayer(l.m);
  });
  _resultLayers.length = 0;
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
}

export function drawPolyline(coords, color = "#1a73e8") {
  if (!coords || coords.length < 2) return;
  const style = { color, weight: 3, opacity: 0.7 };
  const d = L.polyline(coords, style).addTo(_map);
  const m = L.polyline(coords, style).addTo(_mapMobile);
  _resultLayers.push({ d, m });
  _map.fitBounds(d.getBounds(), { padding: [40, 40] });
  _mapMobile.fitBounds(m.getBounds(), { padding: [40, 40] });
}

// ── 내부 이벤트 ───────────────────────────────────────────────────────────────
const _markerClickListeners = [];
const _mapClickListeners    = [];

export function onMarkerClick(fn) { _markerClickListeners.push(fn); }
export function onMapClick(fn)    { _mapClickListeners.push(fn); }
export function offMapClick(fn)   { const i = _mapClickListeners.indexOf(fn); if (i >= 0) _mapClickListeners.splice(i, 1); }

function _fireMarkerClick(id)    { _markerClickListeners.forEach((fn) => fn(id)); }
function _fireMapClick(latlng)   { _mapClickListeners.forEach((fn) => fn(latlng)); }

// ── 롱프레스 (모바일) ─────────────────────────────────────────────────────────
// Leaflet 1.1.1은 touchstart/touchmove/touchend를 _handleDOMEvent로 포워딩하지
// 않아 map.on("touchstart", ...)는 실제로 발화하지 않는다(Playwright 실측 확인 —
// _attachMarkerLongPress와 같은 근본 원인). 그래서 지도 컨테이너에 네이티브
// addEventListener로 직접 붙인다.
function _attachLongPress(map) {
  let _longPressTimer  = null;
  let _longPressActive = false;
  const container = map.getContainer();

  container.addEventListener("touchstart", (e) => {
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

  container.addEventListener("touchmove", () => clearTimeout(_longPressTimer));

  container.addEventListener("touchend", (e) => {
    clearTimeout(_longPressTimer);
    if (_longPressActive) e.preventDefault();
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
