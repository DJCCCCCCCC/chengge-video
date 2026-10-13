import { reactive } from 'vue';

export const state = reactive({ user: null, csrf: null, initialized: false, authOpen: false, config: {}, categories: [], toast: '', toastKind: 'info', menuOpen: false });
let toastTimer;
export function notify(message, kind = 'info') {
  state.toast = message; state.toastKind = kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { state.toast = ''; }, 4000);
}
export async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body && !(options.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
  if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: response.status });
  return data;
}
export async function initialize() {
  try {
    const [session, categories, config] = await Promise.all([api('/api/auth/me'), api('/api/categories'), api('/api/config')]);
    state.user = session.user; state.csrf = session.csrfToken; state.categories = categories.items; state.config = config;
  } catch (error) { notify(error.message, 'error'); }
  finally { state.initialized = true; }
}
export function needLogin() { if (!state.user) { state.authOpen = true; return true; } return false; }
export function duration(value) { const seconds = Math.floor(value || 0); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export function count(value) { return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : (value || 0).toLocaleString(); }
export function date(value) { return value ? new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : ''; }
