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
function cmdBlock(command) {
  return `<div class="copy-command">
    <code>${esc(command)}</code>
    <button class="btn btn-copy-command" type="button" data-copy-command="${escAttr(command)}" aria-label="Copy command: ${escAttr(command)}">Copy</button>
  </div>`;
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

function wireCopyButtons(c) {
  c.querySelectorAll('[data-copy-command]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyCommand);
        toastFn('Command copied', 'success');
      } catch {
        toastFn('Copy failed', 'error');
      }
    });
  });
}

function rInstance(c) {
  const i = settingsData.info;
  c.innerHTML = hdr('Instance', 'The identity and version of this forge. Everything written to memory carries this signature.')
    + fld('Name', 'How this instance identifies itself in Slack and logs.', `<input class="field-input" value="${escAttr(i.name)}" readonly>`)
    + fld('Version', 'Running release.', val(esc(i.version)))
    + '<div style="border-top:1px solid var(--rule);padding-top:18px"></div>';
}

function rModels(c) {
  const llm = {
    ...(settingsData.info.llm || {}),
    provider: settingsData.settings.chatProvider || settingsData.info.llm?.provider,
    model: settingsData.settings.chatModel || settingsData.info.llm?.model,
    permission_mode: settingsData.settings.permissionMode || settingsData.info.llm?.permission_mode,
  };
  let providers = normalizedProviders(settingsData.info);
  const catalog = settingsData.info.llmModelCatalog || {};
  const selectedProvider = llm.provider || 'claude-cli';
  if (!providers.length) {
    providers = [{
      provider: selectedProvider,
      label: selectedProvider,
      auth: 'unknown',
      effectiveModel: llm.model,
      defaultModel: llm.model,
      modelCompatible: true,
    }];
  }
  c.innerHTML = hdr('Models', 'Choose what answers chat. These settings become the default for the chat composer.')
    + fld('Chat backend', 'Provider used for new chat turns.', `<select class="field-input" id="set-chat-provider" aria-label="Chat backend provider">
        ${providers.map(p => `<option value="${escAttr(p.provider)}" ${p.provider === selectedProvider ? 'selected' : ''}>${esc(p.label || p.provider)}</option>`).join('')}
      </select>`)
    + fld('Chat model', 'Model used by the selected provider.', `<select class="field-input" id="set-chat-model" aria-label="Chat model"></select>`)
    + fld('Permission mode', 'Applies to CLI providers only.', `<select class="field-input" id="set-permission-mode" aria-label="Permission mode">
        <option value="default" ${(llm.permission_mode || 'default') === 'default' ? 'selected' : ''}>default</option>
        <option value="yolo" ${llm.permission_mode === 'yolo' ? 'selected' : ''}>yolo</option>
      </select>`)
    + '<div style="padding-top:8px;text-align:right"><button class="btn btn-primary" id="btn-model-save">Save model defaults</button></div>'
    + fld('Provider readiness', 'Available backends and the auth shape each one expects.', `<div class="provider-list">
        ${providers.map(p => `<div class="provider-row">
          <div>
            <div class="mono provider-name">${esc(p.label || p.provider)}</div>
            <div class="provider-hint">${esc(p.effectiveModel || p.defaultModel || 'default')} · ${esc(providerRequirementText(p.auth))}</div>
          </div>
          ${providerReadinessBadge(p, llm.provider)}
        </div>`).join('')}
      </div>`);

  const providerSelect = c.querySelector('#set-chat-provider');
  const modelSelect = c.querySelector('#set-chat-model');
  const fillModels = () => {
    const provider = providerSelect.value;
    const providerInfo = providers.find(p => p.provider === provider);
    const options = modelOptions(provider, providerInfo, catalog, llm);
    modelSelect.innerHTML = options.length
      ? options.map(model =>
        `<option value="${escAttr(model.id)}" ${model.id === llm.model ? 'selected' : ''}>${esc(model.label && model.label !== model.id ? `${model.label} · ${model.id}` : model.id)}</option>`
      ).join('')
      : '<option value="">No compatible models reported</option>';
    modelSelect.disabled = options.length === 0;
    if (!modelSelect.value && options[0]) modelSelect.value = options[0].id;
  };
  providerSelect.addEventListener('change', fillModels);
  fillModels();

  c.querySelector('#btn-model-save')?.addEventListener('click', async (e) => {
    try {
      await withBusy(e.currentTarget, 'Saving…', async () => {
        await apiCall('/api/settings', { method: 'PUT', body: JSON.stringify({
          chatProvider: providerSelect.value,
          chatModel: modelSelect.value,
          permissionMode: c.querySelector('#set-permission-mode').value,
        })});
        await loadData();
      });
      toastFn('Model defaults saved', 'success');
      renderSection();
    } catch (err) {
      toastError('Model save failed', err);
    }
  });
}

