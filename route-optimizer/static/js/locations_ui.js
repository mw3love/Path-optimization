/**
 * locations_ui.js — 사이드바 검색창(주소 검색 · 위경도 붙여넣기)과 지도 우클릭으로
 * 장소를 즉시 추가한다(확인 모달 없음 — 연속 추가에 최적화).
 */
import { addLocationMarker } from "./map.js";

let _debounceTimer = null;
let _searchRequestId = 0;
let _getLocations = null;
let _onLocationAdded = null;

// 세션 내 동일 검색어 재조회 방지용 캐시(탭 새로고침 시 초기화)
const _searchCache = new Map();

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
  if (_searchCache.has(query)) return _searchCache.get(query);

  const resp = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    return { error: data.error || "검색 실패" };
  }
  const data = await resp.json();
  const result = { results: data.results || [] };
  _searchCache.set(query, result); // 에러 응답은 캐시하지 않음(일시 오류 재시도 가능해야 함)
  return result;
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

function _renderCoordResult(box, coord, { onConfirm, onHover }) {
  box.innerHTML = "";
  const div = document.createElement("div");
  div.className = "result-item";
  div.textContent = `📍 ${_coordLabel(coord.lat, coord.lng)} 여기에 추가`;
  div.addEventListener("mouseenter", () => onHover(0));
  div.addEventListener("click", () => onConfirm(0));
  box.appendChild(div);
}

function _renderSearchResults(box, results, { onConfirm, onHover }) {
  box.innerHTML = "";
  results.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.textContent = `${r.name} — ${r.address}`;
    div.addEventListener("mouseenter", () => onHover(i));
    div.addEventListener("click", () => onConfirm(i));
    box.appendChild(div);
  });
}

// 검색창 키보드 조작: 좌표는 결과가 하나뿐이라 렌더 즉시 활성화해 Enter만으로 확정되고,
// 주소는 여러 후보가 나올 수 있어 방향키로 명시적으로 하나를 짚어야 Enter가 먹는다
// (지점 삭제 기능이 있어도 오검색으로 엉뚱한 곳이 조용히 추가되는 걸 막기 위함).
function _bindSearch(inputId, resultsId) {
  const input = _el(inputId);
  const box = _el(resultsId);
  if (!input || !box) return;

  let items = []; // { type: "coord" | "address", data }[]
  let activeIndex = -1;

  function setActive(idx) {
    activeIndex = idx;
    box.querySelectorAll(".result-item").forEach((el, i) => {
      el.classList.toggle("active", i === activeIndex);
    });
  }

  function clearResults() {
    box.innerHTML = "";
    items = [];
    activeIndex = -1;
  }

  function confirmIndex(idx) {
    const item = items[idx];
    if (!item) return;
    clearResults();
    input.value = "";
    if (item.type === "coord") {
      _addLocation({ name: _coordLabel(item.data.lat, item.data.lng), lat: item.data.lat, lng: item.data.lng, source: "paste" });
    } else {
      _addLocation({ name: item.data.name, address: item.data.address, lat: item.data.lat, lng: item.data.lng, source: "geocode" });
    }
  }

  input.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(_debounceTimer);

    const coord = _parseLatLng(q);
    if (coord) {
      items = [{ type: "coord", data: coord }];
      _renderCoordResult(box, coord, { onConfirm: confirmIndex, onHover: setActive });
      setActive(0);
      return;
    }

    if (q.length < 2) {
      clearResults();
      return;
    }
    _debounceTimer = setTimeout(async () => {
      const requestId = ++_searchRequestId;
      const { results, error } = await _searchAddress(q);
      if (requestId !== _searchRequestId) return;
      if (error) {
        box.innerHTML = `<div class="text-muted small p-1">${error}</div>`;
        items = [];
        activeIndex = -1;
        return;
      }
      items = results.map((r) => ({ type: "address", data: r }));
      _renderSearchResults(box, results, { onConfirm: confirmIndex, onHover: setActive });
      activeIndex = -1;
    }, 150);
  });

  input.addEventListener("keydown", (e) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex < 0) return;
      e.preventDefault();
      confirmIndex(activeIndex);
    } else if (e.key === "Escape") {
      clearResults();
    }
  });
}

export function initLocationsUi(getLocations, onLocationAdded) {
  _getLocations = getLocations;
  _onLocationAdded = onLocationAdded;

  _bindSearch("location-search", "location-search-results");
  _bindSearch("location-search-m", "location-search-results-m");
}
