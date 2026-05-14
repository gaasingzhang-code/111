// ReqBot Web — Frontend Logic

const state = {
  sessionId: null,
  currentPhase: 1,
  readyForConfirm: false,
  artifacts: { prd: null, review: null },
  isStreaming: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── DOM refs ──────────────────────────────
const messagesEl = $('#messages');
const inputEl = $('#msg-input');
const sendBtn = $('#send-btn');
const confirmBtn = $('#confirm-btn');
const phaseItems = $$('.phase-item');
const chatHeaderTitle = $('#chat-header-title');
const phaseBadge = $('#phase-badge');
const artifactContent = $('#artifact-content');
const downloadLinks = $('#download-links');

// ── Init ───────────────────────────────────
function init() {
  addMessage('agent', '你好，我是 ReqBot — AI 需求分析 Agent。\n\n请描述你想做的产品，我会引导你完成结构化访谈。\n\n例如：「做一个跨境电商的库存管理后台」或「做一个面向健身爱好者的打卡社区小程序」');
}

// ── API helpers ────────────────────────────
async function* streamSSE(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6));
        } catch (e) {
          // ignore parse errors on partial chunks
        }
      }
    }
  }
}

// ── Start project ──────────────────────────
async function startProject(project) {
  state.isStreaming = true;
  disableInput(true);

  addMessage('agent', '');

  let sessionReceived = false;
  for await (const evt of streamSSE('/api/start', { project })) {
    if (evt.type === 'session') {
      state.sessionId = evt.session_id;
      sessionReceived = true;
      continue;
    }
    if (evt.type === 'phase_start') {
      state.currentPhase = evt.phase;
      updatePhaseUI(evt.phase);
      chatHeaderTitle.textContent = project;
      phaseBadge.textContent = evt.name;
    } else if (evt.type === 'token') {
      appendToLastMessage(evt.text);
    } else if (evt.type === 'token_done') {
      renderLastMessageMarkdown();
    } else if (evt.type === 'round') {
      updateRoundDots(evt.round);
    } else if (evt.type === 'retry') {
      addMessage('system', evt.text);
    } else if (evt.type === 'round') {
      updateRoundDots(evt.round);
    } else if (evt.type === 'retry') {
      addMessage('system', evt.text);
    } else if (evt.type === 'ready_for_confirm') {
      state.readyForConfirm = true;
      showConfirmButton(true);
    } else if (evt.type === 'error') {
      addMessage('system', 'Error: ' + evt.text);
    }
  }

  state.isStreaming = false;
  disableInput(false);
}

// ── Send message ───────────────────────────
async function sendMessage() {
  const msg = inputEl.value.trim();
  if (!msg || state.isStreaming) return;

  addMessage('user', msg);
  inputEl.value = '';
  state.isStreaming = true;
  disableInput(true);

  // If no session yet, start new project with this message
  if (!state.sessionId) {
    await startProject(msg);
    state.isStreaming = false;
    disableInput(false);
    return;
  }

  if (state.readyForConfirm && ['确认', 'confirm', 'ok', '继续'].includes(msg.toLowerCase())) {
    state.readyForConfirm = false;
    showConfirmButton(false);
    await advanceAndStream();
  } else {
    addMessage('agent', '');
    for await (const evt of streamSSE(`/api/chat/${state.sessionId}`, { message: msg })) {
      handleStreamEvent(evt);
    }
  }

  state.isStreaming = false;
  disableInput(false);
}

// ── Advance phase ─────────────────────────
async function advanceAndStream() {
  // Send confirm to chat endpoint which will trigger advance_phase
  addMessage('system', 'Phase ' + state.currentPhase + ' 已确认，进入下一阶段...');

  for await (const evt of streamSSE(`/api/chat/${state.sessionId}`, { message: '确认' })) {
    handleStreamEvent(evt);
  }
}

// ── Handle SSE events ─────────────────────
function handleStreamEvent(evt) {
  if (evt.type === 'phase_start') {
    state.currentPhase = evt.phase;
    updatePhaseUI(evt.phase);
    phaseBadge.textContent = evt.name;
    addMessage('system', 'Phase ' + evt.phase + ': ' + evt.name);
    addMessage('agent', '');
  } else if (evt.type === 'token') {
    appendToLastMessage(evt.text);
  } else if (evt.type === 'token_done') {
    renderLastMessageMarkdown();
  } else if (evt.type === 'ready_for_confirm') {
    state.readyForConfirm = true;
    showConfirmButton(true);
    updateArtifacts();
  } else if (evt.type === 'done') {
    addMessage('system', '所有阶段完成! PRD 和追溯矩阵已生成。');
    updateArtifacts();
  } else if (evt.type === 'error') {
    addMessage('system', 'Error: ' + evt.text);
  }
}

