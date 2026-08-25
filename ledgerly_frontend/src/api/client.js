const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";

// The access token lives only in memory for the life of the tab. It is never written to
// localStorage or sessionStorage, which keeps it out of reach of a JavaScript-injection (XSS)
// attack that scrapes browser storage. The refresh token never touches JS at all — it lives in
// an httpOnly, Secure, SameSite=strict cookie set by the server.
let accessToken = null;
let onUnauthorized = () => {};

export function setAccessToken(token) {
  accessToken = token;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function refreshAccessToken() {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.accessToken;
  return accessToken;
}

async function request(path, { method = "GET", body, retry = true } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request(path, { method, body, retry: false });
    onUnauthorized();
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // no JSON body
  }

  if (!res.ok) {
    const message = payload?.error || "Something went wrong";
    const err = new Error(message);
    err.details = payload?.details;
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

// Multipart upload — the browser sets the Content-Type boundary itself,
// so no JSON serialisation or Content-Type header here.
async function upload(path, formData, retry = true) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: formData,
  });

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return upload(path, formData, false);
    onUnauthorized();
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // no JSON body
  }
  if (!res.ok) {
    const err = new Error(payload?.error || "Upload failed");
    err.status = res.status;
    throw err;
  }
  return payload;
}

// Authenticated file download — fetches as a blob and triggers a save.
async function download(path, filename) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path, body) => request(path, { method: "DELETE", body }),
  upload,
  download,
  refreshAccessToken,
};
