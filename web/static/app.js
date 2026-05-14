// ReqBot Web — Frontend Logic

// ── Minimal Markdown renderer (zero dependencies) ──
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    // Escape HTML first
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Table rows
    .replace(/^\|(.+)\|$/gm, (line) => {
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      if (/^[-| :]+$/.test(line.replace(/\|/g, ''))) return ''; // separator row
      const isHeader = cells.length > 0 && !line.includes('---');
      const tag = isHeader ? 'th' : 'td';
      return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    })
    // Wrap adjacent <tr>s in <table>
    .replace(/(<tr>[\s\S]*?<\/tr>)+/g, '<table>$&</table>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)+/g, (m) => m.includes('<table>') ? m : '<ul>' + m + '</ul>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Paragraphs: double newlines
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}

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

  try {
    for await (const evt of streamSSE('/api/start', { project })) {
      handleEvent(evt, project);
    }
  } catch (e) {
    addMessage('system', '连接失败: ' + e.message + '。请刷新页面重试。');
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

  try {
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
  } catch (e) {
    addMessage('system', '请求失败: ' + e.message + '。请重试。');
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
  try {
    for await (const evt of streamSSE(`/api/chat/${state.sessionId}`, { message: '确认' })) {
      handleEvent(evt);
    }
  } catch (e) {
    addMessage('system', '阶段推进失败: ' + e.message + '。请重试确认。');
    state.readyForConfirm = true;
    showConfirmButton(true);
    throw e;
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
  if (last) {
    last.innerHTML = renderMarkdown(last.textContent);
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
    console.log('tryLoadArtifacts:', data);

    // Update download links FIRST (always, even if content preview fails)
    let hasNewArtifact = false;
    downloadLinks.innerHTML = '';

    if (data.has_prd) {
      if (!state.artifacts.prd) {
        try {
          const prdResp = await fetch(`/api/export/${state.sessionId}/prd`);
          if (prdResp.ok) {
            state.artifacts.prd = await prdResp.text();
            hasNewArtifact = true;
          }
        } catch (e) { console.log('PRD fetch failed:', e); }
      }
      if (state.artifacts.prd) {
        downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/prd" download>下载 PRD (.md)</a>`;
      } else {
        downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/prd" download>下载 PRD (.md)</a>`;
      }
    }

    if (data.has_review) {
      if (!state.artifacts.review) {
        try {
          const reviewResp = await fetch(`/api/export/${state.sessionId}/trace`);
          if (reviewResp.ok) {
            state.artifacts.review = await reviewResp.text();
            hasNewArtifact = true;
          }
        } catch (e) { console.log('Review fetch failed:', e); }
      }
      if (state.artifacts.review) {
        downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/trace" download>下载 追溯矩阵 (.json)</a>`;
      } else {
        downloadLinks.innerHTML += `<a class="download-btn" href="/api/export/${state.sessionId}/trace" download>下载 追溯矩阵 (.json)</a>`;
      }
    }

    // Show artifact content if newly loaded
    if (hasNewArtifact && (state.artifacts.prd || state.artifacts.review)) {
      if (state.artifacts.review) {
        renderArtifactContentTab('trace');
        switchArtifactTab('trace');
      } else {
        renderArtifactContentTab('prd');
        switchArtifactTab('prd');
      }
    }
  } catch (e) {
    console.log('tryLoadArtifacts error:', e);
  }
}

function renderPhaseGuide(phase) {
  // Always show guide in right panel — don't return early for artifacts
  // (artifact tab switching is handled separately)

  const phaseInfo = {
    1: { title: 'Phase 1 — 结构化访谈', desc: '4 轮访谈：背景收集 → 深入追问 → 缺口检测 → 模糊澄清', status: '进行中...' },
    2: { title: 'Phase 2 — 需求分析', desc: '自动执行 MoSCoW 分类、边界用例枚举、一致性检查', status: '自动分析中...' },
    3: { title: 'Phase 3 — PRD 生成', desc: '按 12 章节模板生成完整 PRD', status: '正在生成 PRD...' },
    4: { title: 'Phase 4 — 质量审查', desc: '审计 PRD 完整度、模糊表述、可度量性、追溯性', status: '审计中...' },
    5: { title: 'Phase 5 — 最终交付', desc: '精炼最终 PRD 并生成追溯矩阵', status: '收尾中...' },
  };

  const info = phaseInfo[phase] || phaseInfo[1];
  const hasArtifact = state.artifacts.prd || state.artifacts.review;
  const statusText = hasArtifact ? '已完成' : info.status;

  artifactContent.innerHTML = `<div class="phase-guide">
    <h4>${info.title} <span class="guide-status">${statusText}</span></h4>
    <p>${info.desc}</p>
    ${phase === 1 ? '<p class="guide-hint">左侧圆点显示当前访谈进度</p>' : ''}
    ${hasArtifact ? '<p class="guide-hint">点击上方「PRD」或「Traceability」标签查看产物</p>' : ''}
    ${phase >= 3 && !hasArtifact ? '<p class="guide-hint">生成完毕后此处将自动展示 PRD 内容</p>' : ''}
  </div>`;
}

function renderArtifactContentTab(tab) {
  const content = tab === 'prd' ? state.artifacts.prd : state.artifacts.review;
  if (!content) {
    // Keep the phase guide visible, don't clear the panel
    return;
  }
  if (tab === 'prd') {
    artifactContent.innerHTML = renderMarkdown(content);
  } else {
    try {
      const json = JSON.parse(content);
      artifactContent.innerHTML = `<pre><code>${escapeHtml(JSON.stringify(json, null, 2))}</code></pre>`;
    } catch {
      artifactContent.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
    }
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
