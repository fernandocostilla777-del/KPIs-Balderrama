/**
 * Contabilidad con el formato de KPIs-VECSA y el cálculo de Balderrama:
 * estado de resultados, análisis y Balance General.
 * Las cifras salen del EEFF SUMMARY de Balderrama (/contabilidad/estado-resultados y
 * /contabilidad/balance). Costo y gastos llevan el signo de la balanza (negativos).
 * contabilidad.js sigue siendo el controlador de la página (pestañas y fechas).
 */
(function contabilidadFormato() {
  const D = window.Dashboard;
  const state = {
    tab: 'er',
    rango: null,
    er: null,
    balance: null,
    balanceKey: '',
    expandirTodo: false,
    ceros: false,
    abiertos: new Set(),
    chart: null,
    chartAnio: null,
    kpiAbierto: null,
    kpiExpandido: true,
    kpiFiltro: null,
    kpiBusqueda: '',
    sucursal: 'todas',
  };

  function focoAnalisis() {
    if (!state.sucursal || state.sucursal === 'todas') return null;
    const deApi = (state.er?.filtroSucursales || []).find((s) => s.id === state.sucursal);
    if (deApi?.linea) return deApi;
    const lineas = state.er?.lineas || [];
    const directa = lineas.find((l) => l.key === state.sucursal);
    if (directa) return { id: directa.key, label: directa.label, linea: directa, serie: [], comparativo: null };
    for (const l of lineas) {
      const s = (l.sucursales || []).find((x) => x.key === state.sucursal);
      if (s) return { id: s.key, label: s.label, linea: s, serie: [], comparativo: null };
    }
    return null;
  }

  function marcarSucursal() {
    document.querySelectorAll('#anSucursalChips [data-sucursal]').forEach((b) => {
      b.classList.toggle('active', b.dataset.sucursal === state.sucursal);
    });
  }

  function pintarAnalisis() {
    marcarSucursal();
    renderLineas();
    renderGastos();
    renderTendencia();
    renderAnio();
    renderEquilibrio();
  }

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const AZUL = '#2D5BFF';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pesos = (v) => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
  }).format(num(v));
  const corto = (v) => {
    const n = num(v);
    const abs = Math.abs(n);
    const s = n < 0 ? '−' : '';
    if (abs >= 1e6) return `${s}$${(abs / 1e6).toFixed(1)} M`;
    if (abs >= 1e3) return `${s}$${Math.round(abs / 1e3)} mil`;
    return `${s}$${Math.round(abs)}`;
  };
  const pct = (v, dec = 1) => {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const t = Number(v).toFixed(dec);
    return `${Number(t) === 0 ? (0).toFixed(dec) : t.replace('-', '−')} %`;
  };
  const conSigno = (v) => pesos(v).replace('-', '−');
  const conSignoCent = (v) => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(num(v)).replace('-', '−');
  const $ = (id) => document.getElementById(id);

  function periodoTexto(fi, ff) {
    const [y1, m1] = fi.split('-').map(Number);
    const [y2, m2] = ff.split('-').map(Number);
    const meses = (y2 - y1) * 12 + (m2 - m1) + 1;
    if (meses <= 1) return `${MESES[m2 - 1].replace(/^./, (c) => c.toUpperCase())} ${y2}`;
    const ini = MESES[m1 - 1].replace(/^./, (c) => c.toUpperCase());
    return `${ini}${y1 !== y2 ? ` ${y1}` : ''} a ${MESES[m2 - 1]} ${y2} · ${meses} meses`;
  }

  function aviso(texto, tipo = '') {
    const el = $('ctbAviso');
    if (!el) return;
    el.textContent = texto || '';
    el.className = `ctb-aviso${tipo ? ` ctb-aviso--${tipo}` : ''}${texto ? '' : ' hidden'}`;
  }

  // ── Pestañas (las cambia contabilidad.js) ───────────────────────────────
  function mostrar(tab) {
    state.tab = tab;
    $('ctbAviso')?.classList.toggle('hidden', !['er', 'analisis', 'balance'].includes(tab) || !$('ctbAviso').textContent);
    $('panelCtbEr')?.classList.toggle('hidden', tab !== 'er');
    $('panelCtbAnalisis')?.classList.toggle('hidden', tab !== 'analisis');
    $('panelCtbBalance')?.classList.toggle('hidden', tab !== 'balance');
    if (tab !== 'er') cerrarDetalleKpi();
    if (tab === 'analisis') {
      renderTendencia();
      renderAnio();
    }
    if (tab === 'balance') cargarBalance();
  }

  // ── Estado de resultados ────────────────────────────────────────────────
  const nivelDe = (f) => String(f.nivel || 'cuenta').toLowerCase();

  /** Padre por posición: la cuenta cuelga del subtotal o rubro anterior; un total corta la rama. */
  function conPadres(filas) {
    let rubro = null;
    let subtotal = null;
    return filas.map((f) => {
      const nivel = nivelDe(f);
      let padre = null;
      if (nivel === 'total') { rubro = null; subtotal = null; } else if (nivel === 'rubro') { rubro = f.fila; subtotal = null; } else if (nivel === 'subtotal') { padre = rubro; subtotal = f.fila; } else padre = subtotal ?? rubro;
      return {
        key: String(f.fila), nivel, concepto: f.concepto, importe: num(f.importe), cuentas: f.cuentas || [], pct: f.pctVentas, padre: padre == null ? null : String(padre), final: Boolean(f.final),
      };
    });
  }

  const listaEr = () => conPadres(state.er?.filas || []);
  const cuentasTexto = (cuentas) => (cuentas?.length ? cuentas.join(' · ') : '');

  function renderTablaEr() {
    const body = $('erTabla');
    const er = state.er;
    if (!body) return;
    if (!er || er.disponible === false) {
      body.innerHTML = '<tr class="empty-row"><td colspan="3">Sin balanza para este periodo.</td></tr>';
      return;
    }
    const lista = listaEr();
    const visibleImporte = (r) => r.nivel === 'total' || state.ceros || Math.abs(r.importe) >= 0.005;
    const hijos = new Map();
    lista.forEach((r) => {
      if (r.padre && visibleImporte(r)) hijos.set(r.padre, (hijos.get(r.padre) || 0) + 1);
    });
    const abierto = (key) => state.expandirTodo || state.abiertos.has(key);
    const byKey = new Map(lista.map((r) => [r.key, r]));
    const visible = (r) => {
      if (!visibleImporte(r)) return false;
      let p = r.padre;
      while (p) {
        if (!abierto(p)) return false;
        p = byKey.get(p)?.padre || null;
      }
      return true;
    };
    const filasHtml = lista.filter(visible).map((r) => {
      const tiene = hijos.get(r.key) > 0;
      const prof = r.padre ? (byKey.get(r.padre)?.padre ? 2 : 1) : 0;
      const ctas = (r.nivel === 'cuenta' || (r.nivel !== 'total' && !tiene)) ? cuentasTexto(r.cuentas) : '';
      const toggle = tiene
        ? `<button type="button" class="ctb-er__toggle" data-er-toggle="${esc(r.key)}" aria-expanded="${abierto(r.key)}" aria-label="${abierto(r.key) ? 'Ocultar' : 'Ver'} detalle de ${esc(r.concepto)}"><span class="material-symbols-outlined" aria-hidden="true">${abierto(r.key) ? 'expand_more' : 'chevron_right'}</span></button>`
        : '<span class="ctb-er__toggle-espacio" aria-hidden="true"></span>';
      return `<tr class="ctb-er__fila ctb-er__fila--${r.nivel}${r.final ? ' ctb-er__fila--final' : ''}" data-prof="${prof}">
        <td><div class="ctb-er__concepto">${toggle}<span>${esc(r.concepto)}${ctas && state.expandirTodo ? `<small class="ctb-er__ctas" title="${esc(ctas)}">${esc(ctas)}</small>` : ''}</span></div></td>
        <td class="cell-money">${conSigno(r.importe)}</td>
        <td class="cell-num">${r.pct == null ? '' : pct(r.pct)}</td>
      </tr>`;
    });
    body.innerHTML = filasHtml.join('') || '<tr class="empty-row"><td colspan="3">Sin renglones con saldo en este periodo.</td></tr>';
    const btn = $('erExpandir');
    if (btn) {
      btn.setAttribute('aria-pressed', state.expandirTodo ? 'true' : 'false');
      btn.textContent = state.expandirTodo ? 'Solo rubros' : 'Ver cuentas';
    }
  }

  function kpi(label, valor, sub = '', extra = '', detalle = '') {
    const abierto = detalle && state.kpiAbierto === detalle;
    if (!detalle) {
      return `<div class="ctb-kpi${extra}">
        <span class="ctb-kpi__label">${esc(label)}</span>
        <strong class="ctb-kpi__valor">${valor}</strong>
        ${sub ? `<span class="ctb-kpi__sub">${sub}</span>` : ''}
      </div>`;
    }
    return `<button type="button" class="ctb-kpi ctb-kpi--detalle${extra}${abierto ? ' is-open' : ''}" data-er-kpi="${esc(detalle)}" aria-expanded="${abierto ? 'true' : 'false'}" aria-controls="erKpiDrawer" title="Ver el detalle en pantalla extendida">
      <span class="ctb-kpi__label">${esc(label)}</span>
      <strong class="ctb-kpi__valor">${valor}</strong>
      ${sub ? `<span class="ctb-kpi__sub">${sub}</span>` : '<span class="ctb-kpi__sub">Ver detalle</span>'}
      <span class="material-symbols-outlined ctb-kpi__abrir" aria-hidden="true">open_in_full</span>
    </button>`;
  }

  function renderResumenEr() {
    const er = state.er;
    const { fi, ff } = state.rango || {};
    $('erPeriodo').textContent = fi && ff ? periodoTexto(fi, ff) : '';
    if (!er || er.disponible === false) {
      $('erCifra').textContent = '—';
      $('erFrase').textContent = '';
      $('erKpis').innerHTML = '';
      cerrarDetalleKpi();
      return;
    }
    const t = er.totales || {};
    const m = er.margenes || {};
    const neta = num(t.utilidadNeta);
    const gastosUb = t.utilidadBruta ? (-num(t.gastos) / num(t.utilidadBruta)) * 100 : null;
    $('erKicker').textContent = neta < 0 ? 'Pérdida del periodo' : 'Utilidad del periodo';
    $('erCifra').textContent = conSigno(neta);
    $('erFrase').textContent = neta < 0
      ? `Los gastos (${corto(-num(t.gastos))}) superan la utilidad bruta (${corto(t.utilidadBruta)}).`
      : `Margen de ${pct(m.netoPct)} sobre ventas de ${corto(t.ventas)}. Los gastos se llevan ${pct(gastosUb)} de la utilidad bruta.`;
    // Cascada hacia el titular; la utilidad de operación entra solo si difiere de la del periodo.
    const cards = [
      kpi('Ventas', corto(t.ventas), '', '', 'ventas'),
      kpi('Costo de ventas', corto(-num(t.costo)), `${pct(t.ventas ? (-num(t.costo) / num(t.ventas)) * 100 : null)} de las ventas`, '', 'costo'),
      kpi('Utilidad bruta', corto(t.utilidadBruta), `${pct(m.brutoPct)} de las ventas`, '', 'utilidadBruta'),
      kpi('Gastos', corto(-num(t.gastos)), `${pct(gastosUb)} de la utilidad bruta`, '', 'gastos'),
    ];
    if (Math.abs(num(t.utilidadOperacion) - neta) >= 1) {
      cards.push(kpi('Utilidad de operación', corto(t.utilidadOperacion), `${pct(m.operacionPct)} de las ventas`));
    }
    $('erKpis').innerHTML = cards.join('');
    $('erNota').textContent = er.nota || '';
    if (state.kpiAbierto) pintarDetalleKpi();
  }

  function renderRevision() {
    const sec = $('erRevision');
    const er = state.er;
    const sin = er?.cuentasSinRenglon || [];
    const dup = er?.cuentasDuplicadas || [];
    const fuera = er?.gastosFueraDelEstado || [];
    if (!sec) return;
    const hay = sin.length || dup.length || fuera.length;
    sec.classList.toggle('hidden', !hay);
    if (!hay) return;
    const totalSin = sin.reduce((s, c) => s + num(c.importe), 0);
    const partes = [];
    if (sin.length) partes.push(`${sin.length} cuenta${sin.length === 1 ? '' : 's'} con saldo sin renglón (${corto(totalSin)})`);
    if (dup.length) partes.push(`${dup.length} cuenta${dup.length === 1 ? '' : 's'} en dos renglones`);
    if (fuera.length) partes.push(`${fuera.length} departamento${fuera.length === 1 ? '' : 's'} con gasto fuera del estado`);
    $('erRevisionResumen').innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">fact_check</span> Revisión de la balanza: ${esc(partes.join(' · '))}`;
    const htmlSin = sin.length ? `<p class="ctb-revision__titulo">Cuentas con saldo que el estado no toma</p>
      <table class="data-table ctb-mini"><thead><tr><th>Cuenta</th><th>Descripción</th><th class="cell-money">Importe</th></tr></thead><tbody>
      ${sin.map((c) => `<tr><td>${esc(c.cuenta)}</td><td>${esc(c.descripcion || '—')}</td><td class="cell-money">${conSigno(c.importe)}</td></tr>`).join('')}
      </tbody></table>` : '';
    const htmlDup = dup.length ? `<p class="ctb-revision__titulo">Cuentas que toman dos renglones</p>
      <ul class="ctb-revision__lista">${dup.map((d) => `<li><strong>${esc(d.cuenta)}</strong> · ${conSigno(d.importe)} en ${d.filas.map((f) => esc(f.concepto)).join(' y ')}. La cuenta pesa ${d.filas.length} veces en el estado.</li>`).join('')}</ul>` : '';
    const htmlFuera = fuera.length ? `<p class="ctb-revision__titulo">Departamentos con gasto que el estado no suma</p>
      <ul class="ctb-revision__lista">${fuera.map((g) => `<li><strong>GPO ${esc(g.gpo)}</strong> ${esc(g.label)} · ${conSigno(g.importe)}</li>`).join('')}</ul>` : '';
    $('erRevisionDetalle').innerHTML = htmlSin + htmlDup + htmlFuera;
  }

  // ── Análisis ────────────────────────────────────────────────────────────
  const GRUPOS = [
    { key: 'nuevos', label: 'Autos nuevos' },
    { key: 'usados', label: 'Seminuevos' },
    { key: 'posventa', label: 'PostVenta' },
    { key: 'otros', label: 'Otros' },
  ];

  function renderLineas() {
    const body = $('anLineas');
    const foco = focoAnalisis();
    const lineas = foco?.linea ? [foco.linea] : (state.er?.lineas || []);
    if (!body) return;
    if (foco && !foco.linea) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Sin movimiento de esta sucursal en el periodo.</td></tr>';
      $('anLineasNota').textContent = foco.label;
      return;
    }
    if (!lineas.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Sin datos para este periodo.</td></tr>';
      $('anLineasNota').textContent = '';
      return;
    }
    const total = lineas.reduce((s, l) => s + num(l.utilidad), 0);
    const max = Math.max(...lineas.map((l) => Math.abs(num(l.utilidad))), 1);
    const barra = (v) => {
      const w = Math.max(2, Math.round((Math.abs(v) / max) * 100));
      return `<div class="ctb-barra"><i class="${v < 0 ? 'ctb-barra--neg' : ''}" style="width:${w}%"></i><span>${total ? pct((v / total) * 100, 0) : ''}</span></div>`;
    };
    const fila = (l, clase, etiqueta) => `<tr class="${clase}">
        <td>${esc(etiqueta)}</td>
        <td class="cell-money">${l.ventas ? conSignoCent(l.ventas) : '—'}</td>
        <td class="cell-money">${conSignoCent(l.utilidad)}</td>
        <td class="cell-num">${l.margenPct == null ? '—' : pct(l.margenPct)}</td>
        <td class="ctb-col-barra">${barra(num(l.utilidad))}</td>
      </tr>`;
    const filas = [];
    for (const g of GRUPOS) {
      const ls = lineas.filter((l) => l.grupo === g.key);
      if (!ls.length) continue;
      if (ls.length > 1) {
        const v = ls.reduce((s, l) => s + num(l.ventas), 0);
        const u = ls.reduce((s, l) => s + num(l.utilidad), 0);
        filas.push(`<tr class="ctb-lineas__grupo"><td>${esc(g.label)}</td><td class="cell-money">${conSignoCent(v)}</td><td class="cell-money">${conSignoCent(u)}</td><td class="cell-num">${v ? pct((u / v) * 100) : '—'}</td><td class="ctb-col-barra">${barra(u)}</td></tr>`);
      }
      ls.forEach((l) => {
        filas.push(fila(l, ls.length > 1 && !foco ? 'ctb-lineas__hija' : 'ctb-lineas__grupo', (ls.length > 1 && !foco) ? l.label : (foco ? foco.label : g.label)));
        if (!foco) (l.sucursales || []).forEach((s) => filas.push(fila(s, 'ctb-lineas__sucursal', s.label)));
      });
    }
    body.innerHTML = filas.join('');
    const detalle = foco?.linea
      ? [foco.linea]
      : lineas.flatMap((l) => (l.sucursales?.length ? l.sucursales : [l]));
    const negativas = detalle.filter((l) => num(l.utilidad) < 0);
    if (foco) {
      $('anLineasNota').textContent = `Cifras de ${foco.label}. El resto de la agencia queda fuera de esta vista.`;
      return;
    }
    $('anLineasNota').textContent = negativas.length
      ? `${negativas.map((l) => `${l.label} vende abajo del costo (${pct(l.margenPct)})`).join('; ')}. La suma de las líneas es la utilidad bruta de la agencia.`
      : 'Venta, costo y utilidad bruta de cada línea. La suma es la utilidad bruta de la agencia.';
  }

  function renderGastos() {
    const host = $('anGastos');
    if (!host) return;
    const foco = focoAnalisis();
    if (foco?.linea && (foco.linea.gastos != null || foco.linea.gastosAdministracion != null)) {
      const op = num(foco.linea.gastos);
      const admin = num(foco.linea.gastosAdministracion);
      $('anGastosNota').textContent = `Gasto de operación de ${foco.label} y la parte del bolsón de administración que le toca.`;
      host.innerHTML = [
        { label: 'Gasto de operación', importe: op },
        { label: 'Administración prorrateada', importe: admin },
      ].map((g) => `<details class="ctb-gasto" open>
        <summary>
          <span class="ctb-gasto__label">${esc(g.label)}</span>
          <span class="ctb-gasto__monto">${conSignoCent(-g.importe)}</span>
        </summary>
      </details>`).join('');
      return;
    }
    const gastos = state.er?.gastos || [];
    if (!gastos.length) { host.innerHTML = ''; return; }
    const ub = num(state.er?.totales?.utilidadBruta);
    const totalPct = ub ? (gastos.reduce((s, g) => s - num(g.importe), 0) / ub) * 100 : null;
    const fuera = state.er?.gastosFueraDelEstado || [];
    const notaFuera = fuera.length
      ? ` Fuera del estado: ${fuera.map((g) => `GPO ${g.gpo} ${g.label} (${conSignoCent(-num(g.importe))})`).join('; ')}.`
      : '';
    $('anGastosNota').textContent = `${totalPct == null ? '' : `Los gastos consumen ${pct(totalPct)} de la utilidad bruta. `}Por departamento (GPO); administración es de toda la agencia.${notaFuera}`;
    const max = Math.max(...gastos.map((g) => Math.abs(num(g.pctUtilidadBruta))), 1);
    host.innerHTML = gastos.map((g) => {
      const w = Math.max(2, Math.round((Math.abs(num(g.pctUtilidadBruta)) / max) * 100));
      const det = (g.principales || []).map((c) => `<li><span>${esc(c.concepto)}</span><strong>${conSignoCent(-num(c.importe))}</strong></li>`).join('');
      return `<details class="ctb-gasto">
        <summary>
          <span class="ctb-gasto__label">${esc(g.label)}</span>
          <span class="ctb-gasto__monto">${conSignoCent(-num(g.importe))}</span>
          <span class="ctb-barra ctb-gasto__barra"><i style="width:${w}%"></i><span>${pct(g.pctUtilidadBruta)}</span></span>
        </summary>
        ${det ? `<ul class="ctb-gasto__det">${det}</ul>` : `<p class="ctb-gasto__vacio">${esc(cuentasTexto(g.cuentas) || 'Sin desglose por cuenta.')} · ${pct(g.pctVentas)} de las ventas</p>`}
      </details>`;
    }).join('');
  }

  function opcionesGrafica(extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, color: '#475569', font: { family: 'Inter', size: 12, weight: '600' } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${conSignoCent(c.parsed.y * 1e6)}` } },
        ...extra,
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b' } },
        y: { grid: { color: 'rgba(148,163,184,0.2)' }, ticks: { color: '#64748b', callback: (v) => (v < 0 ? `−$${-v} M` : `$${v} M`) } },
      },
    };
  }
  const millones = (v) => Math.round(num(v) / 10000) / 100;

  function renderTendencia() {
    const canvas = $('anTendencia');
    const foco = focoAnalisis();
    const serie = foco ? (foco.serie || []) : (state.er?.serie || []);
    if (!canvas || !window.Chart) return;
    if ($('panelCtbAnalisis')?.classList.contains('hidden')) return; // se dibuja al abrir la pestaña
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    if (!serie.length) return;
    state.chart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: serie.map((s) => s.etiqueta.split(' ')[0]),
        datasets: [
          { type: 'bar', label: 'Utilidad bruta', data: serie.map((s) => millones(s.totales?.utilidadBruta)), backgroundColor: AZUL, borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Gastos', data: serie.map((s) => millones(-num(s.totales?.gastos))), backgroundColor: '#CBD5E1', borderRadius: 4, order: 2 },
          { type: 'line', label: 'Utilidad del periodo', data: serie.map((s) => millones(s.totales?.utilidadNeta)), borderColor: '#0f172a', backgroundColor: '#0f172a', tension: 0, pointRadius: 3, order: 1 },
        ],
      },
      options: opcionesGrafica(),
    });
  }

  // Costo y gastos llegan con el signo del estado (negativos); la tarjeta los lee como gasto.
  const ES_GASTO = new Set(['costo', 'gastos']);

  function textoVariacion(r) {
    const gasto = ES_GASTO.has(r.key);
    const anterior = conSignoCent(gasto ? -r.anterior : r.anterior);
    if (r.variacionPct == null) return `Año anterior ${anterior} · sin base para el porcentaje`;
    if (gasto) {
      return `${pct(Math.abs(r.variacionPct))} ${r.diferencia < 0 ? 'más' : 'menos'} gasto · año anterior ${anterior}`;
    }
    return `${r.variacionPct > 0 ? '+' : ''}${pct(r.variacionPct)} · año anterior ${anterior}`;
  }

  function renderAnio() {
    const host = $('anAnio');
    const foco = focoAnalisis();
    const comp = foco ? foco.comparativo : state.er?.comparativo;
    if (!host) return;
    if (state.chartAnio) { state.chartAnio.destroy(); state.chartAnio = null; }
    const wrap = $('anAnioGraficaWrap');
    if (!comp) {
      host.innerHTML = '<p class="ctb-nota">Sin cifras mensuales para comparar.</p>';
      wrap?.classList.add('hidden');
      renderCuadroAnio(null);
      return;
    }
    $('anAnioNota').textContent = comp.hayAnterior
      ? `Contra ${periodoTexto(comp.periodoAnterior.fechaInicio, comp.periodoAnterior.fechaFin).replace(/^./, (c) => c.toLowerCase())}.`
      : `No hay cifras de ${comp.anioAnterior} para este periodo.`;
    host.innerHTML = `<div class="ctb-kpis">${comp.rubros.map((r) => {
      const tono = r.diferencia >= 0 ? 'ctb-anio__var--mas' : 'ctb-anio__var--menos';
      return kpi(r.label, conSignoCent(ES_GASTO.has(r.key) ? -r.actual : r.actual), `<span class="${tono}">${esc(textoVariacion(r))}</span>`);
    }).join('')}</div>`;
    renderCuadroAnio(comp);
    const canvas = $('anAnioGrafica');
    if (!wrap || !canvas || !window.Chart || !comp.hayAnterior) {
      wrap?.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    if ($('panelCtbAnalisis')?.classList.contains('hidden')) return;
    state.chartAnio = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: comp.meses.map((m) => m.etiqueta),
        datasets: [
          { label: String(comp.anioAnterior), data: comp.meses.map((m) => millones(m.anterior)), backgroundColor: '#CBD5E1', borderRadius: 4 },
          { label: String(comp.anio), data: comp.meses.map((m) => millones(m.actual)), backgroundColor: AZUL, borderRadius: 4 },
        ],
      },
      options: opcionesGrafica({
        title: { display: true, text: `${comp.metricaLabel}, cada mes`, color: '#475569', font: { family: 'Inter', size: 13, weight: '600' } },
      }),
    });
  }

  function renderCuadroAnio(comp) {
    const tabla = $('anAnioTabla');
    const nota = $('anAnioCorte');
    const cuadro = comp?.cuadro;
    if (!tabla) return;
    if (!cuadro?.filas?.length) {
      tabla.innerHTML = '';
      nota?.classList.add('hidden');
      return;
    }
    nota?.classList.remove('hidden');
    const ultimo = cuadro.meses[cuadro.meses.length - 1];
    if (nota && ultimo) {
      nota.textContent = `De enero a ${ultimo.etiqueta} de ${comp.anio}. El acumulado y la variación van junto al concepto y se comparan con el mismo tramo de ${comp.anioAnterior}; costo y gastos llevan el signo del estado.`;
    }
    const variacion = (fila) => {
      if (!comp.hayAnterior || fila.variacionPct == null) return '—';
      return fila.variacionPct > 0 ? `+${pct(fila.variacionPct)}` : pct(fila.variacionPct);
    };
    const tono = (fila) => (fila.diferencia >= 0 ? 'ctb-anio__var--mas' : 'ctb-anio__var--menos');
    tabla.innerHTML = `<thead><tr>
      <th scope="col">Concepto</th>
      <th scope="col" class="cell-money">Acum. ${esc(comp.anio)}</th>
      <th scope="col" class="cell-money">Acum. ${esc(comp.anioAnterior)}</th>
      <th scope="col" class="cell-money">Diferencia</th>
      <th scope="col" class="cell-num ctb-comp__corte">%</th>
      ${cuadro.meses.map((m) => `<th scope="col" class="cell-money">${esc(m.etiqueta)}</th>`).join('')}
    </tr></thead><tbody>${cuadro.filas.map((f) => `<tr class="ctb-comp--${esc(f.nivel)}">
      <th scope="row">${esc(f.label)}</th>
      <td class="cell-money">${conSignoCent(f.acumulado)}</td>
      <td class="cell-money">${comp.hayAnterior ? conSignoCent(f.acumuladoAnterior) : '—'}</td>
      <td class="cell-money ${tono(f)}">${comp.hayAnterior ? conSignoCent(f.diferencia) : '—'}</td>
      <td class="cell-num ctb-comp__corte ${tono(f)}">${variacion(f)}</td>
      ${f.meses.map((v) => `<td class="cell-money">${conSignoCent(v)}</td>`).join('')}
    </tr>`).join('')}</tbody>`;
  }

  function renderEquilibrio() {
    const host = $('anEquilibrio');
    if (!host) return;
    if (focoAnalisis()) {
      host.innerHTML = '<p class="ctb-nota">El punto de equilibrio es de la agencia completa. No cambia al filtrar una sucursal.</p>';
      return;
    }
    const eq = state.er?.equilibrio;
    if (!eq || !eq.ventas) { host.innerHTML = '<p class="ctb-nota">Sin datos de punto de equilibrio para el periodo.</p>'; return; }
    if (eq.ventasEquilibrio == null) {
      host.innerHTML = `<p class="ctb-equilibrio__frase">Con margen de contribución de ${pct(eq.margenContribucionPct)} no hay punto de equilibrio: cada venta adicional no cubre la estructura.</p>`;
      return;
    }
    const arriba = eq.holgura >= 0;
    const tope = Math.max(eq.ventas, eq.ventasEquilibrio) || 1;
    host.innerHTML = `
      <p class="ctb-equilibrio__frase">${arriba
        ? `Las ventas están <strong>${conSignoCent(eq.holgura)}</strong> arriba del equilibrio (${pct((eq.holgura / eq.ventas) * 100)} de margen de seguridad).`
        : `Faltan <strong>${conSignoCent(-eq.holgura)}</strong> de ventas para llegar al equilibrio.`}</p>
      <div class="ctb-equilibrio__regla" role="img" aria-label="Ventas ${conSignoCent(eq.ventas)} contra equilibrio ${conSignoCent(eq.ventasEquilibrio)}">
        <i style="width:${Math.round((eq.ventas / tope) * 100)}%"></i>
        <b style="left:${Math.round((eq.ventasEquilibrio / tope) * 100)}%"><span>Equilibrio</span></b>
      </div>
      <div class="ctb-kpis ctb-kpis--3">
        ${kpi('Ventas del periodo', conSignoCent(eq.ventas))}
        ${kpi('Ventas de equilibrio', conSignoCent(eq.ventasEquilibrio))}
        ${kpi('Margen de contribución', pct(eq.margenContribucionPct), `${conSignoCent(eq.contribucion)} después de costos variables`)}
        ${kpi('Gastos fijos', conSignoCent(-eq.gastosEstructura))}
        ${kpi('Cobertura', pct(eq.coberturaPct), 'contribución ÷ gastos fijos')}
      </div>
      <p class="ctb-nota">${esc(eq.nota || '')} El detalle por departamento está en «Departamentos y presupuesto».</p>`;
  }

  // ── Balance General ─────────────────────────────────────────────────────
  async function cargarBalance() {
    if (!state.rango) return;
    const { ff } = state.rango;
    if (state.balanceKey === ff && state.balance) { renderBalance(); return; }
    D.showLoading(true);
    try {
      state.balance = await D.api(`/contabilidad/balance?fechaFin=${ff}`);
      state.balanceKey = ff;
    } catch (err) {
      state.balance = { disponible: false, nota: err.message || 'No se pudo cargar el balance.' };
      state.balanceKey = '';
    } finally {
      D.showLoading(false);
    }
    renderBalance();
  }

  const ESTADO_TXT = { ok: 'En referencia', revisar: 'Fuera de referencia', critico: 'Crítico', 'sin-dato': 'Sin dato' };

  function valorIndicador(i) {
    if (i.valor == null) return '—';
    if (i.unidad === '%') return pct(i.valor);
    if (i.unidad === 'pesos') return corto(i.valor);
    return `${Number(i.valor).toFixed(2)}×`;
  }

  function columnaBalance(secciones, activoTotal, extra = '') {
    return secciones.map((sec) => `
      <div class="ctb-bg-sec">
        <div class="ctb-bg-sec__head"><span>${esc(sec.label)}</span><strong>${corto(sec.total)}</strong></div>
        ${sec.grupos.map((g) => `
          <div class="ctb-bg-grupo">
            <div class="ctb-bg-grupo__head"><span>${esc(g.concepto)}</span><span class="ctb-bg-grupo__pct">${activoTotal ? pct((g.total / activoTotal) * 100, 0) : ''}</span><strong>${corto(g.total)}</strong></div>
            ${g.mayores.map((m) => `
              <div class="ctb-bg-mayor ctb-bg-mayor--plano">
                <span class="ctb-bg-mayor__cta">${esc(m.cuenta)}</span><span class="ctb-bg-mayor__nombre">${esc(m.concepto)}</span><strong>${corto(m.importe)}</strong>
              </div>`).join('')}
          </div>`).join('')}
      </div>`).join('') + extra;
  }

  function renderBalance() {
    const b = state.balance;
    const ids = ['bgKpis', 'bgIndicadores', 'bgActivo', 'bgPasivoCapital', 'bgConciliacion'];
    if (!b || b.disponible === false) {
      $('bgCorte').textContent = '—';
      $('bgCuadre').textContent = b?.nota || '';
      $('bgCuadre').className = 'ctb-resumen__frase';
      $('bgNota').textContent = '';
      ids.forEach((id) => { if ($(id)) $(id).innerHTML = ''; });
      return;
    }
    const t = b.totales;
    $('bgCorte').textContent = `Al cierre de ${b.corte}`;
    $('bgCuadre').textContent = b.cuadre.ok
      ? 'Cuadra: activo = pasivo + capital + resultado del ejercicio.'
      : `No cuadra: diferencia de ${pesos(b.cuadre.diferencia)}. Revise el catálogo de cuentas del balance.`;
    $('bgCuadre').className = `ctb-resumen__frase${b.cuadre.ok ? '' : ' ctb-critico'}`;
    $('bgNota').textContent = b.nota || '';
    $('bgKpis').innerHTML = [
      kpi('Activo total', corto(t.activo)),
      kpi('Pasivo total', corto(t.pasivo), `${pct(t.activo ? (t.pasivo / t.activo) * 100 : null)} del activo`),
      kpi('Capital contable', corto(t.capitalContable), 'incluye el resultado del ejercicio'),
      kpi('Resultado del ejercicio', corto(t.resultado), 'de enero al corte'),
    ].join('');
    $('bgIndicadores').innerHTML = (b.indicadores || []).map((i) => `
      <div class="ctb-ind ctb-ind--${esc(i.estado)}">
        <span class="ctb-ind__label">${esc(i.label)}</span>
        <strong class="ctb-ind__valor">${valorIndicador(i)}</strong>
        <span class="ctb-ind__estado">${esc(ESTADO_TXT[i.estado] || '')} · ${esc(i.referencia)}</span>
        <span class="ctb-ind__formula">${esc(i.formula)}</span>
        ${i.nota ? `<span class="ctb-ind__nota">${esc(i.nota)}</span>` : ''}
      </div>`).join('');
    const sec = Object.fromEntries((b.secciones || []).map((s) => [s.key, s]));
    $('bgActivo').innerHTML = columnaBalance([sec.activo].filter(Boolean), t.activo);
    $('bgPasivoCapital').innerHTML = columnaBalance([sec.pasivo, sec.capital].filter(Boolean), t.activo, `
      <div class="ctb-bg-grupo"><div class="ctb-bg-grupo__head"><span>Resultado del ejercicio</span><span class="ctb-bg-grupo__pct">${t.activo ? pct((t.resultado / t.activo) * 100, 0) : ''}</span><strong>${corto(t.resultado)}</strong></div></div>
      <div class="ctb-bg-sec__head ctb-bg-sec__head--total"><span>Pasivo + capital</span><strong>${corto(t.pasivoMasCapital)}</strong></div>`);
    const c = b.conciliacion || {};
    const dif = c.diferencia == null ? null : num(c.diferencia);
    const grupos = { '04': 'ingresos', '06': 'costos', '07': 'gastos', '08': 'productos financieros', '09': 'gastos financieros' };
    $('bgConciliacion').innerHTML = `
      <div class="ctb-kpis ctb-kpis--3">
        ${kpi('Según la balanza', conSigno(c.balanza))}
        ${kpi('Según el estado de resultados', c.estadoResultados == null ? '—' : conSigno(c.estadoResultados), c.estadoResultados == null ? 'faltan meses del año en el EEFF mensual' : '')}
        ${kpi('Diferencia', dif == null ? '—' : (Math.abs(dif) < 1 ? '$0' : conSigno(dif)), dif != null && Math.abs(dif) < 1 ? 'coinciden' : '', dif != null && Math.abs(dif) >= 1 ? ' ctb-kpi--atencion' : '')}
      </div>
      ${(c.porPrefijo || []).length ? `<p class="ctb-nota">Resultado de la balanza por grupo: ${(c.porPrefijo).map((p) => `${esc(p.prefijo)} ${esc(grupos[p.prefijo] || '')} ${corto(p.importe)}`).join(' · ')}.</p>` : ''}
      ${dif != null && Math.abs(dif) >= 1 ? '<p class="ctb-nota">La diferencia sale de cuentas de resultados que el estado no toma; vea «Revisión de la balanza» en el estado de resultados con el periodo de enero al corte.</p>' : ''}`;
  }

  // ── Detalle de los cuatro totales (pantalla extendida) ─────────────────
  const BLOQUES_UI = {
    ventas: { titulo: 'Ventas', seccion: 'Ingresos', icono: 'payments' },
    costo: { titulo: 'Costo de ventas', seccion: 'Costo de ventas', icono: 'inventory_2' },
    utilidadBruta: { titulo: 'Utilidad bruta', seccion: 'Utilidad bruta', icono: 'monitoring' },
    gastos: { titulo: 'Gastos', seccion: 'Gastos', icono: 'account_balance' },
  };
  const bloqueActivo = (key) => {
    const ui = BLOQUES_UI[key];
    const srv = state.er?.bloques?.[key];
    return ui && srv ? { ...ui, ...srv } : null;
  };
  let detalleUi = null;

  function gruposDelBloque(key) {
    const b = bloqueActivo(key);
    if (!b) return [];
    const filas = state.er?.filas || [];
    const deSeccion = filas.filter((f) => f.seccion === b.seccion && f.fila !== b.total);
    return b.raices.map((fila, i) => {
      const hasta = b.raices[i + 1] ?? b.total;
      const lista = conPadres(deSeccion.filter((f) => f.fila >= fila && f.fila < hasta));
      if (!lista.length) return null;
      const vivos = new Set();
      const byKey = new Map(lista.map((r) => [r.key, r]));
      lista.forEach((r) => {
        if (!state.ceros && Math.abs(r.importe) < 0.005) return;
        let p = r.key;
        while (p) {
          if (vivos.has(p)) break;
          vivos.add(p);
          p = byKey.get(p)?.padre || null;
        }
      });
      const hijos = lista.slice(1).filter((r) => vivos.has(r.key));
      if (!state.ceros && !vivos.has(lista[0].key) && !hijos.length) return null;
      return { raiz: lista[0], hijos };
    }).filter(Boolean);
  }

  function asegurarDetalleKpi() {
    if (detalleUi) return detalleUi;
    const backdrop = document.createElement('div');
    backdrop.className = 'ops-orders-backdrop';
    backdrop.id = 'erKpiBackdrop';
    const panel = document.createElement('div');
    panel.className = 'ops-orders-drawer';
    panel.id = 'erKpiDrawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle del estado de resultados');
    panel.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo" data-er-kpi-logo>payments</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-er-kpi-title>Detalle</h2>
            <span class="ops-orders-drawer__status" data-er-kpi-status></span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-er-kpi-expand title="Contraer" aria-label="Contraer pantalla extendida">
            <span class="material-symbols-outlined" data-er-kpi-expand-icon>close_fullscreen</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-er-kpi-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <label class="ops-orders-drawer__search" for="erKpiSearch">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="erKpiSearch" type="search" placeholder="Buscar rubro o cuenta" autocomplete="off"/>
        </label>
        <span class="ops-orders-drawer__meta" data-er-kpi-meta></span>
      </div>
      <div class="ops-orders-drawer__main">
        <aside class="ops-orders-drawer__summary custom-scrollbar" data-er-kpi-summary></aside>
        <div class="ops-orders-drawer__body custom-scrollbar" data-er-kpi-body></div>
      </div>`;
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    const ui = {
      backdrop,
      panel,
      logo: panel.querySelector('[data-er-kpi-logo]'),
      title: panel.querySelector('[data-er-kpi-title]'),
      status: panel.querySelector('[data-er-kpi-status]'),
      meta: panel.querySelector('[data-er-kpi-meta]'),
      summary: panel.querySelector('[data-er-kpi-summary]'),
      body: panel.querySelector('[data-er-kpi-body]'),
      search: panel.querySelector('#erKpiSearch'),
      expand: panel.querySelector('[data-er-kpi-expand]'),
      expandIcon: panel.querySelector('[data-er-kpi-expand-icon]'),
    };
    backdrop.addEventListener('click', cerrarDetalleKpi);
    panel.querySelector('[data-er-kpi-close]').addEventListener('click', cerrarDetalleKpi);
    ui.expand.addEventListener('click', () => {
      state.kpiExpandido = !state.kpiExpandido;
      aplicarExpansionKpi(ui);
    });
    ui.search.addEventListener('input', () => {
      state.kpiBusqueda = ui.search.value;
      pintarDetalleKpi();
    });
    ui.summary.addEventListener('click', (e) => {
      const b = e.target.closest('[data-er-rubro]');
      if (!b) return;
      const rubro = b.dataset.erRubro;
      state.kpiFiltro = state.kpiFiltro === rubro ? null : rubro;
      pintarDetalleKpi();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.kpiAbierto) cerrarDetalleKpi();
    });
    detalleUi = ui;
    return ui;
  }

  function aplicarExpansionKpi(ui) {
    ui.panel.classList.toggle('ops-orders-drawer--expanded', state.kpiExpandido);
    ui.expandIcon.textContent = state.kpiExpandido ? 'close_fullscreen' : 'open_in_full';
    ui.expand.title = state.kpiExpandido ? 'Contraer' : 'Pantalla extendida';
    ui.expand.setAttribute('aria-label', state.kpiExpandido ? 'Contraer pantalla extendida' : 'Pantalla extendida');
  }

  function marcarKpiAbierto() {
    document.querySelectorAll('[data-er-kpi]').forEach((b) => {
      const on = b.dataset.erKpi === state.kpiAbierto;
      b.classList.toggle('is-open', on);
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }

  function cerrarDetalleKpi() {
    if (!state.kpiAbierto && !detalleUi?.panel.classList.contains('ops-orders-drawer--open')) return;
    state.kpiAbierto = null;
    state.kpiFiltro = null;
    state.kpiBusqueda = '';
    document.body.classList.remove('ctb-detalle-abierto');
    if (detalleUi) {
      detalleUi.panel.classList.remove('ops-orders-drawer--open', 'ops-orders-drawer--expanded');
      detalleUi.backdrop.classList.remove('ops-orders-backdrop--visible');
      detalleUi.panel.setAttribute('aria-hidden', 'true');
    }
    marcarKpiAbierto();
  }

  function abrirDetalleKpi(key) {
    if (!bloqueActivo(key)) return;
    const ui = asegurarDetalleKpi();
    state.kpiAbierto = key;
    state.kpiFiltro = null;
    state.kpiBusqueda = '';
    state.kpiExpandido = true;
    ui.search.value = '';
    ui.panel.classList.add('ops-orders-drawer--open');
    ui.backdrop.classList.add('ops-orders-backdrop--visible');
    ui.panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ctb-detalle-abierto');
    aplicarExpansionKpi(ui);
    pintarDetalleKpi();
    marcarKpiAbierto();
    ui.search.focus();
  }

  function filaDetalleHtml(r, prof) {
    const ctas = cuentasTexto(r.cuentas);
    return `<tr class="ctb-detalle__fila ctb-detalle__fila--${esc(r.nivel)}" data-prof="${prof}">
      <td>${esc(r.concepto)}${ctas ? `<small>${esc(ctas)}</small>` : ''}</td>
      <td class="cell-money">${conSignoCent(r.importe)}</td>
      <td class="cell-num">${r.pct == null ? '' : pct(r.pct)}</td>
    </tr>`;
  }

  function pintarDetalleKpi() {
    const key = state.kpiAbierto;
    const b = bloqueActivo(key);
    const ui = detalleUi;
    if (!b || !ui) return;
    const t = state.er?.totales || {};
    const totalFila = (state.er?.filas || []).find((f) => f.fila === b.total);
    const cifra = key === 'costo' || key === 'gastos' ? -num(t[key]) : num(t[key]);
    const q = state.kpiBusqueda.trim().toLowerCase();
    const todos = gruposDelBloque(key);
    let grupos = todos;
    if (q) {
      grupos = todos.map((g) => {
        const raizOk = g.raiz.concepto.toLowerCase().includes(q) || cuentasTexto(g.raiz.cuentas).toLowerCase().includes(q);
        const hijos = g.hijos.filter((r) => raizOk || r.concepto.toLowerCase().includes(q) || cuentasTexto(r.cuentas).toLowerCase().includes(q));
        if (!raizOk && !hijos.length) return null;
        return { raiz: g.raiz, hijos: raizOk ? g.hijos : hijos };
      }).filter(Boolean);
    }
    if (state.kpiFiltro && !grupos.some((g) => g.raiz.key === state.kpiFiltro)) state.kpiFiltro = null;
    const mostrados = state.kpiFiltro ? grupos.filter((g) => g.raiz.key === state.kpiFiltro) : grupos;
    const partidas = todos.reduce((n, g) => n + 1 + g.hijos.length, 0);
    ui.logo.textContent = b.icono;
    ui.title.textContent = b.titulo;
    ui.status.textContent = `${corto(cifra)} · ${partidas} partida${partidas === 1 ? '' : 's'} con saldo`;
    ui.meta.textContent = 'Los importes conservan el signo del estado';
    ui.summary.innerHTML = grupos.map((g) => `
      <button type="button" class="ctb-detalle-rubro${state.kpiFiltro === g.raiz.key ? ' is-on' : ''}" data-er-rubro="${esc(g.raiz.key)}">
        <span>${esc(g.raiz.concepto)}</span>
        <strong>${conSignoCent(g.raiz.importe)}</strong>
      </button>`).join('') || '<p class="ctb-detalle__vacio">Sin rubros con saldo.</p>';
    const cuerpo = mostrados.map((g) => [
      filaDetalleHtml(g.raiz, 0),
      ...g.hijos.map((r) => filaDetalleHtml(r, r.padre && r.padre !== g.raiz.key ? 2 : 1)),
    ].join('')).join('');
    const total = totalFila
      ? `<tr class="ctb-detalle__fila ctb-detalle__fila--total"><td>${esc(totalFila.concepto)}</td><td class="cell-money">${conSignoCent(totalFila.importe)}</td><td class="cell-num">${totalFila.pctVentas == null ? '' : pct(totalFila.pctVentas)}</td></tr>`
      : '';
    ui.body.innerHTML = mostrados.length
      ? `<table class="ctb-detalle"><thead><tr><th>Concepto</th><th>Importe</th><th>% ventas</th></tr></thead><tbody>${cuerpo}${state.kpiFiltro || q ? '' : total}</tbody></table>`
      : '<p class="ctb-detalle__vacio">Sin partidas con saldo en este periodo.</p>';
  }

  // ── Carga ───────────────────────────────────────────────────────────────
  async function load(fi, ff) {
    state.rango = { fi, ff };
    state.balance = null;
    state.balanceKey = '';
    let er;
    try {
      er = await D.api(`/contabilidad/estado-resultados?fechaInicio=${fi}&fechaFin=${ff}`);
    } catch (err) {
      er = { disponible: false, nota: err.message };
    }
    state.er = er;
    if (er?.disponible === false) aviso(er.nota || 'No hay balanza para este periodo.', 'info');
    else aviso('');
    renderResumenEr();
    renderRevision();
    renderTablaEr();
    renderLineas();
    renderGastos();
    renderEquilibrio();
    renderTendencia();
    renderAnio();
    if (state.tab === 'balance') await cargarBalance();
    return er;
  }

  document.getElementById('anSucursalChips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sucursal]');
    if (!b) return;
    state.sucursal = b.dataset.sucursal || 'todas';
    pintarAnalisis();
  });
  document.getElementById('erKpis')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-er-kpi]');
    if (!b) return;
    if (state.kpiAbierto === b.dataset.erKpi) cerrarDetalleKpi();
    else abrirDetalleKpi(b.dataset.erKpi);
  });
  document.getElementById('erTabla')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-er-toggle]');
    if (!b) return;
    const key = b.dataset.erToggle;
    if (state.expandirTodo) {
      // Desde «ver cuentas», cerrar un rubro deja abiertos los demás.
      state.expandirTodo = false;
      state.abiertos = new Set(listaEr().map((r) => r.key));
    }
    if (state.abiertos.has(key)) state.abiertos.delete(key); else state.abiertos.add(key);
    renderTablaEr();
  });
  document.getElementById('erExpandir')?.addEventListener('click', () => {
    state.expandirTodo = !state.expandirTodo;
    if (!state.expandirTodo) state.abiertos.clear();
    renderTablaEr();
  });
  document.getElementById('erCeros')?.addEventListener('change', (e) => {
    state.ceros = e.target.checked;
    renderTablaEr();
    if (state.kpiAbierto) pintarDetalleKpi();
  });

  window.ContabilidadFormato = {
    load,
    mostrar,
    getEstado: () => state.er,
    cerrarDetalle: cerrarDetalleKpi,
  };
}());
