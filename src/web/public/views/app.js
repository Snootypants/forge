import { initChat } from './chat.js';
import { initSettings } from './settings.js';

const API = '';
let authToken = localStorage.getItem('forge_token') || '';

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) {
    showLogin();
    throw new Error('Unauthorized');
  }
  return res.json();
}

export function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      errEl.textContent = 'Invalid token';
      errEl.style.display = 'block';
      return;
    }
    authToken = token;
    localStorage.setItem('forge_token', token);
    errEl.style.display = 'none';
    init();
  } catch {
    errEl.textContent = 'Connection failed';
    errEl.style.display = 'block';
  }
}

let activeTab = localStorage.getItem('forge_tab') || 'chat';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  activeTab = tab;
  localStorage.setItem('forge_tab', tab);
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${tab}`));
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

init();
