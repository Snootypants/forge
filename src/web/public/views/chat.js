import { renderAllMessages, renderInspector, renderThreadMeta, selectMessage, setMessages, getMessages, getThinking, setThinking, scrollToBottom, setMsgContainer, setToastFn as setRenderToast, setApiCall, setAssistantName, setThreadMetaConfig } from './chat-render.js';

let apiCall, toastFn;
let container, composerTextarea, composerProviderSelect, composerModelSelect, composerSendBtn, composerStatus;
let chatReady = false;
let pollTimer = null;
let activeObserver = null;
let lastReceivedAt = 0;
let pollInFlight = false;
let pollingSuspended = false;
let backendReady = false;
let authState = null;
let authStatusResolved = false;
let authStatusLoading = false;
let lastAuthStatusAt = 0;
let mobileRailReturnFocus = null;
let pollFailureCount = 0;
let nextPollAttemptAt = 0;
let nextPollToastAt = 0;
const POLL_INTERVAL_MS = 3000;
const AUTH_STATUS_TTL_MS = 60000;
const POLL_TOAST_COOLDOWN_MS = 30000;
const POLL_BACKOFF_MAX_MS = 30000;

const RAIL_MIN = 180, RAIL_MAX = 360, RAIL_DEFAULT = 240;
const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v));

let rails = loadRails();
function loadRails() {
  try {
    const v = JSON.parse(localStorage.getItem('forge_rails') || '{}');
    return {
      leftW: clamp(RAIL_MIN, RAIL_MAX, v.leftW || RAIL_DEFAULT),
      rightW: clamp(RAIL_MIN, RAIL_MAX, v.rightW || RAIL_DEFAULT),
      leftOpen: v.leftOpen ?? true, rightOpen: v.rightOpen ?? true,
    };
  } catch { return { leftW: RAIL_DEFAULT, rightW: RAIL_DEFAULT, leftOpen: true, rightOpen: true }; }
}
function saveRails() {
  try { localStorage.setItem('forge_rails', JSON.stringify(rails)); }
  catch { /* rail preferences are optional */ }
}

export async function initChat(api, toast) {
  apiCall = api; toastFn = toast;
  setRenderToast(toast);
  setApiCall(api);
  container = document.getElementById('tab-chat');
  if (!chatReady) { buildLayout(); chatReady = true; }
  pollingSuspended = false;
  authState = null;
  authStatusResolved = false;
  authStatusLoading = false;
  await loadMessages();
  await refreshAuthStatus(true);
  startPolling();
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

function buildLayout() {
  const page = el('div', 'chat-page');
  const mobileTools = el('div', 'mobile-rail-actions');
  mobileTools.innerHTML = `
    <button class="btn" type="button" data-mobile-rail="left" aria-controls="rail-left" aria-expanded="false">Inspector</button>
    <button class="btn" type="button" data-mobile-rail="right" aria-controls="rail-right" aria-expanded="false">Identity</button>
  `;
  const scroll = el('div', 'chat-scroll');
  const cols = el('div', 'chat-columns');
  const backdrop = el('button', 'mobile-rail-backdrop');
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close panel');

  const leftRail = el('div', 'rail'); leftRail.id = 'rail-left';
  leftRail.setAttribute('aria-label', 'Inspector panel');
  leftRail.appendChild(buildMobileRailHeader('Inspector', 'left'));
  const leftInner = el('div', 'rail-inner'); leftInner.id = 'inspector-panel';
  leftRail.appendChild(leftInner);

  const rightRail = el('div', 'rail'); rightRail.id = 'rail-right';
  rightRail.setAttribute('aria-label', 'Identity panel');
  rightRail.appendChild(buildMobileRailHeader('Identity', 'right'));
  const rightInner = el('div', 'rail-inner'); rightInner.id = 'threadmeta-panel';
  rightRail.appendChild(rightInner);

  const center = el('div', 'paper-sheet chat-center');
  center.appendChild(el('div', 'thread-spine'));
  const mc = el('div'); mc.id = 'msg-container';
  setMsgContainer(mc);
  center.appendChild(mc);

  cols.append(leftRail, buildDivider('left'), center, buildDivider('right'), rightRail);
  scroll.appendChild(cols);
  page.appendChild(mobileTools);
  page.appendChild(scroll);
  page.appendChild(buildComposer());
  page.appendChild(backdrop);
  container.appendChild(page);

  mobileTools.querySelectorAll('[data-mobile-rail]').forEach(btn => {
    btn.addEventListener('click', () => openMobileRail(btn.dataset.mobileRail));
  });
  backdrop.addEventListener('click', () => closeMobileRails(true));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileRails(true);
    if (e.key === 'Tab') trapMobileRailFocus(e);
  });
  window.addEventListener('forge:auth-failure', () => {
    pollingSuspended = true;
    backendReady = false;
    stopPolling();
    updateComposerState();
  });

  applyRailWidths();
  renderInspector();
  renderThreadMeta();
}

