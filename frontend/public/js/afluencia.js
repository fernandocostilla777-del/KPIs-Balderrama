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
    quarters: new Set([1, 2, 3, 4]),
    mktView: 'submedio',
    mktLeadsFilter: 'todas',
    innerTab: 'general',
    cacheKey: null,
    inflightKey: null,
    inflightPromise: null,
  };

  let ytdChart = null;
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
        title="Clic para ver esta métrica en el comparativo YTD">
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

  function renderKpis() {
    if (!els.kpiRoot) return;
    const s = summary();
    els.kpiRoot.innerHTML = `
      <div class="kpi-group">
        <h4 class="kpi-group-title">Afluencia general</h4>
        <div class="kpi-grid">
          ${kpiCard('afluencia', 'Afluencia total', num(s.afluenciaTotal), 'Fresh up + Citas', 'blue', 'groups')}
          ${kpiCard('freshUp', 'Fresh up', num(s.freshUp), 'Columna T · Reconciliación', 'green', 'person_add')}
          ${kpiCard('citas', 'Citas', num(s.citas), 'Columna T · Reconciliación', 'amber', 'event')}
          ${kpiCard('snv', 'SNV', num(s.snv), 'Seguimiento a no vendidas', 'rose', 'history_edu')}
          ${kpiCard('pruebas', 'Pruebas de manejo', num(s.pruebasManejo), 'Hoja Prueba de manejo', 'violet', 'directions_car')}
        </div>
      </div>`;
  }

  function renderSucursales() {
    if (!els.sucursalesBody) return;
    const rows = state.data?.porSucursal || [];
    if (!rows.length) {
      els.sucursalesBody.innerHTML = '<tr class="empty-row"><td colspan="7">Sin datos de afluencia en el periodo.</td></tr>';
      return;
    }
    els.sucursalesBody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${escapeHtml(r.sucursal)}</strong></td>
        <td class="cell-num">${num(r.afluenciaTotal)}</td>
        <td class="cell-num">${num(r.freshUp)}</td>
        <td class="cell-num">${num(r.citas)}</td>
        <td class="cell-num">${num(r.snv)}</td>
        <td class="cell-num">${num(r.pruebasManejo)}</td>
        <td class="cell-num">${num(r.registros)}</td>
      </tr>
    `).join('');
  }

  function availableQuarters() {
    const list = state.data?.comparativoYtd?.trimestres || [];
    return new Set(list.map((t) => Number(t.quarter)).filter((q) => q >= 1 && q <= 4));
  }

  function syncMetricChips() {
    els.metricChips?.querySelectorAll('[data-af-metric]').forEach((btn) => {
      const on = btn.dataset.afMetric === state.metric;
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
    state.quarters = new Set(avail);
  }

  function setMetric(metric, { fromKpi = null } = {}) {
    if (!METRIC_LABEL[metric]) return;
    state.metric = metric;
    state.openKpi = fromKpi;
    syncMetricChips();
    renderKpis();
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
    const cmp = state.data?.comparativoYtd;
    const canvas = els.ytdChart;
    const empty = els.ytdEmpty;
    if (!canvas) return;

    if (els.detailTitle) {
      els.detailTitle.textContent = 'Comparativo YTD por trimestre';
    }
    if (els.detailResumen) {
      if (cmp) {
        const hasta = cmp.hasta ? ` · YTD al ${cmp.hasta}` : '';
        els.detailResumen.textContent = `${METRIC_LABEL[state.metric] || 'Métrica'} · ${cmp.anioActual} vs ${cmp.anioAnterior}${hasta} · meses del trimestre`;
      } else {
        els.detailResumen.textContent = 'Año actual vs año anterior · meses del trimestre · solo NUEVOS';
      }
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
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      })
      : {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true } },
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

  function setOpenKpi(key) {
    const metric = KPI_TO_METRIC[key];
    if (!metric) return;
    if (state.openKpi === key) {
      setMetric('afluenciaTotal', { fromKpi: null });
      return;
    }
    setMetric(metric, { fromKpi: key });
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
        els.subtitle.textContent = `Periodo ${state.fechaInicio} → ${state.fechaFin} · Solo NUEVOS (col R) · Fresh up + Citas (col T) · SNV · Pruebas de manejo`;
      }
    }

    if (next === 'mtk') {
      renderMarketing();
    } else if (ytdChart == null && state.data?.comparativoYtd) {
      renderYtdChart();
    } else if (ytdChart) {
      // Chart.js a veces queda en 0×0 si el canvas estaba oculto
      try { ytdChart.resize(); } catch { /* ignore */ }
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
    els.sucursalesBody = document.getElementById('afSucursalesBody');
    els.detailTitle = document.getElementById('afDetailTitle');
    els.detailResumen = document.getElementById('afDetailResumen');
    els.metricChips = document.getElementById('afYtdMetricChips');
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
      if (!btn) return;
      setOpenKpi(btn.dataset.afKpi);
    });

    els.metricChips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-af-metric]');
      if (!btn) return;
      const metric = btn.dataset.afMetric;
      const kpiKey = Object.keys(KPI_TO_METRIC).find((k) => KPI_TO_METRIC[k] === metric) || null;
      setMetric(metric, { fromKpi: kpiKey });
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
    const key = `${fechaInicio}|${fechaFin}`;
    state.fechaInicio = fechaInicio;
    state.fechaFin = fechaFin;
    state.openKpi = null;
    state.metric = 'afluenciaTotal';
    state.mktView = 'submedio';
    state.mktLeadsFilter = 'todas';

    if (els.subtitle && state.innerTab === 'general') {
      els.subtitle.textContent = `Periodo ${fechaInicio} → ${fechaFin} · Solo NUEVOS (col R) · Fresh up + Citas (col T) · SNV · Pruebas de manejo`;
    }

    const paint = () => {
      initQuartersFromData();
      syncMetricChips();
      syncQuarterChips();
      renderKpis();
      renderSucursales();
      renderYtdChart();
      renderMarketing();
      setInnerTab(state.innerTab);
    };

    if (!force && state.cacheKey === key && state.data && !state.data.error) {
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
        const qs = new URLSearchParams({ fechaInicio, fechaFin, limit: '800' });
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
    return state.cacheKey === `${fechaInicio}|${fechaFin}` && state.data && !state.data.error;
  }

  function init() {
    bindDom();
    const hash = String(location.hash || '').toLowerCase();
    const startTab = (hash === '#afluencia-mtk' || hash === '#mtk' || hash === '#marketing') ? 'mtk' : 'general';
    syncMetricChips();
    syncQuarterChips();
    syncMktChips();
    setInnerTab(startTab);
  }

  window.AfluenciaVentas = { init, load, hasCache, setInnerTab };
})();