// ── Confirm button handler ────────────────
async function confirmPhase() {
  if (!state.readyForConfirm || state.isStreaming) return;
  state.readyForConfirm = false;
  showConfirmButton(false);
  state.isStreaming = true;
  disableInput(true);
  await advanceAndStream();
  state.isStreaming = false;
  disableInput(false);
}

// ── UI helpers ────────────────────────────
function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  if (role === 'agent') {
    el.setAttribute('data-raw', 'true');
  }
  el.textContent = content;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendToLastMessage(text) {
  const msgs = messagesEl.querySelectorAll('.message.agent');
  const last = msgs[msgs.length - 1];
  if (last) {
    last.textContent += text;
    scrollToBottom();
  }
}

function renderLastMessageMarkdown() {
  const msgs = messagesEl.querySelectorAll('.message.agent[data-raw]');
  const last = msgs[msgs.length - 1];
  if (last && typeof marked !== 'undefined') {
    last.innerHTML = marked.parse(last.textContent);
    last.removeAttribute('data-raw');
  }
}

function showConfirmButton(show) {
  confirmBtn.style.display = show ? 'inline-block' : 'none';
  sendBtn.textContent = show ? '输入回复' : '发送';
  if (show) {
    inputEl.placeholder = '回复 Agent 的问题，或输入"确认"继续...';
  } else {
    inputEl.placeholder = '输入你的回答...';
  }
}

function disableInput(disabled) {
  inputEl.disabled = disabled;
  sendBtn.disabled = disabled;
  confirmBtn.disabled = disabled;
}

function updatePhaseUI(phase) {
  phaseItems.forEach((item, i) => {
    const p = i + 1;
    item.classList.remove('active', 'done');
    if (p === phase) item.classList.add('active');
    else if (p < phase) item.classList.add('done');
  });
  // Reset round dots when entering Phase 1
  if (phase === 1) {
    updateRoundDots(1);
  }
}

function updateRoundDots(round) {
  for (let i = 1; i <= 4; i++) {
    const dot = document.querySelector(`.rd-${i}`);
    if (dot) {
      dot.classList.remove('active', 'done');
      if (i === round) dot.classList.add('active');
      else if (i < round) dot.classList.add('done');
    }
  }
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function updateArtifacts() {
  if (!state.sessionId) return;

  try {
    const resp = await fetch(`/api/session/${state.sessionId}`);
    const data = await resp.json();
    if (data.has_prd) {
      const prdResp = await fetch(`/api/export/${state.sessionId}/prd`);
      if (prdResp.ok) {
        state.artifacts.prd = await prdResp.text();
      }
    }
    if (data.has_review) {
      const reviewResp = await fetch(`/api/export/${state.sessionId}/trace`);
      if (reviewResp.ok) {
        state.artifacts.review = await reviewResp.text();
      }
    }
    renderArtifactTab('prd');
    downloadLinks.innerHTML = '';
    if (state.artifacts.prd) {
      downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/prd" download>Download PRD</a>`;
    }
    if (state.artifacts.review) {
      downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/trace" download>Download Traceability</a>`;
    }
  } catch (e) {
    // ignore
  }
}

function renderArtifactTab(tab) {
  $$('.artifact-tab').forEach(t => t.classList.remove('active'));
  $(`.artifact-tab[data-tab="${tab}"]`)?.classList.add('active');

  const content = tab === 'prd' ? state.artifacts.prd : state.artifacts.review;
  if (content && typeof marked !== 'undefined') {
    artifactContent.innerHTML = marked.parse(content);
  } else if (content) {
    // JSON pretty print
    try {
      const json = JSON.parse(content);
      artifactContent.innerHTML = `<pre><code>${JSON.stringify(json, null, 2)}</code></pre>`;
    } catch {
      artifactContent.innerHTML = `<pre><code>${content}</code></pre>`;
    }
  } else {
    artifactContent.innerHTML = '<div class="empty-state">完成对应阶段后自动展示</div>';
  }
}

// ── Event listeners ────────────────────────
sendBtn.addEventListener('click', sendMessage);
confirmBtn.addEventListener('click', confirmPhase);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (state.readyForConfirm && state.currentPhase > 1) {
      confirmPhase();
    } else {
      sendMessage();
    }
  }
});

$$('.artifact-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    renderArtifactTab(tab.dataset.tab);
  });
});

// ── Start ──────────────────────────────────
init();
