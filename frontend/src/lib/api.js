export const REVIEW_ONLY = import.meta.env.VITE_REVIEW_ONLY === 'true';
const TOKEN_KEY = 'rj_access_token';
const EXPIRY_KEY = 'rj_access_token_expires_at';
let memoryToken = '';

export function setAccessToken(token, expiresAt) {
  memoryToken = token || '';
  if (typeof window === 'undefined') return;
  try {
    if (!memoryToken) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      return;
    }
    const expiry = Number(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      clearAccessToken();
      return;
    }
    localStorage.setItem(TOKEN_KEY, memoryToken);
    localStorage.setItem(EXPIRY_KEY, String(expiry));
  } catch {
    // Keep the current tab usable when browser storage is disabled.
  }
}

export function getAccessToken() {
  if (typeof window === 'undefined') return memoryToken;
  try {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const expiry = Number(localStorage.getItem(EXPIRY_KEY));
    if (!token || !Number.isFinite(expiry) || expiry <= Date.now()) {
      clearAccessToken();
      return '';
    }
    memoryToken = token;
    return token;
  } catch {
    return memoryToken;
  }
}

export function clearAccessToken() {
  memoryToken = '';
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  } catch {
    // The in-memory token is still cleared when browser storage is unavailable.
  }
}

async function send(path, options = {}) {
  if (REVIEW_ONLY) throw Object.assign(Error('API not connected'), { status: 503 });
  let response;
  try {
    const token = getAccessToken();
    response = await fetch('/api' + path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw Error('Connection lost. Keep this form open and retry.');
  }
  const publicAuthPath = [
    '/auth/status',
    '/auth/login',
    '/auth/setup',
    '/auth/passkeys/login/options',
    '/auth/passkeys/login/verify',
  ].includes(path);
  if (response.status === 401 && !publicAuthPath && path !== '/auth/me') {
    clearAccessToken();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('session-expired'));
  }
  if (!response.ok) {
    let data = {};
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      try {
        data = await response.json();
      } catch {}
    }
    throw Object.assign(Error(data.error || 'Request failed'), {
      status: response.status,
      issues: data.issues,
      resetSubmission: data.resetSubmission === true,
    });
  }
  return response;
}

export async function api(path, options = {}) {
  const response = await send(path, options);
  if (!(response.headers.get('content-type') || '').includes('application/json'))
    throw Error('API not connected. Start the backend and check MongoDB.');
  return response.json();
}

export async function apiBlob(path, options = {}) {
  const response = await send(path, options);
  return response.blob();
}

export const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = (path, data) => api(path, { method: 'PATCH', body: JSON.stringify(data) });
export const mediaUrl = (id) => '/media/' + encodeURIComponent(id);
export async function upload(file, kind, source = 'upload') {
  if (file.size > 3 * 1024 * 1024) throw Error('Each image must be 3 MB or smaller');
  const form = new FormData();
  form.set('file', file);
  form.set('kind', kind);
  form.set('source', source);
  return api('/media', { method: 'POST', body: form });
}
export const money = (value, places = 0) =>
  'Rs ' +
  ((value || 0) / 100).toLocaleString('en-PK', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
export const dateLabel = (value, time = false) =>
  new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
export const dateKey = (date = new Date()) =>
  date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
