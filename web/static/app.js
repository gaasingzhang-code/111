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
const exportBtn = $('#export-btn');

// ── Init ───────────────────────────────────
function init() {
  addMessage('agent', '你好，我是 ReqBot — AI 需求分析 Agent。\n\n请描述你想做的产品，我会引导你完成结构化访谈。\n\n例如：「做一个跨境电商的库存管理后台」或「做一个面向健身爱好者的打卡社区小程序」');
  renderPhaseGuide(1);
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
        } catch (e) { /* ignore */ }
      }
    }
  }
}

// ── Start project ──────────────────────────
async function startProject(project) {
  state.isStreaming = true;
  disableInput(true);

  addMessage('agent', '');

  for await (const evt of streamSSE('/api/start', { project })) {
    handleEvent(evt, project);
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
    inputEl.placeholder = 'Agent 正在处理，请稍候...';
    await advanceAndStream();
    inputEl.placeholder = '输入你的回答...';
  } else {
    addMessage('agent', '');
    for await (const evt of streamSSE(`/api/chat/${state.sessionId}`, { message: msg })) {
      handleEvent(evt);
    }
  }

  state.isStreaming = false;
  disableInput(false);
}

// ── Confirm phase ──────────────────────────
async function confirmPhase() {
  if (!state.readyForConfirm || state.isStreaming) return;
  state.readyForConfirm = false;
  showConfirmButton(false);
  state.isStreaming = true;
  disableInput(true);
  inputEl.placeholder = 'Agent 正在处理，请稍候...';
  await advanceAndStream();
  inputEl.placeholder = '输入你的回答...';
  state.isStreaming = false;
  disableInput(false);
}

async function advanceAndStream() {
  addMessage('system', 'Phase ' + state.currentPhase + ' 已确认，进入下一阶段...');
  for await (const evt of streamSSE(`/api/chat/${state.sessionId}`, { message: '确认' })) {
    handleEvent(evt);
  }
}

// ── Unified event handler ──────────────────
function handleEvent(evt, projectName) {
  if (evt.type === 'session') {
    state.sessionId = evt.session_id;
  } else if (evt.type === 'phase_start') {
    state.currentPhase = evt.phase;
    updatePhaseUI(evt.phase);
    if (projectName) chatHeaderTitle.textContent = projectName;
    phaseBadge.textContent = evt.name;
    addMessage('system', 'Phase ' + evt.phase + ': ' + evt.name);
    addMessage('agent', '');
    renderPhaseGuide(evt.phase);
  } else if (evt.type === 'token') {
    appendToLastMessage(evt.text);
  } else if (evt.type === 'token_done') {
    renderLastMessageMarkdown();
  } else if (evt.type === 'round') {
    updateRoundDots(evt.round);
  } else if (evt.type === 'retry') {
    addMessage('system', evt.text);
  } else if (evt.type === 'ready_for_confirm') {
    state.readyForConfirm = true;
    showConfirmButton(true);
    tryLoadArtifacts();
  } else if (evt.type === 'done') {
    addMessage('system', '所有阶段完成! PRD 和追溯矩阵已生成。');
    tryLoadArtifacts();
  } else if (evt.type === 'error') {
    addMessage('system', '错误: ' + evt.text);
  }
}

// ── UI: Messages ───────────────────────────
function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  if (role === 'agent') el.setAttribute('data-raw', 'true');
  el.textContent = content;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendToLastMessage(text) {
  const msgs = messagesEl.querySelectorAll('.message.agent');
  const last = msgs[msgs.length - 1];
  if (last) { last.textContent += text; scrollToBottom(); }
}

function renderLastMessageMarkdown() {
  const msgs = messagesEl.querySelectorAll('.message.agent[data-raw]');
  const last = msgs[msgs.length - 1];
  if (last && typeof marked !== 'undefined') {
    last.innerHTML = marked.parse(last.textContent);
    last.removeAttribute('data-raw');
  }
}

// ── UI: Confirm button ─────────────────────
function showConfirmButton(show) {
  if (show) {
    confirmBtn.style.display = 'block';
    inputEl.placeholder = '输入回复，或按 Ctrl+Enter 确认进入下一阶段';
    sendBtn.textContent = '回复';
  } else {
    confirmBtn.style.display = 'none';
    inputEl.placeholder = '输入你的回答...';
    sendBtn.textContent = '发送';
  }
}

function disableInput(disabled) {
  inputEl.disabled = disabled;
  sendBtn.disabled = disabled;
  confirmBtn.disabled = disabled;
}

