/**
 * nav.js — T맵 / 네이버지도 딥링크 빌더
 *
 * T맵: tmap://route?startX=lng&startY=lat&...&viaX0=lng&viaY0=lat&...
 *   경유지 제한: 없음 (T맵 앱 기본 지원)
 * 네이버지도: nmap://route/car?slat=&slng=&sname=&dlat=&dlng=&dname=&waypoints=lat,lng|...&v=3
 *   경유지 제한: 5개까지 지원 (NAVER_MAX_WAYPOINTS)
 * 데스크톱 폴백: T맵 웹 길찾기 URL
 */

const NAVER_MAX_WAYPOINTS = 5;

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
  const dest = hasEnd ? data.end : orderedLocs[orderedLocs.length - 1];
  const waypoints = hasEnd ? orderedLocs : orderedLocs.slice(0, -1);

  const tmapUrl = _buildTmapUrl(start, dest, waypoints);
  const naverResult = _buildNaverUrl(start, dest, waypoints);
  const webUrl = _buildWebFallbackUrl(start, dest, waypoints);

  let html = `<div class="d-flex gap-2 flex-wrap">`;

  // T맵 버튼
  html += `<button class="btn btn-sm btn-warning flex-fill fw-bold"
    data-nav-url="${_esc(tmapUrl)}"
    data-nav-fallback="${_esc(webUrl)}"
    onclick="window._openNavLink(this)">
    🗺️ T맵
  </button>`;

  // 네이버지도 버튼
  if (naverResult.exceeded) {
    html += `<button class="btn btn-sm btn-secondary flex-fill" disabled
      title="네이버지도 경유지 ${NAVER_MAX_WAYPOINTS}개 초과 (T맵 권장)">
      🟢 네이버 (${waypoints.length}개 초과)
    </button>`;
  } else {
    html += `<button class="btn btn-sm btn-success flex-fill"
      data-nav-url="${_esc(naverResult.url)}"
      data-nav-fallback=""
      onclick="window._openNavLink(this)">
      🟢 네이버지도
    </button>`;
  }

  html += `</div>`;
  return html;
}

// ── URL 빌더 ──────────────────────────────────────────────────────────────────

function _buildTmapUrl(start, dest, waypoints) {
  const params = new URLSearchParams({
    startX: start.lng,
    startY: start.lat,
    startName: start.label || "출발지",
    endX: dest.lng ?? dest.lng,
    endY: dest.lat ?? dest.lat,
    endName: dest.name || dest.label || "도착지",
    reqCoordType: "WGS84GEO",
    resCoordType: "WGS84GEO",
    totalValue: "2",
  });

  waypoints.forEach((loc, i) => {
    params.append(`viaX${i}`, loc.lng);
    params.append(`viaY${i}`, loc.lat);
    params.append(`viaName${i}`, loc.name || `경유${i + 1}`);
  });

  return `tmap://route?${params.toString()}`;
}

function _buildNaverUrl(start, dest, waypoints) {
  if (waypoints.length > NAVER_MAX_WAYPOINTS) {
    return { url: "", exceeded: true };
  }

  const sname = encodeURIComponent(start.label || "출발지");
  const dname = encodeURIComponent(dest.name || dest.label || "도착지");

  let url = `nmap://route/car?slat=${start.lat}&slng=${start.lng}&sname=${sname}` +
    `&dlat=${dest.lat}&dlng=${dest.lng}&dname=${dname}&v=3`;

  if (waypoints.length > 0) {
    const wpStr = encodeURIComponent(waypoints.map((loc) => `${loc.lat},${loc.lng}`).join("|"));
    url += `&waypoints=${wpStr}`;
  }

  return { url, exceeded: false };
}

function _buildWebFallbackUrl(start, dest, waypoints) {
  // T맵 웹 길찾기 (PC 브라우저에서 앱 스킴 실패 시 사용)
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

// ── 앱 스킴 실행 (전역 함수) ──────────────────────────────────────────────────

window._openNavLink = function(btn) {
  const appUrl = btn.dataset.navUrl;
  const webUrl = btn.dataset.navFallback;

  if (!appUrl) return;

  // 앱 스킴은 모바일에서만 시도; 데스크톱에서는 바로 웹 URL
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isMobile && (appUrl.startsWith("tmap://") || appUrl.startsWith("nmap://"))) {
    // iframe 방식으로 앱 스킴 시도
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = appUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1500);
  } else if (webUrl) {
    window.open(webUrl, "_blank", "noopener");
  } else if (!isMobile) {
    // 데스크톱 + 네이버(webUrl 없음): T맵 웹으로 대체 안내
    alert("T맵 버튼을 사용하거나 스마트폰에서 접속하세요.");
  }
};

function _esc(str) {
  return (str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
