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
  _map = initMap("map", locations, onContextMenu);
  _mapMobile = initMap("map-mobile", locations, onContextMenu);
  _renderMarkers(locations);
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

export function clearResultLayers() {
  _resultLayers.forEach((l) => {
    _map.removeLayer(l.d);
    _mapMobile.removeLayer(l.m);
  });
  _resultLayers.length = 0;
}

export function addNumberedMarker(latlng, num) {
  const icon = L.divIcon({
    className: "numbered-icon",
    html: `<div class="num-marker">${num}</div>`,
    iconAnchor: [14, 14],
  });
  const d = L.marker(latlng, { icon }).addTo(_map);
  const m = L.marker(latlng, { icon: L.divIcon({ ...icon.options }) }).addTo(_mapMobile);
  _resultLayers.push({ d, m });
}

export function drawPolyline(coords) {
  if (!coords || coords.length < 2) return;
  const style = { color: "#1a73e8", weight: 3, opacity: 0.7 };
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

function _fireMarkerClick(id)    { _markerClickListeners.forEach((fn) => fn(id)); }
function _fireMapClick(latlng)   { _mapClickListeners.forEach((fn) => fn(latlng)); }

// ── 롱프레스 (모바일) ─────────────────────────────────────────────────────────
function _attachLongPress(map) {
  let _longPressTimer  = null;
  let _longPressActive = false;

  map.on("touchstart", (e) => {
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
