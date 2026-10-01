/**
 * Pronóstico › Simulador de presupuesto.
 * Parte del presupuesto 12m del generador y recalcula en el navegador con palancas
 * globales y por segmento (ventas %, margen bruto pts, gastos %, administración %).
 * UO total = Σ UO segmentos − gastos de administración (misma identidad que el backend).
 */
(function () {
  'use strict';

  const { fmt, setText, chartOptions } = Dashboard;
  const $ = (id) => document.getElementById(id);

  const PRESETS = {
    base: { ventas: 0, margen: 0, gastos: 0, admin: 0 },
    pesimista: { ventas: -10, margen: -0.5, gastos: 3, admin: 3 },
    optimista: { ventas: 8, margen: 0.5, gastos: -3, admin: -3 },
  };
  const SEG_LEVERS = [
    { field: 'ventas', min: -30, max: 30, step: 0.5, unit: '%' },
    { field: 'margen', min: -5, max: 5, step: 0.1, unit: 'pts' },
    { field: 'gastos', min: -30, max: 30, step: 0.5, unit: '%' },
  ];

  let base = null; // respuesta del generador
  let segLevers = {}; // id → { ventas, margen, gastos }
  let sim = null;
  let chartMes = null;
  let chartImpacto = null;
  let loading = false;

  const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : fmt.money(Number(n)));
  const signed = (n, unit = '%') => {
    const v = Number(n) || 0;
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit === 'pts' ? ' pts' : '%'}`;
  };
  const signedMoney = (n) => `${n > 0 ? '+' : ''}${money(n)}`;
  const tone = (v, invert = false) => {
    const n = Number(v) || 0;
    if (Math.abs(n) < 0.5) return '';
    return (invert ? n < 0 : n > 0) ? 'cell-positive' : 'cell-negative';
  };
  const pctChange = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const sum = (arr) => arr.reduce((s, v) => s + (Number(v) || 0), 0);

  function setStatus(text, kind = '') {
    const el = $('pptoSimStatus');
    el.textContent = text;
    el.className = `ppto-empresa__status${kind ? ` ppto-empresa__status--${kind}` : ''}`;
  }

  function globals() {
    return {
      ventas: Number($('simGVentas').value) || 0,
      margen: Number($('simGMargen').value) || 0,
      gastos: Number($('simGGastos').value) || 0,
      admin: Number($('simGAdmin').value) || 0,
    };
  }

  function syncOutput(input) {
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = signed(input.value, input.dataset.unit);
    input.closest('.ppto-sim__lever, .ppto-sim__cell')?.classList.toggle('is-changed', Number(input.value) !== 0);
  }

  // ------------------------------------------------------------ cálculo
  function simulate() {
    const g = globals();
    const adminLine = base.lineas.find((l) => l.key === 'gastosAdministracion');
    const segs = base.segmentos.map((s) => {
      const l = segLevers[s.id] || { ventas: 0, margen: 0, gastos: 0 };
      const fV = (1 + g.ventas / 100) * (1 + l.ventas / 100);
      const dM = (g.margen + l.margen) / 100;
      const fG = (1 + g.gastos / 100) * (1 + l.gastos / 100);
      const ventas = s.meses.ventas.map((v) => v * fV);
      const utilidadBruta = s.meses.ventas.map((v, i) => {
        const m = v ? s.meses.utilidadBruta[i] / v : 0;
        return ventas[i] * (m + dM);
      });
      const gastos = s.meses.gastos.map((v) => v * fG);
      const utilidadOperacion = utilidadBruta.map((ub, i) => ub - gastos[i]);
      return {
        id: s.id, label: s.label, grupo: s.grupo, grupoLabel: s.grupoLabel,
        base: s, levers: l, fV, dM, fG,
        meses: { ventas, utilidadBruta, gastos, utilidadOperacion },
        totales: {
          ventas: sum(ventas), utilidadBruta: sum(utilidadBruta), gastos: sum(gastos), utilidadOperacion: sum(utilidadOperacion),
        },
      };
    });
    const admin = adminLine.meses.map((v) => v * (1 + g.admin / 100));
    const n = base.horizonte.length;
    const mes = (fn) => Array.from({ length: n }, (_, i) => fn(i));
    const uoMes = mes((i) => sum(segs.map((s) => s.meses.utilidadOperacion[i])) - admin[i]);
    const uoBaseMes = mes((i) => sum(base.segmentos.map((s) => s.meses.utilidadOperacion[i])) - adminLine.meses[i]);
    const tot = {
      ventas: sum(segs.map((s) => s.totales.ventas)),
      utilidadBruta: sum(segs.map((s) => s.totales.utilidadBruta)),
      gastos: sum(segs.map((s) => s.totales.gastos)) + sum(admin),
      admin: sum(admin),
      utilidadOperacion: sum(uoMes),
    };
    const totBase = {
      ventas: sum(base.segmentos.map((s) => s.totales.ventas)),
      utilidadBruta: sum(base.segmentos.map((s) => s.totales.utilidadBruta)),
      gastos: sum(base.segmentos.map((s) => s.totales.gastos)) + adminLine.total,
      admin: adminLine.total,
      utilidadOperacion: sum(uoBaseMes),
    };
    sim = { g, segs, admin, uoMes, uoBaseMes, tot, totBase };
  }

  // Crecimiento uniforme de ventas adicional (con márgenes simulados) para UO = 0.
  const equilibrioVentasPct = () => (sim.tot.utilidadBruta ? (-sim.tot.utilidadOperacion / sim.tot.utilidadBruta) * 100 : null);
  const equilibrioGastosPct = () => (sim.tot.gastos ? (sim.tot.utilidadOperacion / sim.tot.gastos) * 100 : null);

  // ------------------------------------------------------------ render
  function renderKpis() {
    const { tot, totBase } = sim;
    const card = (title, icon, color, val, baseVal, invert = false, extra = '') => {
      const d = val - baseVal;
      return `
        <div class="kpi-card kpi-card--${color}">
          <div class="kpi-card-head"><span class="kpi-title">${title}</span><span class="material-symbols-outlined kpi-icon">${icon}</span></div>
          <div class="kpi-value ppto-kpi__value">${money(val)}</div>
          <p class="kpi-subtitle"><strong class="${tone(d, invert)}">${signedMoney(d)}</strong> vs base (${money(baseVal)})</p>
          ${extra}
          <div class="kpi-accent"></div>
        </div>`;
    };
    const mOp = tot.ventas ? (tot.utilidadOperacion / tot.ventas) * 100 : 0;
    const mOpBase = totBase.ventas ? (totBase.utilidadOperacion / totBase.ventas) * 100 : 0;
    const mB = tot.ventas ? (tot.utilidadBruta / tot.ventas) * 100 : 0;
    const eqV = equilibrioVentasPct();
    const eqG = equilibrioGastosPct();
    const enPerdida = tot.utilidadOperacion < 0;
    const eqHtml = enPerdida
      ? `<p class="kpi-subtitle">Para llegar a UO = 0 falta <strong>${signed(eqV)}</strong> de ventas (≈ ${money(tot.ventas * eqV / 100)}) o <strong>${signed(eqG)}</strong> de gastos (≈ ${money(-tot.utilidadOperacion)})</p>`
      : `<p class="kpi-subtitle">Colchón: las ventas pueden caer <strong>${Math.abs(eqV).toFixed(1)}%</strong> antes de entrar en pérdida</p>`;
    $('pptoSimKpis').innerHTML = [
      card('Ventas 12m simuladas', 'payments', 'blue', tot.ventas, totBase.ventas, false, `<p class="kpi-subtitle">${signed(pctChange(tot.ventas, totBase.ventas))} vs base</p>`),
      card('Utilidad bruta 12m', 'account_balance_wallet', 'green', tot.utilidadBruta, totBase.utilidadBruta, false, `<p class="kpi-subtitle">Margen bruto ${mB.toFixed(1)}%</p>`),
      card('Gastos totales 12m', 'receipt_long', 'amber', tot.gastos, totBase.gastos, true, `<p class="kpi-subtitle">Incluye administración ${money(tot.admin)}</p>`),
      card('Utilidad de operación 12m', 'trending_up', 'violet', tot.utilidadOperacion, totBase.utilidadOperacion, false, `<p class="kpi-subtitle">Margen op. ${mOp.toFixed(1)}% (base ${mOpBase.toFixed(1)}%)</p>`),
      `<div class="kpi-card kpi-card--${enPerdida ? 'rose' : 'slate'}">
        <div class="kpi-card-head"><span class="kpi-title">Punto de equilibrio</span><span class="material-symbols-outlined kpi-icon">balance</span></div>
        <div class="kpi-value ppto-kpi__value">${enPerdida ? 'En pérdida' : 'Con utilidad'}</div>
        ${eqHtml}
        <div class="kpi-accent"></div>
      </div>`,
    ].join('');
  }

  function leverCell(segId, lv, value) {
    return `
      <td class="ppto-sim__cell${value ? ' is-changed' : ''}">
        <input type="range" min="${lv.min}" max="${lv.max}" step="${lv.step}" value="${value}" data-seg="${segId}" data-field="${lv.field}" data-unit="${lv.unit}" aria-label="${lv.field} ${segId}"/>
        <output>${signed(value, lv.unit)}</output>
      </td>`;
  }

  function buildSegTable() {
    let lastGrupo = null;
    const rows = [];
    for (const s of base.segmentos) {
      if (s.grupo !== lastGrupo) {
        lastGrupo = s.grupo;
        rows.push(`<tr class="row-highlight ppto-12m__grupo"><td colspan="9"><strong>${s.grupoLabel}</strong></td></tr>`);
      }
      const l = segLevers[s.id] || { ventas: 0, margen: 0, gastos: 0 };
      rows.push(`
        <tr data-seg="${s.id}">
          <td>${s.label}</td>
          <td class="cell-money">${money(s.totales.ventas)}</td>
          ${SEG_LEVERS.map((lv) => leverCell(s.id, lv, l[lv.field])).join('')}
          <td class="cell-money" data-out="ventas"></td>
          <td class="cell-money">${money(s.totales.utilidadOperacion)}</td>
          <td class="cell-money" data-out="uo"></td>
          <td class="cell-money" data-out="impacto"></td>
        </tr>`);
    }
    rows.push(`
      <tr class="row-highlight" data-row="admin">
        <td><strong>Administración (empresa)</strong></td>
        <td class="cell-money"></td>
        <td colspan="3" class="ppto-sim__hint">Se mueve con la palanca global "Gastos de administración"</td>
        <td class="cell-money"></td>
        <td class="cell-money">${money(-sim.totBase.admin)}</td>
        <td class="cell-money" data-out="uo"></td>
        <td class="cell-money" data-out="impacto"></td>
      </tr>
      <tr class="row-highlight" data-row="total">
        <td><strong>Total empresa</strong></td>
        <td class="cell-money"><strong>${money(sim.totBase.ventas)}</strong></td>
        <td colspan="3"></td>
        <td class="cell-money" data-out="ventas"></td>
        <td class="cell-money"><strong>${money(sim.totBase.utilidadOperacion)}</strong></td>
        <td class="cell-money" data-out="uo"></td>
        <td class="cell-money" data-out="impacto"></td>
      </tr>`);
    $('pptoSimTable').innerHTML = rows.join('');
  }

  function updateSegTable() {
    const set = (tr, key, html, cls = '') => {
      const td = tr.querySelector(`[data-out="${key}"]`);
      td.innerHTML = html;
      td.className = `cell-money ${cls}`;
    };
    for (const s of sim.segs) {
      const tr = document.querySelector(`#pptoSimTable tr[data-seg="${s.id}"]`);
      if (!tr) continue;
      const imp = s.totales.utilidadOperacion - s.base.totales.utilidadOperacion;
      set(tr, 'ventas', money(s.totales.ventas));
      set(tr, 'uo', `<strong>${money(s.totales.utilidadOperacion)}</strong>`, tone(s.totales.utilidadOperacion));
      set(tr, 'impacto', Math.abs(imp) < 0.5 ? '—' : signedMoney(imp), tone(imp));
    }
    const adm = document.querySelector('#pptoSimTable tr[data-row="admin"]');
    const admImp = -(sim.tot.admin - sim.totBase.admin);
    set(adm, 'uo', money(-sim.tot.admin));
    set(adm, 'impacto', Math.abs(admImp) < 0.5 ? '—' : signedMoney(admImp), tone(admImp));
    const tot = document.querySelector('#pptoSimTable tr[data-row="total"]');
    const totImp = sim.tot.utilidadOperacion - sim.totBase.utilidadOperacion;
    set(tot, 'ventas', `<strong>${money(sim.tot.ventas)}</strong>`);
    set(tot, 'uo', `<strong>${money(sim.tot.utilidadOperacion)}</strong>`, tone(sim.tot.utilidadOperacion));
    set(tot, 'impacto', `<strong>${Math.abs(totImp) < 0.5 ? '—' : signedMoney(totImp)}</strong>`, tone(totImp));
  }

  function renderSensibilidad() {
    const rows = sim.segs.map((s) => {
      const v = s.totales.utilidadBruta * 0.01;
      const m = s.totales.ventas * 0.01;
      const g = s.totales.gastos * 0.01;
      const best = [['Ventas', v], ['Margen', m], ['Gastos', g]].sort((a, b) => b[1] - a[1])[0];
      return { s, v, m, g, best };
    }).sort((a, b) => Math.max(b.v, b.m, b.g) - Math.max(a.v, a.m, a.g));
    const max = Math.max(...rows.map((r) => Math.max(r.v, r.m, r.g)), 1);
    const bar = (val) => `<span class="ppto-sim__bar" style="width:${Math.max(2, (val / max) * 100).toFixed(1)}%"></span>`;
    $('pptoSimSensTable').innerHTML = rows.map((r) => `
      <tr>
        <td>${r.s.label}</td>
        <td class="cell-money"><div class="ppto-sim__barcell">${bar(r.v)}<span>${signedMoney(r.v)}</span></div></td>
        <td class="cell-money"><div class="ppto-sim__barcell">${bar(r.m)}<span>${signedMoney(r.m)}</span></div></td>
        <td class="cell-money"><div class="ppto-sim__barcell">${bar(r.g)}<span>${signedMoney(r.g)}</span></div></td>
        <td><span class="badge-tipo badge-running">${r.best[0]}</span></td>
      </tr>`).join('') + `
      <tr class="row-highlight">
        <td><strong>Administración</strong></td>
        <td class="cell-money">—</td><td class="cell-money">—</td>
        <td class="cell-money">${signedMoney(sim.tot.admin * 0.01)}</td>
        <td></td>
      </tr>`;
  }

  function renderCharts() {
    const labels = base.horizonte.map((h) => h.label);
    const moneyTick = (v) => fmt.currency(v);
    const tooltipMoney = { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt.money(ctx.raw)}` } };

    if (!chartMes) {
      chartMes = new Chart($('pptoSimChartMes'), {
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Simulada', data: [], backgroundColor: [], borderRadius: 5, order: 2 },
            { type: 'line', label: 'Base', data: [], borderColor: '#64748b', borderDash: [5, 4], borderWidth: 2, pointRadius: 3, order: 1 },
          ],
        },
        options: chartOptions({
          animation: { duration: 200 },
          plugins: { legend: { position: 'bottom' }, tooltip: tooltipMoney },
          scales: { y: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 11 }, callback: moneyTick } } },
        }),
      });
    }
    chartMes.data.labels = labels;
    chartMes.data.datasets[0].data = sim.uoMes;
    chartMes.data.datasets[0].backgroundColor = sim.uoMes.map((v) => (v >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(244,63,94,0.7)'));
    chartMes.data.datasets[1].data = sim.uoBaseMes;
    chartMes.update();

    const impactos = sim.segs.map((s) => ({ label: s.label, v: s.totales.utilidadOperacion - s.base.totales.utilidadOperacion }));
    impactos.push({ label: 'Administración', v: -(sim.tot.admin - sim.totBase.admin) });
    if (!chartImpacto) {
      chartImpacto = new Chart($('pptoSimChartImpacto'), {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Impacto en UO', data: [], backgroundColor: [], borderRadius: 4 }] },
        options: chartOptions({
          indexAxis: 'y',
          animation: { duration: 200 },
          plugins: { legend: { display: false }, tooltip: tooltipMoney },
          scales: {
            x: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 11 }, callback: moneyTick } },
            y: { beginAtZero: true, ticks: { color: '#64748b', font: { size: 11 } } },
          },
        }),
      });
    }
    chartImpacto.data.labels = impactos.map((x) => x.label);
    chartImpacto.data.datasets[0].data = impactos.map((x) => x.v);
    chartImpacto.data.datasets[0].backgroundColor = impactos.map((x) => (x.v >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(244,63,94,0.7)'));
    chartImpacto.update();
  }

  function recompute() {
    if (!base) return;
    simulate();
    renderKpis();
    updateSegTable();
    renderSensibilidad();
    renderCharts();
  }

  // ------------------------------------------------------------ acciones
  function setGlobals(p) {
    const map = { simGVentas: p.ventas, simGMargen: p.margen, simGGastos: p.gastos, simGAdmin: p.admin };
    for (const [id, v] of Object.entries(map)) {
      const inp = $(id);
      inp.value = v;
      syncOutput(inp);
    }
  }

  function applyPreset(name) {
    setGlobals(PRESETS[name] || PRESETS.base);
    if (name === 'base') {
      segLevers = {};
      buildSegTable();
    }
    recompute();
  }

  function irAEquilibrio() {
    if (!sim) return;
    const eq = equilibrioVentasPct();
    if (eq == null) return;
    const g = globals();
    // eq es adicional sobre el escenario actual: se compone con la palanca global vigente.
    const nuevo = ((1 + g.ventas / 100) * (1 + eq / 100) - 1) * 100;
    const inp = $('simGVentas');
    const lim = Math.ceil(Math.abs(nuevo) / 10) * 10;
    if (lim > Number(inp.max)) {
      inp.max = lim;
      inp.min = -lim;
    }
    inp.value = Math.round(nuevo * 10) / 10;
    syncOutput(inp);
    recompute();
    setStatus(`Punto de equilibrio: ventas globales ${signed(nuevo)} sobre el presupuesto base (UO ≈ ${money(sim.tot.utilidadOperacion)}).`);
  }

  function aplicarAlGenerador() {
    if (!sim) return;
    const round = (v) => Math.round(v * 100) / 100;
    const aplicados = Object.fromEntries(base.supuestosAplicados.segmentos.map((s) => [s.id, s]));
    const segmentos = {};
    for (const s of sim.segs) {
      const a = aplicados[s.id];
      if (!a) continue;
      if (Math.abs(s.fV - 1) < 1e-9 && Math.abs(s.dM) < 1e-9 && Math.abs(s.fG - 1) < 1e-9) continue;
      segmentos[s.id] = {
        crecimientoVentasPct: round(((1 + (a.crecimientoVentasAplicadoPct || 0) / 100) * s.fV - 1) * 100),
        margenBrutoPct: round((a.margenBrutoAplicadoPct || 0) + s.dM * 100),
        crecimientoGastosPct: round(((1 + (a.crecimientoGastosAplicadoPct || 0) / 100) * s.fG - 1) * 100),
      };
    }
    const g = globals();
    const adminA = base.supuestosAplicados.admin?.crecimientoAplicadoPct || 0;
    const crecimientoAdminPct = g.admin ? round(((1 + adminA / 100) * (1 + g.admin / 100) - 1) * 100) : null;
    if (!Object.keys(segmentos).length && crecimientoAdminPct == null) {
      setStatus('No hay cambios que aplicar: todas las palancas están en cero.');
      return;
    }
    document.dispatchEvent(new CustomEvent('ppto12m:apply', { detail: { segmentos, crecimientoAdminPct } }));
  }

  // ------------------------------------------------------------ carga
  function setBase(data) {
    if (!data?.available) return;
    base = data;
    segLevers = {};
    simulate();
    buildSegTable();
    recompute();
    const h = base.horizonte;
    setText('pptoSimSubtitle', `Base: presupuesto ${h[0].label} → ${h[h.length - 1].label} (método ${base.supuestosAplicados.metodo}) · mueve las palancas y el resultado se recalcula al instante`);
    setStatus('Simulación sobre el presupuesto vigente del generador. "Aplicar al presupuesto" lleva estos cambios como supuestos para guardarlos o exportarlos.');
  }

  async function load() {
    if (base || loading) return;
    loading = true;
    setStatus('Generando presupuesto base desde contabilidad… la primera vez puede tardar hasta 2 minutos.', 'loading');
    $('pptoSim').classList.add('is-loading');
    try {
      setBase(await window.Ppto12m.ensure());
    } catch (err) {
      setStatus(err.message || 'No se pudo cargar el presupuesto base.', 'error');
    } finally {
      loading = false;
      $('pptoSim').classList.remove('is-loading');
    }
  }

  // ------------------------------------------------------------ eventos
  $('pptoSimGlobales').addEventListener('input', (e) => {
    if (!e.target.matches('input[type="range"]')) return;
    syncOutput(e.target);
    recompute();
  });
  $('pptoSimTable').addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.matches('input[type="range"][data-seg]')) return;
    const l = segLevers[inp.dataset.seg] || (segLevers[inp.dataset.seg] = { ventas: 0, margen: 0, gastos: 0 });
    l[inp.dataset.field] = Number(inp.value) || 0;
    syncOutput(inp);
    recompute();
  });
  $('pptoSimTable').addEventListener('dblclick', (e) => {
    const inp = e.target.closest('.ppto-sim__cell')?.querySelector('input');
    if (!inp) return;
    inp.value = 0;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('pptoSimGlobales').addEventListener('dblclick', (e) => {
    const inp = e.target.closest('.ppto-sim__lever')?.querySelector('input');
    if (!inp) return;
    inp.value = 0;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.querySelectorAll('#pptoSim [data-preset]').forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
  $('btnSimEquilibrio').addEventListener('click', irAEquilibrio);
  $('btnSimAplicar').addEventListener('click', aplicarAlGenerador);

  // Si el generador recalcula (otro método, supuestos), el simulador toma la nueva base.
  document.addEventListener('ppto12m:generated', (e) => {
    if (!base) return;
    setGlobals(PRESETS.base);
    setBase(e.detail.data);
  });

  function onTab(tab) {
    if (tab !== 'simulador') return;
    if (!base) load();
    else requestAnimationFrame(() => { chartMes?.resize(); chartImpacto?.resize(); });
  }
  document.addEventListener('forecast:tab', (e) => onTab(e.detail?.tab));
  if (document.body.dataset.forecastTab) onTab(document.body.dataset.forecastTab);
})();
