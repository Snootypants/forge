let messages = [];
let selectedMsgKey = null;
let thinking = false;
let msgContainer = null;
let toastFn = () => {};
let apiCall = null;
let assistantName = 'forge';
let threadMetaConfig = { contextWindowTokens: 80000 };
const traceOpenState = new Map();

export function setMsgContainer(el) { msgContainer = el; }
export function setMessages(m) { messages = m; }
export function getMessages() { return messages; }
export function getThinking() { return thinking; }
export function setThinking(v) { thinking = v; }
export function setSelectedMsgId(v) { selectedMsgKey = v === null || v === undefined ? null : messageKey(messages[v], v); }
export function setToastFn(fn) { toastFn = fn; }
export function setApiCall(fn) { apiCall = fn; }
export function setAssistantName(name) {
  assistantName = name || 'forge';
}
export function setThreadMetaConfig(config) {
  threadMetaConfig = {
    ...threadMetaConfig,
    ...config,
  };
}
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function roleClass(role) {
  return ['system', 'user', 'assistant', 'tool'].includes(role) ? role : 'unknown';
}
function stableDomId(...parts) {
  return parts
    .map(part => String(part ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item')
    .join('-');
}
function messageKey(msg, idx = 0) {
  return msg?.id || `local:${msg?.role || 'msg'}:${msg?.receivedAt || idx}:${idx}`;
}
function traceStateKey(msgKey, section) {
  return `${msgKey}:${section}`;
}
function traceOpen(msgKey, section, fallback = false) {
  const key = traceStateKey(msgKey, section);
  return traceOpenState.has(key) ? traceOpenState.get(key) : fallback;
}
function traceToggle(label, bodyId, open = false, count = '', stateKey = '') {
  return `<button class="trace-toggle" type="button" aria-expanded="${open}" aria-controls="${escAttr(bodyId)}" data-trace-key="${escAttr(stateKey)}">
    <span class="arrow${open ? ' open' : ''}" aria-hidden="true">›</span>
    <span class="smallcaps" style="font-size:10px">${esc(label)}</span>
    ${count !== '' ? `<span class="count">${esc(count)}</span>` : ''}
  </button>`;
}

function textToHtml(text) {
  if (!text) return '';
  const safe = esc(text);
  return safe.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

export function scrollToBottom(container) {
  const s = msgContainer?.closest?.('.chat-center') ||
    container?.querySelector?.('.chat-center') ||
    document.querySelector('.chat-center');
  if (s) requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
}

export function renderAllMessages() {
  if (!msgContainer) return;
  msgContainer.innerHTML = '';
  messages.forEach((m, i) => {
    msgContainer.appendChild(m.role === 'assistant' ? mkAssistant(m, i, i === 0) : mkUser(m));
  });
  if (thinking) {
    msgContainer.appendChild(mkThinking());
  }
  const lastA = messages.reduce((a, m, i) => m.role === 'assistant' ? i : a, -1);
  const selectedStillValid = selectedMsgKey !== null
    && messages.some((m, i) => m.role === 'assistant' && messageKey(m, i) === selectedMsgKey);
  if (!selectedStillValid && lastA >= 0) {
    selectMessage(messageKey(messages[lastA], lastA));
  } else {
    renderInspector();
  }
  renderThreadMeta();
}

export function mkAssistant(msg, idx, first) {
  const key = messageKey(msg, idx);
  const div = el('div', `msg-assistant${selectedMsgKey === key ? ' selected' : ''}`);
  div.dataset.idx = idx;
  div.dataset.msgKey = key;
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-pressed', String(selectedMsgKey === key));
  div.setAttribute('aria-label', `Inspect ${assistantName} reply`);
  if (!first) div.style.marginTop = '36px';
  div.addEventListener('click', () => selectMessage(key));
  div.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    selectMessage(key);
  });

  div.appendChild(el('div', 'node-dot'));
  const sender = el('div', 'sender smallcaps');
  sender.textContent = assistantName;
  div.appendChild(sender);

  const prose = el('div', 'prose');
  prose.innerHTML = textToHtml(msg.text);
  div.appendChild(prose);

  if (msg.meta) {
    const meta = el('div', 'meta-line');
    const sep = '<span style="color:var(--ink-faint)">·</span>';
    meta.innerHTML = [
      `<span class="mono">${esc(msg.meta.model)}</span>`, sep,
      `<span class="mono">${msg.meta.input}↓ ${msg.meta.output}↑ tok</span>`, sep,
      `<span class="mono">${esc(msg.ts)}</span>`,
      '<div style="flex:1"></div>',
    ].join('');
    const copyBtn = el('button', 'msg-action');
    copyBtn.textContent = 'copy';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(msg.text);
      toastFn('Copied', 'success');
    });
    meta.appendChild(copyBtn);
    div.appendChild(meta);
  }
  return div;
}

