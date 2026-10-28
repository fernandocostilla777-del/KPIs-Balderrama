/**
 * Ventas › Vendedores Cholula.
 * Arriba, el resultado de la sucursal (ventas contra el periodo anterior y tasas del embudo);
 * después, el ranking de vendedores con cada tasa marcada contra el promedio de Cholula;
 * al abrir un vendedor, su resumen contra la sucursal y sus registros por pestaña.
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
  const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  /** Diferencia (en puntos) contra la sucursal a partir de la cual se marca una tasa. */
  const UMBRAL_PUNTOS = 5;
  /** Con menos leads que esto la tasa de un vendedor se muestra, pero no se marca. */
  const MIN_LEADS_MARCA = 10;
  const MAX_FILAS_DETALLE = 50;

  let cacheKey = null;
  let lastPayload = null;
  let abierto = null;
  let pestanaDetalle = 'clientes';
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
      tarjeta({ titulo: 'Fresh up', valor: num(t.visitas), sub: `${num(t.pruebas)} pruebas · ${num(t.seguimientos)} seguimientos`, tono: 'blue' }),
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
    { id: 'clientes', titulo: 'Clientes', cartera: true },
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
  let calMes = null;
  let calManual = false;
  let calDia = null;
  let calVendedor = '';
  let calPayload = null;
  let calInflight = null;

  function soltarCartera() {
    const slot = document.getElementById('cholCarteraSlot');
    const sec = document.getElementById('cholCartera');
    if (slot && sec && sec.parentElement !== slot) slot.appendChild(sec);
    sec?.classList.remove('cc--embebida');
  }

  function pintarModo() {
    const ranking = document.getElementById('cholVendRanking');
    const nav = document.getElementById('cholVendModos');
    const sec = document.getElementById('cholCartera');
    const cal = document.getElementById('cholVendCalendario');
    const viendoVendedor = !!abierto;
    if (ranking) ranking.hidden = viendoVendedor || modo !== 'ranking';
    if (nav) nav.hidden = viendoVendedor;
    if (sec && !sec.classList.contains('cc--embebida')) sec.hidden = viendoVendedor || modo !== 'clientes';
    if (cal) cal.hidden = viendoVendedor || modo !== 'calendario';
    nav?.querySelectorAll('[data-cv-modo]').forEach((btn) => {
      const on = !viendoVendedor && btn.dataset.cvModo === modo;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!viendoVendedor && modo === 'calendario') asegurarCalendario();
  }

  function mesDelPeriodo() {
    const ff = dates().fechaFin || '';
    if (/^\d{4}-\d{2}/.test(ff)) return ff.slice(0, 7);
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
  }

  function hoyIso() {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  }

  function etiquetaDia(iso) {
    const [, m, d] = String(iso || '').split('-').map(Number);
    if (!m || !d) return iso || '';
    return `${d} ${MESES[m - 1]}`;
  }

  function asegurarCalendario() {
    if (!calManual) calMes = mesDelPeriodo();
    if (calPayload?.mes === calMes) {
      pintarCalendario(calPayload, false);
      return;
    }
    cargarCalendario();
  }

  function cargarCalendario() {
    const mes = calMes || mesDelPeriodo();
    calMes = mes;
    pintarCalendario(calPayload?.mes === mes ? calPayload : null, true);
    if (calInflight?.key === mes) return calInflight.promise;
    const promise = api(`/ventas/monitoreo-cholula/calendario?mes=${mes}`).then((data) => {
      if (calMes !== mes) return data;
      calPayload = data;
      pintarCalendario(data, false);
      return data;
    }).catch((err) => {
      const host = document.getElementById('cholVendCalendario');
      if (host && calMes === mes) {
        host.innerHTML = `<p class="cv-leyenda">${esc(err.message || 'No se pudo cargar el calendario.')}</p>`;
      }
    }).finally(() => {
      if (calInflight?.key === mes) calInflight = null;
    });
    calInflight = { key: mes, promise };
    return promise;
  }

  function pintarCalendario(data, cargando) {
    const host = document.getElementById('cholVendCalendario');
    if (!host) return;
    const mes = calMes || mesDelPeriodo();
    const [anio, mesNum] = mes.split('-').map(Number);
    const eventos = data?.mes === mes ? (data.eventos || []) : [];
    const vendedores = [...new Set(eventos.map((e) => e.vendedor))].sort((a, b) => a.localeCompare(b, 'es'));
    if (calVendedor && !vendedores.includes(calVendedor)) calVendedor = '';
    const visibles = eventos.filter((e) => !calVendedor || e.vendedor === calVendedor);
    const delDia = calDia ? visibles.filter((e) => e.fecha === calDia) : visibles;
    const pendientes = visibles.filter((e) => !e.cumplida).length;
    const porDia = new Map();
    visibles.forEach((ev) => porDia.set(ev.fecha, (porDia.get(ev.fecha) || 0) + 1));
    const hoy = hoyIso();
    const primero = new Date(anio, mesNum - 1, 1);
    const huecos = (primero.getDay() + 6) % 7;
    const ultimo = new Date(anio, mesNum, 0).getDate();
    const celdas = [];
    for (let i = 0; i < huecos; i += 1) celdas.push('<span class="cv-cal-vacio"></span>');
    for (let dia = 1; dia <= ultimo; dia += 1) {
      const iso = `${mes}-${String(dia).padStart(2, '0')}`;
      const n = porDia.get(iso) || 0;
      const clases = ['cv-cal-dia'];
      if (n) clases.push('cv-cal-dia--con');
      if (iso === calDia) clases.push('cv-cal-dia--on');
      if (iso === hoy) clases.push('cv-cal-dia--hoy');
      celdas.push(
        `<button type="button" class="${clases.join(' ')}" data-cv-dia="${iso}" aria-pressed="${iso === calDia ? 'true' : 'false'}">`
        + `<span>${dia}</span>${n ? `<em>${n}</em>` : ''}</button>`,
      );
    }
    let sub = 'Cargando comentarios…';
    if (!cargando) {
      sub = visibles.length
        ? `${num(visibles.length)} comentarios · ${num(pendientes)} pendientes`
        : 'En este mes el equipo no tiene comentarios con fecha de cumplimiento.';
    }
    const opciones = ['<option value="">Todo el equipo</option>']
      .concat(vendedores.map((v) => `<option value="${esc(v)}"${v === calVendedor ? ' selected' : ''}>${esc(v)}</option>`))
      .join('');
    const lista = !delDia.length
      ? `<p class="cv-leyenda">${calDia ? 'Ese día no tiene comentarios.' : (cargando ? 'Cargando comentarios…' : 'Nada que mostrar en este mes.')}</p>`
      : `<ul class="cv-cal-lista">${delDia.map((ev) => {
        const tipo = ev.tipo && ev.tipo !== ev.comentario ? esc(ev.tipo) : '';
        return `<li class="cv-cal-item">
          <div class="cv-cal-item-top">
            <strong>${esc(ev.cliente)}</strong>
            <span class="cv-cal-estado${ev.cumplida ? ' cv-cal-estado--ok' : ''}">${ev.cumplida ? 'Cumplida' : 'Pendiente'}</span>
          </div>
          <p>${esc(ev.comentario)}</p>
          <p class="cv-cal-meta">${esc(ev.vendedor)}${tipo ? ` · ${tipo}` : ''}${calDia ? '' : ` · ${esc(etiquetaDia(ev.fecha))}`}</p>
        </li>`;
      }).join('')}</ul>`;
    host.innerHTML = `
      <div class="cv-cal-head">
        <div>
          <h3 class="cv-subtitulo">${esc(MESES_LARGOS[mesNum - 1] || '')} ${anio}</h3>
          <p class="cv-leyenda">${esc(sub)}</p>
        </div>
        <div class="cv-cal-nav">
          <button type="button" class="cc-btn" data-cv-cal="prev" aria-label="Mes anterior">Anterior</button>
          <button type="button" class="cc-btn" data-cv-cal="next" aria-label="Mes siguiente">Siguiente</button>
        </div>
      </div>
      <p class="cv-leyenda">Fecha de cumplimiento de la actividad y el comentario que se le dejó al cliente.</p>
      <label class="cv-cal-filtro">Vendedor
        <select data-cv-cal="vendedor">${opciones}</select>
      </label>
      <div class="cv-cal-semana" aria-hidden="true"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div>
      <div class="cv-cal-grid">${celdas.join('')}</div>
      <h4 class="cv-cal-lista-titulo">${calDia ? esc(etiquetaDia(calDia)) : 'Todo el mes'}</h4>
      ${lista}`;
  }

  function embeberCartera() {
    const host = document.getElementById('cholVendCarteraHost');
    const sec = document.getElementById('cholCartera');
    if (!host || !sec) return;
    host.appendChild(sec);
    sec.hidden = false;
    sec.classList.add('cc--embebida');
    const fila = (lastPayload?.vendedores || []).find((v) => v.key === abierto);
    cartera().then((c) => c?.verVendedor(abierto, fila?.vendedor || ''));
  }
  function pintarDetalle(data) {
    soltarCartera();
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
    const nClientes = window.CarteraCholula?.contar?.(abierto);
    const conteos = Object.fromEntries(PESTANAS.map((p) => (
      p.cartera ? [p.id, nClientes] : [p.id, (data[p.id] || []).length]
    )));
    const actual = PESTANAS.find((p) => p.id === pestanaDetalle);
    if (!actual || (!actual.cartera && !conteos[pestanaDetalle])) {
      pestanaDetalle = PESTANAS.find((p) => p.cartera || conteos[p.id])?.id || 'ventas';
    }
    const def = PESTANAS.find((p) => p.id === pestanaDetalle);
    const cuenta = (p) => (p.cartera && conteos[p.id] == null ? '' : ` <span class="cv-cuenta">${num(conteos[p.id] || 0)}</span>`);
    const cuerpo = def.cartera ? '<div id="cholVendCarteraHost"></div>' : tablaDetalle(def, data[def.id] || []);
    caja.hidden = false;
    caja.innerHTML = `
      <div class="cv-detalle__head">
        <div>
          <span class="cv-detalle__kicker">Detalle del vendedor</span>
          <h3 class="cv-detalle__nombre">${esc(data.vendedor)}</h3>
        </div>
        <button type="button" class="cc-btn" data-cv-cerrar>Volver al ranking</button>
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
        ${PESTANAS.map((p) => `<button type="button" class="eeff-tab${p.id === pestanaDetalle ? ' active' : ''}" data-cv-pestana="${p.id}"${!p.cartera && !conteos[p.id] ? ' disabled' : ''}>${esc(p.titulo)}${cuenta(p)}</button>`).join('')}
      </nav>
      ${cuerpo}`;
    pintarModo();
    if (def.cartera) embeberCartera();
  }

  async function abrirDetalle(key) {
    const { fechaInicio, fechaFin } = dates();
    if (!fechaInicio || !fechaFin || !key) return;
    if (abierto === key) {
      abierto = null;
      pintarTabla(lastPayload);
      pintarDetalle(null);
      verCarteraDe(null);
      return;
    }
    abierto = key;
    pestanaDetalle = 'clientes';
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
        tag.src = '/js/cartera-cholula.js?v=4';
        tag.onload = () => resolve(window.CarteraCholula || null);
        tag.onerror = () => resolve(null);
        document.body.appendChild(tag);
      });
    }
    return carteraLista;
  }

  function verCarteraDe(key) {
    const fila = (lastPayload?.vendedores || []).find((v) => v.key === key);
    cartera().then((c) => c?.verVendedor(key, fila?.vendedor || ''));
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
      cartera().then((c) => c?.load(fi, ff));
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
      cartera().then((c) => {
        c?.verVendedor(null);
        return c?.load(fi, ff, { force: !!opts.force });
      });
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
    if (e.target.closest('[data-cv-cerrar]')) {
      abierto = null;
      pintarTabla(lastPayload);
      pintarDetalle(null);
      verCarteraDe(null);
      return;
    }
    const calBtn = e.target.closest('[data-cv-cal]');
    if (calBtn && calBtn.dataset.cvCal !== 'vendedor') {
      const accion = calBtn.dataset.cvCal;
      calManual = true;
      const [y, m] = (calMes || mesDelPeriodo()).split('-').map(Number);
      const d = new Date(y, m - 1 + (accion === 'next' ? 1 : -1), 1);
      calMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      calDia = null;
      cargarCalendario();
      return;
    }
    const diaBtn = e.target.closest('[data-cv-dia]');
    if (diaBtn) {
      const dia = diaBtn.dataset.cvDia;
      calDia = calDia === dia ? null : dia;
      if (calPayload) pintarCalendario(calPayload, false);
      return;
    }
    const modoBtn = e.target.closest('[data-cv-modo]');
    if (modoBtn) {
      abierto = null;
      modo = modoBtn.dataset.cvModo;
      pintarTabla(lastPayload);
      pintarDetalle(null);
      verCarteraDe(null);
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
  panel?.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-cv-cal="vendedor"]');
    if (!sel) return;
    calVendedor = sel.value;
    if (calPayload) pintarCalendario(calPayload, false);
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
