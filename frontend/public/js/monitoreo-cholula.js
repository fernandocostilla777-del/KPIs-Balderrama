/**
 * Ventas › Vendedores Cholula.
 * Arriba, el resultado del equipo (ventas contra el periodo anterior y tasas del embudo).
 * Dos vistas: Ranking (cada tasa contra el promedio del equipo; al abrir un vendedor, su resumen
 * y sus registros) y Seguimiento del equipo (cartera-cholula.js: trabajo de cada asesor y agenda).
 */
(() => {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const num = (n) => Number(n || 0).toLocaleString('es-MX');
  const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)} %`);
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  /** Diferencia (en puntos) contra la sucursal a partir de la cual se marca una tasa. */
  const UMBRAL_PUNTOS = 5;
  /** Con menos leads que esto la tasa de un vendedor se muestra, pero no se marca. */
  const MIN_LEADS_MARCA = 10;
  const MAX_FILAS_DETALLE = 50;

  let cacheKey = null;
  let lastPayload = null;
  let abierto = null;
  let pestanaDetalle = 'ventas';
  let detalleActual = null;
  let inflight = null;

  function dates() {
    return {
      fechaInicio: document.getElementById('fechaInicio')?.value || '',
      fechaFin: document.getElementById('fechaFin')?.value || '',
    };
  }

  /** «2026-09-01 a 2026-09-30» → «sep 2026»; otro rango → «1 sep – 15 sep 2026». */
  function etiquetaPeriodo(fi, ff) {
    if (!fi || !ff) return '';
    const [y1, m1, d1] = fi.split('-').map(Number);
    const [y2, m2, d2] = ff.split('-').map(Number);
    const finMes = new Date(y2, m2, 0).getDate();
    if (d1 === 1 && d2 === finMes) {
      return y1 === y2 && m1 === m2 ? `${MESES[m1 - 1]} ${y1}` : `${MESES[m1 - 1]} ${y1} – ${MESES[m2 - 1]} ${y2}`;
    }
    return `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]} ${y2}`;
  }

  function variacionChip(v) {
    if (v == null || !Number.isFinite(Number(v))) return '';
    const n = Number(v);
    // Sin cambio no se marca: la columna se lee más limpia.
    if (Math.round(n) === 0) return '';
    const tono = n > 0 ? 'sube' : 'baja';
    const signo = n > 0 ? '+' : '';
    return `<span class="cv-var cv-var--${tono}">${signo}${n.toFixed(0)} %</span>`;
  }

  /** Marca una tasa contra la de la sucursal (azul arriba, ámbar abajo; nunca rojo). */
  function marcaTasa(valor, base, leads) {
    if (valor == null || base == null || Number(leads) < MIN_LEADS_MARCA) return '';
    const dif = Number(valor) - Number(base);
    if (dif >= UMBRAL_PUNTOS) return 'cv-tasa--arriba';
    if (dif <= -UMBRAL_PUNTOS) return 'cv-tasa--abajo';
    return '';
  }

  function setTexto(id, texto) {
    const el = document.getElementById(id);
    if (el) el.textContent = texto;
  }

  function pintarEncabezado(data) {
    const t = data.totales || {};
    const ant = data.periodoAnterior;
    const periodo = etiquetaPeriodo(data.filtros?.fechaInicio, data.filtros?.fechaFin);
    const comparado = ant ? ` · comparado con ${etiquetaPeriodo(ant.fechaInicio, ant.fechaFin)}` : '';
    setTexto('cholVendSubtitle', `${periodo} · ${num(t.vendedores)} vendedores con actividad${comparado}`);
    setTexto('cholVendNota', data.nota || '');
    const avisos = [];
    if (data.sinAsignar?.leads) {
      avisos.push(`${num(data.sinAsignar.leads)} ${Number(data.sinAsignar.leads) === 1 ? 'lead' : 'leads'} de Cholula sin ejecutivo asignado en el periodo.`);
    }
    const fuera = data.fueraEquipo;
    if (fuera && (fuera.ventas || fuera.leads)) {
      const partes = [];
      if (fuera.ventas) partes.push(`${num(fuera.ventas)} ${Number(fuera.ventas) === 1 ? 'venta' : 'ventas'}`);
      if (fuera.leads) partes.push(`${num(fuera.leads)} leads`);
      avisos.push(`${partes.join(' y ')} de Cholula son de personas fuera del equipo y no cuentan aquí (sí en la pestaña Ventas).`);
    }
    if (data.ventasError) avisos.push(`Las facturas no se pudieron leer: ${data.ventasError}`);
    const aviso = document.getElementById('cholVendAviso');
    if (aviso) {
      aviso.hidden = !avisos.length;
      aviso.textContent = avisos.join(' ');
    }
  }

  function tarjeta({ titulo, valor, sub, tono = 'blue', extra = '' }) {
    return `
      <div class="cv-kpi cv-kpi--${tono}">
        <span class="cv-kpi__titulo">${esc(titulo)}</span>
        <strong class="cv-kpi__valor">${valor}${extra}</strong>
        <span class="cv-kpi__sub">${sub}</span>
      </div>`;
  }

  function pintarTotales(data) {
    const el = document.getElementById('cholVendKpis');
    if (!el) return;
    const t = data.totales || {};
    const ant = data.periodoAnterior;
    const subVentas = Number(t.ventasAnterior) > 0
      ? `${num(t.ventasAnterior)} en ${esc(etiquetaPeriodo(ant?.fechaInicio, ant?.fechaFin))}${t.ventasFlotilla ? ` · ${num(t.ventasFlotilla)} flotilla` : ''}`
      : (t.ventasFlotilla ? `${num(t.ventasRetail)} menudeo · ${num(t.ventasFlotilla)} flotilla` : 'Facturas del equipo de Cholula');
    el.innerHTML = [
      tarjeta({ titulo: 'Ventas', valor: num(t.ventas), extra: variacionChip(t.variacionVentasPct), sub: subVentas }),
      tarjeta({ titulo: 'Lead → compra', valor: pct(t.pctCierreLead), sub: `${num(t.comprasLead)} compras de ${num(t.leads)} leads`, tono: 'green' }),
      tarjeta({ titulo: 'Contacto', valor: pct(t.pctContacto), sub: `${num(t.contactados)} de ${num(t.leads)} leads · cita ${pct(t.pctCita)}`, tono: 'violet' }),
      tarjeta({ titulo: 'Solicitudes aprobadas', valor: pct(t.pctAprobacion), sub: `${num(t.solicitudesAprobadas)} de ${num(t.solicitudes)} solicitudes`, tono: 'slate' }),
      tarjeta({ titulo: 'Fresh up', valor: num(t.visitas), sub: 'Visitas de piso de autos nuevos', tono: 'blue' }),
    ].join('');
  }

  function celdaTasa(valor, base, leads, detalle, clase = 'num') {
    const marca = marcaTasa(valor, base, leads);
    return `<td class="${clase}"><span class="cv-tasa ${marca}" title="${esc(detalle)} · equipo ${pct(base)}">${pct(valor)}</span></td>`;
  }

  function filaHtml(fila, t, maxVentas) {
    const abierta = abierto === fila.key ? ' is-open' : '';
    const ancho = maxVentas ? Math.round((Number(fila.ventas) / maxVentas) * 100) : 0;
    const flotilla = fila.ventasFlotilla ? `<span class="cv-nombre__sub">${num(fila.ventasRetail)} menudeo · ${num(fila.ventasFlotilla)} flotilla</span>` : '';
    return `
      <tr class="cv-fila${abierta}" data-vendedor="${esc(fila.key)}" tabindex="0" aria-expanded="${abierta ? 'true' : 'false'}">
        <td class="cv-nombre">${esc(fila.vendedor)}${flotilla}</td>
        <td class="cv-col-ventas">
          <span class="cv-ventas"><span class="cv-barra"><i style="width:${ancho}%"></i></span><strong>${num(fila.ventas)}</strong>${variacionChip(fila.variacionVentasPct)}</span>
        </td>
        <td class="num">${num(fila.leads)}</td>
        ${celdaTasa(fila.pctContacto, t.pctContacto, fila.leads, `${num(fila.contactados)} de ${num(fila.leads)} leads`, 'num cv-col-op')}
        ${celdaTasa(fila.pctCita, t.pctCita, fila.leads, `${num(fila.citas)} de ${num(fila.contactados)} contactados`, 'num cv-col-op')}
        ${celdaTasa(fila.pctCierreLead, t.pctCierreLead, fila.leads, `${num(fila.comprasLead)} compras de ${num(fila.leads)} leads`)}
        <td class="num cv-col-op">${fila.solicitudes ? `${num(fila.solicitudesAprobadas)} <span class="cv-de">de ${num(fila.solicitudes)}</span>` : '—'}</td>
        <td class="num cv-col-op">${num(fila.pruebas)}</td>
        <td class="num cv-col-op">${num(fila.visitas)}</td>
        <td class="num cv-col-op">${num(fila.seguimientos)}</td>
      </tr>`;
  }

  function pintarTabla(data) {
    const body = document.getElementById('cholVendBody');
    const foot = document.getElementById('cholVendFoot');
    if (!body) return;
    const t = data?.totales || {};
    const filas = (data?.vendedores || []).filter((f) => f.vendedor !== 'Sin asignar');
    if (!filas.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty-row">Sin actividad del equipo en el periodo.</td></tr>';
      if (foot) foot.innerHTML = '';
      return;
    }
    const maxVentas = Math.max(...filas.map((f) => Number(f.ventas || 0)), 1);
    body.innerHTML = filas.map((f) => filaHtml(f, t, maxVentas)).join('');
    if (foot) {
      foot.innerHTML = `
        <tr class="cv-total">
          <td>Equipo</td>
          <td class="cv-col-ventas"><span class="cv-ventas"><strong>${num(t.ventas)}</strong>${variacionChip(t.variacionVentasPct)}<span class="cv-de cv-prom">prom. ${t.promedioVentas ?? '—'} por vendedor</span></span></td>
          <td class="num">${num(t.leads)}</td>
          <td class="num cv-col-op">${pct(t.pctContacto)}</td>
          <td class="num cv-col-op">${pct(t.pctCita)}</td>
          <td class="num">${pct(t.pctCierreLead)}</td>
          <td class="num cv-col-op">${t.solicitudes ? `${num(t.solicitudesAprobadas)} <span class="cv-de">de ${num(t.solicitudes)}</span>` : '—'}</td>
          <td class="num cv-col-op">${num(t.pruebas)}</td>
          <td class="num cv-col-op">${num(t.visitas)}</td>
          <td class="num cv-col-op">${num(t.seguimientos)}</td>
        </tr>`;
    }
  }

  const si = (v) => (String(v || '').toUpperCase() === 'SI' || Number(v) === 1);
  const PESTANAS = [
    { id: 'ventas', titulo: 'Ventas', columnas: [
      ['Fecha', (r) => r.fecha], ['Factura', (r) => r.factura], ['Cliente', (r) => r.cliente], ['Modelo', (r) => r.modelo], ['Tipo', (r) => r.tipo],
    ] },
    { id: 'leads', titulo: 'Leads', columnas: [
      ['Entrada', (r) => r.fecha], ['Cliente', (r) => r.cliente], ['Auto', (r) => r.auto], ['Campaña', (r) => r.campana || '—'],
      ['Avance', (r) => ({ html: [['Contacto', si(r.contacto)], ['Cita', si(r.cita)], ['Compra', Number(r.compra) === 1]]
        .map(([k, ok]) => `<span class="cv-paso${ok ? ' is-ok' : ''}">${k}</span>`).join('') })],
    ] },
    { id: 'pruebas', titulo: 'Pruebas', columnas: [
      ['Fecha', (r) => r.fecha], ['Cliente', (r) => r.cliente], ['Auto', (r) => r.auto], ['Tipo', (r) => r.tipo],
    ] },
    { id: 'solicitudes', titulo: 'Solicitudes', columnas: [
      ['Fecha', (r) => r.fecha], ['Cliente', (r) => r.cliente], ['Financiera', (r) => r.financiera], ['Unidad', (r) => r.unidad],
      ['Estatus', (r) => ({ html: `<span class="cv-estatus${/APROBAD/i.test(r.estatus || '') ? ' is-ok' : ''}">${esc(r.estatus || '—')}</span>` })],
    ] },
    { id: 'visitas', titulo: 'Fresh up', columnas: [
      ['Fecha', (r) => r.fecha], ['Cliente', (r) => r.cliente], ['Auto', (r) => r.auto], ['Medio', (r) => r.medio],
      ['Tipo', (r) => r.tipo],
    ] },
    { id: 'seguimientos', titulo: 'Seguimientos', columnas: [
      ['Fecha', (r) => r.fecha], ['Cliente', (r) => r.cliente], ['Actividad', (r) => r.tipo], ['Resultado', (r) => r.resultado],
    ] },
  ];

  function tablaDetalle(def, filas) {
    if (!filas.length) return `<p class="cv-vacio">Sin ${esc(def.titulo.toLowerCase())} en el periodo.</p>`;
    const visibles = filas.slice(0, MAX_FILAS_DETALLE);
    const cuerpo = visibles.map((r) => `<tr>${def.columnas.map(([, f]) => {
      const v = f(r);
      return `<td>${v && typeof v === 'object' ? v.html : esc(v)}</td>`;
    }).join('')}</tr>`).join('');
    const nota = filas.length > MAX_FILAS_DETALLE ? `<p class="cv-vacio">Se muestran los ${MAX_FILAS_DETALLE} más recientes de ${num(filas.length)}.</p>` : '';
    return `
      <div class="table-scroll table-scroll--auto">
        <table class="data-table cv-tabla-detalle">
          <thead><tr>${def.columnas.map(([t]) => `<th>${esc(t)}</th>`).join('')}</tr></thead>
          <tbody>${cuerpo}</tbody>
        </table>
      </div>${nota}`;
  }

  function comparativo(titulo, valor, base, sub) {
    const marca = valor != null && base != null
      ? (Number(valor) - Number(base) >= UMBRAL_PUNTOS ? 'cv-tasa--arriba' : (Number(valor) - Number(base) <= -UMBRAL_PUNTOS ? 'cv-tasa--abajo' : ''))
      : '';
    return `
      <div class="cv-mini">
        <span class="cv-mini__titulo">${esc(titulo)}</span>
        <strong class="cv-tasa ${marca}">${pct(valor)}</strong>
        <span class="cv-mini__sub">${sub} · equipo ${pct(base)}</span>
      </div>`;
  }

  let modo = 'ranking';

  function pintarModo() {
    const ranking = document.getElementById('cholVendRanking');
    const seg = document.getElementById('cholSeguimiento');
    const detalle = document.getElementById('cholVendDetalle');
    const nav = document.getElementById('cholVendModos');
    const viendoVendedor = !!abierto && modo === 'ranking';
    if (ranking) ranking.hidden = viendoVendedor || modo !== 'ranking';
    if (seg) seg.hidden = modo !== 'seguimiento';
    if (detalle && modo !== 'ranking') detalle.hidden = true;
    nav?.querySelectorAll('[data-cv-modo]').forEach((btn) => {
      const on = btn.dataset.cvModo === modo;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function irASeguimiento(key, nombre) {
    modo = 'seguimiento';
    abierto = null;
    pintarTabla(lastPayload);
    pintarDetalle(null);
    const { fechaInicio, fechaFin } = dates();
    cartera().then((c) => {
      c?.verVendedor(key || null, nombre || '');
      return c?.load(fechaInicio, fechaFin);
    });
    document.getElementById('cholVendModos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pintarDetalle(data) {
    const caja = document.getElementById('cholVendDetalle');
    if (!caja) return;
    detalleActual = data;
    if (!data) {
      caja.hidden = true;
      caja.innerHTML = '';
      pintarModo();
      return;
    }
    const r = data.resumen || {};
    const t = lastPayload?.totales || {};
    const conteos = Object.fromEntries(PESTANAS.map((p) => [p.id, (data[p.id] || []).length]));
    if (!conteos[pestanaDetalle]) pestanaDetalle = PESTANAS.find((p) => conteos[p.id])?.id || 'ventas';
    const def = PESTANAS.find((p) => p.id === pestanaDetalle);
    const cuenta = (p) => ` <span class="cv-cuenta">${num(conteos[p.id] || 0)}</span>`;
    const cuerpo = tablaDetalle(def, data[def.id] || []);
    caja.hidden = false;
    caja.innerHTML = `
      <div class="cv-detalle__head">
        <div>
          <span class="cv-detalle__kicker">Detalle del vendedor</span>
          <h3 class="cv-detalle__nombre">${esc(data.vendedor)}</h3>
        </div>
        <div class="cv-detalle__acciones">
          <button type="button" class="cc-btn cc-btn--primario" data-cv-seguimiento="${esc(abierto || '')}" data-cv-nombre="${esc(data.vendedor)}">Ver su seguimiento</button>
          <button type="button" class="cc-btn" data-cv-cerrar>Volver al ranking</button>
        </div>
      </div>
      <div class="cv-minis">
        <div class="cv-mini">
          <span class="cv-mini__titulo">Ventas</span>
          <strong>${num(r.ventas)}${variacionChip(r.variacionVentasPct)}</strong>
          <span class="cv-mini__sub">${num(r.ventasAnterior)} el periodo anterior · prom. del equipo ${t.promedioVentas ?? '—'}</span>
        </div>
        ${comparativo('Lead → compra', r.pctCierreLead, t.pctCierreLead, `${num(r.comprasLead)} de ${num(r.leads)} leads`)}
        ${comparativo('Contacto', r.pctContacto, t.pctContacto, `${num(r.contactados)} de ${num(r.leads)} leads`)}
        ${comparativo('Solicitudes aprobadas', r.pctAprobacion, t.pctAprobacion, `${num(r.solicitudesAprobadas)} de ${num(r.solicitudes)}`)}
      </div>
      <nav class="eeff-tabs cv-pestanas" aria-label="Registros del vendedor">
        ${PESTANAS.map((p) => `<button type="button" class="eeff-tab${p.id === pestanaDetalle ? ' active' : ''}" data-cv-pestana="${p.id}"${!conteos[p.id] ? ' disabled' : ''}>${esc(p.titulo)}${cuenta(p)}</button>`).join('')}
      </nav>
      ${cuerpo}`;
    pintarModo();
  }

  async function abrirDetalle(key) {
    const { fechaInicio, fechaFin } = dates();
    if (!fechaInicio || !fechaFin || !key) return;
    if (abierto === key) {
      abierto = null;
      pintarTabla(lastPayload);
      pintarDetalle(null);
      return;
    }
    abierto = key;
    pestanaDetalle = 'ventas';
    pintarTabla(lastPayload);
    pintarModo();
    const caja = document.getElementById('cholVendDetalle');
    if (caja) {
      caja.hidden = false;
      caja.innerHTML = '<p class="cv-vacio">Cargando detalle…</p>';
    }
    const q = new URLSearchParams({ fechaInicio, fechaFin, vendedor: key });
    const data = await api(`/ventas/monitoreo-cholula?${q}`);
    if (abierto !== key) return;
    pintarDetalle(data);
  }

  let carteraLista = null;
  function cartera() {
    if (!carteraLista) {
      carteraLista = new Promise((resolve) => {
        if (window.CarteraCholula) return resolve(window.CarteraCholula);
        const tag = document.createElement('script');
        tag.src = '/js/cartera-cholula.js?v=5';
        tag.onload = () => resolve(window.CarteraCholula || null);
        tag.onerror = () => resolve(null);
        document.body.appendChild(tag);
      });
    }
    return carteraLista;
  }

  function pintarTodo(data) {
    pintarEncabezado(data);
    pintarTotales(data);
    pintarTabla(data);
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    const fi = fechaInicio || dates().fechaInicio;
    const ff = fechaFin || dates().fechaFin;
    if (!fi || !ff) return null;
    const key = `${fi}|${ff}`;
    if (!opts.force && cacheKey === key && lastPayload) {
      pintarTodo(lastPayload);
      pintarModo();
      if (modo === 'seguimiento') cartera().then((c) => c?.load(fi, ff));
      return lastPayload;
    }
    if (inflight && inflight.key === key) return inflight.promise;
    abierto = null;
    pintarDetalle(null);
    setTexto('cholVendSubtitle', 'Consultando vendedores de Cholula…');
    const q = new URLSearchParams({ fechaInicio: fi, fechaFin: ff });
    const promise = api(`/ventas/monitoreo-cholula?${q}`).then((data) => {
      cacheKey = key;
      lastPayload = data;
      pintarTodo(data);
      pintarModo();
      if (modo === 'seguimiento') cartera().then((c) => c?.load(fi, ff, { force: !!opts.force }));
      return data;
    }).catch((err) => {
      setTexto('cholVendSubtitle', err.message || 'No se pudo cargar el monitoreo.');
      throw err;
    }).finally(() => {
      if (inflight && inflight.key === key) inflight = null;
    });
    inflight = { key, promise };
    return promise;
  }

  const panel = document.getElementById('secVendedoresCholula');
  panel?.addEventListener('click', (e) => {
    if (e.target.closest('#cholSeguimiento')) return;
    if (e.target.closest('[data-cv-cerrar]')) {
      abierto = null;
      pintarTabla(lastPayload);
      pintarDetalle(null);
      return;
    }
    const seg = e.target.closest('[data-cv-seguimiento]');
    if (seg) {
      irASeguimiento(seg.dataset.cvSeguimiento, seg.dataset.cvNombre);
      return;
    }
    const modoBtn = e.target.closest('[data-cv-modo]');
    if (modoBtn) {
      if (modoBtn.dataset.cvModo === 'seguimiento') {
        irASeguimiento(null);
        return;
      }
      modo = 'ranking';
      abierto = null;
      pintarTabla(lastPayload);
      pintarDetalle(null);
      return;
    }
    const pestana = e.target.closest('[data-cv-pestana]');
    if (pestana) {
      pestanaDetalle = pestana.dataset.cvPestana;
      pintarDetalle(detalleActual);
      return;
    }
    const fila = e.target.closest('#cholVendBody [data-vendedor]');
    if (!fila) return;
    abrirDetalle(fila.dataset.vendedor).catch((err) => setTexto('cholVendSubtitle', err.message || 'No se pudo abrir el detalle.'));
  });
  document.getElementById('cholVendBody')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const fila = e.target.closest('[data-vendedor]');
    if (!fila) return;
    e.preventDefault();
    abrirDetalle(fila.dataset.vendedor).catch((err) => setTexto('cholVendSubtitle', err.message || 'No se pudo abrir el detalle.'));
  });

  window.MonitoreoCholula = {
    hasCache(fi, ff) { return cacheKey === `${fi}|${ff}` && !!lastPayload; },
    load,
  };
})();
