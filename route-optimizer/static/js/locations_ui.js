/**
 * locations_ui.js — 사이드바 검색창(주소 검색 · 위경도 붙여넣기)과 지도 우클릭으로
 * 장소를 즉시 추가한다(확인 모달 없음 — 연속 추가에 최적화).
 */
import { addLocationMarker } from "./map.js";

let _debounceTimer = null;
let _searchRequestId = 0;
let _getLocations = null;
let _onLocationAdded = null;

function _el(id) {
  return document.getElementById(id);
}

// "37.5665, 126.9780" / "37.5665 126.9780" 같은 좌표 붙여넣기 인식
function _parseLatLng(text) {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function _coordLabel(lat, lng) {
  return `위도 ${lat.toFixed(5)}, 경도 ${lng.toFixed(5)}`;
}

async function _searchAddress(query) {
  const resp = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    return { error: data.error || "검색 실패" };
  }
  const data = await resp.json();
  return { results: data.results || [] };
}

export async function addLocationAtLatLng(latlng, source = "map_click") {
  await _addLocation({
    name: _coordLabel(latlng.lat, latlng.lng),
    lat: latlng.lat,
    lng: latlng.lng,
    source,
  });
}

async function _addLocation({ name, address, lat, lng, source }) {
  const resp = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, address: address || "", lat, lng, source }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    alert(data.error || "저장 실패");
    return;
  }
  const { id } = await resp.json();
  const newLoc = { id, name, address: address || "", lat, lng, sigungu: "" };
  _getLocations().push(newLoc);
  addLocationMarker(newLoc);
  _onLocationAdded(newLoc);
}

function _renderCoordResult(box, input, coord) {
  box.innerHTML = "";
  const div = document.createElement("div");
  div.className = "result-item";
  div.textContent = `📍 ${_coordLabel(coord.lat, coord.lng)} 여기에 추가`;
  div.addEventListener("click", () => {
    box.innerHTML = "";
    input.value = "";
    _addLocation({ name: _coordLabel(coord.lat, coord.lng), lat: coord.lat, lng: coord.lng, source: "paste" });
  });
  box.appendChild(div);
}

function _renderSearchResults(box, input, results) {
  box.innerHTML = "";
  results.forEach((r) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.textContent = `${r.name} — ${r.address}`;
    div.addEventListener("click", () => {
      box.innerHTML = "";
      input.value = "";
      _addLocation({ name: r.name, address: r.address, lat: r.lat, lng: r.lng, source: "geocode" });
    });
    box.appendChild(div);
  });
}

function _bindSearch(inputId, resultsId) {
  const input = _el(inputId);
  const box = _el(resultsId);
  if (!input || !box) return;
  input.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(_debounceTimer);

    const coord = _parseLatLng(q);
    if (coord) {
      _renderCoordResult(box, input, coord);
      return;
    }

    if (q.length < 2) {
      box.innerHTML = "";
      return;
    }
    _debounceTimer = setTimeout(async () => {
      const requestId = ++_searchRequestId;
      const { results, error } = await _searchAddress(q);
      if (requestId !== _searchRequestId) return;
      if (error) {
        box.innerHTML = `<div class="text-muted small p-1">${error}</div>`;
        return;
      }
      _renderSearchResults(box, input, results);
    }, 300);
  });
}

export function initLocationsUi(getLocations, onLocationAdded) {
  _getLocations = getLocations;
  _onLocationAdded = onLocationAdded;

  _bindSearch("location-search", "location-search-results");
  _bindSearch("location-search-m", "location-search-results-m");
}
