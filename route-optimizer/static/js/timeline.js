/**
 * timeline.js — 타임라인 패널 렌더 + 번호 DivIcon 스타일
 */
import { preparePrint } from "./map.js";

export function renderTimeline(data, locations) {
  const html = _buildTimelineHtml(data, locations);

  // 데스크톱: result-panel (지도 위 오버레이) — 모바일에서는 표시하지 않음
  const panel = document.getElementById("result-panel");
  if (panel && window.innerWidth >= 768) {
    panel.innerHTML = html;
    panel.classList.remove("d-none");
    _attachPrintBtn(panel);
  }

  // 모바일: result-panel-m (경로 탭 내부)
  const panelM = document.getElementById("result-panel-m");
  if (panelM) {
    panelM.innerHTML = html;
    _attachPrintBtn(panelM);
  }
}

export function buildTimelineHtml(data, locations) {
  return _buildTimelineHtml(data, locations);
}

function _buildTimelineHtml(data, locations) {
  const isApprox = data.source === "haversine";
  const legs = data.legs || [];
  const order = data.order || [];
  const summary = data.summary || {};

  const locMap = {};
  for (const loc of locations) locMap[loc.id] = loc;

  let html = "";

  // 거리 계산 기준 배너
  if (isApprox) {
    html += `<div class="timeline-banner-approx">
      ⚠️ <strong>직선 거리×1.4 추정</strong> — 인터넷 연결 불가 시 GPS 직선 거리에 1.4배를 곱해 도로 거리를 추정합니다. 실제 이동 시간과 다를 수 있습니다.
    </div>`;
  } else {
    html += `<div class="timeline-banner-osrm">
      🛣️ <strong>실제 도로 기준</strong> — 실제 도로망을 분석해 계산한 자동차 이동 시간·거리입니다.
    </div>`;
  }

  // 출발지 행
  const startLabel = data.start?.label || "출발지";
  const startTime = legs[0]
    ? _subtractMinutes(legs[0].arrive, legs[0].drive_min)
    : (data.summary?.start_time || "");

  html += `<table class="timeline-table">
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>지점</th>
        <th style="width:48px">도착</th>
        <th style="width:48px">출발</th>
        <th style="width:44px">이동</th>
      </tr>
    </thead>
    <tbody>`;

  // 출발지 행 (이동 시간 없음)
  html += `<tr style="background:#e8f4fd;">
    <td class="leg-num">⭐</td>
    <td>${_esc(startLabel)}</td>
    <td>—</td>
    <td>${legs[0] ? _subtractMinutes(legs[0].arrive, legs[0].drive_min) : ""}</td>
    <td>—</td>
  </tr>`;

  // 각 방문 지점
  order.forEach((id, i) => {
    const loc = locMap[String(id)];
    const leg = legs[i] || {};
    const driveStr = leg.drive_min != null
      ? `${leg.drive_min}분<br>${leg.drive_km}km`
      : "—";

    html += `<tr>
      <td class="leg-num">${i + 1}</td>
      <td>
        <div class="loc-name">${_esc(loc ? loc.name : id)}</div>
        ${loc ? `<div class="loc-sub">${_esc(loc.sigungu)}</div>` : ""}
      </td>
      <td>${leg.arrive || "—"}</td>
      <td>${leg.depart || "—"}</td>
      <td style="white-space:nowrap">${driveStr}</td>
    </tr>`;
  });

  // 도착지 (있을 경우)
  if (data.end) {
    const destLabel = data.end.label || "도착지";
    const lastLeg = legs[order.length] || {};
    const lastDriveStr = lastLeg.drive_min != null
      ? `${lastLeg.drive_min}분<br>${lastLeg.drive_km}km`
      : "—";
    html += `<tr style="background:#e8fce8;">
      <td class="leg-num">🏁</td>
      <td>${_esc(destLabel)}</td>
      <td>${summary.end_time || "—"}</td>
      <td>—</td>
      <td style="white-space:nowrap">${lastDriveStr}</td>
    </tr>`;
  }

  // 합계 행
  html += `<tr style="font-weight:bold;background:#f8f9fa;border-top:2px solid #dee2e6;">
    <td colspan="2">합계</td>
    <td>${data.end ? summary.end_time || "" : ""}</td>
    <td colspan="2">
      이동 ${summary.total_drive_min != null ? _fmtMinutes(summary.total_drive_min) : "—"}
      / ${summary.total_dist_km != null ? summary.total_dist_km + "km" : "—"}
    </td>
  </tr>`;

  html += `</tbody></table>`;

  html += `<button class="btn btn-sm btn-outline-secondary mt-2 btn-print w-100">🖨️ 인쇄 미리보기</button>`;

  return html;
}

function _attachPrintBtn(container) {
  container.querySelectorAll(".btn-print").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await preparePrint(); // 사이드바 숨김 + fitBounds + 타일 로딩 완료 대기
      window.print();
    });
  });
}

function _fmtMinutes(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간(${min}분)` : `${h}시간 ${m}분(${min}분)`;
}

function _subtractMinutes(timeStr, minutes) {
  if (!timeStr || minutes == null) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m - minutes;
  if (total < 0) return timeStr;
  const rh = Math.floor(total / 60) % 24;
  const rm = total % 60;
  return `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
}

function _esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
