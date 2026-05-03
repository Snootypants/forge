let apiCall, toastFn;
let currentSection = 'instance';
let settingsData = null;
let authData = null;
let ready = false;

export async function initSettings(api, toast) {
  apiCall = api; toastFn = toast;
  const container = document.getElementById('tab-settings');
  if (!ready) { buildLayout(container); ready = true; }
  await loadData();
  renderSection();
}

function buildLayout(container) {
  container.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'settings-page';

  const sidebar = document.createElement('aside');
  sidebar.className = 'settings-sidebar';
  const title = document.createElement('div');
  title.className = 'smallcaps title';
  title.textContent = 'Settings';
  sidebar.appendChild(title);

  const nav = document.createElement('nav');
  const sections = [
    { id: 'instance', label: 'Instance', hint: 'Name, version' },
    { id: 'models', label: 'Models', hint: 'Default, architect' },
    { id: 'auth', label: 'Authentication', hint: 'Providers, Slack' },
    { id: 'budget', label: 'Budget', hint: 'Saved policy' },
    { id: 'databases', label: 'Databases', hint: 'Health, storage' },
    { id: 'memory', label: 'Memory', hint: 'Retention, indexing' },
  ];

  sections.forEach(s => {
    const btn = document.createElement('button');
    btn.className = `nav-btn${s.id === currentSection ? ' active' : ''}`;
    btn.type = 'button';
    btn.setAttribute('aria-current', s.id === currentSection ? 'page' : 'false');
    btn.innerHTML = `<span class="name">${esc(s.label)}</span><span class="hint">${esc(s.hint)}</span>`;
    btn.addEventListener('click', () => {
      currentSection = s.id;
      nav.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-current', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      renderSection();
    });
    nav.appendChild(btn);
  });
  sidebar.appendChild(nav);

  const detail = document.createElement('div');
  detail.className = 'settings-detail';
  const inner = document.createElement('div');
  inner.className = 'settings-detail-inner';
  inner.id = 'settings-content';
  detail.appendChild(inner);

  page.append(sidebar, detail);
  container.appendChild(page);
}

async function loadData() {
  try {
    const [s, a] = await Promise.all([apiCall('/api/settings'), apiCall('/api/auth/status')]);
    settingsData = s; authData = a;
  } catch (err) {
    settingsData = null;
    authData = null;
    const c = document.getElementById('settings-content');
    if (c) c.innerHTML = `<div style="color:var(--err);padding:32px">Failed to load: ${esc(err.message)}</div>`;
  }
}

function renderSection() {
  const c = document.getElementById('settings-content');
  if (!c || !settingsData) return;
  const renderers = { instance: rInstance, models: rModels, auth: rAuth, budget: rBudget, databases: rDatabases, memory: rMemory };
  (renderers[currentSection] || rInstance)(c);
}

function hdr(title, lede) {
  return `<div class="section-header"><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>`;
}
function fld(label, hint, content) {
  return `<div class="field"><div><div class="smallcaps field-label">${label}</div>${hint ? `<div class="field-hint">${hint}</div>` : ''}</div><div>${content}</div></div>`;
}
function val(v) { return `<div class="field-value">${v}</div>`; }
function badge(state, text) {
  const safeState = ['ok', 'warn', 'err'].includes(state) ? state : 'warn';
  return `<span class="status-badge ${safeState}"><span class="dot"></span>${esc(text)}</span>`;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
async function withBusy(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = label;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = original;
  }
}
function toastError(prefix, err) {
  toastFn(`${prefix}: ${err.message || String(err)}`, 'error');
}

function rInstance(c) {
  const i = settingsData.info;
  c.innerHTML = hdr('Instance', 'The identity and version of this forge. Everything written to memory carries this signature.')
    + fld('Name', 'How this instance identifies itself in Slack and logs.', `<input class="field-input" value="${escAttr(i.name)}" readonly>`)
    + fld('Version', 'Running release.', val(esc(i.version)))
    + '<div style="border-top:1px solid var(--rule);padding-top:18px"></div>';
}

