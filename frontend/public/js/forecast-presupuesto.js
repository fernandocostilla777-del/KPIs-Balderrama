/**
 * Pronóstico › Presupuesto de la empresa 2026
 * Estado de resultados presupuestal (misma base que Contabilidad › EEFF).
 */
(function () {
  'use strict';

  const { fmt, api, setText, chartOptions, chartColors } = Dashboard;

  const MONTHS_LONG = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  let data = null;
  let mesChart = null;
  let selectedLine = 'ventasTotales';
  let corteInitialized = false;

  const $ = (id) => document.getElementById(id);

  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return fmt.money(Number(n));
  }

  function pctLabel(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  }

  function cumplLabel(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Number(n).toFixed(1)}%`;
  }

  /** Clase de color según variación y sentido de la línea (costos/gastos invertidos). */
  function toneClass(variacion, invert = false) {
    const v = Number(variacion) || 0;
    if (v === 0) return '';
    const favorable = invert ? v < 0 : v > 0;
    return favorable ? 'cell-positive' : 'cell-negative';
  }

  function cumplClass(cumpl, invert = false) {
    if (cumpl == null) return '';
    const v = Number(cumpl);
    if (invert) return v <= 100 ? 'cell-positive' : 'cell-negative';
    if (v >= 100) return 'cell-positive';
    if (v >= 90) return '';
    return 'cell-negative';
  }

  function estadoBadge(estado) {
    if (estado === 'cerrado') return '<span class="badge-tipo badge-running">Cerrado</span>';
    if (estado === 'en-curso') return '<span class="badge-tipo badge-maintenance">En curso</span>';
    if (estado === 'abierto') return '<span class="badge-tipo badge-alert" title="Mes transcurrido sin cierre contable; no entra al YTD">Sin cierre</span>';
    return '<span class="badge-tipo badge-stable">Pendiente</span>';
  }

  // ------------------------------------------------------------------ KPIs
  function renderKpis() {
    const k = data.kpis;
    const cards = [
      { key: 'ventasTotales', title: 'Total ventas', icon: 'payments', color: 'blue' },
      { key: 'utilidadBruta', title: 'Utilidad bruta', icon: 'account_balance_wallet', color: 'green' },
      { key: 'sumaGastos', title: 'Suma gastos', icon: 'receipt_long', color: 'amber', invert: true },
      { key: 'utilidadOperacion', title: 'Utilidad de operación', icon: 'trending_up', color: 'violet' },
    ];
    $('pptoKpis').innerHTML = cards.map((c) => {
      const it = k[c.key];
      const tone = toneClass(it.variacion, c.invert);
      const cierreTone = toneClass(it.proyeccionCierre - it.pptoAnual, c.invert);
      return `
        <div class="kpi-card kpi-card--${c.color}">
          <div class="kpi-card-head"><span class="kpi-title">${c.title}</span><span class="material-symbols-outlined kpi-icon">${c.icon}</span></div>
          <div class="kpi-value ppto-kpi__value">${money(it.realYtd)}</div>
          <p class="kpi-subtitle">Real YTD · PPTO YTD ${money(it.pptoYtd)}</p>
          <p class="kpi-subtitle"><strong class="${tone}">${pctLabel(it.variacionPct)}</strong> vs PPTO · cumplimiento <strong class="${cumplClass(it.cumplimientoPct, c.invert)}">${cumplLabel(it.cumplimientoPct)}</strong></p>
          <p class="kpi-subtitle">Cierre proyectado <strong>${money(it.proyeccionCierre)}</strong> <span class="${cierreTone}">(${pctLabel(it.variacionCierrePct)} vs PPTO anual ${money(it.pptoAnual)})</span></p>
          <div class="kpi-accent"></div>
        </div>`;
    }).join('') + `
        <div class="kpi-card kpi-card--slate">
          <div class="kpi-card-head"><span class="kpi-title">Márgenes YTD</span><span class="material-symbols-outlined kpi-icon">percent</span></div>
          <div class="kpi-value ppto-kpi__value">${cumplLabel(k.margenOperacion.real)}</div>
          <p class="kpi-subtitle">Margen de operación real · PPTO ${cumplLabel(k.margenOperacion.ppto)}</p>
          <p class="kpi-subtitle">Margen bruto real <strong>${cumplLabel(k.margenBruto.real)}</strong> · PPTO ${cumplLabel(k.margenBruto.ppto)}</p>
          <p class="kpi-subtitle">Margen operación proyectado al cierre <strong>${cumplLabel(k.margenOperacion.proyeccion)}</strong> · PPTO anual ${cumplLabel(k.margenOperacion.pptoAnual)}</p>
          <div class="kpi-accent"></div>
        </div>`;
  }

  // ------------------------------------------------------- Estado resultados
  function renderEdoTable() {
    $('pptoEdoTable').innerHTML = data.lineas.map((l) => {
      const indent = l.level ? ` style="padding-left:${16 + l.level * 16}px"` : '';
      const cls = l.highlight ? ' class="row-highlight"' : '';
      const label = l.highlight ? `<strong>${l.label}</strong>` : l.label;
      return `
        <tr${cls} data-key="${l.key}">
          <td${indent}>${label}</td>
          <td class="cell-money">${money(l.pptoAnual)}</td>
          <td class="cell-money">${money(l.pptoYtd)}</td>
          <td class="cell-money"><strong>${money(l.realYtd)}</strong></td>
          <td class="cell-money ${toneClass(l.variacion, l.invert)}"><strong>${money(l.variacion)}</strong></td>
          <td class="cell-num ${toneClass(l.variacion, l.invert)}">${pctLabel(l.variacionPct)}</td>
          <td class="cell-num ${cumplClass(l.cumplimientoPct, l.invert)}">${cumplLabel(l.cumplimientoPct)}</td>
          <td class="cell-money">${money(l.pptoRestante)}</td>
          <td class="cell-money"><strong>${money(l.proyeccionCierre)}</strong></td>
          <td class="cell-num ${toneClass(l.variacionCierre, l.invert)}">${pctLabel(l.variacionCierrePct)}</td>
          <td class="cell-money" style="color:#64748b">${money(l.proyeccionTendencia)}</td>
        </tr>`;
    }).join('');
  }

  // --------------------------------------------------------- Mes a mes
  function fillLineaSelect() {
    const sel = $('pptoLineaSelect');
    const current = sel.value || selectedLine;
    sel.innerHTML = data.lineas.map((l) =>
      `<option value="${l.key}">${l.level ? '· ' : ''}${l.label}</option>`).join('');
    sel.value = data.lineas.some((l) => l.key === current) ? current : 'ventasTotales';
    selectedLine = sel.value;
  }

  function renderMes() {
    const linea = data.lineas.find((l) => l.key === selectedLine) || data.lineas[0];
    if (!linea) return;
    setText('pptoMesTableTitle', `Detalle mensual · ${linea.label}`);
    setText('pptoMesSubtitle', `${linea.label} · PPTO vs Real por mes · barras claras = meses sin cierre contable (fuera del YTD)`);

    const rows = linea.meses;
    $('pptoMesTable').innerHTML = rows.map((m) => `
      <tr class="${m.estado === 'en-curso' || m.estado === 'abierto' ? 'ppto-row--en-curso' : ''}">
        <td><strong>${m.label}</strong> ${estadoBadge(m.estado)}</td>
        <td class="cell-money">${money(m.ppto)}</td>
        <td class="cell-money">${m.real == null ? '—' : money(m.real)}</td>
        <td class="cell-num ${m.real == null ? '' : cumplClass(m.cumplimientoPct, linea.invert)}">${m.real == null ? '—' : cumplLabel(m.cumplimientoPct)}</td>
      </tr>`).join('');
    $('pptoMesFoot').innerHTML = `
      <tr class="row-highlight">
        <td><strong>YTD cerrado</strong></td>
        <td class="cell-money"><strong>${money(linea.pptoYtd)}</strong></td>
        <td class="cell-money"><strong>${money(linea.realYtd)}</strong></td>
        <td class="cell-num ${cumplClass(linea.cumplimientoPct, linea.invert)}"><strong>${cumplLabel(linea.cumplimientoPct)}</strong></td>
      </tr>
      <tr>
        <td>Anual</td>
        <td class="cell-money">${money(linea.pptoAnual)}</td>
        <td class="cell-money" title="Cierre proyectado">${money(linea.proyeccionCierre)}</td>
        <td class="cell-num ${toneClass(linea.variacionCierre, linea.invert)}">${pctLabel(linea.variacionCierrePct)}</td>
      </tr>`;

    const labels = rows.map((m) => m.label);
    const ppto = rows.map((m) => m.ppto);
    const real = rows.map((m) => (m.real == null ? null : m.real));
    const realColors = rows.map((m) => (m.estado === 'cerrado' ? chartColors.primary : 'rgba(37,99,235,0.35)'));

    let pptoAcum = 0;
    const pptoAcumSerie = ppto.map((v) => { pptoAcum += v; return pptoAcum; });
    let realAcum = 0;
    const realAcumSerie = rows.map((m) => {
      if (m.estado !== 'cerrado' || m.real == null) return null;
      realAcum += m.real;
      return realAcum;
    });

    // chartOptions solo conserva x/y: se agrega el eje derecho (acumulados) después del merge.
    const options = chartOptions({
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw == null ? '—' : fmt.money(ctx.raw)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', font: { size: 11 }, callback: (v) => fmt.currency(v) },
        },
      },
    });
    options.scales.y1 = {
      position: 'right',
      beginAtZero: true,
      grid: { drawOnChartArea: false },
      border: { display: false },
      ticks: { color: '#94a3b8', font: { size: 11 }, callback: (v) => fmt.currency(v) },
    };

    if (mesChart) mesChart.destroy();
    mesChart = new Chart($('pptoMesChart'), {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'PPTO mes',
            data: ppto,
            backgroundColor: 'rgba(148,163,184,0.45)',
            borderRadius: 6,
            order: 3,
          },
          {
            type: 'bar',
            label: 'Real mes',
            data: real,
            backgroundColor: realColors,
            borderRadius: 6,
            order: 2,
          },
          {
            type: 'line',
            label: 'PPTO acumulado',
            data: pptoAcumSerie,
            borderColor: chartColors.slate || '#64748b',
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y1',
            order: 1,
          },
          {
            type: 'line',
            label: 'Real acumulado',
            data: realAcumSerie,
            borderColor: chartColors.violet || '#8b5cf6',
            borderWidth: 2.5,
            pointRadius: 3,
            spanGaps: false,
            yAxisID: 'y1',
            order: 0,
          },
        ],
      },
      options,
    });
  }

  // --------------------------------------------------------- Detalle
  function renderDetailTable(tbodyId, rows) {
    $(tbodyId).innerHTML = rows.map((r) => {
      const cls = r.isTotal ? ' class="row-highlight"' : '';
      const label = r.isTotal ? `<strong>${r.label}</strong>` : r.label;
      const v = r.ventas;
      const ub = r.utilidadBruta;
      const uo = r.utilidadOperacion;
      return `
        <tr${cls}>
          <td>${label}</td>
          <td class="cell-money"><strong>${money(v.realYtd)}</strong></td>
          <td class="cell-money">${money(v.pptoYtd)}</td>
          <td class="cell-num ${cumplClass(v.cumplimientoPct)}">${cumplLabel(v.cumplimientoPct)}</td>
          <td class="cell-money ${toneClass(ub.variacion)}">${money(ub.realYtd)}</td>
          <td class="cell-money">${money(ub.pptoYtd)}</td>
          <td class="cell-money ${toneClass(uo.variacion)}">${money(uo.realYtd)}</td>
          <td class="cell-money">${money(uo.pptoYtd)}</td>
          <td class="cell-money" title="Real cerrado + PPTO restante · PPTO anual ${money(v.pptoAnual)}">${money(v.proyeccionCierre)} <span class="${toneClass(v.proyeccionCierre - v.pptoAnual)}" style="font-size:11px">(${pctLabel(v.variacionCierrePct)})</span></td>
        </tr>`;
    }).join('') || '<tr class="empty-row"><td colspan="9">Sin datos.</td></tr>';
  }

  // --------------------------------------------------------- Metodología
  function renderMetodologia() {
    const m = data.metodologia || {};
    const items = [
      ['Real', m.real],
      ['Presupuesto', m.presupuesto],
      ['Acumulado (YTD)', m.ytd],
      ['Cierre proyectado', m.proyeccionCierre],
      ['Tendencia', m.proyeccionTendencia],
      ['Signos', m.signos],
      ['Fuente real', data.source?.real],
      ['Fuente presupuesto', data.source?.presupuesto],
    ].filter(([, v]) => v);
    $('pptoMetodologia').innerHTML = items.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('');
  }

  // --------------------------------------------------------- Corte select
  function fillCorteSelect() {
    const sel = $('pptoCorteSelect');
    if (corteInitialized) return;
    const opts = ['<option value="0">Sin meses cerrados</option>'];
    for (let m = 1; m <= 12; m += 1) {
      opts.push(`<option value="${m}">${m === 1 ? 'Enero' : `Ene – ${MONTHS_LONG[m - 1].slice(0, 3)}`} (${m} ${m === 1 ? 'mes' : 'meses'})</option>`);
    }
    sel.innerHTML = opts.join('');
    sel.value = String(data.corte.mesCorte);
    corteInitialized = true;
  }

  // --------------------------------------------------------- CSV
  function downloadCsv() {
    if (!data?.available) return;
    const rows = [[
      'Sección', 'Concepto', 'PPTO anual', 'PPTO YTD', 'Real YTD', 'Variación', 'Variación %', 'Cumplimiento %',
      'PPTO restante', 'Cierre proyectado', 'Var. cierre %', 'Tendencia',
    ]];
    const num = (v) => (v == null ? '' : Number(v).toFixed(2));
    for (const l of data.lineas) {
      rows.push(['Estado de resultados', l.label, num(l.pptoAnual), num(l.pptoYtd), num(l.realYtd), num(l.variacion),
        num(l.variacionPct), num(l.cumplimientoPct), num(l.pptoRestante), num(l.proyeccionCierre), num(l.variacionCierrePct), num(l.proyeccionTendencia)]);
    }
    const detail = (section, list) => {
      for (const r of list) {
        for (const metric of ['ventas', 'utilidadBruta', 'utilidadOperacion']) {
          const m = r[metric];
          const name = { ventas: 'Ventas', utilidadBruta: 'Utilidad bruta', utilidadOperacion: 'Utilidad de operación' }[metric];
          rows.push([section, `${r.label} · ${name}`, num(m.pptoAnual), num(m.pptoYtd), num(m.realYtd), num(m.variacion),
            num(m.variacionPct), num(m.cumplimientoPct), num(m.pptoRestante), num(m.proyeccionCierre), num(m.variacionCierrePct), num(m.proyeccionTendencia)]);
        }
      }
    };
    detail('Autos nuevos', data.detalle.autosNuevos);
    detail('PostVenta', data.detalle.postventa);

    rows.push([]);
    rows.push(['Mensual', 'Concepto', ...data.meses.map((m) => `${m.label} PPTO`), ...data.meses.map((m) => `${m.label} Real`)]);
    for (const l of data.lineas) {
      rows.push(['Mensual', l.label, ...l.meses.map((m) => num(m.ppto)), ...l.meses.map((m) => (m.real == null ? '' : num(m.real)))]);
    }

    const csv = rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `presupuesto-empresa-${data.year}-corte-${data.corte.mesCorte}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // --------------------------------------------------------- Carga
  function setStatus(text, kind = '') {
    const el = $('pptoEmpresaStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `ppto-empresa__status${kind ? ` ppto-empresa__status--${kind}` : ''}`;
  }

  function showAlert(html) {
    const el = $('pptoEmpresaAlert');
    if (!html) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<span class="material-symbols-outlined">warning</span><div>${html}</div>`;
    el.classList.remove('hidden');
  }

  function renderAll() {
    fillCorteSelect();
    const c = data.corte;
    const enCurso = c.mesEnCursoLabel ? ` · ${c.mesEnCursoLabel} en curso (parcial, fuera del YTD)` : '';
    setText('pptoEmpresaSubtitle', `Estado de resultados presupuestal ${data.year} · Real contable ${c.mesesCerradosLabel}${enCurso} · misma base que Contabilidad › EEFF`);
    setText('pptoEdoSubtitle', `Acumulado ${c.mesesCerradosLabel} (${c.mesesCerrados.length} de 12 meses · ${Math.round(c.factorYtd * 100)}% del año) · ${c.mesesRestantes} meses restantes a presupuesto`);

    const warnings = [];
    if (c.realParcial) warnings.push('Algún mes cerrado no tiene tabla contable disponible; el real YTD puede estar incompleto.');
    if (c.errores?.length) warnings.push(`Errores al leer contabilidad: ${c.errores.join(' · ')}`);
    showAlert(warnings.length ? `<strong>Revisar</strong><p>${warnings.join('<br>')}</p>` : '');

    renderKpis();
    renderEdoTable();
    fillLineaSelect();
    renderMes();
    renderDetailTable('pptoAutosTable', data.detalle.autosNuevos);
    renderDetailTable('pptoPostventaTable', data.detalle.postventa);
    renderMetodologia();

    const gen = data.generatedAt ? new Date(data.generatedAt).toLocaleString('es-MX') : '';
    setStatus(`Fuente: ${data.source?.real} + ${data.source?.presupuesto} · generado ${gen}`);
  }

  async function load({ fresh = false } = {}) {
    const sel = $('pptoCorteSelect');
    const mesCorte = corteInitialized && sel.value !== '' ? sel.value : undefined;
    const params = new URLSearchParams();
    if (mesCorte != null) params.set('mesCorte', mesCorte);
    if (fresh) params.set('fresh', '1');
    setStatus('Consultando contabilidad mes a mes… la primera carga puede tardar hasta un minuto.', 'loading');
    $('pptoEmpresa').classList.add('is-loading');
    try {
      const res = await api(`/forecast/presupuesto${params.toString() ? `?${params}` : ''}`);
      if (!res?.available) {
        showAlert(`<strong>Presupuesto no disponible</strong><p>${res?.reason || 'Sin datos.'}</p>`);
        setStatus('Sin datos de presupuesto.', 'error');
        return;
      }
      data = res;
      renderAll();
    } catch (err) {
      setStatus(err.message || 'Error al cargar el presupuesto.', 'error');
    } finally {
      $('pptoEmpresa').classList.remove('is-loading');
    }
  }

  $('pptoCorteSelect').addEventListener('change', () => load());
  $('btnPptoActualizar').addEventListener('click', () => load({ fresh: true }));
  $('btnPptoCsv').addEventListener('click', downloadCsv);
  $('pptoLineaSelect').addEventListener('change', (e) => {
    selectedLine = e.target.value;
    renderMes();
  });

  // ------------------------------------------------------ Pestañas Pronóstico
  const TAB_TITLES = {
    ventas: 'Pronóstico de Ventas',
    presupuesto12m: 'Presupuesto próximos 12 meses',
    simulador: 'Simulador de presupuesto',
    presupuesto: 'Seguimiento PPTO 2026',
  };
  const TABS = Object.keys(TAB_TITLES);
  let loadedOnce = false;

  function currentTabFromUrl() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('tab');
    const fromHash = location.hash.replace('#', '');
    const tab = fromQuery || fromHash;
    return TABS.includes(tab) ? tab : 'ventas';
  }

  function switchTab(tab, { updateUrl = true } = {}) {
    const target = TABS.includes(tab) ? tab : 'ventas';
    document.querySelectorAll('#forecastTabs .contabilidad-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === target);
    });
    document.querySelectorAll('.forecast-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.panel !== target);
    });
    setText('forecastTopTitle', TAB_TITLES[target]);
    $('forecastVentasControls')?.classList.toggle('hidden', target !== 'ventas');
    document.body.dataset.forecastTab = target;

    if (updateUrl) {
      const url = new URL(location.href);
      if (target !== 'ventas') url.searchParams.set('tab', target);
      else url.searchParams.delete('tab');
      url.hash = '';
      history.replaceState(null, '', url);
    }

    document.dispatchEvent(new CustomEvent('forecast:tab', { detail: { tab: target } }));

    if (target === 'presupuesto') {
      if (!loadedOnce) {
        loadedOnce = true;
        load();
      } else if (mesChart) {
        // El canvas estaba oculto: forzar reajuste de tamaño
        requestAnimationFrame(() => mesChart.resize());
      }
    }
  }

  $('forecastTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.contabilidad-tab');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  switchTab(currentTabFromUrl(), { updateUrl: false });
})();
