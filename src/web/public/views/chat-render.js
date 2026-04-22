let messages = [];
let selectedMsgId = null;
let thinking = false;
let msgContainer = null;
let toastFn = () => {};
let apiCall = null;

export function setMsgContainer(el) { msgContainer = el; }
export function setMessages(m) { messages = m; }
export function getMessages() { return messages; }
export function getThinking() { return thinking; }
export function setThinking(v) { thinking = v; }
export function setSelectedMsgId(v) { selectedMsgId = v; }
export function setToastFn(fn) { toastFn = fn; }
export function setApiCall(fn) { apiCall = fn; }

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function textToHtml(text) {
  if (!text) return '';
  const safe = esc(text);
  return safe.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

export function scrollToBottom(container) {
  const s = container?.querySelector?.('.chat-scroll') || document.querySelector('.chat-scroll');
  if (s) requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
}

export function renderAllMessages() {
  if (!msgContainer) return;
  msgContainer.innerHTML = '';
  messages.forEach((m, i) => {
    msgContainer.appendChild(m.role === 'assistant' ? mkAssistant(m, i, i === 0) : mkUser(m));
  });
  const lastA = messages.reduce((a, m, i) => m.role === 'assistant' ? i : a, -1);
  if (lastA >= 0) selectMessage(lastA);
  renderThreadMeta();
}

export function mkAssistant(msg, idx, first) {
  const div = el('div', `msg-assistant${selectedMsgId === idx ? ' selected' : ''}`);
  div.dataset.idx = idx;
  if (!first) div.style.marginTop = '36px';
  div.addEventListener('click', () => selectMessage(idx));

  div.appendChild(el('div', 'node-dot'));
  const sender = el('div', 'sender smallcaps');
  sender.textContent = 'forge';
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
  sender.textContent = 'forge';
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

export function selectMessage(idx) {
  selectedMsgId = idx;
  document.querySelectorAll('.msg-assistant').forEach(e =>
    e.classList.toggle('selected', parseInt(e.dataset.idx) === idx));
  renderInspector();
}

function renderPromptSection(ctx) {
  if (!ctx) {
    return `<section>
      <button class="trace-toggle" data-open="false">
        <span class="arrow">›</span>
        <span class="smallcaps" style="font-size:10px">Prompt</span>
        <span class="count">—</span>
      </button>
      <div class="trace-body" style="display:none">
        <div style="font-size:11px;color:var(--ink-faint);font-style:italic">
          No prompt data saved for this message.
        </div>
      </div>
    </section>`;
  }

  const msgCount = ctx.messages?.length || 0;
  let messagesHtml = '';
  if (ctx.messages && ctx.messages.length > 0) {
    messagesHtml = ctx.messages.map(m =>
      `<div class="prompt-msg">
        <div class="smallcaps prompt-role ${m.role}">${esc(m.role)}</div>
        <div class="prompt-content">${esc(m.content)}</div>
      </div>`
    ).join('');
  }

  return `<section>
      <button class="trace-toggle" data-open="false">
        <span class="arrow">›</span>
        <span class="smallcaps" style="font-size:10px">System prompt</span>
      </button>
      <div class="trace-body" style="display:none">
        <div class="prompt-content">${esc(ctx.system || '')}</div>
      </div>
    </section>
    <section>
      <button class="trace-toggle" data-open="false">
        <span class="arrow">›</span>
        <span class="smallcaps" style="font-size:10px">Messages</span>
        <span class="count">${msgCount}</span>
      </button>
      <div class="trace-body" style="display:none">
        ${messagesHtml || '<div style="font-size:11px;color:var(--ink-faint);font-style:italic">No messages in context.</div>'}
      </div>
    </section>`;
}

export function renderInspector() {
  const c = document.getElementById('inspector-panel');
  if (!c) return;
  const msg = selectedMsgId !== null ? messages[selectedMsgId] : null;

  if (!msg || msg.role !== 'assistant') {
    c.innerHTML = `<div class="inspector-empty">
      <div class="smallcaps" style="margin-bottom:8px">Inspector</div>
      Click any forge reply to see the metadata that produced it.</div>`;
    return;
  }

  const meta = msg.meta || { model: '—', input: 0, output: 0 };
  c.innerHTML = `<div class="inspector">
    <div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--accent)"></span>
        <div class="smallcaps">Inspector</div>
      </div>
      <div style="font-size:11.5px;color:var(--ink-mute);line-height:1.45">Metadata for this reply.</div>
    </div>
    <section>
      <button class="trace-toggle" data-open="true">
        <span class="arrow open">›</span>
        <span class="smallcaps" style="font-size:10px">Usage</span>
      </button>
      <div class="trace-body">
        <div class="usage-grid">
          <span style="color:var(--ink-mute)">model</span>
          <span class="mono" style="color:var(--ink)">${esc(meta.model)}</span>
          <span style="color:var(--ink-mute)">input</span>
          <span class="mono" style="color:var(--ink)">${meta.input.toLocaleString()} tok</span>
          <span style="color:var(--ink-mute)">output</span>
          <span class="mono" style="color:var(--ink)">${meta.output.toLocaleString()} tok</span>
        </div>
      </div>
    </section>
    ${renderPromptSection(msg.promptContext)}
  </div>`;

  c.querySelectorAll('.trace-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const arrow = btn.querySelector('.arrow');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      arrow.classList.toggle('open', !open);
    });
  });
}

export function renderThreadMeta() {
  const c = document.getElementById('threadmeta-panel');
  if (!c) return;
  const count = messages.length;
  const tokens = messages.reduce((a, m) => a + (m.meta?.input || 0) + (m.meta?.output || 0), 0);
  const pct = Math.min(100, (tokens / 80000) * 100);

  c.innerHTML = `<div class="thread-meta">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="rail-stat">
        <div class="smallcaps stat-label" style="font-size:9.5px">turns</div>
        <div class="stat-value">${count}</div>
      </div>
      <div class="rail-stat">
        <div class="smallcaps stat-label" style="font-size:9.5px">context</div>
        <div class="stat-value">${(tokens / 1000).toFixed(1)}k / 80k tok</div>
      </div>
      <div class="context-meter"><div class="fill" style="width:${pct}%"></div></div>
    </div>
    <div style="border-top:1px solid var(--rule);padding-top:14px">
      <div class="smallcaps" style="margin-bottom:8px">Agent</div>
      <div class="agent-row">
        <span class="initial" style="background:var(--accent-wash-strong);color:var(--accent-ink)">E</span>
        <span class="name">Ember</span>
        <div style="flex:1;min-width:8px"></div>
        <span class="time">now</span>
      </div>
    </div>
    <div style="border-top:1px solid var(--rule);padding-top:14px">
      <div class="smallcaps" style="margin-bottom:8px">Identity</div>
      <div id="identity-files" style="display:flex;flex-direction:column;gap:6px"></div>
    </div>
  </div>`;

  loadIdentityFiles();
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
      row.innerHTML = `<span class="file-name">${esc(file.name)}</span><button class="btn-edit">Edit</button>`;
      row.querySelector('.btn-edit').addEventListener('click', () => openEditor(file));
      container.appendChild(row);
    }
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
    await apiCall(`/api/identity/${file.name}`, {
      method: 'PUT', body: JSON.stringify({ content: ta.value }),
    });
    toastFn(`${file.name} saved`, 'success');
    file.content = ta.value;
    editor.remove();
  });
}
