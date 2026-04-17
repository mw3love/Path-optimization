/**
 * admin.js — 지점 데이터 관리 페이지 로직
 *
 * 흐름:
 *   [헤더 확인] → POST /api/admin/preview → 컬럼 드롭다운 채우기
 *   [가져오기]  → POST /api/admin/import  → locations 갱신 + 결과 표시
 */

// 저장된 column_map (상태 API로부터 로드)
let _savedColumnMap = null;

// 현재 활성 탭 ("gsheet" | "xlsx")
function _activeTab() {
  return document.getElementById("tab-gsheet").classList.contains("active")
    ? "gsheet"
    : "xlsx";
}

// ── 상태 표시 ──────────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const res = await fetch("/api/admin/status");
    const data = await res.json();
    const statusEl = document.getElementById("status-text");

    let html = `현재 지점: <strong>${data.location_count}개</strong> 등록됨`;
    if (data.data_source) {
      const ds = data.data_source;
      if (ds.type === "gsheet") {
        const shortUrl = ds.gsheet_url
          ? ds.gsheet_url.replace(/^https:\/\/docs\.google\.com\/spreadsheets\/d\//, "…/")
          : "";
        html += ` &nbsp;·&nbsp; 저장된 소스: 구글시트 <span class="text-muted">${shortUrl}</span>`;
      } else {
        html += ` &nbsp;·&nbsp; 저장된 소스: 엑셀 (${ds.excel_filename || ""})`;
      }
      _savedColumnMap = ds.column_map || null;
    }
    statusEl.innerHTML = html;
  } catch {
    document.getElementById("status-text").textContent = "상태 불러오기 실패";
  }
}

// ── 컬럼 드롭다운 채우기 ───────────────────────────────────────────────────────
const FIELD_IDS = [
  { key: "id",      elId: "map-id",      hint: ["NA", "seq", "id", "순번"] },
  { key: "name",    elId: "map-name",    hint: ["Point_Name", "name", "지점명", "장소명"] },
  { key: "sigungu", elId: "map-sigungu", hint: ["Address_2", "시군구", "sigungu", "Address_1"] },
  { key: "address", elId: "map-address", hint: ["Address_3", "Address", "주소", "address", "Address_4"] },
  { key: "lat",     elId: "map-lat",     hint: ["Latitude", "lat", "위도"] },
  { key: "lng",     elId: "map-lng",     hint: ["Longitude", "lng", "경도"] },
];

function _fillDropdowns(columns) {
  for (const field of FIELD_IDS) {
    const sel = document.getElementById(field.elId);
    sel.innerHTML = '<option value="">— 선택 —</option>';
    for (const col of columns) {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      sel.appendChild(opt);
    }

    // 자동 선택 우선순위: 저장된 매핑 > 힌트 키워드 매칭
    let autoVal = null;
    if (_savedColumnMap && _savedColumnMap[field.key]) {
      autoVal = columns.includes(_savedColumnMap[field.key])
        ? _savedColumnMap[field.key]
        : null;
    }
    if (!autoVal) {
      for (const hint of field.hint) {
        const match = columns.find(
          (c) => c.toLowerCase() === hint.toLowerCase()
        );
        if (match) { autoVal = match; break; }
      }
    }
    if (autoVal) sel.value = autoVal;
  }
}

// ── 미리보기(헤더 확인) ────────────────────────────────────────────────────────
async function doPreview(btn, fetchFn) {
  setResult("");
  document.getElementById("mapping-section").style.display = "none";

  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "확인 중...";

  let data;
  try {
    data = await fetchFn();
  } catch (e) {
    setResult(`오류: ${e.message}`, "danger");
    btn.disabled = false;
    btn.textContent = origText;
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }

  if (data.error) {
    setResult(`오류: ${data.error}`, "danger");
    return;
  }

  _fillDropdowns(data.columns);

  document.getElementById("preview-info").textContent =
    `헤더 ${data.header_row}행 · 데이터 ${data.total_data_rows}행 감지됨`;
  document.getElementById("mapping-section").style.display = "block";
}

document.getElementById("btn-preview-gsheet").addEventListener("click", function () {
  const url = document.getElementById("gsheet-url").value.trim();
  if (!url) { setResult("URL을 입력하세요", "warning"); return; }
  doPreview(this, async () => {
    const res = await fetch("/api/admin/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "gsheet", url }),
    });
    return res.json();
  });
});

document.getElementById("btn-preview-xlsx").addEventListener("click", function () {
  const fileEl = document.getElementById("xlsx-file");
  if (!fileEl.files.length) { setResult("파일을 선택하세요", "warning"); return; }
  doPreview(this, async () => {
    const fd = new FormData();
    fd.append("file", fileEl.files[0]);
    const res = await fetch("/api/admin/preview", { method: "POST", body: fd });
    return res.json();
  });
});

// ── 가져오기 ──────────────────────────────────────────────────────────────────
document.getElementById("btn-import").addEventListener("click", async () => {
  // 컬럼 매핑 수집
  const columnMap = {};
  for (const field of FIELD_IDS) {
    const val = document.getElementById(field.elId).value;
    if (val) columnMap[field.key] = val;
  }
  const required = ["id", "name", "lat", "lng"];
  const missing = required.filter((k) => !columnMap[k]);
  if (missing.length) {
    setResult(`필수 매핑 미선택: ${missing.join(", ")}`, "warning");
    return;
  }

  const btn = document.getElementById("btn-import");
  btn.disabled = true;
  btn.textContent = "가져오는 중...";
  setResult("");

  try {
    let res;
    if (_activeTab() === "gsheet") {
      const url = document.getElementById("gsheet-url").value.trim();
      res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "gsheet", url, column_map: columnMap }),
      });
    } else {
      const fileEl = document.getElementById("xlsx-file");
      const fd = new FormData();
      fd.append("type", "xlsx");
      fd.append("column_map", JSON.stringify(columnMap));
      fd.append("file", fileEl.files[0]);
      res = await fetch("/api/admin/import", { method: "POST", body: fd });
    }

    const data = await res.json();
    if (data.error) {
      setResult(`오류: ${data.error}`, "danger");
    } else {
      const skipMsg = data.skipped > 0 ? ` (${data.skipped}개 행 스킵)` : "";
      setResult(
        `${data.imported}개 지점을 가져왔습니다${skipMsg}. ` +
        `<a href="/" class="alert-link">지도 페이지에서 새로고침</a>하세요.`,
        "success"
      );
      // 상태 업데이트
      loadStatus();
    }
  } catch (e) {
    setResult(`네트워크 오류: ${e.message}`, "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = "가져오기 및 저장";
  }
});

// ── 결과 메시지 표시 ──────────────────────────────────────────────────────────
function setResult(html, type = "") {
  const el = document.getElementById("result-msg");
  if (!html) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="alert alert-${type || "info"} py-2">${html}</div>`;
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
loadStatus();