export function mkUser(msg) {
  const div = el('div', 'msg-user');
  div.appendChild(el('div', 'tick'));
  const wrap = el('div', 'bubble-wrap');
  const bubble = el('div', 'bubble');
  bubble.textContent = msg.text;
  const ts = el('div', 'bubble-ts');
  ts.textContent = msg.ts;
  bubble.appendChild(ts);
  wrap.appendChild(bubble);
  div.appendChild(wrap);
  return div;
}

export function mkThinking() {
  const div = el('div', 'thinking');
  div.appendChild(el('div', 'node-dot'));
  const sender = el('div', 'sender smallcaps');
  sender.textContent = assistantName;
  sender.style.color = 'var(--accent-ink)';
  sender.style.fontSize = '10px';
  sender.style.marginBottom = '6px';
  div.appendChild(sender);
  const dots = el('div');
  dots.style.cssText = 'display:flex;gap:5px;align-items:center;height:28px';
  for (let i = 0; i < 3; i++) {
    const d = el('span', 'forge-dot');
    d.style.animationDelay = i * 160 + 'ms';
    dots.appendChild(d);
  }
  div.appendChild(dots);
  return div;
}

export function selectMessage(keyOrIdx) {
  selectedMsgKey = typeof keyOrIdx === 'number'
    ? messageKey(messages[keyOrIdx], keyOrIdx)
    : keyOrIdx;
  document.querySelectorAll('.msg-assistant').forEach(e => {
    const selected = e.dataset.msgKey === selectedMsgKey;
    e.classList.toggle('selected', selected);
    e.setAttribute('aria-pressed', String(selected));
  });
  renderInspector();
}

function renderPromptSection(ctx, msgKey) {
  if (!ctx) {
    const id = stableDomId('trace-body', msgKey, 'prompt-unavailable');
    const stateKey = traceStateKey(msgKey, 'prompt-unavailable');
    const open = traceOpen(msgKey, 'prompt-unavailable', false);
    return `<section>
      ${traceToggle('Prompt trace', id, open, 'unavailable', stateKey)}
      <div class="trace-body" id="${id}" ${open ? '' : 'hidden'}>
        <div class="trace-unavailable">
          Prompt trace is unavailable. Debug prompt capture may be disabled, or this message was loaded from history without trace data.
        </div>
      </div>
    </section>`;
  }

  const msgCount = ctx.messages?.length || 0;
  let messagesHtml = '';
  if (ctx.messages && ctx.messages.length > 0) {
    messagesHtml = ctx.messages.map(m =>
      `<div class="prompt-msg">
        <div class="smallcaps prompt-role ${roleClass(m.role)}">${esc(m.role)}</div>
        <div class="prompt-content">${esc(m.content)}</div>
      </div>`
    ).join('');
  }

  const systemId = stableDomId('trace-body', msgKey, 'system');
  const messagesId = stableDomId('trace-body', msgKey, 'messages');
  const systemOpen = traceOpen(msgKey, 'system', false);
  const messagesOpen = traceOpen(msgKey, 'messages', false);
  return `<section>
      ${traceToggle('System prompt', systemId, systemOpen, '', traceStateKey(msgKey, 'system'))}
      <div class="trace-body" id="${systemId}" ${systemOpen ? '' : 'hidden'}>
        <div class="prompt-content">${esc(ctx.system || '')}</div>
      </div>
    </section>
    <section>
      ${traceToggle('Messages', messagesId, messagesOpen, msgCount, traceStateKey(msgKey, 'messages'))}
      <div class="trace-body" id="${messagesId}" ${messagesOpen ? '' : 'hidden'}>
        ${messagesHtml || '<div style="font-size:11px;color:var(--ink-faint);font-style:italic">No messages in context.</div>'}
      </div>
    </section>`;
}

export function renderInspector() {
  const c = document.getElementById('inspector-panel');
  if (!c) return;
  const selectedIdx = messages.findIndex((m, i) => messageKey(m, i) === selectedMsgKey);
  const msg = selectedIdx >= 0 ? messages[selectedIdx] : null;

  if (!msg || msg.role !== 'assistant') {
    c.innerHTML = `<div class="inspector-empty">
      <div class="smallcaps" style="margin-bottom:8px">Inspector</div>
      Click any ${esc(assistantName)} reply to see the metadata that produced it.</div>`;
    return;
  }

  const meta = msg.meta || { model: '—', input: 0, output: 0 };
  const msgKey = messageKey(msg, selectedIdx);
  const usageId = stableDomId('trace-body', msgKey, 'usage');
  const usageOpen = traceOpen(msgKey, 'usage', true);
  c.innerHTML = `<div class="inspector">
    <div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--accent)"></span>
        <div class="smallcaps">Inspector</div>
      </div>
      <div style="font-size:11.5px;color:var(--ink-mute);line-height:1.45">Metadata for this reply.</div>
    </div>
    <section>
      ${traceToggle('Usage', usageId, usageOpen, '', traceStateKey(msgKey, 'usage'))}
      <div class="trace-body" id="${usageId}" ${usageOpen ? '' : 'hidden'}>
        <div class="usage-grid">
          <span style="color:var(--ink-mute)">model</span>
          <span class="mono" style="color:var(--ink)">${esc(meta.model)}</span>
          <span style="color:var(--ink-mute)">provider</span>
          <span class="mono" style="color:var(--ink)">${esc(meta.provider || 'unknown')}</span>
          <span style="color:var(--ink-mute)">input</span>
          <span class="mono" style="color:var(--ink)">${meta.input.toLocaleString()} tok</span>
          <span style="color:var(--ink-mute)">output</span>
          <span class="mono" style="color:var(--ink)">${meta.output.toLocaleString()} tok</span>
        </div>
      </div>
    </section>
    ${renderPromptSection(msg.promptContext, msgKey)}
  </div>`;

  setupTraceToggles(c);
}

