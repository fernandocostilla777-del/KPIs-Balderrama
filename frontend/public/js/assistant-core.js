window.AssistantChat = (function () {
  const STORAGE_KEY = 'balderrama-ai-chat-v2';
  const DEFAULT_WELCOME =
    'Soy Balvo, tu asistente de Balderrama.\n'
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
      `Soy Balvo, tu asistente para el perfil **${roleLabel}**.\n`
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

  function assistantAvatar() {
    return window.AssistantMascot?.avatarSvg?.()
      || '<span class="material-symbols-outlined">smart_toy</span>';
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
    // Momento en que cada mensaje apareció, para animar solo los nuevos aunque se repinte.
    const firstSeen = new WeakMap();
    let hasRendered = false;

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
          || /^Soy (tu asistente|Balvo)/.test(String(messages[0]?.content || ''))
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

        const now = performance.now();
        if (!firstSeen.has(msg)) firstSeen.set(msg, hasRendered ? now : -1e9);
        const age = now - firstSeen.get(msg);
        const isNew = age < 500;

        return `
          <article class="assistant-msg ${isUser ? 'assistant-msg--user' : 'assistant-msg--assistant'}${isNew ? ' assistant-msg--new' : ''}"${isNew ? ` style="animation-delay:-${Math.round(age)}ms"` : ''}>
            <div class="assistant-msg__avatar">
              ${isUser ? '<span class="material-symbols-outlined">person</span>' : assistantAvatar()}
            </div>
            <div class="assistant-msg__body">
              ${blocks}
              ${prose}
              ${isUser ? '' : `<button type="button" class="assistant-speak" data-ai-speak="${msgIndex}" title="Escuchar" aria-label="Escuchar respuesta"><span class="material-symbols-outlined">volume_up</span></button>`}
              ${exportsHtml}
              ${tools}
            </div>
          </article>`;
      }).join('');

      hasRendered = true;
      renderVizPanel(latestBlocks, latestBlocksIndex);

      if (isLoading) {
        chatMessages.insertAdjacentHTML('beforeend', `
          <article class="assistant-msg assistant-msg--assistant assistant-msg--loading" aria-live="polite">
            <div class="assistant-msg__avatar">${assistantAvatar()}</div>
            <div class="assistant-msg__body">
              <div class="assistant-thinking">
                <div class="assistant-thinking__row">
                  <div class="assistant-typing" aria-hidden="true"><span></span><span></span><span></span></div>
                  <span class="assistant-thinking__label">Pensando</span>
                </div>
                <div class="assistant-thinking__steps" aria-hidden="true">
                  <span>Consultando datos…</span>
                  <span>Cruzando cifras del periodo…</span>
                  <span>Armando la respuesta…</span>
                </div>
                <div class="assistant-thinking__bar" aria-hidden="true"></div>
              </div>
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
      options.onLoading?.(state);
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
          aiStatusBadge.dataset.state = 'warn';
          return false;
        }
        const via = data.source === 'railway' ? 'nube' : null;
        aiStatusBadge.textContent = data.model
          ? `En línea${via ? ` · ${via}` : ''} · ${data.model}`
          : (via ? `En línea · ${via}` : 'En línea');
        aiStatusBadge.dataset.state = 'ok';
        return true;
      } catch {
        aiStatusBadge.textContent = 'Sin conexión';
        aiStatusBadge.classList.add('assistant-status--warn');
        aiStatusBadge.dataset.state = 'warn';
        return false;
      }
    }

    async function sendMessage(text, { speakReply = false } = {}) {
      const content = String(text || '').trim();
      if (!content || isLoading) return;
      if (speakReply) setVoiceState('thinking');

      await ensureChartJs().catch(() => {});

      messages.push({ role: 'user', content });
      saveHistory();
      renderMessages();
      setLoading(true);
      let ok = false;

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
        ok = true;
        if (voiceOn || speakReply) speak(data.reply || '');
      } catch (err) {
        messages.push({
          role: 'assistant',
          content: `No pude completar la consulta: ${err.message}`,
          blocks: [],
        });
        saveHistory();
        if (speakReply) setVoiceState('idle');
      } finally {
        setLoading(false);
        const last = messages[messages.length - 1];
        options.onReply?.({ ok, reply: last?.content || '', hasBlocks: Boolean(last?.blocks?.length) });
        if (!speakReply) chatInput.focus();
      }
    }

    function setVoiceState(state) {
      options.onVoiceState?.(state);
    }

    const VOICE_KEY = 'balderrama-assistant-voice';
    const voiceName = 'echo';
    let voiceOn = localStorage.getItem(VOICE_KEY) === '1';
    let speechAudio = null;
    let recognition = null;
    let listening = false;
    const btnMic = q('[data-ai="mic"]');
    const btnVoice = q('[data-ai="voice"]');
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    function plainSpeech(text) {
      return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#*_`>\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 700);
    }

    function speakWithSystem(phrase) {
      if (!phrase || !window.speechSynthesis) {
        setVoiceState('idle');
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.lang = 'es-MX';
      const voices = window.speechSynthesis.getVoices() || [];
      utter.voice = voices.find((item) => /es-MX/i.test(item.lang))
        || voices.find((item) => /^es/i.test(item.lang))
        || null;
      utter.onend = () => setVoiceState('idle');
      utter.onerror = () => setVoiceState('idle');
      setVoiceState('speaking');
      window.speechSynthesis.speak(utter);
    }

    async function speak(text) {
      const phrase = plainSpeech(text);
      if (!phrase) return;
      stopSpeaking();
      try {
        const res = await fetch('/api/ai/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ text: phrase, voice: voiceName }),
        });
        if (!res.ok) throw new Error(`speech ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        speechAudio = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (speechAudio === audio) speechAudio = null;
          setVoiceState('idle');
        };
        setVoiceState('speaking');
        await audio.play();
      } catch (err) {
        console.warn('[Balvo voz]', err.message);
        speakWithSystem(phrase);
      }
    }

    function stopSpeaking() {
      if (speechAudio) {
        speechAudio.pause();
        speechAudio = null;
      }
      window.speechSynthesis?.cancel();
    }

    const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    let voiceTurn = null;

    function voiceError(message) {
      setVoiceState('idle');
      options.onVoiceError?.(message);
    }

    function releaseVoiceTurn(turn) {
      if (!turn) return;
      clearInterval(turn.timer);
      turn.stream.getTracks().forEach((t) => t.stop());
      turn.audioCtx?.close().catch(() => {});
      if (voiceTurn === turn) voiceTurn = null;
    }

    async function transcribeAndSend(blob) {
      setVoiceState('thinking');
      try {
        const res = await fetch('/api/ai/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          credentials: 'same-origin',
          body: blob,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `transcribe ${res.status}`);
        const text = String(data.text || '').trim();
        if (!text) {
          voiceError('No alcancé a escucharte. Toca el botón y vuelve a intentarlo.');
          return;
        }
        options.onVoiceTranscript?.(text);
        sendMessage(text, { speakReply: true });
      } catch (err) {
        console.warn('[Balvo voz] transcripción', err.message);
        voiceError('No pude entender el audio. Intenta de nuevo o usa el modo Chat.');
      }
    }

    /** Graba hasta detectar ~1.4 s de silencio tras hablar (máx. 20 s) y transcribe en el backend. */
    async function startRecordedTurn() {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        console.warn('[Balvo voz] micrófono', err.name, err.message);
        voiceError(err.name === 'NotAllowedError'
          ? 'Sin permiso de micrófono. Actívalo en la configuración del sistema.'
          : 'No encontré un micrófono disponible.');
        return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const turn = { stream, recorder, cancelled: false, timer: null, audioCtx: null };
      voiceTurn = turn;
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const spoke = turn.spoke;
        releaseVoiceTurn(turn);
        listening = false;
        syncMicButton();
        if (turn.cancelled) return;
        if (!spoke || !chunks.length) {
          voiceError('No te escuché. Toca el botón y habla cerca del micrófono.');
          return;
        }
        transcribeAndSend(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }));
      };

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const started = Date.now();
      let lastVoice = started;
      if (Ctx) {
        turn.audioCtx = new Ctx();
        const analyser = turn.audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        turn.audioCtx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        turn.timer = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const now = Date.now();
          if (Math.sqrt(sum / buf.length) > 0.035) {
            turn.spoke = true;
            lastVoice = now;
          }
          const silentFor = now - lastVoice;
          if ((turn.spoke && silentFor > 1400) || (!turn.spoke && now - started > 8000) || now - started > 20000) {
            if (recorder.state === 'recording') recorder.stop();
          }
        }, 100);
      } else {
        turn.spoke = true;
        turn.timer = setTimeout(() => recorder.state === 'recording' && recorder.stop(), 8000);
      }

      listening = true;
      setVoiceState('listening');
      recorder.start(250);
    }

    function startVoiceTurn() {
      if (listening || isLoading || voiceTurn) return;
      if (canRecord) {
        stopSpeaking();
        startRecordedTurn();
        return;
      }
      if (!SpeechRec) {
        setVoiceState('unsupported');
        return;
      }
      stopSpeaking();
      recognition = new SpeechRec();
      recognition.lang = 'es-MX';
      recognition.interimResults = true;
      recognition.continuous = false;
      let said = '';
      recognition.onresult = (event) => {
        said = '';
        for (let i = 0; i < event.results.length; i += 1) said += event.results[i][0].transcript;
        options.onVoiceTranscript?.(said.trim());
      };
      recognition.onend = () => {
        listening = false;
        syncMicButton();
        const text = said.trim();
        if (text) sendMessage(text, { speakReply: true });
        else setVoiceState('idle');
      };
      recognition.onerror = (event) => {
        listening = false;
        syncMicButton();
        voiceError(event?.error === 'not-allowed'
          ? 'Sin permiso de micrófono.'
          : 'El dictado no está disponible aquí. Usa el modo Chat.');
      };
      listening = true;
      setVoiceState('listening');
      recognition.start();
    }

    function stopVoice() {
      if (voiceTurn) {
        voiceTurn.cancelled = true;
        if (voiceTurn.recorder.state === 'recording') voiceTurn.recorder.stop();
        else releaseVoiceTurn(voiceTurn);
      }
      try { recognition?.stop(); } catch { /* ya detenido */ }
      listening = false;
      stopSpeaking();
      syncMicButton();
      setVoiceState('idle');
    }

    function syncVoiceButton() {
      if (!btnVoice) return;
      btnVoice.setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
      btnVoice.title = voiceOn ? 'Voz activada' : 'Leer respuestas en voz';
      btnVoice.classList.toggle('is-on', voiceOn);
      const icon = btnVoice.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = voiceOn ? 'volume_up' : 'volume_off';
    }

    function syncMicButton() {
      if (!btnMic) return;
      btnMic.hidden = !SpeechRec;
      btnMic.setAttribute('aria-pressed', listening ? 'true' : 'false');
      btnMic.classList.toggle('is-on', listening);
      btnMic.title = listening ? 'Detener dictado' : 'Dictar';
    }

    function stopDictation() {
      listening = false;
      try { recognition?.stop(); } catch { /* ya detenido */ }
      syncMicButton();
    }

    function startDictation() {
      if (!SpeechRec || listening) return;
      recognition = new SpeechRec();
      recognition.lang = 'es-MX';
      recognition.interimResults = true;
      recognition.continuous = false;
      const base = chatInput.value.trim();
      recognition.onresult = (event) => {
        let said = '';
        for (let i = 0; i < event.results.length; i += 1) said += event.results[i][0].transcript;
        chatInput.value = `${base}${base ? ' ' : ''}${said.trim()}`;
        chatInput.dispatchEvent(new Event('input'));
      };
      recognition.onend = () => { listening = false; syncMicButton(); };
      recognition.onerror = () => { listening = false; syncMicButton(); };
      listening = true;
      syncMicButton();
      stopSpeaking();
      recognition.start();
    }

    btnMic?.addEventListener('click', () => (listening ? stopDictation() : startDictation()));
    btnVoice?.addEventListener('click', () => {
      voiceOn = !voiceOn;
      localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0');
      syncVoiceButton();
      if (!voiceOn) stopSpeaking();
      else speak('Hola, soy Balvo.');
    });
    chatMessages.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ai-speak]');
      if (!btn) return;
      const msg = messages[Number(btn.dataset.aiSpeak)];
      if (msg?.content) speak(msg.content);
    });
    syncVoiceButton();
    syncMicButton();

    renderSuggestedPrompts({ reshuffle: true });

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value;
      stopDictation();
      stopSpeaking();
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
      startVoiceTurn,
      stopVoice,
      isListening: () => listening,
      focus: () => chatInput.focus(),
      refresh: renderMessages,
      refreshSuggestions: () => renderSuggestedPrompts({ reshuffle: true }),
      scrollToBottom: () => scrollChatToBottom(),
    };
  }

  return { init, STORAGE_KEY };
})();
