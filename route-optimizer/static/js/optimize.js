/**
 * optimize.js — /api/optimize 호출, 로딩 스피너, 결과 렌더 트리거
 */
import { clearResultLayers, addNumberedMarker, drawPolyline, setMarkerSelected } from "./map.js";
import { renderTimeline } from "./timeline.js";

export function initOptimize(state, locations) {
  function runOptimize() {
    const ids = [...state.selected];
    if (ids.length < 2 || !state.origin) return;

    const startTimeEl = document.getElementById("start-time")
      || document.getElementById("start-time-m");
    const stayEl = document.getElementById("stay-minutes")
      || document.getElementById("stay-minutes-m");

    const body = {
      location_ids: ids,
      start: state.origin,
      end: state.destination || null,
      start_time: startTimeEl?.value || "09:00",
      stay_minutes: parseInt(stayEl?.value || "20", 10),
    };

    _showLoading(true);

    fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.error || r.statusText));
        return r.json();
      })
      .then((data) => {
        _showLoading(false);
        _renderResult(data, locations, state);
      })
      .catch((err) => {
        _showLoading(false);
        alert(`최적화 오류: ${err}`);
      });
  }

  return { runOptimize };
}

function _showLoading(show) {
  const el = document.getElementById("loading-overlay");
  if (el) el.classList.toggle("d-none", !show);
}

function _renderResult(data, locations, state) {
  clearResultLayers();

  const order = data.order || [];

  // 선택된 마커를 dim 처리 (선택 해제하지 않고 흐리게)
  for (const id of state.selected) {
    setMarkerSelected(id, false);
  }

  // 번호 마커 추가
  order.forEach((id, i) => {
    const loc = locations.find((l) => l.id === String(id));
    if (loc) addNumberedMarker([loc.lat, loc.lng], i + 1);
  });

  // 경로선
  if (data.polyline && data.polyline.length > 1) {
    drawPolyline(data.polyline);
  }

  // 타임라인 + 내비 버튼 렌더
  renderTimeline(data, locations);

  // 모바일: 경로 탭으로 자동 전환
  const tabResult = document.getElementById("tab-result-btn");
  if (tabResult && window.innerWidth < 768) {
    tabResult.click();
  }
}
