window.AssistantChat = (function () {
  const STORAGE_KEY = 'balderrama-ai-chat-v2';
  const DEFAULT_WELCOME =
    'Soy tu asistente de BALDERRAMA.\n'
    + 'Razonaré con el lente de tu perfil y recordaré tus preferencias para enfocarme en lo que necesitas decidir.';
  let welcomeMessage = DEFAULT_WELCOME;
  let profileLabel = null;
  const chartInstances = new Map();
  const expandedKpis = new Set();
  const drilldownState = new Map();

  const CHART_COLORS = [
    '#2D5BFF', '#9B51E0', '#27AE60', '#f59e0b', '#E056FD',
    '#3498db', '#e74c3c', '#1abc9c', '#95a5a6', '#2C3E50',
  ];

  function buildWelcome(roleLabel) {
    if (!roleLabel) return DEFAULT_WELCOME;
    return (
      `Soy tu asistente para el perfil **${roleLabel}**.\n`
      + 'Uso el conocimiento de tu rol y la memoria de tus preferencias para responder enfocado a lo que necesitas decidir.'
    );
  }

  async function refreshProfileWelcome() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      const me = await res.json();
      profileLabel = me.roleLabel || me.role || null;
      welcomeMessage = buildWelcome(profileLabel);
      if (typeof window !== 'undefined' && window.__assistantApplyWelcome) {
        window.__assistantApplyWelcome(welcomeMessage);
      }
    } catch {
      /* opcional */
    }
  }
  function fmtUnits(n) {
    return new Intl.NumberFormat('es-MX').format(Math.round(n || 0));
  }

  function getDrilldownState(key) {
    if (!drilldownState.has(key)) {
      drilldownState.set(key, { fecha: '_all', sort: 'desc' });
    }
    return drilldownState.get(key);
  }

  function sortRetailItems(items, sort) {
    const sorted = [...(items || [])].sort((a, b) => (b.count || 0) - (a.count || 0));
    return sort === 'asc' ? sorted.reverse() : sorted;
  }

  function getRetailFilterItems(drilldown, state) {
    const fecha = state?.fecha || '_all';
    const sort = state?.sort || 'desc';
    const source = fecha === '_all'
      ? (drilldown.periodo || [])
      : (drilldown.byFecha?.[fecha] || []);
    return sortRetailItems(source, sort);
  }

  function buildRetailChartBlock(items) {
    return {
      chartType: 'bar-h',
      labels: items.map((i) => i.label),
      datasets: [{
        label: 'Unidades',
        data: items.map((i) => i.count),
        backgroundColor: CHART_COLORS,
      }],
    };
  }

  function renderRetailFilterTableRows(items) {
    if (!items.length) {
      return '<tr><td colspan="4">Sin ventas retail en la fecha seleccionada.</td></tr>';
    }
    return items.map((item, index) => `
      <tr>
        <td class="cell-num">${index + 1}</td>
        <td>${escapeHtml(item.label)}</td>
        <td class="cell-num"><strong>${fmtUnits(item.count)}</strong></td>
        <td class="cell-num">${items[0]?.count ? ((item.count / items.reduce((s, r) => s + r.count, 0)) * 100).toFixed(1) : 0}%</td>
      </tr>`).join('');
  }

  function renderRetailFilterBody(drilldown, key) {
    const state = getDrilldownState(key);
    const items = getRetailFilterItems(drilldown, state);
    const periodLabel = drilldown.fechaInicio && drilldown.fechaFin
      ? `${drilldown.fechaInicio} → ${drilldown.fechaFin}`
      : 'periodo consultado';
    const fechaOptions = (drilldown.fechas || []).map((f) =>
      `<option value="${escapeHtml(f.key)}"${state.fecha === f.key ? ' selected' : ''}>${escapeHtml(f.label)} (${fmtUnits(f.count)})</option>`,
    ).join('');

    return `
      <div class="assistant-kpi-drilldown__filters">
        <label class="assistant-kpi-drilldown__field">
          <span>Fecha</span>
          <select class="assistant-kpi-drilldown__select" data-drill-fecha="${key}">
            <option value="_all"${state.fecha === '_all' ? ' selected' : ''}>Todo el periodo (${escapeHtml(periodLabel)})</option>
            ${fechaOptions}
          </select>
        </label>
        <button type="button" class="assistant-kpi-drilldown__sort${state.sort === 'asc' ? ' is-asc' : ''}" data-drill-sort="${key}" title="Cambiar orden">
          <span class="material-symbols-outlined">${state.sort === 'desc' ? 'south' : 'north'}</span>
          ${state.sort === 'desc' ? 'Mayor a menor' : 'Menor a mayor'}
        </button>
      </div>
      <div class="assistant-table-wrap" data-drill-table="${key}">
        <table class="assistant-table assistant-table--ranked">
          <thead>
            <tr>
              <th>#</th>
              <th>Sucursal</th>
              <th class="cell-num">Unidades</th>
              <th class="cell-num">% del total</th>
            </tr>
          </thead>
          <tbody>${renderRetailFilterTableRows(items)}</tbody>
        </table>
      </div>
      <div class="assistant-chart-wrap assistant-chart-wrap--drilldown">
        <canvas id="drill-chart-${key}" data-drill-key="${key}" data-drill-retail="1"></canvas>
      </div>`;
  }

  const PROMPT_POOLS = {
    overview: [
      'Resumen ejecutivo del mes actual',
      '¿Cuáles son las alertas más críticas ahora?',
      'Compara ventas vs postventa este mes',
      '¿Cómo va el cumplimiento de metas retail?',
      'Top 5 hallazgos del tablero para dirección',
      '¿Qué área está más desviada del presupuesto?',
    ],
    sales: [
      '¿Cuántas unidades retail se vendieron este mes?',
      'Top vendedores retail vs flotilla',
      '¿Cómo va la penetración GMF sobre entregas SOFIA?',
      'Resumen de conversión de leads a compra del mes',
      '¿Qué canal trae más leads y cuál convierte mejor?',
      'Compara ventas del mes actual vs mes anterior',
      '¿Cuántas entregas SOFIA van sin previas de taller?',
      'Lista oportunidades con cita que aún no compran',
      '¿Cuántas unidades HIGH END (Suburban/Tahoe/Cheyenne/Traverse) se vendieron este mes?',
      '¿Cuál es el Precio de Venta GMMX / plan del Aveo con stock?',
    ],
    'post-sales': [
      'Resumen de órdenes abiertas críticas (+60 días)',
      '¿Cuántas órdenes de servicio se facturaron este mes?',
      'Backlog abierto de HyP vs Servicio',
      '¿Cuántas órdenes HyP externas (A,F,V,Z) están abiertas?',
      'Resumen de órdenes internas HyP (J,H,Ó,I,E)',
      '¿Qué inventario de refacciones está trabado (+90 días)?',
      'Top partes de mejor utilidad en refacciones',
      'Órdenes abiertas con refacciones cargadas sin facturar',
      'Productividad por asesor de taller del periodo',
    ],
    'lista-precios': [
      '¿Cuál es el Precio de Venta GMMX del Aveo LT Plus con stock?',
      'Compara planes GMF del Traverse con existencia',
      '¿Qué versiones tienen mejor precio final en Guía Administración?',
      'Resume la vigencia de la lista de precios publicada',
      '¿Qué hay en Bono Toma a Cuenta para Captiva?',
      'Ficha técnica y transmisión del Equinox EV',
    ],
    inventory: [
      '¿Cómo va inventario y plan piso?',
      'Antigüedad alta (+60 días) disponible',
      'Stock sin previas de taller',
      'Comparar inventario nuevos vs seminuevos',
      '¿Qué modelos concentran más interés de plan piso?',
    ],
    contabilidad: [
      'Utilidad bruta del mes por área',
      '¿Cómo van ingresos de refacciones 0481–0484?',
      'Resumen EEFF del mes actual',
      'Comparar gastos de operación vs mes anterior',
      'Margen de postventa vs ventas de unidades',
    ],
    forecast: [
      'Pronóstico de cierre del mes vs meta',
      '¿Qué falta para llegar a la meta retail?',
      'Tendencia de ventas de los últimos 3 meses',
      'Proyección YTD vs año anterior',
    ],
    seguimiento: [
      'Busca el historial 360 del cliente más reciente con compra',
      'Resumen de actividad comercial por vendedor este mes',
      'Clientes con cita programada sin compra',
      '¿Qué vendedor tiene mejor conversión lead → VIN?',
    ],
    admin: [
      '¿Qué roles tienen acceso a PostVenta?',
      'Resume el estado de alertas configuradas por perfil',
      '¿Qué módulos debería ver Gerencia Comercial?',
      '¿Qué ve el perfil Vendedor?',
      '¿Está vigente la lista de precios / planes Chevrolet publicada?',
    ],
    general: [
      'Resumen ejecutivo del mes',
      '¿Qué debo revisar primero hoy?',
      'Dame 3 insights accionables del negocio',
      'Explica la variación más relevante del periodo',
      '¿Dónde se está trabando la operación?',
      'Compara este mes contra el anterior en lo más importante',
      `¿Cómo cerramos ${'{mes}'} hasta ahora?`,
      'Lista riesgos y oportunidades de la semana',
    ],
  };

  const LAST_PROMPTS_KEY = 'balderrama-ai-prompts-last';

  function getPageId() {
    return String(document.body?.dataset?.page || 'overview').toLowerCase();
  }

  function monthLabel() {
    return new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  function resolvePromptTemplate(text) {
    return String(text || '').replace(/\{mes\}/gi, monthLabel());
  }

  function shuffleWithSeed(items, seed) {
    const arr = [...items];
    let s = seed >>> 0;
    for (let i = arr.length - 1; i > 0; i -= 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function pickQuickPrompts(count = 4, { forceNew = true } = {}) {
    const page = getPageId();
    const pool = [
      ...(PROMPT_POOLS[page] || []),
      ...(PROMPT_POOLS.general || []),
    ].map(resolvePromptTemplate);

    const unique = [...new Set(pool.filter(Boolean))];
    if (!unique.length) return [];

    let seed = (Date.now() ^ ((Math.random() * 1e9) | 0)) >>> 0;
    // Variación diaria + página para que no se sienta estático entre sesiones
    const dayKey = new Date().toISOString().slice(0, 10);
    seed ^= [...(`${dayKey}:${page}`)].reduce((a, c) => a + c.charCodeAt(0), 0);

    let picked = shuffleWithSeed(unique, seed).slice(0, Math.min(count, unique.length));

    if (forceNew) {
      try {
        const last = JSON.parse(sessionStorage.getItem(LAST_PROMPTS_KEY) || '[]');
        const same = last.length === picked.length && last.every((p, i) => p === picked[i]);
        if (same && unique.length > count) {
          picked = shuffleWithSeed(unique, seed + 7919).slice(0, count);
        }
        sessionStorage.setItem(LAST_PROMPTS_KEY, JSON.stringify(picked));
      } catch {
        /* ignore */
      }
    }

    return picked;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function downloadExportFile(url, filename) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `No se pudo descargar (${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'export.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
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

  function renderDrilldown(drilldown, msgIndex, blockIndex, kpiIndex) {
    if (!drilldown) return '';
    const key = `${msgIndex}-${blockIndex}-${kpiIndex}`;
    const isOpen = expandedKpis.has(key);

    if (drilldown.type === 'chart') {
      const canvasId = `drill-chart-${key}`;
      return `
        <div class="assistant-kpi-drilldown${isOpen ? ' assistant-kpi-drilldown--open' : ''}" data-drilldown-panel="${key}"${isOpen ? '' : ' hidden'}>
          <div class="assistant-kpi-drilldown__head">
            <strong>${escapeHtml(drilldown.title || 'Desglose')}</strong>
            <button type="button" class="assistant-kpi-drilldown__close" data-drilldown-close="${key}" aria-label="Cerrar desglose">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="assistant-chart-wrap assistant-chart-wrap--drilldown">
            <canvas id="${canvasId}" data-chart-type="${drilldown.chartType || 'bar'}" data-drill-key="${key}"></canvas>
          </div>
        </div>`;
    }

    if (drilldown.type === 'retail-filter') {
      return `
        <div class="assistant-kpi-drilldown assistant-kpi-drilldown--retail${isOpen ? ' assistant-kpi-drilldown--open' : ''}" data-drilldown-panel="${key}" data-drill-type="retail-filter"${isOpen ? '' : ' hidden'}>
          <div class="assistant-kpi-drilldown__head">
            <strong>${escapeHtml(drilldown.title || 'Retail por sucursal')}</strong>
            <button type="button" class="assistant-kpi-drilldown__close" data-drilldown-close="${key}" aria-label="Cerrar desglose">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div data-drill-body="${key}">
            ${isOpen ? renderRetailFilterBody(drilldown, key) : ''}
          </div>
        </div>`;
    }

    if (drilldown.type === 'table') {
      const heads = (drilldown.headers || []).map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const rows = (drilldown.rows || []).map((row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
      ).join('');
      return `
        <div class="assistant-kpi-drilldown${isOpen ? ' assistant-kpi-drilldown--open' : ''}" data-drilldown-panel="${key}"${isOpen ? '' : ' hidden'}>
          <div class="assistant-kpi-drilldown__head">
            <strong>${escapeHtml(drilldown.title || 'Desglose')}</strong>
            <button type="button" class="assistant-kpi-drilldown__close" data-drilldown-close="${key}" aria-label="Cerrar desglose">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="assistant-table-wrap">
            <table class="assistant-table"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>
          </div>
        </div>`;
    }

    return '';
  }

  function renderKpiRow(block, msgIndex, blockIndex) {
    const items = block.items || [];
    const cards = items.map((item, kpiIndex) => {
      const key = `${msgIndex}-${blockIndex}-${kpiIndex}`;
      const hasDrill = Boolean(item.drilldown);
      const isOpen = expandedKpis.has(key);
      const trend = item.trend != null
        ? `<span class="assistant-kpi-trend ${item.trendUp ? 'up' : 'down'}">${item.trendUp ? '↑' : '↓'} ${Math.abs(item.trend).toFixed(1)}%</span>`
        : '';
      const Tag = hasDrill ? 'button' : 'div';
      const attrs = hasDrill
        ? ` type="button" class="assistant-kpi-card assistant-kpi-card--interactive${isOpen ? ' assistant-kpi-card--active' : ''}" data-drilldown-key="${key}" aria-expanded="${isOpen ? 'true' : 'false'}"`
        : ' class="assistant-kpi-card"';

      return `
        <${Tag}${attrs}>
          <div class="assistant-kpi-card__icon"><span class="material-symbols-outlined">${item.icon || 'insights'}</span></div>
          <div class="assistant-kpi-card__body">
            <span class="assistant-kpi-card__label">${escapeHtml(item.label)}</span>
            <span class="assistant-kpi-card__value">${escapeHtml(item.value)}</span>
            ${item.sub ? `<span class="assistant-kpi-card__sub">${escapeHtml(item.sub)}</span>` : ''}
            ${trend}
            ${hasDrill ? '<span class="assistant-kpi-card__hint">Ver desglose</span>' : ''}
          </div>
        </${Tag}>`;
    }).join('');

    const drilldowns = items
      .map((item, kpiIndex) => (item.drilldown
        ? renderDrilldown(item.drilldown, msgIndex, blockIndex, kpiIndex)
        : ''))
      .join('');

    return `
      <div class="assistant-block assistant-block--kpis">
        ${block.title ? `<h4 class="assistant-block__title">${escapeHtml(block.title)}</h4>` : ''}
        <div class="assistant-kpi-grid">${cards}</div>
        ${drilldowns}
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

  function ensureChartJs() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function init(options = {}) {
    const root = options.root || document;
    const q = (sel) => root.querySelector(sel);

    const chatMessages = q('[data-ai="messages"]');
    const chatForm = q('[data-ai="form"]');
    const chatInput = q('[data-ai="input"]');
    const btnSend = q('[data-ai="send"]');
    const btnClearChat = q('[data-ai="clear"]');
    const aiStatusBadge = q('[data-ai="status"]');
    const suggestedPrompts = q('[data-ai="prompts"]');
    const vizPanel = q('[data-ai="viz"]');

    if (!chatMessages || !chatForm || !chatInput) return null;

    let messages = [];
    let isLoading = false;

    const isExpanded = () => Boolean(options.getExpanded?.());

    function findDrilldownBlock(key) {
      const parts = key.split('-').map(Number);
      const [msgIndex, blockIndex, kpiIndex] = parts;
      const msg = messages[msgIndex];
      const block = msg?.blocks?.[blockIndex];
      if (block?.type !== 'kpi-row') return null;
      return block.items?.[kpiIndex]?.drilldown || null;
    }

    function findDrilldownChart(key) {
      const drill = findDrilldownBlock(key);
      if (!drill) return null;
      if (drill.type === 'chart') return drill;
      if (drill.type === 'retail-filter') {
        const state = getDrilldownState(key);
        const items = getRetailFilterItems(drill, state);
        if (!items.length) return null;
        return buildRetailChartBlock(items);
      }
      return null;
    }

    function refreshRetailDrilldown(key) {
      const drill = findDrilldownBlock(key);
      if (!drill || drill.type !== 'retail-filter') return;

      const bodyHost = root.querySelector(`[data-drill-body="${key}"]`);
      if (bodyHost) {
        bodyHost.innerHTML = renderRetailFilterBody(drill, key);
      }

      const canvas = document.getElementById(`drill-chart-${key}`);
      if (canvas && typeof Chart !== 'undefined') {
        const block = findDrilldownChart(key);
        if (block) {
          const existing = Chart.getChart(canvas);
          if (existing) existing.destroy();
          const isHorizontal = block.chartType === 'bar-h';
          chartInstances.set(canvas.id, new Chart(canvas, {
            type: 'bar',
            data: {
              labels: block.labels || [],
              datasets: (block.datasets || []).map((ds) => ({
                ...ds,
                borderRadius: 8,
                maxBarThickness: isExpanded() ? 56 : 42,
              })),
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: isHorizontal ? 'y' : 'x',
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { display: !isHorizontal, color: 'rgba(44,62,80,0.06)' }, ticks: { font: { size: 11 } } },
                y: { beginAtZero: true, grid: { color: 'rgba(44,62,80,0.06)' }, ticks: { font: { size: 11 } } },
              },
            },
          }));
        }
      }
    }

    function toggleDrilldown(key) {
      if (expandedKpis.has(key)) {
        expandedKpis.delete(key);
      } else {
        expandedKpis.add(key);
        if (!drilldownState.has(key)) {
          drilldownState.set(key, { fecha: '_all', sort: 'desc' });
        }
      }
      renderMessages();
    }

    function handleDrilldownInteraction(e) {
      const fechaSelect = e.target.closest('[data-drill-fecha]');
      if (fechaSelect) {
        const key = fechaSelect.dataset.drillFecha;
        const state = getDrilldownState(key);
        state.fecha = fechaSelect.value;
        refreshRetailDrilldown(key);
        return;
      }

      const sortBtn = e.target.closest('[data-drill-sort]');
      if (sortBtn) {
        const key = sortBtn.dataset.drillSort;
        const state = getDrilldownState(key);
        state.sort = state.sort === 'desc' ? 'asc' : 'desc';
        refreshRetailDrilldown(key);
      }
    }

    function loadHistory() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        messages = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(messages)) messages = [];
      } catch {
        messages = [];
      }
      if (!messages.length) {
        messages = [{ role: 'assistant', content: welcomeMessage }];
      }
    }

    function isOnlyWelcome() {
      return messages.length === 1
        && messages[0]?.role === 'assistant'
        && (
          messages[0]?.content === welcomeMessage
          || messages[0]?.content === DEFAULT_WELCOME
          || String(messages[0]?.content || '').startsWith('Soy tu asistente')
        );
    }

    function resetToWelcome() {
      messages = [{ role: 'assistant', content: welcomeMessage }];
    }

    window.__assistantApplyWelcome = (text) => {
      welcomeMessage = text || DEFAULT_WELCOME;
      if (isOnlyWelcome()) {
        messages = [{ role: 'assistant', content: welcomeMessage }];
        saveHistory();
        renderMessages();
      }
    };

    refreshProfileWelcome();

    function saveHistory() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    }

    function renderVizPanel(latestBlocks, msgIndex) {
      if (!vizPanel) return;
      if (!isExpanded()) {
        vizPanel.innerHTML = '';
        vizPanel.hidden = true;
        return;
      }
      vizPanel.hidden = false;
      if (latestBlocks?.length) {
        vizPanel.innerHTML = `
          <div class="ai-chat-panel__viz-head">
            <h3 class="ai-chat-panel__viz-title">Visualizaciones</h3>
            <p class="ai-chat-panel__viz-sub">Última respuesta del asistente</p>
          </div>
          ${renderBlocks(latestBlocks, msgIndex)}`;
      } else {
        vizPanel.innerHTML = `
          <div class="ai-chat-panel__viz-empty">
            <span class="material-symbols-outlined">analytics</span>
            <p>Las gráficas y KPIs aparecerán aquí cuando consultes datos.</p>
          </div>`;
      }
    }

    function destroyCharts() {
      for (const chart of chartInstances.values()) {
        try { chart.destroy(); } catch { /* ignore */ }
      }
      chartInstances.clear();
    }

    function initCharts() {
      if (typeof Chart === 'undefined') return;

      const mountChart = (canvas, block) => {
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();

        const isHorizontal = block.chartType === 'bar-h';
        const isDoughnut = block.chartType === 'doughnut';
        const isLine = block.chartType === 'line';

        chartInstances.set(canvas.id, new Chart(canvas, {
          type: isDoughnut ? 'doughnut' : isLine ? 'line' : 'bar',
          data: {
            labels: block.labels || [],
            datasets: (block.datasets || []).map((ds) => ({
              ...ds,
              borderWidth: isLine ? 2 : 0,
              borderRadius: isHorizontal || isDoughnut || isLine ? undefined : 8,
              maxBarThickness: isExpanded() ? 56 : 42,
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
              x: { grid: { display: !isHorizontal, color: 'rgba(44,62,80,0.06)' }, ticks: { font: { size: 11 } } },
              y: { beginAtZero: true, grid: { color: 'rgba(44,62,80,0.06)' }, ticks: { font: { size: 11 } } },
            },
          },
        }));
      };

      document.querySelectorAll('canvas[id^="chart-"]').forEach((canvas) => {
        if (!root.contains(canvas)) return;
        const parts = canvas.id.split('-');
        const msgIndex = parts[1];
        const blockIndex = parts[2];
        const msg = messages[Number(msgIndex)];
        const block = msg?.blocks?.[Number(blockIndex)];
        if (!block || block.type !== 'chart') return;
        mountChart(canvas, block);
      });

      document.querySelectorAll('canvas[id^="drill-chart-"]').forEach((canvas) => {
        if (!root.contains(canvas)) return;
        const key = canvas.dataset.drillKey;
        const block = findDrilldownChart(key);
        if (!block) return;
        mountChart(canvas, block);
      });
    }

    function renderMessages() {
      destroyCharts();

      const expanded = isExpanded();
      let latestBlocks = null;
      let latestBlocksIndex = -1;

      messages.forEach((msg, i) => {
        if (msg.role === 'assistant' && msg.blocks?.length) {
          latestBlocks = msg.blocks;
          latestBlocksIndex = i;
        }
      });

      chatMessages.innerHTML = messages.map((msg, msgIndex) => {
        const isUser = msg.role === 'user';
        const tools = msg.toolsUsed?.length
          ? `<div class="assistant-tools">${msg.toolsUsed.map((t) => `<span class="assistant-tool-badge">${escapeHtml(t)}</span>`).join('')}</div>`
          : '';
        const exportsHtml = (!isUser && msg.exports?.length)
          ? `<div class="assistant-exports">
              ${msg.exports.map((ex, exIndex) => `
                <button type="button" class="assistant-export-btn" data-export-url="${escapeHtml(ex.url)}" data-export-name="${escapeHtml(ex.filename || 'export.xlsx')}" data-msg="${msgIndex}" data-ex="${exIndex}">
                  <span class="material-symbols-outlined">download</span>
                  <span>${escapeHtml(ex.label || ex.filename || 'Descargar Excel')}</span>
                  ${ex.rowCount ? `<em>${Number(ex.rowCount).toLocaleString('es-MX')} filas</em>` : ''}
                </button>`).join('')}
            </div>`
          : '';
        const showBlocksInline = !isUser && !expanded;
        const blocks = showBlocksInline ? renderBlocks(msg.blocks, msgIndex) : '';
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
              ${exportsHtml}
              ${tools}
            </div>
          </article>`;
      }).join('');

      renderVizPanel(latestBlocks, latestBlocksIndex);

      if (isLoading) {
        chatMessages.insertAdjacentHTML('beforeend', `
          <article class="assistant-msg assistant-msg--assistant assistant-msg--loading">
            <div class="assistant-msg__avatar"><span class="material-symbols-outlined">smart_toy</span></div>
            <div class="assistant-msg__body">
              <div class="assistant-typing"><span></span><span></span><span></span></div>
              <p class="assistant-msg__meta">Consultando datos y razonando…</p>
            </div>
          </article>`);
      }

      if (suggestedPrompts) {
        suggestedPrompts.style.display = (messages.length && !isOnlyWelcome()) ? 'none' : 'flex';
        if ((!messages.length || isOnlyWelcome()) && !suggestedPrompts.innerHTML.trim()) {
          renderSuggestedPrompts();
        }
      }

      requestAnimationFrame(() => {
        initCharts();
        scrollChatToBottom();
      });
    }

    function getChatScrollParent() {
      return chatMessages?.closest('.ai-chat-panel__body') || chatMessages || null;
    }

    function scrollChatToBottom() {
      const scroller = getChatScrollParent();
      if (!scroller) return;

      const apply = () => {
        scroller.scrollTop = scroller.scrollHeight;
      };

      apply();
      requestAnimationFrame(apply);
      // Las gráficas/KPIs pueden crecer el alto después del primer paint
      setTimeout(apply, 80);
      setTimeout(apply, 280);
    }

    function renderSuggestedPrompts({ reshuffle = true } = {}) {
      if (!suggestedPrompts) return;
      const prompts = options.prompts?.length
        ? options.prompts
        : pickQuickPrompts(4, { forceNew: reshuffle });
      suggestedPrompts.innerHTML = `
        <div class="assistant-suggestions__head">
          <span class="assistant-suggestions__label">Preguntas rápidas</span>
          <button type="button" class="assistant-suggestions__refresh" data-ai-refresh-prompts title="Otras sugerencias">
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
            Otras
          </button>
        </div>
        <div class="assistant-suggestions__list">
          ${prompts.map((p) =>
            `<button type="button" class="assistant-suggestion" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`,
          ).join('')}
        </div>`;
      suggestedPrompts.style.display = (messages.length && !isOnlyWelcome()) ? 'none' : 'flex';
    }

    function setLoading(state) {
      isLoading = state;
      if (btnSend) btnSend.disabled = state || !chatInput.value.trim();
      chatInput.disabled = state;
      renderMessages();
    }

    async function checkStatus() {
      if (!aiStatusBadge) return true;
      try {
        const res = await fetch('/api/ai/status');
        const data = await res.json();
        if (!data.configured) {
          aiStatusBadge.textContent = 'Sin API key';
          aiStatusBadge.classList.add('assistant-status--warn');
          return false;
        }
        aiStatusBadge.textContent = data.model;
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

      await ensureChartJs().catch(() => {});

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
          exports: data.exports || [],
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

    renderSuggestedPrompts({ reshuffle: true });

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value;
      chatInput.value = '';
      chatInput.style.height = 'auto';
      if (btnSend) btnSend.disabled = true;
      sendMessage(text);
    });

    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
      if (btnSend) btnSend.disabled = isLoading || !chatInput.value.trim();
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });

    btnClearChat?.addEventListener('click', () => {
      resetToWelcome();
      expandedKpis.clear();
      drilldownState.clear();
      localStorage.removeItem(STORAGE_KEY);
      renderSuggestedPrompts({ reshuffle: true });
      renderMessages();
      chatInput.focus();
    });

    suggestedPrompts?.addEventListener('click', (e) => {
      const refreshBtn = e.target.closest('[data-ai-refresh-prompts]');
      if (refreshBtn) {
        e.preventDefault();
        renderSuggestedPrompts({ reshuffle: true });
        return;
      }
      const btn = e.target.closest('[data-prompt]');
      if (!btn) return;
      sendMessage(btn.dataset.prompt);
    });

    chatMessages?.addEventListener('click', async (e) => {
      const exportBtn = e.target.closest('[data-export-url]');
      if (exportBtn) {
        e.preventDefault();
        const url = exportBtn.getAttribute('data-export-url');
        const name = exportBtn.getAttribute('data-export-name') || 'export.xlsx';
        try {
          exportBtn.disabled = true;
          await downloadExportFile(url, name);
        } catch (err) {
          window.alert(err?.message || 'No se pudo descargar el Excel.');
        } finally {
          exportBtn.disabled = false;
        }
        return;
      }
      const openBtn = e.target.closest('[data-drilldown-key]');
      if (openBtn) {
        toggleDrilldown(openBtn.dataset.drilldownKey);
        return;
      }
      const closeBtn = e.target.closest('[data-drilldown-close]');
      if (closeBtn) {
        expandedKpis.delete(closeBtn.dataset.drilldownClose);
        renderMessages();
        return;
      }
      handleDrilldownInteraction(e);
    });

    chatMessages?.addEventListener('change', handleDrilldownInteraction);

    vizPanel?.addEventListener('click', (e) => {
      const openBtn = e.target.closest('[data-drilldown-key]');
      if (openBtn) {
        toggleDrilldown(openBtn.dataset.drilldownKey);
        return;
      }
      const closeBtn = e.target.closest('[data-drilldown-close]');
      if (closeBtn) {
        expandedKpis.delete(closeBtn.dataset.drilldownClose);
        renderMessages();
        return;
      }
      handleDrilldownInteraction(e);
    });

    vizPanel?.addEventListener('change', handleDrilldownInteraction);

    loadHistory();
    renderMessages();
    checkStatus();

    return {
      sendMessage,
      focus: () => chatInput.focus(),
      refresh: renderMessages,
      refreshSuggestions: () => renderSuggestedPrompts({ reshuffle: true }),
      scrollToBottom: () => scrollChatToBottom(),
    };
  }

  return { init, STORAGE_KEY };
})();
