/**
 * sharing_ui.js — 지점 공유 대상 관리(이메일 추가/삭제) + 전체공개 토글.
 */

function _buildDialog() {
  // 재오픈 시 이전 공유 다이얼로그가 남아 있으면 제거(DOM id 중복 방지).
  // ".add-location-modal" 클래스는 다른 다이얼로그와도 공유되므로,
  // 공유 다이얼로그에만 붙는 data-role로 구분해 그것만 제거한다.
  document.querySelectorAll('.add-location-modal[data-role="share-dialog"]').forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "add-location-modal"; // 기존 모달 스타일 재사용
  overlay.dataset.role = "share-dialog";
  overlay.innerHTML = `
    <div class="add-location-card">
      <h6 class="mb-2">공유 설정</h6>
      <label class="form-check form-switch mb-2">
        <input class="form-check-input" type="checkbox" id="share-public-toggle" />
        <span class="form-check-label small">회사 전체 공개</span>
      </label>
      <div class="small text-muted mb-1">특정 이메일에 공유</div>
      <ul id="share-email-list" class="list-unstyled small mb-2"></ul>
      <div class="d-flex gap-1 mb-2">
        <input type="email" id="share-email-input" class="form-control form-control-sm" placeholder="email@company.com" />
        <button id="share-email-add" class="btn btn-outline-primary btn-sm">추가</button>
      </div>
      <button id="share-close" class="btn btn-secondary btn-sm w-100">닫기</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function _renderEmailList(overlay, locationId, emails) {
  const list = overlay.querySelector("#share-email-list");
  list.innerHTML = "";
  emails.forEach((email) => {
    const li = document.createElement("li");
    li.className = "d-flex justify-content-between align-items-center";

    const span = document.createElement("span");
    span.textContent = email; // innerHTML 대신 textContent로 stored-XSS 방지

    const btn = document.createElement("button");
    btn.className = "btn btn-link btn-sm p-0 text-danger";
    btn.textContent = "✕";
    btn.addEventListener("click", async () => {
      const resp = await fetch(`/api/locations/${locationId}/share/${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!resp.ok) {
        alert("공유 해제에 실패했습니다. 다시 시도해주세요.");
        return; // 실패 시 목록에서 제거하지 않음(서버 상태와 UI 불일치 방지)
      }
      li.remove();
    });

    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

export async function openShareDialog(locationId, currentIsPublic, currentShares) {
  const overlay = _buildDialog();
  overlay.querySelector("#share-public-toggle").checked = !!currentIsPublic;
  _renderEmailList(overlay, locationId, currentShares || []);

  overlay.querySelector("#share-public-toggle").addEventListener("change", async (e) => {
    const resp = await fetch(`/api/locations/${locationId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: e.target.checked }),
    });
    if (!resp.ok) {
      e.target.checked = !e.target.checked; // 실패 시 이전 상태로 되돌림
      alert("공개 설정 변경에 실패했습니다. 다시 시도해주세요.");
    }
  });

  overlay.querySelector("#share-email-add").addEventListener("click", async () => {
    const input = overlay.querySelector("#share-email-input");
    const email = input.value.trim();
    if (!email || !email.includes("@")) return;
    const resp = await fetch(`/api/locations/${locationId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (resp.ok) {
      const list = overlay.querySelector("#share-email-list");
      const emails = Array.from(list.querySelectorAll("span")).map((s) => s.textContent);
      emails.push(email);
      _renderEmailList(overlay, locationId, emails);
      input.value = "";
    }
  });

  overlay.querySelector("#share-close").addEventListener("click", () => overlay.remove());
}
