/**
 * locations_ui.js — 장소 추가 모달: 검색/GPS/지도클릭 3경로 → POST /api/locations
 */
import { addLocationMarker } from "./map.js";

let _pendingLatLng = null;
let _debounceTimer = null;

function _el(id) {
  return document.getElementById(id);
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

function _renderSearchResults(results) {
  const box = _el("add-loc-search-results");
  box.innerHTML = "";
  results.forEach((r) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.textContent = `${r.name} — ${r.address}`;
    div.addEventListener("click", () => {
      _el("add-loc-name").value = r.name;
      _el("add-loc-address").value = r.address;
      _pendingLatLng = { lat: r.lat, lng: r.lng };
      _el("add-loc-coord").textContent = `좌표: ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
      box.innerHTML = "";
    });
    box.appendChild(div);
  });
}

function _openModal(latlng, sourceLabel) {
  _pendingLatLng = latlng;
  _el("add-loc-name").value = "";
  _el("add-loc-address").value = "";
  _el("add-loc-search").value = "";
  _el("add-loc-search-results").innerHTML = "";
  _el("add-loc-coord").textContent = latlng
    ? `좌표: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)} (${sourceLabel})`
    : "";
  _el("add-location-modal").classList.remove("d-none");
}

function _closeModal() {
  _el("add-location-modal").classList.add("d-none");
  _pendingLatLng = null;
}

export function initLocationsUi(getLocations, onLocationAdded) {
  _el("add-loc-search").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(_debounceTimer);
    if (q.length < 2) {
      _el("add-loc-search-results").innerHTML = "";
      return;
    }
    _debounceTimer = setTimeout(async () => {
      const { results, error } = await _searchAddress(q);
      if (error) {
        _el("add-loc-search-results").innerHTML = `<div class="text-muted small p-1">${error}</div>`;
        return;
      }
      _renderSearchResults(results);
    }, 300);
  });

  _el("add-loc-cancel").addEventListener("click", _closeModal);

  _el("add-loc-save").addEventListener("click", async () => {
    const name = _el("add-loc-name").value.trim();
    if (!name || !_pendingLatLng) {
      alert("장소 이름과 위치를 확인하세요.");
      return;
    }
    const resp = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: _el("add-loc-address").value.trim(),
        lat: _pendingLatLng.lat,
        lng: _pendingLatLng.lng,
        source: "map_click",
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || "저장 실패");
      return;
    }
    const { id } = await resp.json();
    const newLoc = {
      id, name, address: _el("add-loc-address").value.trim(),
      lat: _pendingLatLng.lat, lng: _pendingLatLng.lng, sigungu: "",
    };
    getLocations().push(newLoc);
    addLocationMarker(newLoc);
    onLocationAdded(newLoc);
    _closeModal();
  });

  document.getElementById("ctx-add-location")?.addEventListener("click", () => {
    if (window._pendingCtxLatLngForAdd) {
      _openModal(window._pendingCtxLatLngForAdd, "지도 클릭");
    }
  });
}

export function openAddLocationModalAt(latlng, sourceLabel) {
  _openModal(latlng, sourceLabel);
}