// ── UI: Phase panel ────────────────────────
function updatePhaseUI(phase) {
  phaseItems.forEach((item, i) => {
    const p = i + 1;
    item.classList.remove('active', 'done');
    if (p === phase) item.classList.add('active');
    else if (p < phase) item.classList.add('done');
  });
  if (phase === 1) updateRoundDots(1);
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

// ── UI: Artifact panel ─────────────────────
async function tryLoadArtifacts() {
  if (!state.sessionId) return;

  try {
    const resp = await fetch(`/api/session/${state.sessionId}`);
    const data = await resp.json();

    if (data.has_prd && !state.artifacts.prd) {
      const prdResp = await fetch(`/api/export/${state.sessionId}/prd`);
      if (prdResp.ok) state.artifacts.prd = await prdResp.text();
    }
    if (data.has_review && !state.artifacts.review) {
      const reviewResp = await fetch(`/api/export/${state.sessionId}/trace`);
      if (reviewResp.ok) state.artifacts.review = await reviewResp.text();
    }

    // Only update panel when we have actual content
    if (state.artifacts.prd || state.artifacts.review) {
      if (state.artifacts.review) {
        renderArtifactTab('trace');
        switchArtifactTab('trace');
      } else if (state.artifacts.prd) {
        renderArtifactTab('prd');
        switchArtifactTab('prd');
      }
      // Show export button in toolbar
      if (state.artifacts.prd && exportBtn) {
        exportBtn.style.display = 'inline-block';
        exportBtn.href = `/api/export/${state.sessionId}/prd`;
      }
    }

    // Update download links
    downloadLinks.innerHTML = '';
    if (state.artifacts.prd) {
      downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/prd" download>下载 PRD (.md)</a>`;
    }
    if (state.artifacts.review) {
      downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/trace" download>下载 追溯矩阵 (.json)</a>`;
    }
  } catch (e) { /* ignore */ }
}

function renderPhaseGuide(phase) {
  // Don't overwrite artifact content once we have real artifacts
  if (state.artifacts.prd || state.artifacts.review) return;

  const guides = {
    1: `<div class="phase-guide">
      <h4>Phase 1 — 结构化访谈</h4>
      <p>4 轮访谈进行中：</p>
      <ol>
        <li><strong>背景收集</strong>：问题、用户、目标、约束</li>
        <li><strong>深入追问</strong>：量化模糊表述</li>
        <li><strong>缺口检测</strong>：发现遗漏信息</li>
        <li><strong>模糊澄清</strong>：列出解读供选择</li>
      </ol>
      <p class="guide-hint">左侧圆点显示当前进度</p>
    </div>`,
    2: `<div class="phase-guide">
      <h4>Phase 2 — 需求分析</h4>
      <p>Agent 正在自动执行：</p>
      <ul>
        <li>MoSCoW 优先级分类</li>
        <li>5 类边界用例枚举</li>
        <li>跨需求一致性检查</li>
      </ul>
      <p class="guide-hint">完成后此处将展示分析结果</p>
    </div>`,
    3: `<div class="phase-guide">
      <h4>Phase 3 — PRD 生成</h4>
      <p>正在按 12 章节模板生成完整 PRD...</p>
      <p class="guide-hint">生成完毕后自动展示，可下载 .md 文件</p>
    </div>`,
    4: `<div class="phase-guide">
      <h4>Phase 4 — 质量审查</h4>
      <p>正在审计：完整度 / 模糊表述 / 可度量性 / 追溯性</p>
      <p class="guide-hint">完成后点击「Traceability」查看审计报告</p>
    </div>`,
    5: `<div class="phase-guide">
      <h4>Phase 5 — 最终交付</h4>
      <p>正在精炼最终 PRD 并生成追溯矩阵...</p>
    </div>`,
  };

  artifactContent.innerHTML = guides[phase] || guides[1];
}

function renderArtifactTab(tab) {
  const content = tab === 'prd' ? state.artifacts.prd : state.artifacts.review;
  if (!content) {
    artifactContent.innerHTML = '<div class="empty-state">产物尚未生成</div>';
    return;
  }
  if (tab === 'prd' && typeof marked !== 'undefined') {
    artifactContent.innerHTML = marked.parse(content);
  } else if (tab === 'trace') {
    try {
      const json = JSON.parse(content);
      artifactContent.innerHTML = `<pre><code>${escapeHtml(JSON.stringify(json, null, 2))}</code></pre>`;
    } catch {
      artifactContent.innerHTML = `<div class="phase-guide">${escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
    }
  } else {
    artifactContent.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
  }
}

function switchArtifactTab(tab) {
  $$('.artifact-tab').forEach(t => t.classList.remove('active'));
  $(`.artifact-tab[data-tab="${tab}"]`)?.classList.add('active');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Event listeners ────────────────────────
sendBtn.addEventListener('click', sendMessage);
confirmBtn.addEventListener('click', confirmPhase);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Enter = confirm
      e.preventDefault();
      if (state.readyForConfirm) confirmPhase();
    } else if (!e.shiftKey) {
      e.preventDefault();
      if (state.readyForConfirm && state.currentPhase > 1 && inputEl.value.trim() === '') {
        confirmPhase();
      } else {
        sendMessage();
      }
    }
  }
});

$$('.artifact-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    renderArtifactTab(tab.dataset.tab);
    switchArtifactTab(tab.dataset.tab);
  });
});

// ── Start ──────────────────────────────────
init();
