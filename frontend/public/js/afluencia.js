/**
 * Sección Afluencia en Ventas — Tráfico piso + Pruebas + YTD + Marketing.
 */
(function () {
  let state = {
    data: null,
    fechaInicio: null,
    fechaFin: null,
    openKpi: null,
    metric: 'afluenciaTotal',
    centro: 'todos',
    quarters: new Set([1, 2, 3, 4]),
    mktView: 'submedio',
    mktLeadsFilter: 'todas',
    innerTab: 'general',
    cacheKey: null,
    inflightKey: null,
    inflightPromise: null,
  };

  let ytdChart = null;
  let afluenciaDrawerUi = null;
  const els = {};

  const KPI_TO_METRIC = {
    afluencia: 'afluenciaTotal',
    freshUp: 'freshUp',
    citas: 'citas',
    snv: 'snv',
    pruebas: 'pruebasManejo',
  };

  const METRIC_LABEL = {
    afluenciaTotal: 'Afluencia',
    freshUp: 'Fresh up',
    citas: 'Citas',
    snv: 'SNV',
    pruebasManejo: 'Pruebas de manejo',
  };

  const CENTRO_LABEL = {
    todos: 'Todos',
    cholula: 'Cholula',
    zacatelco: 'Zacatelco',
    matriz: 'Matriz Serdan',
  };

  const MKT_VIEW_LABEL = {
    submedio: 'Submedio',
    medio: 'Medio',
    pair: 'Medio · submedio',
    forma: 'Forma de contacto',
  };

  function num(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return (window.Dashboard?.fmt || { number: (x) => String(x) }).number(Number(n));
  }

  function pct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Number(n).toFixed(1)}%`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function summary() {
    return state.data?.summary || {};
  }

  function marketing() {
    return state.data?.marketing || null;
  }

  function kpiCard(key, title, value, sub, cls, icon) {
    const active = state.openKpi === key ? ' is-active' : '';
    return `
      <button type="button" class="kpi-card kpi-card--${cls} kpi-card--interactive${active}"
        data-af-kpi="${escapeHtml(key)}"
        aria-pressed="${state.openKpi === key ? 'true' : 'false'}"
        title="Clic para ver el detalle">
        <div class="kpi-card-head">
          <span class="kpi-title">${escapeHtml(title)}</span>
          <span class="material-symbols-outlined kpi-icon" aria-hidden="true">${icon}</span>
        </div>
        <div class="kpi-value">${value}</div>
        <p class="kpi-subtitle">${escapeHtml(sub || '')}</p>
        <div class="kpi-accent"></div>
      </button>`;
  }

  function kpiCardStatic(title, value, sub, cls, icon, id) {
    const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
    return `
      <div class="kpi-card kpi-card--${cls}"${idAttr}>
        <div class="kpi-card-head">
          <span class="kpi-title">${escapeHtml(title)}</span>
          <span class="material-symbols-outlined kpi-icon" aria-hidden="true">${icon}</span>
        </div>
        <div class="kpi-value">${value}</div>
        <p class="kpi-subtitle">${escapeHtml(sub || '')}</p>
        <div class="kpi-accent"></div>
      </div>`;
  }

  function convSub(compras, total, pctVal) {
    const c = Number(compras);
    const t = Number(total);
    if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return 'Clic para ver detalle';
    const pctTxt = pctVal != null && Number.isFinite(Number(pctVal))
      ? `${Number(pctVal)}%`
      : `${Math.round((c / t) * 1000) / 10}%`;
    return `${num(c)} compraron auto · ${pctTxt}`;
  }

  function renderKpis() {
    if (!els.kpiRoot) return;
    const s = summary();
    els.kpiRoot.innerHTML = `
      <div class="kpi-group">
        <h4 class="kpi-group-title">Afluencia general</h4>
        <div class="kpi-grid">
          ${kpiCard('afluencia', 'Afluencia total', num(s.afluenciaTotal), 'Clic para ver detalle', 'blue', 'groups')}
          ${kpiCard('freshUp', 'Fresh up', num(s.freshUp), convSub(s.freshUpCompras, s.freshUp, s.freshUpConversionPct), 'green', 'person_add')}
          ${kpiCard('citas', 'Citas', num(s.citas), convSub(s.citasCompras, s.citas, s.citasConversionPct), 'amber', 'event')}
          ${kpiCard('snv', 'SNV', num(s.snv), convSub(s.snvCompras, s.snv, s.snvConversionPct), 'rose', 'history_edu')}
          ${kpiCard('pruebas', 'Pruebas de manejo', num(s.pruebasManejo), convSub(s.pruebasCompras, s.pruebasManejo, s.pruebasConversionPct), 'violet', 'directions_car')}
        </div>
      </div>`;
  }

  function activeYtdBlock() {
    const cmp = state.data?.comparativoYtd;
    if (!cmp) return null;
    const key = state.centro || 'todos';
    const fromCentro = cmp.porCentro?.[key];
    if (fromCentro?.trimestres?.length) {
      return {
        ...cmp,
        trimestres: fromCentro.trimestres,
        centroKey: key,
        centroLabel: fromCentro.label || CENTRO_LABEL[key] || key,
        centroReady: true,
      };
    }
    // Sin porCentro (API vieja / caché): no fingir filtro; marcar para refetch.
    return {
      ...cmp,
      centroKey: key,
      centroLabel: CENTRO_LABEL[key] || key,
      centroReady: key === 'todos',
      needsCentroReload: key !== 'todos',
    };
  }

  function hasPorCentro() {
    return Boolean(state.data?.comparativoYtd?.porCentro?.todos?.trimestres);
  }

  function availableQuarters() {
    const list = activeYtdBlock()?.trimestres || [];
    return new Set(list.map((t) => Number(t.quarter)).filter((q) => q >= 1 && q <= 4));
  }

  function syncMetricChips() {
    els.metricChips?.querySelectorAll('[data-af-metric]').forEach((btn) => {
      const on = btn.dataset.afMetric === state.metric;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncCentroChips() {
    els.centroChips?.querySelectorAll('[data-af-centro]').forEach((btn) => {
      const on = btn.dataset.afCentro === state.centro;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncQuarterChips() {
    const avail = availableQuarters();
    els.quarterChips?.querySelectorAll('[data-af-quarter]').forEach((btn) => {
      const q = Number(btn.dataset.afQuarter);
      const visible = !avail.size || avail.has(q);
      btn.hidden = !visible;
      btn.disabled = !visible;
      const on = visible && state.quarters.has(q);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function initQuartersFromData() {
    const avail = availableQuarters();
    if (!avail.size) {
      state.quarters = new Set([1, 2, 3, 4]);
      return;
    }
    // Conservar selección si sigue válida; si no, activar todos los disponibles.
    const next = new Set([...state.quarters].filter((q) => avail.has(q)));
    state.quarters = next.size ? next : new Set(avail);
  }

  function setMetric(metric, { fromKpi = null } = {}) {
    if (!METRIC_LABEL[metric]) return;
    state.metric = metric;
    state.openKpi = fromKpi;
    syncMetricChips();
    renderKpis();
    renderYtdChart();
  }

  async function setCentro(centro) {
    if (!CENTRO_LABEL[centro]) return;
    state.centro = centro;
    syncCentroChips();

    // Si el payload no trae desglose por centro, forzar recarga del API.
    if (centro !== 'todos' && !hasPorCentro() && state.fechaInicio && state.fechaFin) {
      if (els.detailResumen) {
        els.detailResumen.textContent = `Cargando ${CENTRO_LABEL[centro]}…`;
      }
      await load(state.fechaInicio, state.fechaFin, { force: true, keepFilters: true });
      state.centro = centro;
      syncCentroChips();
    }

    renderYtdChart();
  }

  function toggleQuarter(q) {
    const n = Number(q);
    if (!Number.isFinite(n) || n < 1 || n > 4) return;
    if (state.quarters.has(n)) {
      if (state.quarters.size <= 1) return;
      state.quarters.delete(n);
    } else {
      state.quarters.add(n);
    }
    syncQuarterChips();
    renderYtdChart();
  }

  function renderYtdChart() {
    const cmp = activeYtdBlock();
    const canvas = els.ytdChart;
    const empty = els.ytdEmpty;
    if (!canvas) return;

    if (els.detailTitle) {
      els.detailTitle.textContent = 'Comparativo YTD por trimestre';
    }
    if (els.detailResumen) {
      if (cmp) {
        const hasta = cmp.hasta ? ` · YTD al ${cmp.hasta}` : '';
        const centro = cmp.centroLabel ? ` · ${cmp.centroLabel}` : '';
        const warn = cmp.needsCentroReload ? ' · actualizando filtro…' : '';
        els.detailResumen.textContent = `${METRIC_LABEL[state.metric] || 'Métrica'}${centro} · ${cmp.anioActual} vs ${cmp.anioAnterior}${hasta} · meses del trimestre${warn}`;
      } else {
        els.detailResumen.textContent = 'Año actual vs año anterior · meses del trimestre · solo NUEVOS';
      }
    }

    // Sin desglose por centro aún: no pintar el total global como si fuera Cholula/etc.
    if (cmp?.needsCentroReload) {
      if (ytdChart) {
        ytdChart.destroy();
        ytdChart = null;
      }
      empty?.classList.remove('hidden');
      if (empty) empty.textContent = `Cargando datos de ${cmp.centroLabel}…`;
      return;
    }

    if (!cmp?.trimestres?.length) {
      if (ytdChart) {
        ytdChart.destroy();
        ytdChart = null;
      }
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    if (empty) empty.textContent = 'Sin datos suficientes para el comparativo YTD.';

    const selected = cmp.trimestres.filter((t) => state.quarters.has(t.quarter));
    const monthPoints = selected.flatMap((t) => (t.meses || []).map((m) => ({
      ...m,
      quarterLabel: t.label,
    })));

    if (!monthPoints.length) {
      empty?.classList.remove('hidden');
      if (ytdChart) {
        ytdChart.destroy();
        ytdChart = null;
      }
      return;
    }

    // Una sola etiqueta por mes; si hay varios trimestres, anteponer T1/T2…
    const multiQ = selected.length > 1;
    const labels = monthPoints.map((m) => (multiQ ? `${m.quarterLabel} ${m.label}` : m.label));
    const actual = monthPoints.map((m) => Number(m.actual?.[state.metric] || 0));
    const anterior = monthPoints.map((m) => Number(m.anterior?.[state.metric] || 0));
    const palette = window.Dashboard?.chartPalette || ['#2563eb', '#94a3b8', '#0d9488'];
    const optionsBase = window.Dashboard?.chartOptions
      ? window.Dashboard.chartOptions({
        plugins: {
          legend: { position: 'bottom' },
          datalabels: window.Dashboard.chartDataLabels
            ? window.Dashboard.chartDataLabels('bar')
            : {
              display: true,
              anchor: 'end',
              align: 'top',
              offset: 2,
              color: '#1e293b',
              font: { weight: '700', size: 11 },
              formatter: (v) => {
                const n = Number(v);
                return Number.isFinite(n) && n !== 0 ? String(Math.round(n)) : '';
              },
            },
          tooltip: {
            callbacks: {
              title(items) {
                const i = items?.[0]?.dataIndex;
                if (i == null) return '';
                const m = monthPoints[i];
                return `${m.quarterLabel} · ${m.label}`;
              },
              afterBody(items) {
                const i = items?.[0]?.dataIndex;
                if (i == null) return '';
                const a = actual[i];
                const b = anterior[i];
                if (!b) return a ? 'Sin base año anterior' : '';
                const delta = a - b;
                const p = ((delta / b) * 100).toFixed(1);
                const sign = delta > 0 ? '+' : '';
                return `Var: ${sign}${delta} (${sign}${p}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxRotation: multiQ ? 45 : 0,
              minRotation: multiQ ? 30 : 0,
            },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grace: '12%',
          },
        },
        layout: {
          padding: { top: 16 },
        },
      })
      : {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { position: 'bottom' },
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'top',
            color: '#1e293b',
            font: { weight: '700', size: 11 },
            formatter: (v) => {
              const n = Number(v);
              return Number.isFinite(n) && n !== 0 ? String(Math.round(n)) : '';
            },
          },
        },
        scales: { y: { beginAtZero: true, grace: '12%' } },
      };

    if (typeof Chart === 'undefined') {
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = 'Chart.js no está disponible.';
      }
      return;
    }

    if (ytdChart) ytdChart.destroy();
    ytdChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: String(cmp.anioActual),
            data: actual,
            backgroundColor: palette[0] || '#2563eb',
            borderRadius: 6,
            maxBarThickness: 36,
          },
          {
            label: String(cmp.anioAnterior),
            data: anterior,
            backgroundColor: palette[1] || '#94a3b8',
            borderRadius: 6,
            maxBarThickness: 36,
          },
        ],
      },
      options: optionsBase,
    });
  }

  function formatAfDate(iso) {
    const s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  function dash(v) {
    const s = String(v ?? '').trim();
    return s || '—';
  }

  function kpiMetaAf(key) {
    const s = summary();
    const map = {
      afluencia: {
        title: 'Afluencia total',
        hint: `${num(s.afluenciaTotal)} registros Fresh up + Citas (NUEVOS)`,
        icon: 'groups',
        bucket: 'afluencia',
      },
      freshUp: {
        title: 'Fresh up',
        hint: `${num(s.freshUp)} visitas · ${num(s.freshUpCompras)} compraron auto${s.freshUpConversionPct != null ? ` (${s.freshUpConversionPct}%)` : ''}`,
        icon: 'person_add',
        bucket: 'freshUp',
      },
      citas: {
        title: 'Citas',
        hint: `${num(s.citas)} citas · ${num(s.citasCompras)} compraron auto${s.citasConversionPct != null ? ` (${s.citasConversionPct}%)` : ''}`,
        icon: 'event',
        bucket: 'citas',
      },
      snv: {
        title: 'SNV',
        hint: `${num(s.snv)} SNV · ${num(s.snvCompras)} compraron auto${s.snvConversionPct != null ? ` (${s.snvConversionPct}%)` : ''}`,
        icon: 'history_edu',
        bucket: 'snv',
      },
      pruebas: {
        title: 'Pruebas de manejo',
        hint: `${num(s.pruebasManejo)} pruebas · ${num(s.pruebasCompras)} compraron auto${s.pruebasConversionPct != null ? ` (${s.pruebasConversionPct}%)` : ''}`,
        icon: 'directions_car',
        bucket: 'pruebas',
      },
    };
    return map[key] || { title: 'Detalle', hint: '', icon: 'groups', bucket: 'afluencia' };
  }

  function rowsForAfKpi(key) {
    const meta = kpiMetaAf(key);
    const byKpi = state.data?.detallePorKpi?.[meta.bucket];
    if (Array.isArray(byKpi)) return byKpi;
    if (meta.bucket === 'pruebas') return state.data?.pruebasDetalle || [];
    const detalle = state.data?.detalle || [];
    if (meta.bucket === 'afluencia') return detalle.filter((r) => r.afluencia);
    if (meta.bucket === 'freshUp') return detalle.filter((r) => r.freshUp);
    if (meta.bucket === 'citas') return detalle.filter((r) => r.cita);
    if (meta.bucket === 'snv') return detalle.filter((r) => r.snv);
    return detalle;
  }

  function countByField(rows, keyFn) {
    const map = new Map();
    for (const r of rows) {
      const label = keyFn(r) || 'Sin dato';
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function ensureAfluenciaKpiDrawer() {
    if (afluenciaDrawerUi) return afluenciaDrawerUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-orders-backdrop';
    backdrop.id = 'afKpiBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-orders-drawer';
    panel.id = 'afKpiDrawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle de afluencia');
    panel.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo" data-af-kpi-logo>groups</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-af-kpi-title>Detalle de afluencia</h2>
            <span class="ops-orders-drawer__status" data-af-kpi-status>0 registros</span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-af-kpi-download title="Descargar CSV" aria-label="Descargar CSV">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-af-kpi-expand title="Expandir" aria-label="Expandir panel">
            <span class="material-symbols-outlined" data-af-kpi-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-af-kpi-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <label class="ops-orders-drawer__search" for="afKpiSearch">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="afKpiSearch" type="search" placeholder="Buscar cliente, asesor, sucursal…" autocomplete="off"/>
        </label>
        <button type="button" class="ops-orders-drawer__filter-chip" data-af-kpi-filter-chip hidden title="Quitar filtro"></button>
        <span class="ops-orders-drawer__meta" data-af-kpi-meta></span>
      </div>
      <div class="ops-orders-drawer__main">
        <aside class="ops-orders-drawer__summary custom-scrollbar" data-af-kpi-summary></aside>
        <div class="ops-orders-drawer__body custom-scrollbar" data-af-kpi-body></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-af-kpi-status]');
    const metaEl = panel.querySelector('[data-af-kpi-meta]');
    const bodyEl = panel.querySelector('[data-af-kpi-body]');
    const summaryEl = panel.querySelector('[data-af-kpi-summary]');
    const searchEl = panel.querySelector('#afKpiSearch');
    const filterChip = panel.querySelector('[data-af-kpi-filter-chip]');
    const expandBtn = panel.querySelector('[data-af-kpi-expand]');
    const expandIcon = panel.querySelector('[data-af-kpi-expand-icon]');
    const downloadBtn = panel.querySelector('[data-af-kpi-download]');
    const titleEl = panel.querySelector('[data-af-kpi-title]');
    const logoEl = panel.querySelector('[data-af-kpi-logo]');

    let expanded = false;
    let activeFilter = null;
    let sourceRows = [];
    let lastExportRows = [];
    let currentMeta = { kpi: '', title: 'Detalle', hint: '', icon: 'groups' };
    let lastCard = null;

    const FILTER_DIM_LABEL = {
      sucursal: 'Sucursal',
      asesor: 'Asesor',
      medio: 'Medio',
      submedio: 'Submedio',
      interes: 'Interés',
      compra: 'Compra',
    };

    function placeNearKpi(card) {
      if (expanded) return;
      const kpiBlock = document.getElementById('afKpiOperational');
      const ref = card || kpiBlock;
      const rect = ref?.getBoundingClientRect?.();
      let top = 96;
      if (rect) top = Math.round(rect.bottom + 12);
      top = Math.max(72, Math.min(top, Math.round(window.innerHeight * 0.28)));
      const maxHeight = Math.max(360, window.innerHeight - top - 24);
      panel.style.top = `${top}px`;
      panel.style.right = window.innerWidth < 640 ? '12px' : '28px';
      panel.style.left = window.innerWidth < 640 ? '12px' : 'auto';
      panel.style.bottom = 'auto';
      panel.style.height = `${Math.min(680, maxHeight)}px`;
    }

    function clearPlacement() {
      panel.style.top = '';
      panel.style.right = '';
      panel.style.left = '';
      panel.style.bottom = '';
      panel.style.height = '';
    }

    function setExpanded(next) {
      expanded = Boolean(next);
      panel.classList.toggle('ops-orders-drawer--expanded', expanded);
      if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
      if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
      if (expanded) clearPlacement();
      else if (panel.classList.contains('ops-orders-drawer--open')) placeNearKpi(lastCard);
    }

    function updateFilterChip() {
      if (!filterChip) return;
      if (!activeFilter) {
        filterChip.hidden = true;
        filterChip.textContent = '';
        return;
      }
      filterChip.hidden = false;
      filterChip.innerHTML = `
        <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
        ${escapeHtml(FILTER_DIM_LABEL[activeFilter.dim] || activeFilter.dim)}: ${escapeHtml(activeFilter.label || activeFilter.value)}
        <span class="material-symbols-outlined" aria-hidden="true">close</span>`;
    }

    function matchesActiveFilter(r) {
      if (!activeFilter) return true;
      const { dim, value } = activeFilter;
      if (dim === 'sucursal') return String(r.sucursal || r.centroTrabajo || 'Sin sucursal') === value;
      if (dim === 'asesor') return String(r.asesor || r.ejecutivo || 'Sin asesor') === value;
      if (dim === 'medio') return String(r.medio || 'Sin medio') === value;
      if (dim === 'submedio') return String(r.submedio || 'Sin submedio') === value;
      if (dim === 'interes') return String(r.autoInteres || r.tipoAuto || 'Sin interés') === value;
      if (dim === 'compra') return (r.conCompra ? 'Compró auto' : 'Sin compra') === value;
      return true;
    }

    function setFilter(dim, value, label) {
      if (activeFilter && activeFilter.dim === dim && activeFilter.value === value) activeFilter = null;
      else activeFilter = { dim, value, label: label || value };
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function clearFilter() {
      activeFilter = null;
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function renderSummary(rows) {
      const isActive = (dim, value) => activeFilter && activeFilter.dim === dim && activeFilter.value === value;
      const block = (titulo, dim, items) => `
        <div class="ops-orders-drawer__group">
          <h5>${escapeHtml(titulo)}</h5>
          ${items.length
            ? items.slice(0, 12).map((x) => `
              <button type="button"
                class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x.label) ? ' is-active' : ''}"
                data-af-filter-dim="${escapeHtml(dim)}"
                data-af-filter-value="${escapeHtml(x.label)}"
                title="Filtrar por ${escapeHtml(x.label)}">
                <span class="lbl">${escapeHtml(x.label)}</span>
                <span class="val">${x.value}</span>
              </button>`).join('')
            : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
        </div>`;

      const isPruebas = currentMeta.kpi === 'pruebas';
      const showCompra = ['freshUp', 'citas', 'snv', 'pruebas'].includes(currentMeta.kpi);
      const compras = rows.filter((r) => r.conCompra).length;
      const conv = rows.length ? Math.round((compras / rows.length) * 1000) / 10 : null;
      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Registros</span><span class="val">${rows.length}</span></div>
          ${showCompra ? `
          <div class="ops-orders-drawer__row"><span class="lbl">Compraron auto</span><span class="val">${compras}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Conversión</span><span class="val">${conv != null ? `${conv}%` : '—'}</span></div>
          ` : ''}
          <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
        </div>
        ${showCompra ? block('Compra', 'compra', countByField(rows, (r) => (r.conCompra ? 'Compró auto' : 'Sin compra'))) : ''}
        ${block('Por sucursal', 'sucursal', countByField(rows, (r) => r.sucursal || r.centroTrabajo || 'Sin sucursal'))}
        ${block(isPruebas ? 'Por ejecutivo' : 'Por asesor', 'asesor', countByField(rows, (r) => r.asesor || r.ejecutivo || 'Sin asesor'))}
        ${isPruebas
          ? block('Auto / interés', 'interes', countByField(rows, (r) => r.autoInteres || r.tipoAuto || 'Sin interés'))
          : `${block('Por medio', 'medio', countByField(rows, (r) => r.medio || 'Sin medio'))}
             ${block('Por submedio', 'submedio', countByField(rows, (r) => r.submedio || 'Sin submedio'))}`}
      `;
    }

    function renderList(term = '') {
      const q = String(term || '').trim().toLowerCase();
      const searched = !q
        ? sourceRows
        : sourceRows.filter((r) => [
          r.cliente, r.asesor, r.ejecutivo, r.sucursal, r.centroTrabajo,
          r.medio, r.submedio, r.autoInteres, r.tipoAuto, r.telefono,
          r.idCrm, r.vin, r.vinVenta, r.reconciliacion,
        ].some((v) => String(v || '').toLowerCase().includes(q)));

      const filtered = searched.filter(matchesActiveFilter);
      lastExportRows = filtered;

      if (statusEl) statusEl.textContent = `${filtered.length} registro${filtered.length === 1 ? '' : 's'}`;
      if (metaEl) {
        metaEl.textContent = filtered.length !== sourceRows.length
          ? `${filtered.length} de ${sourceRows.length}`
          : `${sourceRows.length} registros`;
      }

      renderSummary(searched);
      updateFilterChip();

      if (!filtered.length) {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__empty">
            <span class="material-symbols-outlined">inbox</span>
            <p>${activeFilter || q ? 'Sin coincidencias con el filtro actual.' : 'No hay registros para este indicador.'}</p>
          </div>`;
        return;
      }

      const isPruebas = currentMeta.kpi === 'pruebas';
      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <h5>Detalle</h5>
          <span>${filtered.length}</span>
        </div>
        ${filtered.map((r) => `
          <div class="ops-orders-drawer__item">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(dash(r.cliente))}</strong>
              <span class="ld-badge">${escapeHtml(dash(r.sucursal || r.centroTrabajo))}</span>
              ${r.conCompra ? '<span class="ld-badge ld-badge--ok">Compró</span>' : ''}
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.asesor || r.ejecutivo))} · ${escapeHtml(dash(isPruebas ? (r.autoInteres || r.tipoAuto) : (r.medio || r.submedio)))}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(formatAfDate(r.fecha))}${r.hora ? ` ${escapeHtml(String(r.hora).slice(0, 5))}` : ''}</span>
              <span>${escapeHtml(dash(isPruebas ? r.vin : r.reconciliacion))}</span>
              <span class="mono">${escapeHtml(dash(r.telefono || r.idCrm))}</span>
            </div>
          </div>
        `).join('')}`;
    }

    function downloadCsv(rows, title) {
      const safeName = String(title || 'afluencia').replace(/[^\w\-]+/g, '_').slice(0, 48);
      const stamp = new Date().toISOString().slice(0, 10);
      const isPruebas = currentMeta.kpi === 'pruebas';
      const headers = isPruebas
        ? ['Fecha', 'Cliente', 'Telefono', 'Ejecutivo', 'Sucursal', 'Auto', 'VIN', 'ID CRM', 'Compro']
        : ['Fecha', 'Hora', 'Cliente', 'Telefono', 'Asesor', 'Sucursal', 'Medio', 'Submedio', 'Reconciliacion', 'ID CRM', 'Compro'];
      const lines = [headers.join(',')];
      for (const r of rows) {
        const compra = r.conCompra ? 'SI' : 'NO';
        const cols = isPruebas
          ? [r.fecha, r.cliente, r.telefono, r.ejecutivo, r.sucursal, r.autoInteres || r.tipoAuto, r.vin, r.idCrm, compra]
          : [r.fecha, r.hora, r.cliente, r.telefono, r.asesor, r.sucursal, r.medio, r.submedio, r.reconciliacion, r.idCrm, compra];
        lines.push(cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}_${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    function close() {
      panel.classList.remove('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ops-orders-drawer-open');
      expanded = false;
      panel.classList.remove('ops-orders-drawer--expanded');
      if (expandIcon) expandIcon.textContent = 'open_in_full';
      if (expandBtn) expandBtn.title = 'Expandir';
      clearPlacement();
      activeFilter = null;
      lastCard = null;
      state.openKpi = null;
      renderKpis();
    }

    function open(kpiKey, card) {
      const meta = kpiMetaAf(kpiKey);
      const resolvedCard = card || document.querySelector(`[data-af-kpi="${kpiKey}"]`);

      if (state.openKpi === kpiKey && panel.classList.contains('ops-orders-drawer--open')) {
        close();
        return;
      }

      currentMeta = {
        kpi: kpiKey,
        title: meta.title,
        hint: meta.hint,
        icon: meta.icon || 'groups',
      };
      lastCard = resolvedCard;
      state.openKpi = kpiKey;
      activeFilter = null;

      const metric = KPI_TO_METRIC[kpiKey];
      if (metric) {
        state.metric = metric;
        syncMetricChips();
      }

      if (titleEl) titleEl.textContent = currentMeta.title;
      if (logoEl) logoEl.textContent = currentMeta.icon;
      panel.setAttribute('aria-label', currentMeta.title);
      if (searchEl) {
        searchEl.value = '';
        searchEl.placeholder = 'Buscar cliente, asesor, sucursal…';
      }

      sourceRows = rowsForAfKpi(kpiKey).slice();
      updateFilterChip();
      placeNearKpi(resolvedCard);
      setExpanded(true);
      renderList('');
      panel.classList.add('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-orders-drawer-open');
      renderKpis();
      window.setTimeout(() => searchEl?.focus({ preventScroll: true }), 180);
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-af-kpi-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));
    downloadBtn?.addEventListener('click', () => {
      if (!lastExportRows.length) {
        window.alert('No hay registros para descargar.');
        return;
      }
      downloadCsv(lastExportRows, currentMeta.title);
    });
    searchEl?.addEventListener('input', () => renderList(searchEl.value));
    filterChip?.addEventListener('click', clearFilter);
    summaryEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-filter-dim]');
      if (!btn || !summaryEl.contains(btn)) return;
      setFilter(btn.dataset.afFilterDim, btn.dataset.afFilterValue, btn.dataset.afFilterValue);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('ops-orders-drawer--open')) close();
    });

    afluenciaDrawerUi = { open, close, panel };
    return afluenciaDrawerUi;
  }

  function setOpenKpi(key, card) {
    if (!KPI_TO_METRIC[key]) return;
    ensureAfluenciaKpiDrawer().open(key, card);
  }

  function syncMktChips() {
    els.mktTraficoView?.querySelectorAll('[data-af-mkt-view]').forEach((btn) => {
      const on = btn.dataset.afMktView === state.mktView;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    els.mktLeadsFilter?.querySelectorAll('[data-af-mkt-leads]').forEach((btn) => {
      const on = btn.dataset.afMktLeads === state.mktLeadsFilter;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderMarketingKpis() {
    if (!els.mktKpis) return;
    const m = marketing();
    const t = m?.trafico?.summary || {};
    const l = m?.leads?.summary || {};
    if (!m) {
      els.mktKpis.innerHTML = '';
      return;
    }
    els.mktKpis.innerHTML = `
      <div class="kpi-group">
        <h4 class="kpi-group-title">Marketing · periodo</h4>
        <div class="kpi-grid">
          ${kpiCardStatic('Tráfico marketing', num(t.afluenciaMarketing), `${pct(t.pctMarketing)} de la afluencia`, 'blue', 'campaign', 'kpiMktTraficoMarketing')}
          ${kpiCardStatic('Tráfico orgánico', num(t.afluenciaOrganico), `${pct(t.pctOrganico)} piso / cartera / referido`, 'slate', 'storefront', 'kpiMktTraficoOrganico')}
          ${kpiCardStatic('Compras por canal', num(t.compras), `conv. ${pct(t.conversionCompraPct)} vs afluencia`, 'amber', 'shopping_cart', 'kpiMktComprasCanal')}
          ${kpiCardStatic('Campañas activas', num(l.campanasActivas), `${num(l.leads)} leads en el periodo`, 'violet', 'ads_click', 'kpiMktCampanasActivas')}
          ${kpiCardStatic('Campañas funcionando', num(l.campanasFuncionando), `${num(l.citas)} citas · ${num(l.compras)} compras`, 'green', 'trending_up', 'kpiMktCampanasFuncionando')}
        </div>
      </div>`;
  }

  function traficoRowsForView() {
    const t = marketing()?.trafico || {};
    if (state.mktView === 'medio') return t.porMedio || [];
    if (state.mktView === 'pair') return t.porMedioSubmedio || [];
    if (state.mktView === 'forma') return t.porFormaContacto || [];
    return t.porSubmedio || [];
  }

  function renderMarketingTrafico() {
    if (!els.mktTraficoBody) return;
    if (els.mktTraficoCol) {
      els.mktTraficoCol.textContent = MKT_VIEW_LABEL[state.mktView] || 'Origen';
    }
    const rows = traficoRowsForView();
    const total = Number(marketing()?.trafico?.summary?.afluenciaTotal || 0);
    if (!rows.length) {
      els.mktTraficoBody.innerHTML = '<tr class="empty-row"><td colspan="8">Sin afluencia atribuible en el periodo.</td></tr>';
      return;
    }
    els.mktTraficoBody.innerHTML = rows.map((r) => {
      const mix = total ? ((Number(r.afluencia || 0) / total) * 100) : 0;
      const isMkt = Number(r.marketing || 0) >= Number(r.organico || 0) && Number(r.marketing || 0) > 0;
      const tipo = state.mktView === 'forma'
        ? '—'
        : (isMkt ? 'Marketing' : 'Orgánico');
      const tipoCls = isMkt ? 'fi-list-chip fi-list-chip--ok' : 'fi-list-chip';
      const conv = r.conversionCompraPct != null
        ? pct(r.conversionCompraPct)
        : (Number(r.afluencia || 0) ? pct(0) : '—');
      return `
        <tr>
          <td><strong>${escapeHtml(r.grupo)}</strong></td>
          <td class="cell-num">${num(r.afluencia)}</td>
          <td class="cell-num">${num(r.freshUp)}</td>
          <td class="cell-num">${num(r.citas)}</td>
          <td class="cell-num">${num(r.compras)}</td>
          <td class="cell-num">${conv}</td>
          <td class="cell-num">${pct(mix)}</td>
          <td>${tipo === '—' ? '—' : `<span class="${tipoCls}">${tipo}</span>`}</td>
        </tr>`;
    }).join('');
  }

  function leadsRowsFiltered() {
    const rows = marketing()?.leads?.porCampana || [];
    if (state.mktLeadsFilter === 'funcionando') return rows.filter((r) => r.funcionando);
    if (state.mktLeadsFilter === 'volumen') return rows.filter((r) => Number(r.leads || 0) >= 50);
    return rows;
  }

  function renderMarketingLeads() {
    if (!els.mktLeadsBody) return;
    const l = marketing()?.leads?.summary || {};
    if (els.mktLeadsResumen) {
      els.mktLeadsResumen.textContent = `${num(l.campanasActivas)} activas · ${num(l.campanasFuncionando)} funcionando · ${num(l.leads)} leads · ${num(l.citas)} citas · ${num(l.compras)} compras`;
    }
    const rows = leadsRowsFiltered();
    if (!rows.length) {
      els.mktLeadsBody.innerHTML = '<tr class="empty-row"><td colspan="9">Sin campañas de leads en el periodo (o con el filtro actual).</td></tr>';
      return;
    }
    els.mktLeadsBody.innerHTML = rows.map((r) => {
      const estadoCls = r.funcionando
        ? 'fi-list-chip fi-list-chip--ok'
        : (Number(r.leads || 0) >= 50 ? 'fi-list-chip fi-list-chip--warn' : 'fi-list-chip');
      return `
        <tr>
          <td><strong>${escapeHtml(r.campana)}</strong></td>
          <td>${escapeHtml(r.canal)}</td>
          <td class="cell-num">${num(r.leads)}</td>
          <td class="cell-num">${num(r.contactados)}</td>
          <td class="cell-num">${num(r.citas)}</td>
          <td class="cell-num">${num(r.compras)}</td>
          <td class="cell-num">${pct(r.conversionCitaPct)}</td>
          <td class="cell-num">${pct(r.conversionCompraPct)}</td>
          <td><span class="${estadoCls}">${escapeHtml(r.estado || '—')}</span></td>
        </tr>`;
    }).join('');
  }

  function severityTone(sev) {
    if (sev === 'critical') return 'rose';
    if (sev === 'warning') return 'amber';
    return 'blue';
  }

  function renderMktInsightCards(insights) {
    if (!els.mktInsightCards) return;
    const list = Array.isArray(insights) ? insights : [];
    if (!list.length) {
      els.mktInsightCards.innerHTML = `
        <div class="liquidez-note mtk-insight-card">
          <span class="liquidez-note__badge liquidez-note__badge--blue">MTK</span>
          <p class="liquidez-note__summary">Sin diagnósticos aún. Consulte un periodo con datos de afluencia y campañas.</p>
        </div>`;
      return;
    }

    els.mktInsightCards.innerHTML = list.map((ins, idx) => {
      const tone = severityTone(ins.severity);
      const recs = Array.isArray(ins.recommendations) ? ins.recommendations : [];
      const badge = escapeHtml(ins.badge || (ins.severity === 'critical' ? 'Crítico' : ins.severity === 'warning' ? 'Alerta' : 'Info'));
      return `
        <article class="liquidez-note mtk-insight-card pe-insight-note${ins.severity === 'critical' ? ' pe-insight-note--critical' : ''}${ins.severity === 'warning' ? ' pe-insight-note--warning' : ''}" data-mtk-insight="${idx}">
          <span class="liquidez-note__badge liquidez-note__badge--${tone}">${badge}</span>
          <p class="liquidez-note__summary"><strong>${escapeHtml(ins.title || 'Diagnóstico')}</strong></p>
          <p class="liquidez-note__summary">${escapeHtml(ins.summary || '')}</p>
          ${ins.analysis ? `<p class="liquidez-note__hint"><strong>Análisis.</strong> ${escapeHtml(ins.analysis)}</p>` : ''}
          ${recs.length ? `<ul class="liquidez-note__facts">${recs.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
          ${ins.chatPrompt ? `<p class="liquidez-note__theory"><button type="button" class="btn-glass btn-primary pe-insight-chat-btn" data-mtk-insight-chat="${idx}">Más información en el asistente</button></p>` : ''}
        </article>`;
    }).join('');

    els.mktInsightCards.querySelectorAll('[data-mtk-insight-chat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-mtk-insight-chat'));
        const prompt = list[i]?.chatPrompt;
        if (!prompt) return;
        if (window.AssistantBubble?.open) window.AssistantBubble.open(prompt);
        else window.alert('El asistente IA no está disponible en esta página.');
      });
    });
  }

  async function applyMarketingInsights() {
    const m = marketing();
    if (!m || !window.KpiInsights?.apply) {
      renderMktInsightCards([]);
      return;
    }

    let campanasConversion = null;
    try {
      campanasConversion = window.LeadsVentas?.getCampanasConversion?.() || null;
    } catch { /* ignore */ }

    const insights = await window.KpiInsights.apply('marketing', {
      fechaInicio: state.fechaInicio,
      fechaFin: state.fechaFin,
      trafico: m.trafico || {},
      leads: m.leads || {},
      campanasConversion: campanasConversion || undefined,
    });
    renderMktInsightCards(insights);
  }

  function renderMarketing() {
    const m = marketing();
    if (els.mktSubtitle) {
      els.mktSubtitle.textContent = m
        ? `Periodo ${state.fechaInicio} → ${state.fechaFin} · tráfico piso (medio/submedio) + campañas CRM de leads`
        : 'Sin datos de marketing para el periodo.';
    }
    syncMktChips();
    renderMarketingKpis();
    renderMarketingTrafico();
    renderMarketingLeads();
    applyMarketingInsights();
  }

  function setInnerTab(tab) {
    const next = tab === 'mtk' ? 'mtk' : 'general';
    state.innerTab = next;

    els.innerTabs?.querySelectorAll('[data-af-tab]').forEach((btn) => {
      const on = btn.dataset.afTab === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const showGeneral = next === 'general';
    if (els.panelGeneral) {
      els.panelGeneral.classList.toggle('hidden', !showGeneral);
      els.panelGeneral.hidden = !showGeneral;
    }
    if (els.panelMtk) {
      els.panelMtk.classList.toggle('hidden', showGeneral);
      els.panelMtk.hidden = showGeneral;
    }

    if (els.subtitle) {
      if (next === 'mtk') {
        els.subtitle.textContent = state.fechaInicio && state.fechaFin
          ? `MTK · periodo ${state.fechaInicio} → ${state.fechaFin} · origen de tráfico y campañas de leads`
          : 'MTK · origen de tráfico piso y campañas de leads activas';
      } else if (state.fechaInicio && state.fechaFin) {
        els.subtitle.textContent = state.fechaInicio && state.fechaFin
          ? `Periodo ${state.fechaInicio} → ${state.fechaFin}`
          : 'Tráfico piso, SNV y pruebas de manejo.';
      }
    }

    if (next === 'mtk') {
      renderMarketing();
    } else if (state.data?.comparativoYtd) {
      // Al volver de MTK, re-pintar con el centro/métrica actuales (no solo resize).
      renderYtdChart();
    }

    const hash = next === 'mtk' ? '#afluencia-mtk' : '#afluencia';
    // Solo sincroniza hash si ya estamos en Afluencia; no forzar #afluencia al boot (Ventas es la pestaña principal).
    const current = String(location.hash || '').toLowerCase();
    const onAfluenciaRoute = current.startsWith('#afluencia')
      || current === '#trafico'
      || current === '#tráfico'
      || current === '#mtk'
      || current === '#marketing';
    if (onAfluenciaRoute && current !== hash) {
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    }
  }

  function bindDom() {
    els.root = document.getElementById('secAfluencia');
    els.subtitle = document.getElementById('afSubtitle');
    els.kpiRoot = document.getElementById('afKpiOperational');
    els.detailTitle = document.getElementById('afDetailTitle');
    els.detailResumen = document.getElementById('afDetailResumen');
    els.metricChips = document.getElementById('afYtdMetricChips');
    els.centroChips = document.getElementById('afYtdCentroChips');
    els.quarterChips = document.getElementById('afYtdQuarterChips');
    els.ytdChart = document.getElementById('afYtdChart');
    els.ytdEmpty = document.getElementById('afYtdEmpty');
    els.innerTabs = document.getElementById('afInnerTabs');
    els.panelGeneral = document.getElementById('afPanelGeneral');
    els.panelMtk = document.getElementById('afPanelMtk');
    els.mktSubtitle = document.getElementById('afMktSubtitle');
    els.mktKpis = document.getElementById('afMktKpis');
    els.mktInsightCards = document.getElementById('afMktInsightCards');
    els.mktTraficoView = document.getElementById('afMktTraficoView');
    els.mktTraficoCol = document.getElementById('afMktTraficoCol');
    els.mktTraficoBody = document.getElementById('afMktTraficoBody');
    els.mktLeadsFilter = document.getElementById('afMktLeadsFilter');
    els.mktLeadsResumen = document.getElementById('afMktLeadsResumen');
    els.mktLeadsBody = document.getElementById('afMktLeadsBody');

    els.innerTabs?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-tab]');
      if (!btn) return;
      setInnerTab(btn.dataset.afTab);
    });

    els.kpiRoot?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-kpi]');
      if (!btn || !els.kpiRoot.contains(btn)) return;
      setOpenKpi(btn.dataset.afKpi, btn);
    });

    els.metricChips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-metric]');
      if (!btn) return;
      const metric = btn.dataset.afMetric;
      const kpiKey = Object.keys(KPI_TO_METRIC).find((k) => KPI_TO_METRIC[k] === metric) || null;
      setMetric(metric, { fromKpi: kpiKey });
    });

    els.centroChips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-centro]');
      if (!btn || !els.centroChips.contains(btn)) return;
      e.preventDefault();
      void setCentro(btn.dataset.afCentro);
    });

    els.quarterChips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-quarter]');
      if (!btn) return;
      toggleQuarter(btn.dataset.afQuarter);
    });

    els.mktTraficoView?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-mkt-view]');
      if (!btn) return;
      state.mktView = btn.dataset.afMktView;
      syncMktChips();
      renderMarketingTrafico();
    });

    els.mktLeadsFilter?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-mkt-leads]');
      if (!btn) return;
      state.mktLeadsFilter = btn.dataset.afMktLeads;
      syncMktChips();
      renderMarketingLeads();
    });
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    const force = Boolean(opts.force);
    const keepFilters = Boolean(opts.keepFilters);
    const key = `${fechaInicio}|${fechaFin}`;
    const periodChanged = state.cacheKey !== key;
    state.fechaInicio = fechaInicio;
    state.fechaFin = fechaFin;
    if (!keepFilters) {
      state.openKpi = null;
      state.metric = 'afluenciaTotal';
      state.mktView = 'submedio';
      state.mktLeadsFilter = 'todas';
      if (periodChanged) state.centro = 'todos';
      afluenciaDrawerUi?.close?.();
    }

    if (els.subtitle && state.innerTab === 'general') {
      els.subtitle.textContent = `Periodo ${fechaInicio} → ${fechaFin}`;
    }

    const paint = () => {
      initQuartersFromData();
      syncMetricChips();
      syncCentroChips();
      syncQuarterChips();
      renderKpis();
      renderYtdChart();
      renderMarketing();
      setInnerTab(state.innerTab);
    };

    // Caché sin porCentro = obsoleta (antes del filtro por centro).
    const cacheOk = !force
      && state.cacheKey === key
      && state.data
      && !state.data.error
      && hasPorCentro();

    if (cacheOk) {
      paint();
      return state.data;
    }
    if (!force && state.inflightKey === key && state.inflightPromise) {
      await state.inflightPromise;
      paint();
      return state.data;
    }

    state.inflightKey = key;
    state.inflightPromise = (async () => {
      try {
        const qs = new URLSearchParams({ fechaInicio, fechaFin, limit: '5000' });
        const res = await fetch(`/api/ventas/afluencia?${qs}`, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Error afluencia (${res.status})`);
        state.data = data;
        state.cacheKey = key;
      } catch (err) {
        console.error('[Afluencia]', err);
        state.cacheKey = null;
        state.data = {
          summary: {},
          porSucursal: [],
          comparativoYtd: null,
          marketing: null,
          error: err.message,
        };
        if (els.subtitle) els.subtitle.textContent = err.message;
      } finally {
        if (state.inflightKey === key) {
          state.inflightKey = null;
          state.inflightPromise = null;
        }
      }
      return state.data;
    })();

    await state.inflightPromise;
    paint();
    return state.data;
  }

  function hasCache(fechaInicio, fechaFin) {
    return state.cacheKey === `${fechaInicio}|${fechaFin}`
      && state.data
      && !state.data.error
      && hasPorCentro();
  }

  function init() {
    bindDom();
    const hash = String(location.hash || '').toLowerCase();
    const startTab = (hash === '#afluencia-mtk' || hash === '#mtk' || hash === '#marketing') ? 'mtk' : 'general';
    syncMetricChips();
    syncCentroChips();
    syncQuarterChips();
    syncMktChips();
    setInnerTab(startTab);
  }

  window.AfluenciaVentas = { init, load, hasCache, setInnerTab };
})();