function normalizedProviders(info = {}) {
  const providers = info.llmProviderRequirements?.providers;
  if (Array.isArray(providers) && providers.length) return providers.filter(p => p?.provider);
  const provider = info.llm?.provider;
  return provider ? [{
    provider,
    label: provider,
    auth: 'unknown',
    effectiveModel: info.llm?.model,
    defaultModel: info.llm?.model,
    modelCompatible: true,
  }] : [];
}

function modelOptions(provider, providerInfo, catalog, llm) {
  const reported = Array.isArray(catalog?.[provider]) ? catalog[provider] : [];
  const candidates = [
    { id: providerInfo?.effectiveModel || llm.model, label: 'Active' },
    { id: providerInfo?.defaultModel, label: 'Provider default' },
    ...reported,
  ].filter(item => item?.id);
  const seen = new Set();
  return candidates.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return modelFitsProvider(provider, item.id);
  });
}

function modelFitsProvider(provider, model) {
  const normalized = String(model).trim().toLowerCase();
  const expectsClaude = provider === 'claude-cli' || provider === 'anthropic-api';
  const looksClaude = normalized.startsWith('claude-');
  const looksOpenAI = normalized.startsWith('gpt-')
    || normalized.startsWith('o1')
    || normalized.startsWith('o3')
    || normalized.startsWith('o4')
    || normalized.startsWith('o5')
    || normalized.startsWith('chatgpt-')
    || normalized.startsWith('codex-')
    || normalized.startsWith('computer-use-');
  if (expectsClaude && looksOpenAI) return false;
  if (!expectsClaude && looksClaude) return false;
  return true;
}

function providerRequirementText(requirement) {
  switch (requirement) {
    case 'claude-oauth-or-anthropic-key': return 'Claude OAuth or Anthropic API key';
    case 'codex-login-or-openai-api-key': return 'Codex CLI login or OpenAI API key';
    case 'anthropic-api-key': return 'Anthropic API key';
    case 'openai-api-key': return 'OpenAI API key';
    case 'none': return 'No provider auth required';
    default: return 'Auth requirement unknown';
  }
}

function providerAuthStatus(provider) {
  return authData?.providers?.find(p => p.provider === provider)?.status || null;
}

function providerReadinessBadge(provider, selectedProvider) {
  const status = providerAuthStatus(provider.provider);
  if (status === 'authenticated') return badge('ok', provider.provider === selectedProvider ? 'selected, ready' : 'ready');
  if (status === 'not_authenticated' || status === 'error') return badge('err', status.replace(/_/g, ' '));
  return badge(provider.provider === selectedProvider ? 'ok' : 'warn', provider.provider === selectedProvider ? 'selected' : 'available');
}

