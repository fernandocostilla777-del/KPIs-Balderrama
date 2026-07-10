(function () {
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const btnSend = document.getElementById('btnSend');
  const btnClearChat = document.getElementById('btnClearChat');
  const aiStatusBadge = document.getElementById('aiStatusBadge');
  const suggestedPrompts = document.getElementById('suggestedPrompts');

  const STORAGE_KEY = 'balderrama-ai-chat-v2';
  const chartInstances = new Map();
  let messages = [];
  let isLoading = false;

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      messages = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(messages)) messages = [];
    } catch {
      messages = [];
    }
  }

  function saveHistory() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(/^### (.+)$/gm, '</div><h4 class="assistant-md-h4">$1</h4><div>');
    html = html.replace(/^## (.+)$/gm, '</div><h3 class="assistant-md-h3">$1</h3><div>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="assistant-quote">$1</blockquote>');

    html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm, (_m, header, body) => {
      const heads = header.split('|').map((c) => c.trim()).filter(Boolean);
      const rows = body.trim().split('\n').map((line) =>
        line.split('|').map((c) => c.trim()).filter(Boolean),
      );
      const thead = `<thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return `<div class="assistant-table-wrap"><table class="assistant-table">${thead}${tbody}</table></div>`;
    });

    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>\s*)+/gs, (block) => `<ul class="assistant-list">${block}</ul>`);
    html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n{2,}/g, '</p><p class="assistant-md-p">');
    html = html.replace(/\n/g, '<br/>');

    return `<div class="assistant-prose"><p class="assistant-md-p">${html}</p></div>`;
  }

  function renderKpiRow(block, msgIndex, blockIndex) {
    const cards = (block.items || []).map((item) => {
      const trend = item.trend != null
        ? `<span class="assistant-kpi-trend ${item.trendUp ? 'up' : 'down'}">${item.trendUp ? '↑' : '↓'} ${Math.abs(item.trend).toFixed(1)}%</span>`
        : '';
      return `
        <div class="assistant-kpi-card">
          <div class="assistant-kpi-card__icon"><span class="material-symbols-outlined">${item.icon || 'insights'}</span></div>
          <div class="assistant-kpi-card__body">
            <span class="assistant-kpi-card__label">${escapeHtml(item.label)}</span>
            <span class="assistant-kpi-card__value">${escapeHtml(item.value)}</span>
            ${item.sub ? `<span class="assistant-kpi-card__sub">${escapeHtml(item.sub)}</span>` : ''}
            ${trend}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="assistant-block assistant-block--kpis">
        ${block.title ? `<h4 class="assistant-block__title">${escapeHtml(block.title)}</h4>` : ''}
        <div class="assistant-kpi-grid">${cards}</div>
      </div>`;
  }

  function renderChart(block, msgIndex, blockIndex) {
    const id = `chart-${msgIndex}-${blockIndex}`;
    return `
      <div class="assistant-block assistant-block--chart">
        <h4 class="assistant-block__title">${escapeHtml(block.title || 'Gráfica')}</h4>
        <div class="assistant-chart-wrap">
          <canvas id="${id}" data-chart-type="${block.chartType || 'bar'}"></canvas>
        </div>
      </div>`;
  }

  function renderTable(block) {
    const heads = (block.headers || []).map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const rows = (block.rows || []).map((row) =>
      `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
    ).join('');
    return `
      <div class="assistant-block assistant-block--table">
        <h4 class="assistant-block__title">${escapeHtml(block.title || 'Tabla')}</h4>
        <div class="assistant-table-wrap">
          <table class="assistant-table"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>`;
  }

  function renderInsight(block) {
    const icon = block.variant === 'warning' ? 'warning' : block.variant === 'success' ? 'check_circle' : 'lightbulb';
    return `
      <div class="assistant-block assistant-block--insight assistant-insight--${block.variant || 'info'}">
        <span class="material-symbols-outlined assistant-insight__icon">${icon}</span>
        <div>
          <strong>${escapeHtml(block.title || 'Insight')}</strong>
          <p>${escapeHtml(block.text)}</p>
        </div>
      </div>`;
  }

  function renderBlocks(blocks, msgIndex) {
    if (!blocks?.length) return '';
    return `
      <div class="assistant-blocks">
        ${blocks.map((block, blockIndex) => {
          switch (block.type) {
            case 'kpi-row': return renderKpiRow(block, msgIndex, blockIndex);
            case 'chart': return renderChart(block, msgIndex, blockIndex);
            case 'table': return renderTable(block);
            case 'insight': return renderInsight(block);
            default: return '';
          }
        }).join('')}
      </div>`;
  }

  function destroyCharts() {
    for (const chart of chartInstances.values()) {
      try { chart.destroy(); } catch { /* ignore */ }
    }
    chartInstances.clear();
  }

  function initCharts() {
    if (typeof Chart === 'undefined') return;

    document.querySelectorAll('canvas[id^="chart-"]').forEach((canvas) => {
      const msgIndex = canvas.id.split('-')[1];
      const blockIndex = canvas.id.split('-')[2];
      const msg = messages[Number(msgIndex)];
      const block = msg?.blocks?.[Number(blockIndex)];
      if (!block || block.type !== 'chart') return;

      const existing = Chart.getChart(canvas);
      if (existing) existing.destroy();

      const isHorizontal = block.chartType === 'bar-h';
      const isDoughnut = block.chartType === 'doughnut';
      const isLine = block.chartType === 'line';

      const config = {
        type: isDoughnut ? 'doughnut' : isLine ? 'line' : 'bar',
        data: {
          labels: block.labels || [],
          datasets: (block.datasets || []).map((ds) => ({
            ...ds,
            borderWidth: isLine ? 2 : 0,
            borderRadius: isHorizontal || isDoughnut || isLine ? undefined : 8,
            maxBarThickness: 42,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: isHorizontal ? 'y' : 'x',
          plugins: {
            legend: {
              display: isDoughnut || isLine,
              position: 'bottom',
              labels: { boxWidth: 10, font: { size: 11, family: 'Inter' } },
            },
          },
          scales: isDoughnut ? {} : {
            x: {
              grid: { display: !isHorizontal, color: 'rgba(44,62,80,0.06)' },
              ticks: { font: { size: 11 }, maxRotation: 0 },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(44,62,80,0.06)' },
              ticks: { font: { size: 11 } },
            },
          },
        },
      };

      chartInstances.set(canvas.id, new Chart(canvas, config));
    });
  }

  function renderMessages() {
    destroyCharts();

    chatMessages.innerHTML = messages.map((msg, msgIndex) => {
      const isUser = msg.role === 'user';
      const tools = msg.toolsUsed?.length
        ? `<div class="assistant-tools">${msg.toolsUsed.map((t) => `<span class="assistant-tool-badge">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      const blocks = !isUser ? renderBlocks(msg.blocks, msgIndex) : '';
      const prose = isUser
        ? `<div class="assistant-msg__content assistant-msg__content--plain">${escapeHtml(msg.content).replace(/\n/g, '<br/>')}</div>`
        : `<div class="assistant-msg__content">${formatMarkdown(msg.content)}</div>`;

      return `
        <article class="assistant-msg ${isUser ? 'assistant-msg--user' : 'assistant-msg--assistant'}">
          <div class="assistant-msg__avatar">
            <span class="material-symbols-outlined">${isUser ? 'person' : 'smart_toy'}</span>
          </div>
          <div class="assistant-msg__body">
            ${blocks}
            ${prose}
            ${tools}
          </div>
        </article>`;
    }).join('');

    if (isLoading) {
      chatMessages.insertAdjacentHTML('beforeend', `
        <article class="assistant-msg assistant-msg--assistant assistant-msg--loading">
          <div class="assistant-msg__avatar"><span class="material-symbols-outlined">smart_toy</span></div>
          <div class="assistant-msg__body">
            <div class="assistant-typing"><span></span><span></span><span></span></div>
            <p class="assistant-msg__meta">Consultando datos y generando visualizaciones…</p>
          </div>
        </article>`);
    }

    requestAnimationFrame(() => {
      initCharts();
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    suggestedPrompts.style.display = messages.length ? 'none' : 'flex';
  }

  function setLoading(state) {
    isLoading = state;
    btnSend.disabled = state || !chatInput.value.trim();
    chatInput.disabled = state;
    renderMessages();
  }

  async function checkStatus() {
    try {
      const res = await fetch('/api/ai/status');
      const data = await res.json();
      if (!data.configured) {
        aiStatusBadge.textContent = 'Sin API key';
        aiStatusBadge.classList.add('assistant-status--warn');
        return false;
      }
      aiStatusBadge.textContent = `OpenAI · ${data.model}`;
      return true;
    } catch {
      aiStatusBadge.textContent = 'Sin conexión';
      aiStatusBadge.classList.add('assistant-status--warn');
      return false;
    }
  }

  async function sendMessage(text) {
    const content = String(text || '').trim();
    if (!content || isLoading) return;

    messages.push({ role: 'user', content });
    saveHistory();
    renderMessages();
    setLoading(true);

    try {
      const payload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);

      messages.push({
        role: 'assistant',
        content: data.reply || 'Sin respuesta.',
        blocks: data.blocks || [],
        toolsUsed: data.toolsUsed || [],
      });
      saveHistory();
    } catch (err) {
      messages.push({
        role: 'assistant',
        content: `No pude completar la consulta: ${err.message}`,
        blocks: [],
      });
      saveHistory();
    } finally {
      setLoading(false);
      chatInput.focus();
    }
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    btnSend.disabled = true;
    sendMessage(text);
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
    btnSend.disabled = isLoading || !chatInput.value.trim();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  btnClearChat.addEventListener('click', () => {
    messages = [];
    localStorage.removeItem(STORAGE_KEY);
    renderMessages();
    chatInput.focus();
  });

  suggestedPrompts.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prompt]');
    if (!btn) return;
    sendMessage(btn.dataset.prompt);
  });

  loadHistory();
  renderMessages();
  checkStatus();
  chatInput.focus();
})();