function buildMobileRailHeader(title, side) {
  const header = el('div', 'mobile-rail-header');
  const label = el('div', 'smallcaps');
  label.textContent = title;
  const close = el('button', 'mobile-rail-close');
  close.type = 'button';
  close.setAttribute('aria-label', `Close ${title}`);
  close.textContent = '×';
  close.addEventListener('click', () => closeMobileRails(true));
  header.append(label, close);
  header.dataset.side = side;
  return header;
}

function openMobileRail(side) {
  closeMobileRails(false);
  const rail = document.getElementById(`rail-${side}`);
  const backdrop = container?.querySelector('.mobile-rail-backdrop');
  if (!rail || !backdrop) return;
  mobileRailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  rail.classList.add('mobile-open');
  rail.setAttribute('role', 'dialog');
  rail.setAttribute('aria-modal', 'true');
  backdrop.classList.add('open');
  container?.querySelectorAll('[data-mobile-rail]').forEach(btn => {
    btn.setAttribute('aria-expanded', String(btn.dataset.mobileRail === side));
  });
  rail.querySelector('button, [tabindex], textarea, input, select, a[href]')?.focus?.();
}

function closeMobileRails(restoreFocus = false) {
  if (!container) return;
  container.querySelectorAll('.rail.mobile-open').forEach(rail => {
    rail.classList.remove('mobile-open');
    rail.removeAttribute('role');
    rail.removeAttribute('aria-modal');
  });
  container.querySelectorAll('[data-mobile-rail]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
  container.querySelector('.mobile-rail-backdrop')?.classList.remove('open');
  if (restoreFocus) mobileRailReturnFocus?.focus?.();
  mobileRailReturnFocus = null;
}

function trapMobileRailFocus(e) {
  const rail = container?.querySelector('.rail.mobile-open');
  if (!rail) return;
  const focusables = [...rail.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function buildDivider(side) {
  const div = el('div', 'rail-divider');
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', `${side} inspector panel`);
  const line = el('div', 'line');
  const grip = el('div', 'grip');
  div.append(line, grip);
  let moved = 0, lastX = 0;

  div.addEventListener('mousemove', (e) => {
    grip.style.top = (e.clientY - div.getBoundingClientRect().top) + 'px';
  });

  div.addEventListener('mousedown', (e) => {
    e.preventDefault(); lastX = e.clientX; moved = 0;
    div.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const dx = ev.clientX - lastX; lastX = ev.clientX; moved += Math.abs(dx);
      const key = side === 'left' ? 'leftW' : 'rightW';
      rails[key] = clamp(RAIL_MIN, RAIL_MAX, rails[key] + (side === 'left' ? dx : -dx));
      rails[`${side}Open`] = true;
      applyRailWidths(); saveRails();
      grip.style.top = (ev.clientY - div.getBoundingClientRect().top) + 'px';
    };
    const onUp = () => {
      div.classList.remove('dragging');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved < 4) { rails[`${side}Open`] = !rails[`${side}Open`]; applyRailWidths(); saveRails(); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  div.addEventListener('keydown', (e) => {
    const key = side === 'left' ? 'leftW' : 'rightW';
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      rails[`${side}Open`] = !rails[`${side}Open`];
      applyRailWidths(); saveRails();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 16 : -16;
      rails[key] = clamp(RAIL_MIN, RAIL_MAX, rails[key] + (side === 'left' ? delta : -delta));
      rails[`${side}Open`] = true;
      applyRailWidths(); saveRails();
    }
  });

  div._side = side; div._grip = grip;
  return div;
}

function applyRailWidths() {
  for (const side of ['left', 'right']) {
    const rail = document.getElementById(`rail-${side}`);
    if (!rail) continue;
    const open = rails[`${side}Open`], w = rails[`${side}W`];
    rail.style.width = open ? w + 'px' : '0';
    rail.querySelector('.rail-inner').style.width = w + 'px';
  }
  document.querySelectorAll('.rail-divider').forEach(d => {
    const open = rails[`${d._side}Open`];
    d.setAttribute('aria-expanded', String(open));
    d._grip.replaceChildren();
    if (!open) {
      const icon = document.createElement('span');
      icon.className = 'grip-chevron';
      icon.textContent = d._side === 'left' ? '›' : '‹';
      d._grip.appendChild(icon);
    }
  });
}

function parseMeta(raw) {
  if (!raw) return null;
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { provider: m.provider, model: m.model, input: m.inputTokens || 0, output: m.outputTokens || 0 };
  } catch { return null; }
}

function parsePromptContext(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'string' ? parseInt(ts) : ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function loadMessages() {
  const data = await apiCall('/api/messages/poll?limit=50');
  backendReady = true;
  recordPollingRecovered();
  const assistantName = data.agentName || 'forge';
  setAssistantName(assistantName);
  applyUiConfig(data.ui || {});
  const mapped = data.messages.map(m => mapServerMessage(m, assistantName));
  lastReceivedAt = mapped.reduce((max, m) => Math.max(max, m.receivedAt || 0), lastReceivedAt);
  setMessages(mapped);
  renderAllMessages();
  scrollToBottom();
}

function startPolling() {
  if (pollingSuspended) return;
  if (!pollTimer) {
    pollTimer = window.setInterval(() => {
      if (canPoll()) pollMessages();
    }, POLL_INTERVAL_MS);
  }
  if (!activeObserver && container) {
    activeObserver = new MutationObserver(() => {
      if (canPoll()) pollMessages();
    });
    activeObserver.observe(container, { attributes: true, attributeFilter: ['class', 'hidden'] });
    document.addEventListener('visibilitychange', () => {
      if (canPoll()) pollMessages();
    });
  }
}

async function pollMessages() {
  if (!apiCall || pollInFlight || !canPoll()) return;
  pollInFlight = true;
  try {
    const since = Math.max(0, lastReceivedAt - 1);
    const qs = lastReceivedAt ? `?since=${encodeURIComponent(since)}&limit=200` : '?limit=50';
    const data = await apiCall(`/api/messages/poll${qs}`);
    backendReady = true;
    recordPollingRecovered();
    const assistantName = data.agentName || 'forge';
    setAssistantName(assistantName);
    applyUiConfig(data.ui || {});
    mergeMessages(data.messages.map(m => mapServerMessage(m, assistantName)));
  } catch (err) {
    backendReady = false;
    if (err?.isAuth) {
      pollingSuspended = true;
      stopPolling();
      return;
    }
    recordPollingFailure(err);
  } finally {
    pollInFlight = false;
    updateComposerState();
  }
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function canPoll() {
  return !pollingSuspended
    && isChatActive()
    && !document.hidden
    && Date.now() >= nextPollAttemptAt
    && document.getElementById('login-gate')?.style.display !== 'flex';
}

function recordPollingFailure(err) {
  pollFailureCount += 1;
  const now = Date.now();
  const backoff = Math.min(POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS * (2 ** Math.min(pollFailureCount - 1, 4)));
  nextPollAttemptAt = now + backoff;
  backendReady = false;
  dispatchConnectionState(pollFailureCount >= 3 ? 'disconnected' : 'degraded');
  if (!document.hidden && now >= nextPollToastAt) {
    toastFn?.(`Polling degraded: ${err.message}`, 'error');
    nextPollToastAt = now + POLL_TOAST_COOLDOWN_MS;
  }
}

function recordPollingRecovered() {
  if (pollFailureCount > 0) {
    dispatchConnectionState('connected');
  }
  pollFailureCount = 0;
  nextPollAttemptAt = 0;
  nextPollToastAt = 0;
}

function dispatchConnectionState(state) {
  window.dispatchEvent(new CustomEvent('forge:connection-state', { detail: { state } }));
}

function applyUiConfig(ui) {
  setThreadMetaConfig(ui);
  updateProviderAndModelSelects(ui);
  maybeRefreshAuthStatus();
}

function isChatActive() {
  return container?.classList.contains('active') && !container.hidden;
}

function mapServerMessage(m, assistantName) {
  const receivedAt = Number(m.receivedAt) || 0;
  return {
    id: m.id,
    receivedAt,
    role: m.user === 'assistant' || m.userName === assistantName ? 'assistant' : 'user',
    text: m.text,
    ts: fmtTs(receivedAt),
    meta: parseMeta(m.llm_metadata),
    promptContext: parsePromptContext(m.prompt_context),
  };
}

function mergeMessages(incoming) {
  if (!incoming.length) return;
  const current = getMessages();
  const byId = new Map(current.filter(m => m.id).map(m => [m.id, m]));
  let changed = false;
  for (const msg of incoming) {
    lastReceivedAt = Math.max(lastReceivedAt, msg.receivedAt || 0);
    if (msg.id && byId.has(msg.id)) {
      const existing = byId.get(msg.id);
      if (!messagesEqual(existing, msg)) {
        Object.assign(existing, msg);
        changed = true;
      }
      continue;
    }
    const optimisticIdx = current.findIndex(m =>
      m.optimistic &&
      m.role === msg.role &&
      m.text === msg.text &&
      Math.abs((m.receivedAt || 0) - (msg.receivedAt || 0)) < 30000
    );
    if (optimisticIdx >= 0) current.splice(optimisticIdx, 1, msg);
    else current.push(msg);
    changed = true;
  }
  if (!changed) return;
  current.sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
  renderAllMessages();
  scrollToBottom();
}

function messagesEqual(a, b) {
  return a.id === b.id
    && a.receivedAt === b.receivedAt
    && a.role === b.role
    && a.text === b.text
    && a.ts === b.ts
    && JSON.stringify(a.meta || null) === JSON.stringify(b.meta || null)
    && JSON.stringify(a.promptContext || null) === JSON.stringify(b.promptContext || null);
}

function buildComposer() {
  const wrapper = el('div', 'composer');
  const inner = el('div', 'composer-inner');
  const box = el('div', 'composer-box');

  const controls = el('div', 'composer-controls');
  const providerLabel = el('label', 'composer-control-label');
  providerLabel.textContent = 'Provider';
  composerProviderSelect = document.createElement('select');
  composerProviderSelect.className = 'composer-provider-select';
  composerProviderSelect.setAttribute('aria-label', 'Chat provider');
  providerLabel.appendChild(composerProviderSelect);

  const modelLabel = el('label', 'composer-model-label');
  modelLabel.textContent = 'Model';
  composerModelSelect = document.createElement('select');
  composerModelSelect.className = 'composer-model-select';
  composerModelSelect.setAttribute('aria-label', 'Chat model');
  modelLabel.appendChild(composerModelSelect);
  controls.append(providerLabel, modelLabel);
  inner.appendChild(controls);

  composerTextarea = document.createElement('textarea');
  composerTextarea.className = 'composer-input';
  composerTextarea.placeholder = 'Write a message…';
  composerTextarea.rows = 1;
  composerTextarea.setAttribute('aria-label', 'Message');
  composerTextarea.setAttribute('aria-describedby', 'composer-status');

  const sendBtn = el('button', 'composer-send idle');
  composerSendBtn = sendBtn;
  sendBtn.type = 'button';
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.innerHTML = 'Send <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  box.append(composerTextarea, sendBtn);
  inner.appendChild(box);

  const hints = el('div', 'composer-hints');
  hints.innerHTML = '<span class="mono">⏎ send</span><span class="mono">⇧⏎ newline</span><div style="flex:1"></div><span class="mono" style="color:var(--ink-faint)">/remember · /forget</span>';
  inner.appendChild(hints);
  composerStatus = el('div', 'composer-status');
  composerStatus.id = 'composer-status';
  composerStatus.setAttribute('role', 'status');
  composerStatus.setAttribute('aria-live', 'polite');
  inner.appendChild(composerStatus);
  wrapper.appendChild(inner);

  const updateBtn = () => updateComposerState();
  composerTextarea.addEventListener('input', () => {
    composerTextarea.style.height = 'auto';
    composerTextarea.style.height = Math.min(composerTextarea.scrollHeight, 200) + 'px';
    updateBtn();
  });
  composerTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  sendBtn.addEventListener('click', doSend);
  composerProviderSelect.addEventListener('change', () => {
    updateModelSelectForProvider();
    updateComposerState();
    refreshAuthStatus(false);
  });
  composerModelSelect.addEventListener('change', updateComposerState);
  wrapper._updateBtn = updateBtn;
  updateBtn();
  return wrapper;
}

let latestUi = {};

function updateProviderAndModelSelects(ui = {}) {
  latestUi = ui;
  if (!composerProviderSelect || !composerModelSelect) return;
  const previousProvider = composerProviderSelect.value;
  const providers = normalizedProviders(ui);
  const selectedProvider = ui.llm?.provider || providers[0]?.provider || 'claude-cli';

  composerProviderSelect.innerHTML = '';
  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = provider.provider;
    option.textContent = providerLabel(provider);
    composerProviderSelect.appendChild(option);
  }
  if (!providers.length) {
    const option = document.createElement('option');
    option.value = selectedProvider;
    option.textContent = selectedProvider;
    composerProviderSelect.appendChild(option);
  }

  const validPrevious = [...composerProviderSelect.options].some(option => option.value === previousProvider);
  composerProviderSelect.value = validPrevious ? previousProvider : selectedProvider;
  composerProviderSelect.disabled = !providers.length || !backendReady;
  updateModelSelectForProvider();
  updateComposerState();
}

function updateModelSelectForProvider() {
  if (!composerModelSelect) return;
  const previous = composerModelSelect.value;
  const ui = latestUi || {};
  const provider = composerProviderSelect?.value || ui.llm?.provider || 'claude-cli';
  const providerInfo = normalizedProviders(ui).find(p => p.provider === provider);
  const catalog = Array.isArray((ui.llmModelCatalog || {})[provider]) ? (ui.llmModelCatalog || {})[provider] : [];
  const candidates = [
    { id: providerInfo?.effectiveModel || ui.llm?.model, label: 'Active', family: 'configured' },
    { id: providerInfo?.defaultModel, label: 'Provider default', family: 'configured' },
    ...catalog,
  ].filter(item => item.id && modelFitsProvider(provider, item.id));

  const seen = new Set();
  const unique = candidates.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  composerModelSelect.innerHTML = '';
  for (const item of unique) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label && item.label !== item.id ? `${item.label}: ${item.id}` : item.id;
    composerModelSelect.appendChild(option);
  }
  if (!unique.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No compatible models reported';
    composerModelSelect.appendChild(option);
  }
  composerModelSelect.disabled = !backendReady || unique.length <= 1;
  const fallback = unique[0]?.id || '';
  composerModelSelect.value = unique.some(item => item.id === previous) ? previous : fallback;
  updateComposerState();
}

function normalizedProviders(ui = {}) {
  const providers = ui.llmProviderRequirements?.providers;
  if (Array.isArray(providers) && providers.length) return providers.filter(p => p?.provider);
  return ui.llm?.provider ? [{
    provider: ui.llm.provider,
    label: ui.llm.provider,
    auth: 'unknown',
    effectiveModel: ui.llm.model,
    defaultModel: ui.llm.model,
    modelCompatible: true,
  }] : [];
}

function providerLabel(provider) {
  const status = providerAuthStatus(provider.provider);
  const statusText = status && status !== 'authenticated' ? ` (${status.replace(/_/g, ' ')})` : '';
  return `${provider.label || provider.provider}${statusText}`;
}

function providerAuthStatus(provider) {
  if (!authStatusResolved || authStatusLoading) return 'checking';
  const entry = authState?.providers?.find(p => p.provider === provider);
  return entry?.status || null;
}

function selectedProviderBlocked() {
  const status = providerAuthStatus(composerProviderSelect?.value);
  return !authStatusResolved
    || authStatusLoading
    || !status
    || status === 'checking'
    || status === 'not_authenticated'
    || status === 'error';
}

function updateComposerState() {
  if (!composerSendBtn || !composerTextarea) return;
  const hasText = Boolean(composerTextarea.value.trim());
  const blocked = selectedProviderBlocked();
  const canSend = hasText && !getThinking() && backendReady && authStatusResolved && !authStatusLoading && !blocked && !pollingSuspended;
  composerSendBtn.disabled = !canSend;
  composerSendBtn.setAttribute('aria-disabled', String(!canSend));
  composerSendBtn.className = `composer-send ${canSend ? 'ready' : 'idle'}`;
  if (composerStatus) {
    composerStatus.textContent = composerStatusText(blocked);
  }
}

function composerStatusText(blocked) {
  if (pollingSuspended) return 'Authentication required. Sign in to resume chat.';
  if (!backendReady) return 'Chat backend is not ready.';
  if (!authStatusResolved || authStatusLoading) return 'Checking provider authentication...';
  if (blocked) return 'Selected provider needs authentication in Settings.';
  const provider = composerProviderSelect?.value;
  const model = composerModelSelect?.value;
  if (!provider) return 'No provider available.';
  if (!model) return 'No compatible model available for the selected provider.';
  return `${provider} ready with ${model}`;
}

async function maybeRefreshAuthStatus() {
  if (authStatusLoading) return;
  if (Date.now() - lastAuthStatusAt < AUTH_STATUS_TTL_MS) return;
  refreshAuthStatus(false);
}

async function refreshAuthStatus(force) {
  if (!apiCall || authStatusLoading || (!force && Date.now() - lastAuthStatusAt < AUTH_STATUS_TTL_MS)) return;
  authStatusLoading = true;
  lastAuthStatusAt = Date.now();
  updateComposerState();
  try {
    authState = await apiCall('/api/auth/status');
  } catch (err) {
    authState = null;
    if (err?.isAuth) {
      pollingSuspended = true;
      stopPolling();
    }
  } finally {
    authStatusResolved = true;
    authStatusLoading = false;
    updateProviderAndModelSelects(latestUi);
  }
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

async function doSend() {
  const text = composerTextarea.value.trim();
  updateComposerState();
  if (!text || getThinking() || composerSendBtn?.disabled) return;
  const msgs = getMessages();

  msgs.push({ id: `local:user:${Date.now()}`, role: 'user', text, ts: nowTs(), receivedAt: Date.now(), optimistic: true });
  composerTextarea.value = ''; composerTextarea.style.height = 'auto';
  setThinking(true);
  container.querySelector('.composer')._updateBtn();
  renderAllMessages();
  scrollToBottom();

  try {
    const provider = composerProviderSelect?.value || undefined;
    const model = composerModelSelect?.value || undefined;
    const data = await apiCall('/api/messages', {
      method: 'POST', body: JSON.stringify({ content: text, provider, model }),
    });
    if (data.agentName) setAssistantName(data.agentName);
    setThinking(false);
    const idx = msgs.length;
    const assistantId = `local:assistant:${Date.now()}`;
    msgs.push({
      id: assistantId,
      role: 'assistant', text: data.reply, ts: nowTs(), receivedAt: Date.now(), optimistic: true,
      meta: data.model && data.usage ? { provider: data.provider, model: data.model, input: data.usage.input, output: data.usage.output } : null,
      promptContext: parsePromptContext(data.prompt_context),
    });
    renderAllMessages();
    selectMessage(assistantId);
    pollMessages();
  } catch (err) {
    setThinking(false);
    renderAllMessages();
    toastFn('Error: ' + err.message, 'error');
  }

  container.querySelector('.composer')._updateBtn();
  scrollToBottom();
  composerTextarea.focus();
}

function nowTs() { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
