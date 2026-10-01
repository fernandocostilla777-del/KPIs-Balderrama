/**
 * Pronóstico › Presupuesto próximos 12 meses (generador).
 * Histórico contable real + supuestos por segmento → P&L presupuestado 12 meses.
 */
(function () {
  'use strict';

  const { fmt, api, setText, chartOptions, chartColors } = Dashboard;
  const $ = (id) => document.getElementById(id);

  let data = null; // última respuesta del generador
  let chart = null;
  let escenarioActual = null; // { id, nombre }
  let loadedOnce = false;
  let generating = false;

  // ------------------------------------------------------------ formato
  const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : fmt.money(Number(n)));
  const pctLabel = (n) => {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  };
  const pctPlain = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(1)}%`);
  const tone = (v, invert = false) => {
    const n = Number(v) || 0;
    if (n === 0) return '';
    return (invert ? n < 0 : n > 0) ? 'cell-positive' : 'cell-negative';
  };
  const numOrNull = (el) => {
    const v = String(el?.value ?? '').trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  function setStatus(text, kind = '') {
    const el = $('ppto12mStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `ppto-empresa__status${kind ? ` ppto-empresa__status--${kind}` : ''}`;
  }

  function showAlert(html) {
    const el = $('ppto12mAlert');
    if (!html) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<span class="material-symbols-outlined">warning</span><div>${html}</div>`;
    el.classList.remove('hidden');
  }

  // ------------------------------------------------------------ supuestos ⇄ UI
  function collectSupuestos() {
    const segmentos = {};
    document.querySelectorAll('#ppto12mSupuestosTable tr[data-seg]').forEach((tr) => {
      const id = tr.dataset.seg;
      const cfg = {
        crecimientoVentasPct: numOrNull(tr.querySelector('[data-field="crecimientoVentasPct"]')),
        margenBrutoPct: numOrNull(tr.querySelector('[data-field="margenBrutoPct"]')),
        crecimientoGastosPct: numOrNull(tr.querySelector('[data-field="crecimientoGastosPct"]')),
      };
      if (Object.values(cfg).some((v) => v != null)) segmentos[id] = cfg;
    });
    return {
      metodo: $('ppto12mMetodo').value || 'estacional',
      crecimientoVentasPct: numOrNull($('ppto12mCrecVentas')),
      crecimientoGastosPct: numOrNull($('ppto12mCrecGastos')),
      crecimientoAdminPct: numOrNull($('ppto12mCrecAdmin')),
      segmentos,
    };
  }

  function currentParams() {
    return {
      inicio: $('ppto12mInicio').value || undefined,
      supuestos: collectSupuestos(),
    };
  }

  function applySupuestosToInputs(supuestos = {}) {
    $('ppto12mMetodo').value = supuestos.metodo === 'regresion' ? 'regresion' : 'estacional';
    $('ppto12mCrecVentas').value = supuestos.crecimientoVentasPct ?? '';
    $('ppto12mCrecGastos').value = supuestos.crecimientoGastosPct ?? '';
    $('ppto12mCrecAdmin').value = supuestos.crecimientoAdminPct ?? '';
    document.querySelectorAll('#ppto12mSupuestosTable tr[data-seg]').forEach((tr) => {
      const cfg = supuestos.segmentos?.[tr.dataset.seg] || {};
      tr.querySelectorAll('input[data-field]').forEach((inp) => {
        inp.value = cfg[inp.dataset.field] ?? '';
      });
    });
  }

  // ------------------------------------------------------------ render
  function renderKpis() {
    const k = data.kpis;
    const cards = [
      { key: 'ventasTotales', title: 'Total ventas 12m', icon: 'payments', color: 'blue' },
      { key: 'utilidadBruta', title: 'Utilidad bruta 12m', icon: 'account_balance_wallet', color: 'green' },
      { key: 'sumaGastos', title: 'Suma gastos 12m', icon: 'receipt_long', color: 'amber', invert: true },
      { key: 'utilidadOperacion', title: 'Utilidad de operación 12m', icon: 'trending_up', color: 'violet' },
    ];
    $('ppto12mKpis').innerHTML = cards.map((c) => {
      const it = k[c.key];
      return `
        <div class="kpi-card kpi-card--${c.color}">
          <div class="kpi-card-head"><span class="kpi-title">${c.title}</span><span class="material-symbols-outlined kpi-icon">${c.icon}</span></div>
          <div class="kpi-value ppto-kpi__value">${money(it.total)}</div>
          <p class="kpi-subtitle">Promedio mensual ${money(it.promedioMensual)}</p>
          <p class="kpi-subtitle"><strong class="${tone(it.variacionPct, c.invert)}">${pctLabel(it.variacionPct)}</strong> vs últimos 12m reales (${money(it.ultimos12mTotal)})</p>
          <div class="kpi-accent"></div>
        </div>`;
    }).join('') + `
        <div class="kpi-card kpi-card--slate">
          <div class="kpi-card-head"><span class="kpi-title">Márgenes presupuestados</span><span class="material-symbols-outlined kpi-icon">percent</span></div>
          <div class="kpi-value ppto-kpi__value">${pctPlain(k.margenOperacionPct)}</div>
          <p class="kpi-subtitle">Margen de operación · últimos 12m ${pctPlain(k.margenOperacionAnteriorPct)}</p>
          <p class="kpi-subtitle">Margen bruto <strong>${pctPlain(k.margenBrutoPct)}</strong> · últimos 12m ${pctPlain(k.margenBrutoAnteriorPct)}</p>
          <p class="kpi-subtitle">Base real: ${k.ultimos12mRango || '—'}</p>
          <div class="kpi-accent"></div>
        </div>`;
  }

  function renderSupuestos() {
    const segs = data.supuestosAplicados.segmentos;
    const bySeg = Object.fromEntries(data.segmentos.map((s) => [s.id, s]));
    const prev = collectSupuestos(); // conserva lo tecleado
    let lastGrupo = null;
    const rows = [];
    for (const s of segs) {
      if (s.grupo !== lastGrupo) {
        lastGrupo = s.grupo;
        rows.push(`<tr class="row-highlight ppto-12m__grupo"><td colspan="10"><strong>${s.grupoLabel}</strong></td></tr>`);
      }
      const cfg = prev.segmentos?.[s.id] || {};
      const tot = bySeg[s.id]?.totales || {};
      const derivadoTitle = s.crecimientoVentasManual ? 'Crecimiento fijado manualmente' : 'Variación últimos 12m vs 12 anteriores (tope ±25 %)';
      rows.push(`
        <tr data-seg="${s.id}">
          <td>${s.label}</td>
          <td class="cell-money">${money(s.ventas12m)}</td>
          <td class="cell-num" title="${derivadoTitle}">${pctLabel(s.crecimientoVentasDerivadoPct)}</td>
          <td class="cell-num"><input type="number" step="0.1" class="ppto-12m__input" data-field="crecimientoVentasPct" value="${cfg.crecimientoVentasPct ?? ''}" placeholder="${pctLabel(s.crecimientoVentasAplicadoPct)}" aria-label="Crecimiento ventas ${s.label}"/></td>
          <td class="cell-money"><strong>${money(tot.ventas)}</strong></td>
          <td class="cell-num">${pctPlain(s.margenBruto12mPct)}</td>
          <td class="cell-num"><input type="number" step="0.1" class="ppto-12m__input" data-field="margenBrutoPct" value="${cfg.margenBrutoPct ?? ''}" placeholder="${pctPlain(s.margenBrutoAplicadoPct)}" aria-label="Margen bruto objetivo ${s.label}"/></td>
          <td class="cell-money" title="Últimos 12m: ${money(s.gastos12m)} · ${s.gastosBaseLabel || ''}">${money(s.gastosBase)}</td>
          <td class="cell-num"><input type="number" step="0.1" class="ppto-12m__input" data-field="crecimientoGastosPct" value="${cfg.crecimientoGastosPct ?? ''}" placeholder="${pctLabel(s.crecimientoGastosAplicadoPct)}" aria-label="Crecimiento gastos ${s.label}"/></td>
          <td class="cell-money"><strong>${money(tot.gastos)}</strong></td>
        </tr>`);
    }
    const a = data.supuestosAplicados.admin;
    const adminLine = data.lineas.find((l) => l.key === 'gastosAdministracion');
    rows.push(`<tr class="row-highlight ppto-12m__grupo"><td colspan="10"><strong>Administración (empresa)</strong></td></tr>`);
    rows.push(`
      <tr>
        <td>Gastos de administración</td>
        <td class="cell-money" colspan="6" style="text-align:left;color:#64748b">Se ajusta con "Crec. administración %" (arriba) · run-rate vs últimos 12m: ${pctLabel(a.gastosRunrateVsUltimos12Pct)}</td>
        <td class="cell-money" title="Últimos 12m: ${money(a.gastos12m)}">${money(a.gastosBase)}</td>
        <td class="cell-num">${pctLabel(a.crecimientoAplicadoPct)}</td>
        <td class="cell-money"><strong>${money(adminLine?.total)}</strong></td>
      </tr>`);
    $('ppto12mSupuestosTable').innerHTML = rows.join('');
  }

  function renderEdo() {
    const months = data.horizonte;
    $('ppto12mEdoHead').innerHTML = `
      <tr>
        <th>Concepto</th>
        ${months.map((h) => `<th class="cell-money">${h.label}</th>`).join('')}
        <th class="cell-money">Total 12m</th>
        <th class="cell-money">Últ. 12m real</th>
        <th class="cell-num">Var. %</th>
      </tr>`;
    $('ppto12mEdoTable').innerHTML = data.lineas.map((l) => {
      const indent = l.level ? ` style="padding-left:${16 + l.level * 16}px"` : '';
      const cls = l.highlight ? ' class="row-highlight"' : '';
      const label = l.highlight ? `<strong>${l.label}</strong>` : l.label;
      const cells = l.meses.map((v, i) => {
        const ppto = l.ppto2026?.[i];
        const prev = l.anioAnterior?.[i];
        const tips = [];
        if (ppto != null) tips.push(`PPTO oficial 2026: ${money(ppto)}`);
        if (prev != null) tips.push(`Mismo mes año anterior: ${money(prev)}`);
        return `<td class="cell-money"${tips.length ? ` title="${tips.join(' · ')}"` : ''}>${money(v)}</td>`;
      }).join('');
      return `
        <tr${cls} data-key="${l.key}">
          <td${indent}>${label}</td>
          ${cells}
          <td class="cell-money"><strong>${money(l.total)}</strong></td>
          <td class="cell-money">${money(l.ultimos12mTotal)}</td>
          <td class="cell-num ${tone(l.variacionVsUltimos12mPct, l.invert)}">${pctLabel(l.variacionVsUltimos12mPct)}</td>
        </tr>`;
    }).join('');
    setText('ppto12mEdoSubtitle', `${months[0].label} → ${months[months.length - 1].label} · mismas líneas que Contabilidad › EEFF · comparación contra últimos 12 meses reales (${data.kpis.ultimos12mRango || '—'})`);
  }

  function renderSegmentos() {
    let lastGrupo = null;
    const rows = [];
    for (const s of data.segmentos) {
      if (s.grupo !== lastGrupo) {
        lastGrupo = s.grupo;
        rows.push(`<tr class="row-highlight ppto-12m__grupo"><td colspan="8"><strong>${s.grupoLabel}</strong></td></tr>`);
      }
      const t = s.totales;
      rows.push(`
        <tr>
          <td>${s.label}</td>
          <td class="cell-money">${money(t.ventas)}</td>
          <td class="cell-money">${money(t.costo)}</td>
          <td class="cell-money">${money(t.utilidadBruta)}</td>
          <td class="cell-num">${pctPlain(t.margenBrutoPct)}</td>
          <td class="cell-money">${money(t.gastos)}</td>
          <td class="cell-money ${tone(t.utilidadOperacion)}"><strong>${money(t.utilidadOperacion)}</strong></td>
          <td class="cell-num ${tone(t.margenOperacionPct)}">${pctPlain(t.margenOperacionPct)}</td>
        </tr>`);
    }
    const sumT = (k) => data.segmentos.reduce((s, x) => s + (x.totales[k] || 0), 0);
    const v = sumT('ventas');
    const ub = sumT('utilidadBruta');
    const uo = sumT('utilidadOperacion');
    rows.push(`
      <tr class="row-highlight">
        <td><strong>Total segmentos (antes de administración)</strong></td>
        <td class="cell-money"><strong>${money(v)}</strong></td>
        <td class="cell-money"><strong>${money(sumT('costo'))}</strong></td>
        <td class="cell-money"><strong>${money(ub)}</strong></td>
        <td class="cell-num">${v ? pctPlain((ub / v) * 100) : '—'}</td>
        <td class="cell-money"><strong>${money(sumT('gastos'))}</strong></td>
        <td class="cell-money ${tone(uo)}"><strong>${money(uo)}</strong></td>
        <td class="cell-num">${v ? pctPlain((uo / v) * 100) : '—'}</td>
      </tr>`);
    $('ppto12mSegmentosTable').innerHTML = rows.join('');
  }

  function renderChart() {
    const key = $('ppto12mLineaChart').value || 'ventasTotales';
    const linea = data.lineas.find((l) => l.key === key);
    const hist = data.historia;
    const labels = [...hist.map((h) => h.label), ...data.horizonte.map((h) => h.label)];
    const realSerie = [...hist.map((h) => h[key]), ...data.horizonte.map(() => null)];
    const pptoSerie = [...hist.map(() => null), ...linea.meses];
    const pptoOficial = linea.ppto2026 ? [...hist.map(() => null), ...linea.ppto2026] : null;

    const options = chartOptions({
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw == null ? '—' : fmt.money(ctx.raw)}` } },
      },
      scales: {
        y: { beginAtZero: false, ticks: { color: '#94a3b8', font: { size: 11 }, callback: (v) => fmt.currency(v) } },
      },
    });

    const datasets = [
      {
        type: 'bar',
        label: 'Real (histórico)',
        data: realSerie,
        backgroundColor: 'rgba(37,99,235,0.75)',
        borderRadius: 5,
        order: 2,
      },
      {
        type: 'bar',
        label: 'Presupuesto 12m',
        data: pptoSerie,
        backgroundColor: 'rgba(139,92,246,0.7)',
        borderRadius: 5,
        order: 2,
      },
    ];
    if (pptoOficial) {
      datasets.push({
        type: 'line',
        label: 'PPTO oficial 2026',
        data: pptoOficial,
        borderColor: chartColors.tertiary || '#f59e0b',
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 3,
        spanGaps: false,
        order: 1,
      });
    }

    if (chart) chart.destroy();
    chart = new Chart($('ppto12mChart'), { data: { labels, datasets }, options });
    setText('ppto12mChartSubtitle', `${linea.label} · ${hist.length} meses reales + 12 meses presupuestados${pptoOficial ? ' · línea punteada = PPTO oficial 2026' : ''}`);
  }

  function renderMetodologia() {
    const m = data.metodologia || {};
    const items = [
      ['Base', m.base], ['Método estacional', m.estacional], ['Método regresión', m.regresion],
      ['Margen', m.margen], ['Gastos', m.gastos], ['Referencias', m.referencias],
      ['Histórico usado', `${data.historiaInfo.desde} → ${data.historiaInfo.hasta} (${data.historiaInfo.disponibles} meses cerrados)`],
    ].filter(([, v]) => v);
    $('ppto12mMetodologia').innerHTML = items.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('');
  }

  function renderAll() {
    const h = data.horizonte;
    setText('ppto12mSubtitle', `${h[0].label} → ${h[h.length - 1].label} · generado desde ${data.historiaInfo.disponibles} meses contables reales (hasta ${data.historiaInfo.hasta}) · método ${data.supuestosAplicados.metodo}${escenarioActual ? ` · escenario "${escenarioActual.nombre}"` : ''}`);
    if (!$('ppto12mInicio').value) $('ppto12mInicio').value = data.inicio;
    const warn = [];
    if (data.historiaInfo.faltantes?.length) warn.push(`Meses sin contabilidad disponible: ${data.historiaInfo.faltantes.join(', ')}.`);
    showAlert(warn.length ? `<strong>Revisar</strong><p>${warn.join('<br>')}</p>` : '');
    renderKpis();
    renderSupuestos();
    renderEdo();
    renderSegmentos();
    renderChart();
    renderMetodologia();
    const gen = data.generatedAt ? new Date(data.generatedAt).toLocaleString('es-MX') : '';
    setStatus(`Presupuesto generado ${gen} · base real: Contabilidad › EEFF (CON_CTAS) · ajusta supuestos y pulsa Generar`);
  }

  // ------------------------------------------------------------ API
  async function generate({ fresh = false } = {}) {
    if (generating) return;
    generating = true;
    const params = { ...currentParams(), fresh };
    setStatus(loadedOnce
      ? 'Recalculando presupuesto…'
      : 'Leyendo 36 meses de contabilidad… la primera vez puede tardar hasta 2 minutos; después queda en caché.', 'loading');
    $('ppto12m').classList.add('is-loading');
    try {
      const res = await api('/forecast/presupuesto-12m', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res?.available) {
        showAlert(`<strong>No se pudo generar</strong><p>${res?.reason || 'Sin datos.'}</p>`);
        setStatus('Sin datos suficientes.', 'error');
        document.dispatchEvent(new CustomEvent('ppto12m:failed', { detail: { message: res?.reason || 'Sin datos suficientes' } }));
        return;
      }
      data = res;
      loadedOnce = true;
      renderAll();
      window.Ppto12m.data = data;
      document.dispatchEvent(new CustomEvent('ppto12m:generated', { detail: { data } }));
    } catch (err) {
      setStatus(err.message || 'Error al generar el presupuesto.', 'error');
      document.dispatchEvent(new CustomEvent('ppto12m:failed', { detail: { message: err.message } }));
    } finally {
      generating = false;
      $('ppto12m').classList.remove('is-loading');
    }
  }

  async function exportXlsx() {
    if (!data?.available) return;
    const btn = $('btnPpto12mXlsx');
    btn.disabled = true;
    try {
      const res = await fetch('/api/forecast/presupuesto-12m/xlsx', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentParams()),
      });
      if (!res.ok) throw new Error(`Error ${res.status} al exportar`);
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `presupuesto-12m-${data.inicio}${escenarioActual ? `-${escenarioActual.nombre.replace(/[^\w-]+/g, '_')}` : ''}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ escenarios
  async function loadEscenarios(selectId = '') {
    try {
      const res = await api('/forecast/presupuesto-12m/escenarios');
      const sel = $('ppto12mEscenario');
      sel.innerHTML = '<option value="">— Sin guardar —</option>'
        + (res.escenarios || []).map((e) => `<option value="${e.id}">${e.nombre}${e.inicio ? ` (${e.inicio})` : ''}</option>`).join('');
      sel.value = selectId || '';
    } catch { /* silencioso */ }
  }

  async function onEscenarioChange() {
    const id = $('ppto12mEscenario').value;
    if (!id) {
      escenarioActual = null;
      return;
    }
    try {
      const esc = await api(`/forecast/presupuesto-12m/escenarios/${id}`);
      escenarioActual = { id: esc.id, nombre: esc.nombre };
      if (esc.inicio) $('ppto12mInicio').value = esc.inicio;
      applySupuestosToInputs(esc.supuestos || {});
      await generate();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  async function saveEscenario({ nuevo = false } = {}) {
    let nombre = escenarioActual?.nombre;
    if (nuevo || !escenarioActual) {
      nombre = window.prompt('Nombre del escenario:', nombre || `Presupuesto ${$('ppto12mInicio').value || ''}`.trim());
      if (!nombre) return;
    }
    try {
      const saved = await api('/forecast/presupuesto-12m/escenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: nuevo ? undefined : escenarioActual?.id,
          nombre,
          inicio: $('ppto12mInicio').value || null,
          supuestos: collectSupuestos(),
        }),
      });
      escenarioActual = { id: saved.id, nombre: saved.nombre };
      await loadEscenarios(saved.id);
      setStatus(`Escenario "${saved.nombre}" guardado.`);
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  async function deleteEscenario() {
    if (!escenarioActual) return;
    if (!window.confirm(`¿Eliminar el escenario "${escenarioActual.nombre}"?`)) return;
    try {
      await api(`/forecast/presupuesto-12m/escenarios/${escenarioActual.id}`, { method: 'DELETE' });
      escenarioActual = null;
      await loadEscenarios('');
      setStatus('Escenario eliminado.');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  function resetSupuestos() {
    applySupuestosToInputs({});
    generate();
  }

  // ------------------------------------------------------------ eventos
  $('btnPpto12mGenerar').addEventListener('click', () => generate());
  $('btnPpto12mXlsx').addEventListener('click', exportXlsx);
  $('btnPpto12mGuardar').addEventListener('click', () => saveEscenario());
  $('btnPpto12mGuardarComo').addEventListener('click', () => saveEscenario({ nuevo: true }));
  $('btnPpto12mEliminar').addEventListener('click', deleteEscenario);
  $('btnPpto12mReset').addEventListener('click', resetSupuestos);
  $('ppto12mEscenario').addEventListener('change', onEscenarioChange);
  $('ppto12mLineaChart').addEventListener('change', () => data && renderChart());
  $('ppto12mMetodo').addEventListener('change', () => loadedOnce && generate());
  $('ppto12mInicio').addEventListener('change', () => loadedOnce && generate());
  $('ppto12m').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input.ppto-12m__input')) {
      e.preventDefault();
      generate();
    }
  });

  function onTab(tab) {
    if (tab !== 'presupuesto12m') return;
    if (!loadedOnce) {
      loadEscenarios();
      generate();
    } else if (chart) {
      requestAnimationFrame(() => chart.resize());
    }
  }
  // El simulador aplica sus palancas como supuestos del generador.
  document.addEventListener('ppto12m:apply', (e) => {
    const { segmentos = {}, crecimientoAdminPct } = e.detail || {};
    document.querySelectorAll('#ppto12mSupuestosTable tr[data-seg]').forEach((tr) => {
      const cfg = segmentos[tr.dataset.seg];
      if (!cfg) return;
      tr.querySelectorAll('input[data-field]').forEach((inp) => {
        if (cfg[inp.dataset.field] != null) inp.value = cfg[inp.dataset.field];
      });
    });
    if (crecimientoAdminPct != null) $('ppto12mCrecAdmin').value = crecimientoAdminPct;
    document.querySelector('#forecastTabs [data-tab="presupuesto12m"]')?.click();
    generate();
  });

  window.Ppto12m = {
    data: null,
    ensure: () => {
      if (loadedOnce) return Promise.resolve(data);
      return new Promise((resolve, reject) => {
        document.addEventListener('ppto12m:generated', (e) => resolve(e.detail.data), { once: true });
        document.addEventListener('ppto12m:failed', (e) => reject(new Error(e.detail?.message || 'No se pudo generar el presupuesto base')), { once: true });
        if (!generating) generate();
      });
    },
  };

  document.addEventListener('forecast:tab', (e) => onTab(e.detail?.tab));
  if (document.body.dataset.forecastTab) onTab(document.body.dataset.forecastTab);
})();
