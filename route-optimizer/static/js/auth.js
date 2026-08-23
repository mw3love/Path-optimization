/**
 * auth.js — 세션 확인 + 지점 fetch + 로그아웃.
 */
export async function fetchSession() {
  const resp = await fetch("/api/session");
  return resp.json(); // { email, user_id } — 비로그인 시 둘 다 null
}

export async function fetchLocations() {
  const resp = await fetch("/api/locations");
  if (resp.status === 401) {
    window.location.href = "/login";
    return [];
  }
  const data = await resp.json();
  return data.locations;
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}