function rAuth(c) {
  const webPolicy = webAuthPolicy();
  const webAuthRequired = webPolicy.effectiveRequired;
  const webAuthDisabled = webPolicy.forcedRequired;
  const webAuthSaveDisabled = webAuthDisabled ? 'disabled aria-disabled="true"' : '';
  const webAuthPolicyBadge = badge(webAuthRequired ? 'ok' : 'warn', webAuthRequired ? 'token required' : 'token not required');
  const codexStatus = providerAuthStatus('codex-cli') || authData.codex || authData.openai || 'not_authenticated';
  const codexBadgeText = codexStatus === 'authenticated'
    ? (authData.codex === 'authenticated' ? 'Codex login ready' : authData.openai === 'authenticated' ? 'OpenAI key available' : 'Codex auth ready')
    : 'Codex login or OpenAI key required';
  c.innerHTML = hdr('Authentication', 'Credentials for the local web UI, chat providers, and Slack.')
    + fld('Web access token', 'Controls whether this browser UI must send the forge auth token on API calls. Keep this on unless the port is private to a trusted local machine.', `<label class="toggle-row" for="web-auth-required">
        <input id="web-auth-required" type="checkbox" ${webAuthRequired ? 'checked' : ''} ${webAuthDisabled ? 'disabled' : ''}>
        <span>Require token for web UI API calls</span>
      </label>
      <div class="auth-stack" style="margin-top:8px">
        <div>${webAuthPolicyBadge}</div>
        <div class="field-note">${esc(webPolicy.note)}</div>
      </div>
      <div style="padding-top:10px"><button class="btn" id="btn-web-auth-save" type="button" ${webAuthSaveDisabled}>Save web access</button></div>`)
    + fld('Claude CLI', 'Use OAuth for claude-cli, or use an Anthropic API key as the CLI fallback when supported by your local Claude setup.', `<div class="auth-stack">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${badge(authData.claude === 'authenticated' ? 'ok' : 'err', authData.claude || 'not_authenticated')}
          ${authData.claude !== 'authenticated' ? '<button class="btn btn-primary" id="btn-claude-auth" type="button">Start OAuth</button>' : ''}
        </div>
        ${cmdBlock('claude auth login')}
        ${cmdBlock('export ANTHROPIC_API_KEY="sk-ant-..."')}
      </div>`)
    + fld('Anthropic API', 'Use an API key for the anthropic-api provider.', `<div class="auth-stack">
        ${badge(authData.anthropic === 'authenticated' ? 'ok' : 'warn', authData.anthropic || 'not_authenticated')}
        <label class="sr-only" for="anthropic-input">Anthropic API key</label>
        <input class="field-input" id="anthropic-input" type="password" placeholder="sk-ant-..." aria-label="Anthropic API key" autocomplete="off">
        <div><button class="btn" id="btn-anthropic-save" type="button">Save Anthropic API key</button></div>
        ${cmdBlock('export ANTHROPIC_API_KEY="sk-ant-..."')}
      </div>`)
    + fld('Slack', 'Socket-mode bot for DMs and channel mentions.', `<div style="display:flex;flex-direction:column;gap:10px">
        ${badge(authData.slack === 'authenticated' ? 'ok' : 'err', authData.slack || 'not_authenticated')}
        <label class="sr-only" for="slack-bot-input">Slack bot token</label>
        <input class="field-input" id="slack-bot-input" type="password" placeholder="Bot token (xoxb-...)" aria-label="Slack bot token" autocomplete="off">
        <label class="sr-only" for="slack-app-input">Slack app token</label>
        <input class="field-input" id="slack-app-input" type="password" placeholder="App token (xapp-...)" aria-label="Slack app token" autocomplete="off">
        <div><button class="btn btn-primary" id="btn-slack-save" type="button">Save Slack tokens</button></div>
      </div>`)
    + fld('OpenAI API', 'Use an API key for openai-api, embeddings, and Codex CLI API-key fallback.', `<div class="auth-stack">
        ${badge(authData.openai === 'authenticated' ? 'ok' : 'warn', authData.openai || 'not_authenticated')}
        <label class="sr-only" for="openai-input">OpenAI API key</label>
        <input class="field-input" id="openai-input" type="password" placeholder="sk-..." aria-label="OpenAI API key" autocomplete="off">
        <div><button class="btn" id="btn-openai-save" type="button">Save OpenAI API key</button></div>
        ${cmdBlock('export OPENAI_API_KEY="sk-..."')}
      </div>`)
    + fld('Codex CLI', 'Use Codex CLI login where your local Codex install supports it; OpenAI API key fallback is configured above.', `<div class="auth-stack">
        ${badge(codexStatus === 'authenticated' ? 'ok' : 'warn', codexBadgeText)}
        ${cmdBlock('codex login')}
        ${cmdBlock('export OPENAI_API_KEY="sk-..."')}
      </div>`);

  wireCopyButtons(c);

  c.querySelector('#btn-web-auth-save')?.addEventListener('click', async (e) => {
    if (webAuthDisabled) return;
    const webAuthRequired = c.querySelector('#web-auth-required').checked;
    try {
      await withBusy(e.currentTarget, 'Saving…', async () => {
        await apiCall('/api/settings', { method: 'PUT', body: JSON.stringify({ webAuthRequired }) });
        await loadData();
      });
      const savedPolicy = webAuthPolicy();
      if (webAuthRequired) {
        toastFn('Web token required', 'success');
      } else if (savedPolicy.effectiveRequired) {
        toastFn('Web token preference saved; server policy still requires it', 'success');
      } else {
        toastFn(savedPolicy.unknownEffective ? 'Web token preference saved' : 'Web token disabled', 'success');
      }
      renderSection();
    } catch (err) {
      toastError('Web access save failed', err);
    }
  });
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
  c.querySelector('#btn-anthropic-save')?.addEventListener('click', async (e) => {
    const key = c.querySelector('#anthropic-input').value.trim();
    if (!key) return toastFn('API key required', 'error');
    try {
      await withBusy(e.currentTarget, 'Saving…', async () => {
        await apiCall('/api/auth/anthropic/key', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
        await loadData();
      });
      toastFn('Anthropic key saved', 'success');
      renderSection();
    } catch (err) {
      toastError('Anthropic key save failed', err);
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

function webAuthPolicy() {
  const raw = settingsData.webAuthPolicy
    || settingsData.info?.webAuthPolicy
    || settingsData.info?.web?.authPolicy
    || {};
  const storedRequired = settingsData.settings?.webAuthRequired !== false;
  const reportedEffective = raw.effectiveRequired ?? raw.effectiveWebAuthRequired ?? raw.required ?? settingsData.info?.effectiveWebAuthRequired;
  const effectiveRequired = typeof reportedEffective === 'boolean' ? reportedEffective : storedRequired;
  const source = String(raw.source || raw.reason || raw.forcedBy || '').toLowerCase();
  const forcedRequired = effectiveRequired && Boolean(
    raw.forced
    || raw.locked
    || raw.readOnly
    || raw.canDisable === false
    || ['env', 'config', 'host', 'non-loopback', 'forced'].includes(source)
    || source.includes('non-loopback')
  );
  const reason = raw.reason || raw.source || raw.forcedBy || '';
  let note;
  if (forcedRequired) {
    note = `Effective server policy requires a token${reason ? ` (${reason})` : ''}. The saved setting cannot disable web auth in this deployment.`;
  } else if (typeof reportedEffective === 'boolean') {
    note = effectiveRequired
      ? 'Effective server policy currently requires a token.'
      : 'Effective server policy currently allows web UI API calls without a token.';
  } else {
    note = 'Saved preference. Server config, environment, or a non-loopback host may still force token enforcement.';
  }
  return {
    effectiveRequired,
    forcedRequired,
    unknownEffective: typeof reportedEffective !== 'boolean',
    note,
  };
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
  const embedding = settingsData.info.embedding || {};
  const retentionDays = memory.retentionDays ?? 30;
  const contextWindowTokens = memory.contextWindowTokens ?? 80000;
  const indexMinutes = memory.indexRebuildIntervalMinutes ?? 15;
  const vectorLive = Boolean(embedding.live || embedding.vectorLive || embedding.sqliteVecLoaded);
  c.innerHTML = hdr('Memory', 'forge keeps one thread. These settings describe the retrieval and context policy reported by the backend.')
    + fld('Retention', 'Configured retention target for memory records.', val(`${retentionDays} days`))
    + fld('Context window', 'Reported context budget for web chat prompts.', val(`${Math.round(contextWindowTokens / 1000)}k tokens`))
    + fld('Index rebuild', 'Configured rebuild interval reported by the backend.', val(`${indexMinutes} minutes`))
    + fld('Vector readiness', 'FTS5 remains the baseline. Vector status is shown only when the backend reports enough detail.', `<div class="auth-stack">
        ${badge(vectorLive ? 'ok' : embedding.enabled ? 'warn' : 'warn', vectorLive ? 'live' : embedding.enabled ? 'OpenAI key detected' : 'FTS5 only')}
        <div class="field-value">${esc(embedding.provider || 'openai')} · ${esc(embedding.model || 'text-embedding-3-small')} · ${esc(embedding.dimension || 1536)} dims</div>
      </div>`);
}