function rModels(c) {
  const m = settingsData.info.models;
  const llm = settingsData.info.llm || {};
  c.innerHTML = hdr('Models', 'The selected provider answers normal chat; specialized model slots are kept for future routing.')
    + fld('Provider', 'The LLM backend selected in forge.config.yaml.', val(esc(llm.provider || 'claude-cli')))
    + fld('Active model', 'The model used for normal chat turns.', val(esc(llm.model || m.default)))
    + fld('Permission mode', 'Applies to CLI providers. yolo maps to each CLI provider’s full-power mode.', val(esc(llm.permission_mode || 'default')))
    + fld('Default', 'Fallback model when no provider model is configured.', val(esc(m.default)))
    + fld('Architect', 'Used for planning, refactors, long-range reasoning.', val(esc(m.architect)))
    + fld('Sentinel', 'Lightweight tasks, triage, classification.', val(esc(m.sentinel)));
}

function rAuth(c) {
  c.innerHTML = hdr('Authentication', 'Credentials for providers and chat surfaces. Changes saved here may require a process restart.')
    + fld('Claude CLI / Anthropic', 'Claude CLI OAuth or Anthropic API key.', `<div style="display:flex;align-items:center;gap:12px">
        ${badge(authData.claude === 'authenticated' ? 'ok' : 'err', authData.claude)}
        ${authData.claude !== 'authenticated' ? '<button class="btn btn-primary" id="btn-claude-auth">Authenticate</button>' : ''}
      </div>`)
    + fld('Slack', 'Socket-mode bot for DMs and channel mentions.', `<div style="display:flex;flex-direction:column;gap:10px">
        ${badge(authData.slack === 'authenticated' ? 'ok' : 'err', authData.slack)}
        <input class="field-input" id="slack-bot-input" type="password" placeholder="Bot token (xoxb-…)">
        <input class="field-input" id="slack-app-input" type="password" placeholder="App token (xapp-…)">
        <div><button class="btn btn-primary" id="btn-slack-save">Save tokens</button></div>
      </div>`)
    + fld('OpenAI / Codex', 'Embeddings, OpenAI API provider, or Codex CLI key fallback. Optional unless selected.', `<div style="display:flex;flex-direction:column;gap:10px">
        ${badge(authData.openai === 'authenticated' ? 'ok' : 'warn', authData.openai === 'authenticated' ? 'authenticated' : 'optional')}
        <input class="field-input" id="openai-input" type="password" placeholder="sk-…">
        <div><button class="btn" id="btn-openai-save">Save key</button></div>
      </div>`);

  c.querySelector('#btn-claude-auth')?.addEventListener('click', async (e) => {
    try {
      await withBusy(e.currentTarget, 'Starting…', async () => {
        await apiCall('/api/auth/claude/login', { method: 'POST' });
      });
      toastFn('Starting Claude OAuth - check the browser on the server machine', 'success');
    } catch (err) {
      toastError('Claude OAuth failed', err);
    }
  });
  c.querySelector('#btn-slack-save')?.addEventListener('click', async (e) => {
    const bot = c.querySelector('#slack-bot-input').value.trim();
    const app = c.querySelector('#slack-app-input').value.trim();
    if (!bot || !app) return toastFn('Both tokens required', 'error');
    try {
      await withBusy(e.currentTarget, 'Saving…', async () => {
        await apiCall('/api/auth/slack/tokens', { method: 'POST', body: JSON.stringify({ botToken: bot, appToken: app }) });
        await loadData();
      });
      toastFn('Slack tokens saved', 'success');
      renderSection();
    } catch (err) {
      toastError('Slack token save failed', err);
    }
  });
  c.querySelector('#btn-openai-save')?.addEventListener('click', async (e) => {
    const key = c.querySelector('#openai-input').value.trim();
    if (!key) return toastFn('API key required', 'error');
    try {
      await withBusy(e.currentTarget, 'Saving…', async () => {
        await apiCall('/api/auth/openai/key', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
        await loadData();
      });
      toastFn('OpenAI key saved', 'success');
      renderSection();
    } catch (err) {
      toastError('OpenAI key save failed', err);
    }
  });
}

function rBudget(c) {
  const s = settingsData.settings;
  const limit = Number(s.dailyBudget) || 0;
  const warn = Number(s.warningThreshold) || 0;
  c.innerHTML = hdr('Budget', 'Saved spend policy. Enforcement is not wired into provider calls yet.')
    + `<div class="budget-meter">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
          <span class="amount">$0.00</span>
          <span style="font-size:13px;color:var(--ink-mute)">of $${limit} today</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px">
          <span class="mono" style="font-size:10.5px;color:var(--ink-faint)">0</span>
          <span class="mono" style="font-size:10.5px;color:var(--ink-faint)">warn @ $${Math.round(limit * warn / 100)}</span>
          <span class="mono" style="font-size:10.5px;color:var(--ink-faint)">$${limit}</span>
        </div>
      </div>`
    + fld('Daily limit', 'Persisted for upcoming budget enforcement.', `<input class="field-input" id="set-daily" type="number" value="${escAttr(s.dailyBudget)}">`)
    + fld('Per-job limit', 'Persisted for upcoming job-level enforcement.', `<input class="field-input" id="set-perjob" type="number" value="${escAttr(s.perJobBudget)}">`)
    + fld('Warning threshold', 'Persisted threshold for upcoming warnings.', `<input class="field-input" id="set-warn" type="number" value="${escAttr(s.warningThreshold)}">`)
    + '<div style="padding-top:24px;text-align:right"><button class="btn btn-primary" id="btn-budget-save">Save budget</button></div>';

  c.querySelector('#btn-budget-save')?.addEventListener('click', async (e) => {
    try {
      const data = await withBusy(e.currentTarget, 'Saving…', async () => apiCall('/api/settings', { method: 'PUT', body: JSON.stringify({
        dailyBudget: parseFloat(c.querySelector('#set-daily').value),
        perJobBudget: parseFloat(c.querySelector('#set-perjob').value),
        warningThreshold: parseInt(c.querySelector('#set-warn').value),
      })}));
      if (data?.settings) settingsData = { ...settingsData, settings: data.settings };
      else await loadData();
      toastFn('Budget saved', 'success');
      renderSection();
    } catch (err) {
      toastError('Budget save failed', err);
    }
  });
}

function rDatabases(c) {
  const dbs = settingsData.info.databases || [];
  c.innerHTML = hdr('Databases', 'Where memory lives. The ledger is append-only; the index is rebuilt on change.')
    + dbs.map(db => `<div class="db-row">
        <div>
          <div class="mono" style="font-size:13px;color:var(--ink)">${esc(db.name)}</div>
          <div style="font-size:11.5px;color:var(--ink-mute);margin-top:2px">${db.ok ? 'healthy' : esc(db.error || 'error')}</div>
        </div>
        <div></div><div></div>
        ${badge(db.ok ? 'ok' : 'err', db.ok ? 'healthy' : 'error')}
      </div>`).join('');
}

function rMemory(c) {
  const memory = settingsData.info.memory || {};
  const retentionDays = memory.retentionDays ?? 30;
  const contextWindowTokens = memory.contextWindowTokens ?? 80000;
  const indexMinutes = memory.indexRebuildIntervalMinutes ?? 15;
  c.innerHTML = hdr('Memory', 'forge keeps one thread. Everything said becomes part of the record; these controls shape what\'s surfaced.')
    + fld('Retention', 'How long raw turns stay before summarization.', val(`${retentionDays} days · then summarized`))
    + fld('Context window', 'How much of the ledger to inject per turn.', val(`adaptive · targeting ${Math.round(contextWindowTokens / 1000)}k tokens`))
    + fld('Index rebuild', 'How often semantic recall is recomputed.', val(`every ${indexMinutes} minutes on change`));
}
