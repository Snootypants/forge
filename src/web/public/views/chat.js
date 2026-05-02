import { renderAllMessages, renderInspector, renderThreadMeta, mkUser, mkAssistant, mkThinking, selectMessage, setMessages, getMessages, getThinking, setThinking, scrollToBottom, setMsgContainer, setToastFn as setRenderToast, setApiCall, setAssistantName, setThreadMetaConfig } from './chat-render.js';

let apiCall, toastFn;
let container, composerTextarea;
let chatReady = false;

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
function saveRails() { localStorage.setItem('forge_rails', JSON.stringify(rails)); }

export async function initChat(api, toast) {
  apiCall = api; toastFn = toast;
  setRenderToast(toast);
  setApiCall(api);
  container = document.getElementById('tab-chat');
  if (!chatReady) { buildLayout(); chatReady = true; }
  await loadMessages();
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

function buildLayout() {
  const page = el('div', 'chat-page');
  const scroll = el('div', 'chat-scroll');
  const cols = el('div', 'chat-columns');

  const leftRail = el('div', 'rail'); leftRail.id = 'rail-left';
  const leftInner = el('div', 'rail-inner'); leftInner.id = 'inspector-panel';
  leftRail.appendChild(leftInner);

  const rightRail = el('div', 'rail'); rightRail.id = 'rail-right';
  const rightInner = el('div', 'rail-inner'); rightInner.id = 'threadmeta-panel';
  rightRail.appendChild(rightInner);

  const center = el('div', 'paper-sheet chat-center');
  center.appendChild(el('div', 'thread-spine'));
  const mc = el('div'); mc.id = 'msg-container';
  setMsgContainer(mc);
  center.appendChild(mc);

  cols.append(leftRail, buildDivider('left'), center, buildDivider('right'), rightRail);
  scroll.appendChild(cols);
  page.appendChild(scroll);
  page.appendChild(buildComposer());
  container.appendChild(page);

  applyRailWidths();
  renderInspector();
  renderThreadMeta();
}

function buildDivider(side) {
  const div = el('div', 'rail-divider');
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
    d._grip.innerHTML = open ? '' : `<span class="grip-chevron">${d._side === 'left' ? '›' : '‹'}</span>`;
  });
}

function parseMeta(raw) {
  if (!raw) return null;
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { model: m.model, input: m.inputTokens || 0, output: m.outputTokens || 0 };
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
  const assistantName = data.agentName || 'forge';
  setAssistantName(assistantName);
  setThreadMetaConfig(data.ui || {});
  setMessages(data.messages.map(m => ({
    role: m.user === 'assistant' || m.userName === assistantName ? 'assistant' : 'user',
    text: m.text, ts: fmtTs(m.receivedAt), meta: parseMeta(m.llm_metadata),
    promptContext: parsePromptContext(m.prompt_context),
  })));
  renderAllMessages();
  scrollToBottom(container);
}

function buildComposer() {
  const wrapper = el('div', 'composer');
  const inner = el('div', 'composer-inner');
  const box = el('div', 'composer-box');

  composerTextarea = document.createElement('textarea');
  composerTextarea.className = 'composer-input';
  composerTextarea.placeholder = 'Write a message…';
  composerTextarea.rows = 1;

  const sendBtn = el('button', 'composer-send idle');
  sendBtn.innerHTML = 'Send <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  box.append(composerTextarea, sendBtn);
  inner.appendChild(box);

  const hints = el('div', 'composer-hints');
  hints.innerHTML = '<span class="mono">⏎ send</span><span class="mono">⇧⏎ newline</span><div style="flex:1"></div><span class="mono" style="color:var(--ink-faint)">/remember · /forget</span>';
  inner.appendChild(hints);
  wrapper.appendChild(inner);

  const updateBtn = () => {
    sendBtn.className = `composer-send ${composerTextarea.value.trim() && !getThinking() ? 'ready' : 'idle'}`;
  };
  composerTextarea.addEventListener('input', () => {
    composerTextarea.style.height = 'auto';
    composerTextarea.style.height = Math.min(composerTextarea.scrollHeight, 200) + 'px';
    updateBtn();
  });
  composerTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  sendBtn.addEventListener('click', doSend);
  wrapper._updateBtn = updateBtn;
  return wrapper;
}

async function doSend() {
  const text = composerTextarea.value.trim();
  if (!text || getThinking()) return;
  const msgs = getMessages();
  const mc = document.getElementById('msg-container');

  msgs.push({ role: 'user', text, ts: nowTs() });
  mc.appendChild(mkUser(msgs[msgs.length - 1]));
  composerTextarea.value = ''; composerTextarea.style.height = 'auto';
  setThinking(true);
  container.querySelector('.composer')._updateBtn();

  const thinkEl = mkThinking();
  mc.appendChild(thinkEl);
  scrollToBottom(container);

  try {
    const data = await apiCall('/api/messages', {
      method: 'POST', body: JSON.stringify({ content: text }),
    });
    if (data.agentName) setAssistantName(data.agentName);
    thinkEl.remove();
    const idx = msgs.length;
    msgs.push({
      role: 'assistant', text: data.reply, ts: nowTs(),
      meta: data.model && data.usage ? { model: data.model, input: data.usage.input, output: data.usage.output } : null,
      promptContext: parsePromptContext(data.prompt_context),
    });
    mc.appendChild(mkAssistant(msgs[idx], idx, false));
    selectMessage(idx);
    renderThreadMeta();
  } catch (err) {
    thinkEl.remove();
    toastFn('Error: ' + err.message, 'error');
  }

  setThinking(false);
  container.querySelector('.composer')._updateBtn();
  scrollToBottom(container);
  composerTextarea.focus();
}

function nowTs() { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
