/**
 * nav.js — T맵 / 네이버지도 딥링크 빌더
 *
 * T맵:    tmap://route?startX=lng&startY=lat&...&viaX0=lng&viaY0=lat&...  (totalValue=0)
 * 네이버: nmap://route/car?slat=lat&slng=lng&...&waypoints=lat,lng|...    (경유지 최대 5개)
 * 데스크톱 폴백: T맵 웹 길찾기 URL (새 탭)
 */

export function buildNavButtons(data, locations) {
  const order = data.order || [];
  if (order.length < 1) return "";

  const start = data.start;
  if (!start) return "";

  const locMap = {};
  for (const loc of locations) locMap[loc.id] = loc;

  const orderedLocs = order
    .map((id) => locMap[String(id)])
    .filter(Boolean);

  if (orderedLocs.length === 0) return "";

  const hasEnd = !!(data.end?.lat && data.end?.lng);

  // 도착지가 출발지와 동일 좌표면(현 위치로 되돌아오는 경우) T맵이 경로를 무시함.
  // 이 경우 마지막 방문 지점을 도착지로, 나머지를 경유지로 처리.
  const sameAsStart = hasEnd &&
    Math.abs(data.end.lat - start.lat) < 0.0001 &&
    Math.abs(data.end.lng - start.lng) < 0.0001;

  const useLastAsEnd = !hasEnd || sameAsStart;
  const dest      = useLastAsEnd ? orderedLocs[orderedLocs.length - 1] : data.end;
  const waypoints = useLastAsEnd ? orderedLocs.slice(0, -1) : orderedLocs;

  const tmapUrl = _buildTmapUrl(start, dest, waypoints);
  const webUrl  = _buildWebFallbackUrl(start, dest, waypoints);
  const naverUrl = _buildNaverUrl(start, dest, waypoints);

  // 네이버지도 경유지 최대 5개 제한 (CLAUDE.md 스펙)
  const naverDisabled = waypoints.length > 5;

  // &amp; 인코딩: innerHTML 파싱 시 HTML 파서가 &param= 을 올바르게 처리하도록 보장.
  // 브라우저는 클릭 시 &amp; → & 로 되돌려 앱에 전달함.
  const tmapHref  = tmapUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const naverHref = naverUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // 데스크톱에서 T맵 버튼 클릭 시 웹 폴백 URL을 새 탭으로 열기.
  // 모바일에서는 조건이 false → href 기본 동작(tmap:// 스킴) 실행.
  // webUrl은 URLSearchParams로 생성되므로 single quote 이스케이프만 필요.
  const webUrlEsc = webUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const tmapOnclick = `if(!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)){event.preventDefault();window.open('${webUrlEsc}','_blank','noopener');}`;

  let html = `<div class="d-flex gap-2 flex-wrap">`;

  // T맵 버튼
  html += `<a class="btn btn-sm btn-warning flex-fill fw-bold text-decoration-none"
    href="${tmapHref}"
    onclick="${tmapOnclick}">
    🗺️ T맵
  </a>`;

  // 네이버지도 버튼 (경유지 5개 초과 시 비활성화)
  html += `<a class="btn btn-sm btn-success flex-fill fw-bold text-decoration-none${naverDisabled ? ' disabled' : ''}"
    href="${naverDisabled ? '#' : naverHref}"
    ${naverDisabled ? 'aria-disabled="true" tabindex="-1" onclick="event.preventDefault();"' : ''}>
    🗺️ 네이버지도${naverDisabled ? '<br><small>(경유지 5개 초과)</small>' : ''}
  </a>`;

  // 디버그: 생성된 URL 확인용 (접어둔 details)
  html += `<details class="w-100 mt-1" style="font-size:0.7rem">
    <summary style="cursor:pointer;color:#888">URL 확인</summary>
    <div style="word-break:break-all;background:#f8f9fa;padding:4px;border-radius:4px;margin-top:2px">
      <strong>T맵:</strong> ${_esc(tmapUrl)}<br>
      <strong>네이버:</strong> ${_esc(naverUrl)}
    </div>
  </details>`;

  html += `</div>`;
  return html;
}

// ── URL 빌더 ──────────────────────────────────────────────────────────────────

function _buildTmapUrl(start, dest, waypoints) {
  // URLSearchParams는 공백을 '+'로 인코딩하지만 T맵 URL 스킴은 %20을 기대함.
  // encodeURIComponent로 직접 빌드.
  // totalValue=0: 즉시 내비게이션 실행 (totalValue=2는 iOS에서 빈 경로검색 화면을 여는 경우가 있음).
  const enc = encodeURIComponent;
  let url = `tmap://route?`;
  url += `startX=${start.lng}&startY=${start.lat}`;
  url += `&startName=${enc(start.label || "출발지")}`;
  url += `&endX=${dest.lng}&endY=${dest.lat}`;
  url += `&endName=${enc(dest.name || dest.label || "도착지")}`;
  url += `&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&totalValue=0`;

  waypoints.forEach((loc, i) => {
    url += `&viaX${i}=${loc.lng}&viaY${i}=${loc.lat}`;
    url += `&viaName${i}=${enc(loc.name || `경유${i + 1}`)}`;
  });

  return url;
}

function _buildNaverUrl(start, dest, waypoints) {
  // 네이버지도 딥링크: nmap://route/car?slat=위도&slng=경도&...&waypoints=위도,경도|...
  // 경유지는 최대 5개까지 지원 (초과 시 호출부에서 버튼 비활성화).
  const enc = encodeURIComponent;
  let url = `nmap://route/car?`;
  url += `slat=${start.lat}&slng=${start.lng}&sname=${enc(start.label || "출발지")}`;
  url += `&dlat=${dest.lat}&dlng=${dest.lng}&dname=${enc(dest.name || dest.label || "도착지")}`;
  const pts = waypoints.slice(0, 5);
  if (pts.length > 0) {
    const wptStr = pts.map(w => `${w.lat},${w.lng}`).join("|");
    url += `&waypoints=${enc(wptStr)}`;
  }
  url += `&appname=route-optimizer`;
  return url;
}

function _buildWebFallbackUrl(start, dest, waypoints) {
  // T맵 웹 길찾기 (데스크톱 브라우저에서 앱 스킴 실패 시 사용)
  const params = new URLSearchParams({
    startX: start.lng,
    startY: start.lat,
    startName: start.label || "출발지",
    endX: dest.lng,
    endY: dest.lat,
    endName: dest.name || dest.label || "도착지",
  });
  return `https://tmap.life/route?${params.toString()}`;
}

function _esc(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
