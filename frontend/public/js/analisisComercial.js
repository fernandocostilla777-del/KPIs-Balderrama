/**
 * CMI Comercial (C-1…C-12.1) — montado por sección del dashboard
 * (Ventas / Financiamiento / Inventario), no en un tab único.
 */
(function initAnalisisComercial() {
  let acData = null;
  let activeClave = null;
  let lastPeriod = null;
  let chartAntiguedad = null;
  let chartTipoCliente = null;

  const ANTIGUEDAD_BUCKETS = [
    { key: '0-30', label: '0–30 días', color: '#059669' },
    { key: '31-90', label: '31–90 días', color: '#2563eb' },
    { key: '91-180', label: '91–180 días', color: '#d97706' },
    { key: '>180', label: '>180 días', color: '#e11d48' },
    { key: 'sin', label: 'Sin clasificar', color: '#94a3b8' },
  ];

  const TIPO_CLIENTE_SLICES = [
    { key: 'primeraCompra', label: '1ª compra', color: '#2563eb' },
    { key: 'recurrente', label: 'Recurrentes', color: '#059669' },
    { key: 'sinClasificar', label: 'Sin clasificar', color: '#94a3b8' },
  ];

  const KPI_ICONS = {
    'C-1': 'local_shipping',
    'C-1.1': 'difference',
    'C-2': 'pie_chart',
    'C-2.1': 'account_tree',
    'C-3': 'hourglass_bottom',
    'C-4': 'public',
    'C-5': 'account_balance',
    'C-6': 'group',
    'C-6.1': 'schedule',
    'C-7': 'groups',
    'C-8': 'trending_down',
    'C-9': 'receipt_long',
    'C-10': 'swap_horiz',
    'C-10.1': 'percent',
    'C-11': 'extension',
    'C-11.1': 'payments',
    'C-12': 'sensors',
    'C-12.1': 'wifi_tethering',
  };

  /** Textos de negocio (UI); la clave CMI se mantiene como referencia en la ficha. */
  const KPI_UI = {
    'C-10': {
      label: 'Cumplimiento vs meta',
      sub: 'Tomas del periodo contra el objetivo de TAC',
    },
    'C-10.1': {
      label: 'Participación en entregas',
      sub: 'Qué porcentaje de entregas llevó toma a cuenta',
    },
  };

  /** Dónde vive cada bloque en el dashboard */
  const MOUNTS = [
    // PENDIENTE: C-4 / C-7 / C-8 (CMI · mercado y fuerza) — fichas ocultas de momento.
    // Al reactivar: restaurar #acMountVentasCore en sales.html y este mount:
    // { id: 'acMountVentasCore', claves: ['C-4', 'C-7', 'C-8'], title: 'CMI · mercado y fuerza' },
    // C-2 / C-2.1 se visualizan en #mixSummary (sección Mix de entregas), no como fichas genéricas.
    {
      id: 'acMountTomas',
      claves: ['C-10', 'C-10.1'],
      title: 'Avance de tomas a cuenta',
    },
    // C-3 vive en el KPI «Antigüedad» de Inventario (#kpiAgeingAlerts).
    // C-5 ya vive como «Penetración GMF». C-11/C-11.1/C-12/C-12.1 (accesorios/OnStar):
    // sección #acMountFi retirada de sales.html; backend conserva el cálculo.
  ];

  function formatPeriodLabel(fechaInicio, fechaFin) {
    const fmt = (iso) => {
      const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return iso || '—';
      return `${m[3]}/${m[2]}/${m[1]}`;
    };
    if (!fechaInicio || !fechaFin) return '—';
    return `${fmt(fechaInicio)} – ${fmt(fechaFin)}`;
  }

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Dashboard.fmt.money(value);
  }

  function fmtNum(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Dashboard.fmt.number(value);
  }

  function formatDisplay(kpi) {
    if (kpi.display != null && kpi.display !== '' && kpi.unidad !== 'MXN') return kpi.display;
    if (kpi.unidad === 'MXN') return fmtMoney(kpi.valor);
    if (kpi.valor == null) return '—';
    if (kpi.unidad === '%') return `${kpi.valor}%`;
    if (kpi.unidad === 'unidades') return fmtNum(kpi.valor);
    return String(kpi.valor);
  }

  function statusLabel(status) {
    if (status === 'completo') return 'Completo';
    if (status === 'pendiente_meta') return 'Falta meta';
    return 'Parcial';
  }

  function accentFromTone(tone) {
    if (tone === 'green' || tone === 'amber' || tone === 'rose' || tone === 'blue' || tone === 'violet') return tone;
    return 'slate';
  }

  function sortByClaves(kpis, claves) {
    const map = new Map((kpis || []).map((k) => [k.clave, k]));
    return claves.map((c) => map.get(c)).filter(Boolean);
  }

  function formatDetalleValue(key, value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) {
      if (!value.length) return '—';
      if (typeof value[0] === 'object') {
        return value.slice(0, 8).map((r) => {
          const linea = r.linea || r.parte || '—';
          const brecha = r.brecha != null ? ` brecha ${r.brecha}` : '';
          return `${linea}: ${r.real ?? '—'}/${r.meta ?? '—'}${brecha}`;
        }).join(' · ');
      }
      return value.slice(0, 12).join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    const k = String(key).toLowerCase();
    if (k.includes('pct') || k.includes('margen') || k.includes('penetracion')) return `${value}%`;
    if (k.includes('monto') || k.includes('piso') || k.includes('mxn')) return fmtMoney(value);
    if (k.includes('unidad') || k.includes('entrega') || k.includes('linea') || k.includes('asesor') || k.includes('contrato')) {
      return fmtNum(value);
    }
    return String(value);
  }

  function renderKpiCard(kpi) {
    const tone = kpi.tone || 'slate';
    const isOpen = activeClave === kpi.clave;
    const disabled = kpi.disponible === false && kpi.valor == null;
    const ui = KPI_UI[kpi.clave] || {};
    const label = ui.label || kpi.nombre || kpi.clave;
    const sub = ui.sub || kpi.descripcion || '';
    return `<button type="button" class="eeff-edo-kpi eeff-edo-kpi--${tone} eeff-edo-kpi--interactive af-kpi${isOpen ? ' is-open is-selected' : ''}${disabled ? ' is-muted' : ''}"
      data-ac-kpi="${escHtml(kpi.clave)}" aria-pressed="${isOpen}" title="Ver detalle">
      <div class="eeff-edo-kpi__head">
        <span class="eeff-edo-kpi__clave">${escHtml(kpi.clave)}</span>
        <span class="af-kpi__status af-kpi__status--${escHtml(kpi.status || 'parcial')}">${statusLabel(kpi.status)}</span>
      </div>
      <div class="eeff-edo-kpi__label">${escHtml(label)}</div>
      <div class="eeff-edo-kpi__value">${formatDisplay(kpi)}</div>
      <p class="eeff-edo-kpi__sub">${escHtml(sub)}</p>
      <span class="af-kpi__hint">Clic para detalle</span>
    </button>`;
  }

  function buildDetailSections(kpi) {
    const sections = [];
    const calcRows = [];
    if (kpi.formula) calcRows.push({ label: 'Fórmula', value: kpi.formula, text: true });
    if (kpi.numerador != null) {
      calcRows.push({
        label: 'Numerador',
        value: kpi.unidad === '%' || kpi.unidad === 'unidades' ? fmtNum(kpi.numerador) : fmtMoney(kpi.numerador),
      });
    }
    if (kpi.denominador != null) {
      calcRows.push({
        label: 'Denominador',
        value: kpi.unidad === '%' || kpi.unidad === 'unidades' ? fmtNum(kpi.denominador) : fmtMoney(kpi.denominador),
      });
    }
    if (kpi.valor != null) calcRows.push({ label: 'Resultado', value: formatDisplay(kpi), highlight: true });
    if (calcRows.length) sections.push({ title: 'Cálculo', rows: calcRows });

    const metaRows = [];
    if (kpi.meta != null) {
      metaRows.push({
        label: 'Meta',
        value: kpi.unidad === '%' ? `${kpi.meta}%` : (kpi.unidad === 'MXN' ? fmtMoney(kpi.meta) : fmtNum(kpi.meta)),
      });
    }
    metaRows.push({ label: 'Estado del dato', value: statusLabel(kpi.status) });
    sections.push({ title: 'Meta y cobertura', rows: metaRows });

    const d = kpi.detalle || {};
    const detRows = Object.entries(d)
      .filter(([, v]) => v != null && v !== '')
      .map(([key, value]) => ({
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        value: formatDetalleValue(key, value),
        text: Array.isArray(value) || typeof value === 'object',
      }));
    if (detRows.length) sections.push({ title: 'Componentes', rows: detRows });

    if (kpi.nota) {
      sections.push({
        title: 'Nota / lectura',
        rows: [{ label: 'Observación', value: kpi.nota, text: true }],
      });
    }
    return sections;
  }

  function closeDetail() {
    activeClave = null;
    const panel = document.getElementById('acKpiFloat');
    const backdrop = document.getElementById('acKpiFloatBackdrop');
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
    if (backdrop) {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    renderMounts();
  }

  function renderDetail(kpi) {
    const panel = document.getElementById('acKpiFloat');
    const backdrop = document.getElementById('acKpiFloatBackdrop');
    if (!panel || !backdrop || !kpi) {
      closeDetail();
      return;
    }
    const accent = accentFromTone(kpi.tone);
    const sections = buildDetailSections(kpi);
    const icon = KPI_ICONS[kpi.clave] || 'analytics';
    const periodo = acData?.periodo
      ? `${acData.periodo.fechaInicio} → ${acData.periodo.fechaFin}`
      : '';

    const bodyHtml = sections.map((section) => {
      const rows = section.rows.map((row) => {
        if (row.text) {
          return `<tr class="bg-kpi-float__text-row">
            <td>${escHtml(row.label)}</td>
            <td>${escHtml(String(row.value))}</td>
          </tr>`;
        }
        return `<tr class="${row.highlight ? 'bg-kpi-float__highlight-row' : ''}">
          <td>${escHtml(row.label)}</td>
          <td class="cell-money"><strong>${escHtml(String(row.value))}</strong></td>
        </tr>`;
      }).join('');
      return `<div class="bg-kpi-float__group">
        <p class="bg-kpi-float__section">${escHtml(section.title)}</p>
        <table class="bg-kpi-float__table">
          <thead><tr><th>Concepto</th><th class="cell-money">Valor</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');

    panel.dataset.accent = accent;
    panel.innerHTML = `
      <div class="bg-kpi-float__head bg-kpi-float__head--${accent}">
        <div class="bg-kpi-float__head-main">
          <div class="bg-kpi-float__icon bg-kpi-float__icon--${accent}" aria-hidden="true">
            <span class="material-symbols-outlined">${icon}</span>
          </div>
          <div>
            <p class="bg-kpi-float__eyebrow">CMI comercial · ${escHtml(kpi.clave)}</p>
            <h3 class="bg-kpi-float__title" id="acKpiFloatTitle">${escHtml(kpi.nombre)}</h3>
            <p class="bg-kpi-float__value">${formatDisplay(kpi)}</p>
            <p class="bg-kpi-float__hint">${escHtml(kpi.descripcion || '')}</p>
            <span class="bg-kpi-float__meta">${escHtml(periodo)} · ${statusLabel(kpi.status)}</span>
          </div>
        </div>
        <button type="button" class="bg-kpi-float__close" data-ac-close-detail aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="bg-kpi-float__body">
        ${bodyHtml || '<div class="bg-kpi-float__group"><p class="section-subtitle">Sin desglose disponible.</p></div>'}
      </div>`;

    panel.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function destroyAntiguedadChart() {
    if (chartAntiguedad) {
      chartAntiguedad.destroy();
      chartAntiguedad = null;
    }
  }

  function destroyTipoClienteChart() {
    if (chartTipoCliente) {
      chartTipoCliente.destroy();
      chartTipoCliente = null;
    }
  }

  function renderAntiguedadChart() {
    const canvas = document.getElementById('chartAntiguedadOrigen');
    const empty = document.getElementById('acAntiguedadEmpty');
    const meta = document.getElementById('acAntiguedadMeta');
    const periodEl = document.getElementById('acAntiguedadPeriod');
    if (!canvas) return;

    if (periodEl && lastPeriod) {
      periodEl.textContent = formatPeriodLabel(lastPeriod.fechaInicio, lastPeriod.fechaFin);
    }

    const kpi = (acData?.kpis || []).find((k) => k.clave === 'C-6.1');
    const d = kpi?.detalle || {};
    const counts = ANTIGUEDAD_BUCKETS.map((b) => {
      if (b.key === '0-30') return Number(d.rango_0_30) || 0;
      if (b.key === '31-90') return Number(d.rango_31_90) || 0;
      if (b.key === '91-180') return Number(d.rango_91_180) || 0;
      if (b.key === '>180') return Number(d.rango_mas_180) || 0;
      return Number(d.noClasificables) || 0;
    });
    const clasificables = Number(d.clasificables) || counts.slice(0, 4).reduce((s, n) => s + n, 0);
    const totalSofia = Number(d.totalEntregasSofia) || (clasificables + (Number(d.noClasificables) || 0));
    const total = counts.reduce((s, n) => s + n, 0);

    if (!kpi || totalSofia <= 0 || typeof Chart === 'undefined') {
      destroyAntiguedadChart();
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = !acData
          ? 'Consulte un periodo para ver la distribución.'
          : (kpi?.nota || 'Sin entregas SOFIA en el periodo para clasificar antigüedad.');
      }
      if (meta) meta.textContent = '';
      return;
    }

    empty?.classList.add('hidden');
    if (meta) {
      const cob = d.coberturaPct != null ? Math.round(Number(d.coberturaPct)) : null;
      const huecos = [];
      if (d.sinIdCrm) huecos.push(`${fmtNum(d.sinIdCrm)} sin vínculo CRM`);
      if (d.sinCaptura) huecos.push(`${fmtNum(d.sinCaptura)} sin fecha de captura`);
      const base = `${fmtNum(clasificables)} de ${fmtNum(totalSofia)} entregas con fecha de captura`
        + (cob != null ? ` (${cob}% del total)` : '');
      meta.textContent = huecos.length
        ? `${base} · pendientes: ${huecos.join(', ')}`
        : base;
    }

    destroyAntiguedadChart();
    chartAntiguedad = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ANTIGUEDAD_BUCKETS.map((b) => b.label),
        datasets: [{
          label: 'Entregas SOFIA',
          data: counts,
          backgroundColor: ANTIGUEDAD_BUCKETS.map((b) => b.color),
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const n = Number(ctx.raw) || 0;
                const pctTotal = totalSofia ? ((n / totalSofia) * 100).toFixed(1) : '0.0';
                const isSin = ctx.dataIndex === 4;
                if (isSin) return ` ${n} sin captura CRM (${pctTotal}% de entregas SOFIA)`;
                const pctClas = clasificables ? ((n / clasificables) * 100).toFixed(1) : '0.0';
                return ` ${n} · ${pctClas}% de clasificables · ${pctTotal}% de SOFIA`;
              },
            },
          },
          datalabels: typeof ChartDataLabels !== 'undefined'
            ? {
              display: true,
              anchor: 'end',
              align: 'top',
              offset: 2,
              clamp: true,
              formatter(value, ctx) {
                const n = Number(value) || 0;
                if (!n || !totalSofia) return '';
                const pct = Math.round((n / totalSofia) * 1000) / 10;
                return `${pct}%`;
              },
              color: '#1e293b',
              font: { family: 'Inter, Segoe UI, sans-serif', weight: '700', size: 12 },
            }
            : { display: false },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: '#64748b' },
            grid: { color: 'rgba(148,163,184,0.25)' },
            suggestedMax: Math.max(...counts, 1) * 1.18,
          },
        },
        layout: { padding: { top: 28, right: 8, bottom: 0, left: 0 } },
      },
      plugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : [],
    });
  }

  function renderTipoClienteChart() {
    const canvas = document.getElementById('chartTipoCliente');
    const empty = document.getElementById('acTipoClienteEmpty');
    const meta = document.getElementById('acTipoClienteMeta');
    const periodEl = document.getElementById('acTipoClientePeriod');
    if (!canvas) return;

    if (periodEl && lastPeriod) {
      periodEl.textContent = formatPeriodLabel(lastPeriod.fechaInicio, lastPeriod.fechaFin);
    }

    const kpi = (acData?.kpis || []).find((k) => k.clave === 'C-6');
    const d = kpi?.detalle || {};
    const slices = TIPO_CLIENTE_SLICES.map((s) => ({
      ...s,
      value: Number(d[s.key]) || 0,
    })).filter((s) => s.value > 0);
    const total = slices.reduce((sum, s) => sum + s.value, 0);

    if (!kpi || total <= 0 || typeof Chart === 'undefined') {
      destroyTipoClienteChart();
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = !acData
          ? 'Consulte un periodo para ver la composición.'
          : (kpi?.nota || 'Sin entregas clasificables por tipo de cliente en el periodo.');
      }
      if (meta) meta.textContent = '';
      return;
    }

    empty?.classList.add('hidden');
    if (meta) {
      const primera = d.pctPrimeraCompra != null ? Math.round(Number(d.pctPrimeraCompra)) : null;
      const recurrente = d.pctRecurrente != null ? Math.round(Number(d.pctRecurrente)) : null;
      const cob = d.coberturaPct != null ? Math.round(Number(d.coberturaPct)) : null;
      const parts = [`${fmtNum(total)} entregas clasificadas`];
      if (primera != null) parts.push(`${primera}% primera compra`);
      if (recurrente != null) parts.push(`${recurrente}% recurrentes`);
      if (cob != null) parts.push(`clasificadas ${cob}% del total SOFIA`);
      meta.textContent = parts.join(' · ');
    }

    destroyTipoClienteChart();
    chartTipoCliente = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: slices.map((s) => s.label),
        datasets: [{
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: '#64748b',
              boxWidth: 12,
              padding: 14,
              font: { family: 'Inter, Segoe UI, sans-serif', size: 12, weight: '600' },
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const n = Number(ctx.raw) || 0;
                const pct = total ? ((n / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.label}: ${n} (${pct}%)`;
              },
            },
          },
          datalabels: typeof ChartDataLabels !== 'undefined'
            ? {
              display: true,
              color: '#ffffff',
              font: { family: 'Inter, Segoe UI, sans-serif', weight: '700', size: 12 },
              textStrokeColor: 'rgba(15,23,42,0.35)',
              textStrokeWidth: 2,
              formatter(value) {
                const n = Number(value) || 0;
                if (!n || !total) return '';
                const pct = Math.round((n / total) * 1000) / 10;
                return pct >= 6 ? `${pct}%` : '';
              },
            }
            : { display: false },
        },
      },
      plugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : [],
    });
  }

  function renderMounts() {
    MOUNTS.forEach((mount) => {
      const el = document.getElementById(mount.id);
      if (!el) return;
      const row = el.querySelector('[data-ac-row]');
      const empty = el.querySelector('[data-ac-empty]');
      const loading = el.querySelector('[data-ac-loading]');
      loading?.classList.add('hidden');

      if (!acData?.kpis) {
        if (row) row.innerHTML = '';
        if (empty) {
          empty.classList.remove('hidden');
          empty.textContent = lastPeriod
            ? 'No se pudo cargar CMI para el periodo.'
            : 'Consulte un periodo para ver los KPI CMI.';
        }
        return;
      }

      const subset = sortByClaves(acData.kpis, mount.claves);
      if (row) row.innerHTML = subset.map(renderKpiCard).join('');
      empty?.classList.add('hidden');
    });
    renderAntiguedadChart();
    renderTipoClienteChart();
  }

  function setLoading(on) {
    MOUNTS.forEach((mount) => {
      const el = document.getElementById(mount.id);
      el?.querySelector('[data-ac-loading]')?.classList.toggle('hidden', !on);
    });
  }

  function openKpi(clave) {
    const kpi = (acData?.kpis || []).find((k) => k.clave === clave);
    if (!kpi) return;
    if (activeClave === clave) {
      closeDetail();
      return;
    }
    activeClave = clave;
    renderMounts();
    renderDetail(kpi);
  }

  function ensureFloatHost() {
    if (document.getElementById('acKpiFloat')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'acKpiFloatBackdrop';
    backdrop.className = 'bg-kpi-float-backdrop hidden';
    backdrop.setAttribute('aria-hidden', 'true');
    const panel = document.createElement('aside');
    panel.id = 'acKpiFloat';
    panel.className = 'bg-kpi-float hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'acKpiFloatTitle');
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
  }

  function bindClicks() {
    ensureFloatHost();
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ac-kpi]');
      if (btn) {
        openKpi(btn.getAttribute('data-ac-kpi'));
        return;
      }
      if (event.target.closest('[data-ac-close-detail]')) closeDetail();
      if (event.target.id === 'acKpiFloatBackdrop') closeDetail();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeClave) closeDetail();
    });
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    if (!fechaInicio || !fechaFin) return null;
    const force = Boolean(opts.force);
    const samePeriod = lastPeriod
      && lastPeriod.fechaInicio === fechaInicio
      && lastPeriod.fechaFin === fechaFin;

    if (!force && samePeriod && acData) {
      renderMounts();
      MOUNTS.forEach((mount) => {
        const el = document.getElementById(mount.id);
        const label = el?.querySelector('[data-ac-period]');
        if (label) label.textContent = formatPeriodLabel(fechaInicio, fechaFin);
      });
      return acData;
    }

    lastPeriod = { fechaInicio, fechaFin };
    setLoading(true);
    try {
      const qs = new URLSearchParams({ fechaInicio, fechaFin });
      acData = await Dashboard.api(`/ventas/analisis-comercial?${qs}`);
      closeDetail();
      renderMounts();
      MOUNTS.forEach((mount) => {
        const el = document.getElementById(mount.id);
        const label = el?.querySelector('[data-ac-period]');
        if (label) label.textContent = formatPeriodLabel(fechaInicio, fechaFin);
      });
      return acData;
    } catch (err) {
      acData = null;
      closeDetail();
      renderMounts();
      MOUNTS.forEach((mount) => {
        const empty = document.getElementById(mount.id)?.querySelector('[data-ac-empty]');
        if (empty) {
          empty.classList.remove('hidden');
          empty.textContent = err.message || 'No se pudo cargar los indicadores.';
        }
      });
      return null;
    } finally {
      setLoading(false);
    }
  }

  function hasCache(fechaInicio, fechaFin) {
    return Boolean(
      acData
      && lastPeriod
      && lastPeriod.fechaInicio === fechaInicio
      && lastPeriod.fechaFin === fechaFin
    );
  }

  bindClicks();
  window.AnalisisComercial = {
    load,
    hasCache,
    closeDetail,
    renderMounts,
    getKpi(clave) {
      return (acData?.kpis || []).find((k) => k.clave === clave) || null;
    },
    getData() {
      return acData;
    },
  };
})();
