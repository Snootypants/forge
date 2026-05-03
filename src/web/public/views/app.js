import { initChat } from './chat.js';
import { initSettings } from './settings.js';

const API = '';
let authToken = '';

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${API}${path}`, { credentials: 'same-origin', ...opts, headers });
  const data = await readResponse(res);
  if (res.status === 401) {
    showLogin();
    throw new Error(errorMessage(data) || 'Unauthorized');
  }
  if (!res.ok) throw new Error(errorMessage(data) || `${res.status} ${res.statusText}`.trim());
  return data;
}

export function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : 'success'}`;
  el.textContent = msg;
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function readResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

function errorMessage(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return data.error || data.message || data.detail || '';
}

function updateStatus(connected) {
  const pill = document.getElementById('status-pill');
  pill.innerHTML = connected
    ? '<span class="dot ok"></span><span class="label">connected</span>'
    : '<span class="dot err"></span><span class="label">disconnected</span>';
}

function showLogin() {
  document.getElementById('login-gate').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('login-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const input = document.getElementById('login-token');
  const errEl = document.getElementById('login-error');
  const token = input.value.trim();
  if (!token) return;

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      errEl.textContent = 'Invalid token';
      errEl.style.display = 'block';
      return;
    }
    authToken = token;
    errEl.style.display = 'none';
    init();
  } catch {
    errEl.textContent = 'Connection failed';
    errEl.style.display = 'block';
  }
}

async function loadPublicInfo() {
  try {
    const res = await fetch(`${API}/api/public/info`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const info = await res.json();
    document.querySelectorAll('.wordmark-name').forEach(el => { el.textContent = info.name || 'forge'; });
    document.querySelectorAll('.wordmark-tag').forEach(el => {
      el.textContent = info.version ? `memory · v${info.version}` : 'memory';
    });
  } catch {
    /* public info is cosmetic */
  }
}

const TABS = ['chat', 'settings'];
const isValidTab = (tab) => TABS.includes(tab);

function storedTab() {
  try {
    const tab = localStorage.getItem('forge_tab');
    return isValidTab(tab) ? tab : 'chat';
  } catch {
    return 'chat';
  }
}

let activeTab = storedTab();

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab, true));
  btn.addEventListener('keydown', (e) => {
    const buttons = [...document.querySelectorAll('.tab-btn')];
    const idx = buttons.indexOf(btn);
    let next = null;
    if (e.key === 'ArrowRight') next = buttons[(idx + 1) % buttons.length];
    if (e.key === 'ArrowLeft') next = buttons[(idx - 1 + buttons.length) % buttons.length];
    if (e.key === 'Home') next = buttons[0];
    if (e.key === 'End') next = buttons[buttons.length - 1];
    if (!next) return;
    e.preventDefault();
    switchTab(next.dataset.tab, true);
  });
});

function switchTab(tab, focus = false) {
  if (!isValidTab(tab)) tab = 'chat';
  activeTab = tab;
  try { localStorage.setItem('forge_tab', tab); } catch { /* storage is optional */ }
  document.querySelectorAll('.tab-btn').forEach(b => {
    const selected = b.dataset.tab === tab;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
    if (selected && focus) b.focus();
  });
  document.querySelectorAll('.tab-content').forEach(t => {
    const selected = t.id === `tab-${tab}`;
    t.classList.toggle('active', selected);
    t.hidden = !selected;
  });
  if (tab === 'settings') initSettings(api, toast);
}

async function init() {
  showApp();
  switchTab(activeTab);
  try {
    await initChat(api, toast);
    updateStatus(true);
  } catch {
    showLogin();
  }
}

loadPublicInfo();
init();