function setupTraceToggles(container) {
  container.querySelectorAll('.trace-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('aria-controls'));
      const arrow = btn.querySelector('.arrow');
      if (!body) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (btn.dataset.traceKey) traceOpenState.set(btn.dataset.traceKey, !open);
      btn.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
      arrow?.classList.toggle('open', !open);
    });
  });
}

export function renderThreadMeta() {
  const c = document.getElementById('threadmeta-panel');
  if (!c) return;
  const count = messages.length;
  const tokens = messages.reduce((a, m) => a + (m.meta?.input || 0) + (m.meta?.output || 0), 0);
  const contextWindowTokens = threadMetaConfig.contextWindowTokens || 80000;
  const pct = Math.min(100, (tokens / contextWindowTokens) * 100);
  const initial = assistantName.trim().slice(0, 1).toUpperCase() || 'F';

  if (c.dataset.ready !== 'true') {
    c.innerHTML = `<div class="thread-meta">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="rail-stat">
        <div class="smallcaps stat-label" style="font-size:9.5px">turns</div>
        <div class="stat-value" data-thread-turns></div>
      </div>
      <div class="rail-stat">
        <div class="smallcaps stat-label" style="font-size:9.5px">context</div>
        <div class="stat-value" data-thread-context></div>
      </div>
      <div class="context-meter"><div class="fill" data-thread-meter></div></div>
    </div>
    <div style="border-top:1px solid var(--rule);padding-top:14px">
      <div class="smallcaps" style="margin-bottom:8px">Agent</div>
      <div class="agent-row">
        <span class="initial" style="background:var(--accent-wash-strong);color:var(--accent-ink)" data-agent-initial></span>
        <span class="name" data-agent-name></span>
        <div style="flex:1;min-width:8px"></div>
        <span class="time">now</span>
      </div>
    </div>
    <div style="border-top:1px solid var(--rule);padding-top:14px">
      <div class="smallcaps" style="margin-bottom:8px">Identity</div>
      <div id="identity-files" style="display:flex;flex-direction:column;gap:6px"></div>
    </div>
  </div>`;

    c.dataset.ready = 'true';
  }

  c.querySelector('[data-thread-turns]').textContent = String(count);
  c.querySelector('[data-thread-context]').textContent = `${(tokens / 1000).toFixed(1)}k / ${(contextWindowTokens / 1000).toFixed(0)}k tok`;
  c.querySelector('[data-thread-meter]').style.width = `${pct}%`;
  c.querySelector('[data-agent-initial]').textContent = initial;
  c.querySelector('[data-agent-name]').textContent = assistantName;

  const identityFiles = c.querySelector('#identity-files');
  if (identityFiles && identityFiles.dataset.loaded !== 'true') {
    loadIdentityFiles();
  }
}

async function loadIdentityFiles() {
  const container = document.getElementById('identity-files');
  if (!container || !apiCall) return;
  try {
    const data = await apiCall('/api/identity');
    container.innerHTML = '';
    for (const file of data.files) {
      const row = document.createElement('div');
      row.className = 'identity-file';
      row.innerHTML = `<span class="file-name">${esc(file.name)}</span><button class="btn-edit" type="button">Edit</button>`;
      row.querySelector('.btn-edit').addEventListener('click', () => openEditor(file));
      container.appendChild(row);
    }
    container.dataset.loaded = 'true';
  } catch { /* identity endpoint may not exist yet */ }
}

function openEditor(file) {
  const panel = document.getElementById('threadmeta-panel');
  const existing = panel.querySelector('.identity-editor');
  if (existing) existing.remove();

  const editor = document.createElement('div');
  editor.className = 'identity-editor';
  const ta = document.createElement('textarea');
  ta.value = file.content;
  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary'; saveBtn.textContent = 'Save';
  btnRow.append(cancelBtn, saveBtn);
  editor.append(ta, btnRow);

  const filesContainer = document.getElementById('identity-files');
  filesContainer.parentNode.appendChild(editor);

  cancelBtn.addEventListener('click', () => editor.remove());
  saveBtn.addEventListener('click', async () => {
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await apiCall(`/api/identity/${encodeURIComponent(file.name)}`, {
        method: 'PUT', body: JSON.stringify({ content: ta.value }),
      });
      toastFn(`${file.name} saved`, 'success');
      file.content = ta.value;
      editor.remove();
    } catch (err) {
      toastFn(`Failed to save ${file.name}: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  });
}
