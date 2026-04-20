const API = '';
let authToken = localStorage.getItem('forge_token') || '';
let pollTimer = null;
let lastTs = null;
let thinking = false;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) {
    showLogin();
    throw new Error('Unauthorized');
  }
  return res.json();
}

// ---- AUTH ----
function showLogin() {
  const msg = document.getElementById('chat-messages');
  msg.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:16px">
      <div style="font-family:var(--font-mono);color:var(--accent);font-size:18px">forge/zima</div>
      <input id="login-token" type="password" placeholder="Auth token"
        style="width:300px;padding:12px;font-family:var(--font-mono);font-size:14px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);outline:none">
      <button onclick="doLogin()" class="auth-btn save-btn">Connect</button>
    </div>
  `;
}

window.doLogin = async function() {
  const input = document.getElementById('login-token');
  const token = input.value.trim();
  if (!token) return;
  try {
    await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    authToken = token;
    localStorage.setItem('forge_token', token);
    init();
  } catch (err) {
    toast('Invalid token', 'error');
  }
};

// ---- TABS ----
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'settings') loadSettings();
  });
});

// ---- CHAT ----
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
});

chatSend.addEventListener('click', sendMessage);

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || thinking) return;

  addMessage('user', text);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  thinking = true;
  chatSend.disabled = true;
  const thinkingEl = addMessage('assistant', '...', true);

  try {
    const data = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ content: text }),
    });

    thinkingEl.remove();
    addMessage('assistant', data.reply, false, {
      model: data.model,
      tokens: `${data.usage.input}in / ${data.usage.output}out`,
    });
  } catch (err) {
    thinkingEl.remove();
    addMessage('assistant', `Error: ${err.message}`, false);
  }

  thinking = false;
  chatSend.disabled = false;
  chatInput.focus();
}

function addMessage(role, text, isThinking = false, meta = null) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const sender = document.createElement('div');
  sender.className = 'sender';
  sender.textContent = role === 'user' ? 'you' : 'forge';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (isThinking) {
    bubble.style.opacity = '0.5';
    bubble.innerHTML = '<span class="thinking-dots">thinking</span>';
  } else {
    bubble.textContent = text;
  }

  div.appendChild(sender);
  div.appendChild(bubble);

  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.textContent = `${meta.model} | ${meta.tokens}`;
    div.appendChild(metaEl);
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

async function loadMessages() {
  try {
    const data = await api('/api/messages/poll?limit=50');
    chatMessages.innerHTML = '';
    for (const msg of data.messages) {
      const role = msg.userName === 'forge-zima' || msg.user === 'assistant' ? 'assistant' : 'user';
      const meta = msg.llm_metadata ? JSON.parse(msg.llm_metadata) : null;
      addMessage(role, msg.text, false, meta ? {
        model: meta.model,
        tokens: `${meta.inputTokens}in / ${meta.outputTokens}out`,
      } : null);
    }
    updateStatus(true);
  } catch {
    updateStatus(false);
  }
}

// ---- SETTINGS ----
async function loadSettings() {
  const container = document.getElementById('settings-content');
  try {
    const [settings, authStatus] = await Promise.all([
      api('/api/settings'),
      api('/api/auth/status'),
    ]);

    container.innerHTML = `
      <div class="settings-section">
        <h2>Instance</h2>
        <div class="settings-grid">
          <div class="setting-card">
            <label>Name</label>
            <div class="value">${settings.info.name}</div>
          </div>
          <div class="setting-card">
            <label>Version</label>
            <div class="value">${settings.info.version}</div>
          </div>
          <div class="setting-card">
            <label>Default Model</label>
            <div class="value">${settings.info.models.default}</div>
          </div>
          <div class="setting-card">
            <label>Architect Model</label>
            <div class="value">${settings.info.models.architect}</div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h2>Authentication</h2>
        <div class="settings-grid">
          <div class="setting-card">
            <label>Claude (OAuth)</label>
            <div class="value">
              <span class="status-dot ${authStatus.claude === 'authenticated' ? 'ok' : 'err'}"></span>
              ${authStatus.claude}
            </div>
            ${authStatus.claude !== 'authenticated' ? '<button class="auth-btn" onclick="startClaudeAuth()">Authenticate</button>' : ''}
          </div>
          <div class="setting-card">
            <label>Slack</label>
            <div class="value">
              <span class="status-dot ${authStatus.slack === 'authenticated' ? 'ok' : 'err'}"></span>
              ${authStatus.slack}
            </div>
            <div style="margin-top:8px">
              <input type="password" id="slack-bot-token" placeholder="Bot Token (xoxb-...)" style="margin-bottom:6px">
              <input type="password" id="slack-app-token" placeholder="App Token (xapp-...)">
              <button class="auth-btn save-btn" onclick="saveSlack()" style="margin-top:6px">Save Tokens</button>
            </div>
          </div>
          <div class="setting-card">
            <label>OpenAI (Embeddings)</label>
            <div class="value">
              <span class="status-dot ${authStatus.openai === 'authenticated' ? 'ok' : 'warn'}"></span>
              ${authStatus.openai === 'authenticated' ? 'authenticated' : 'optional'}
            </div>
            <div style="margin-top:8px">
              <input type="password" id="openai-key" placeholder="sk-...">
              <button class="auth-btn save-btn" onclick="saveOpenAI()" style="margin-top:6px">Save Key</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h2>Budget</h2>
        <div class="settings-grid">
          <div class="setting-card">
            <label>Daily Limit ($)</label>
            <input type="number" id="set-daily" value="${settings.settings.dailyBudget}" step="1" min="0">
          </div>
          <div class="setting-card">
            <label>Per-Job Limit ($)</label>
            <input type="number" id="set-perjob" value="${settings.settings.perJobBudget}" step="1" min="0">
          </div>
          <div class="setting-card">
            <label>Warning Threshold (%)</label>
            <input type="number" id="set-warn" value="${settings.settings.warningThreshold}" step="5" min="0" max="100">
          </div>
          <div class="setting-card" style="display:flex;align-items:end">
            <button class="auth-btn save-btn" onclick="saveBudget()">Save Budget</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h2>Databases</h2>
        <div class="settings-grid">
          ${settings.info.databases.map(db => `
            <div class="setting-card">
              <label>${db.name}</label>
              <div class="value">
                <span class="status-dot ${db.ok ? 'ok' : 'err'}"></span>
                ${db.ok ? 'healthy' : db.error}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--error);padding:32px">Failed to load settings: ${err.message}</div>`;
  }
}

window.startClaudeAuth = async function() {
  toast('Starting Claude OAuth — check the browser on the server machine', 'success');
  await api('/api/auth/claude/login', { method: 'POST' });
};

window.saveSlack = async function() {
  const botToken = document.getElementById('slack-bot-token').value.trim();
  const appToken = document.getElementById('slack-app-token').value.trim();
  if (!botToken || !appToken) return toast('Both tokens required', 'error');
  await api('/api/auth/slack/tokens', {
    method: 'POST',
    body: JSON.stringify({ botToken, appToken }),
  });
  toast('Slack tokens saved', 'success');
  loadSettings();
};

window.saveOpenAI = async function() {
  const apiKey = document.getElementById('openai-key').value.trim();
  if (!apiKey) return toast('API key required', 'error');
  await api('/api/auth/openai/key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
  toast('OpenAI key saved', 'success');
  loadSettings();
};

window.saveBudget = async function() {
  const data = {
    dailyBudget: parseFloat(document.getElementById('set-daily').value),
    perJobBudget: parseFloat(document.getElementById('set-perjob').value),
    warningThreshold: parseInt(document.getElementById('set-warn').value),
  };
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
  toast('Budget saved', 'success');
};

// ---- UTILITIES ----
function updateStatus(connected) {
  const el = document.getElementById('conn-status');
  el.innerHTML = connected
    ? '<span class="status-dot ok"></span><span style="font-size:13px;color:var(--text-muted)">connected</span>'
    : '<span class="status-dot err"></span><span style="font-size:13px;color:var(--text-muted)">disconnected</span>';
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---- INIT ----
async function init() {
  try {
    await loadMessages();
  } catch {
    showLogin();
  }
}

init();
