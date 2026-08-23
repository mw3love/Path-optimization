/**
 * sharing_ui.js — 지점 공유 대상 관리(이메일 추가/삭제) + 전체공개 토글.
 */

function _buildDialog() {
  const overlay = document.createElement("div");
  overlay.className = "add-location-modal"; // 기존 모달 스타일 재사용
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
    li.innerHTML = `<span>${email}</span><button class="btn btn-link btn-sm p-0 text-danger">✕</button>`;
    li.querySelector("button").addEventListener("click", async () => {
      await fetch(`/api/locations/${locationId}/share/${encodeURIComponent(email)}`, { method: "DELETE" });
      li.remove();
    });
    list.appendChild(li);
  });
}

export async function openShareDialog(locationId, currentIsPublic, currentShares) {
  const overlay = _buildDialog();
  overlay.querySelector("#share-public-toggle").checked = !!currentIsPublic;
  _renderEmailList(overlay, locationId, currentShares || []);

  overlay.querySelector("#share-public-toggle").addEventListener("change", async (e) => {
    await fetch(`/api/locations/${locationId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: e.target.checked }),
    });
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
