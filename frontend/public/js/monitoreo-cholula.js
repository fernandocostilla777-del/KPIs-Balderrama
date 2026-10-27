(() => {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const num = (n) => Number(n || 0).toLocaleString('es-MX');

  let cacheKey = null;
  let lastPayload = null;
  let abierto = null;
  let inflight = null;

  function dates() {
    return {
      fechaInicio: document.getElementById('fechaInicio')?.value || '',
      fechaFin: document.getElementById('fechaFin')?.value || '',
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('cholVendSubtitle');
    if (el) el.textContent = msg;
  }

  function pintarTotales(totales) {
    const map = {
      cholKpiVentas: totales?.ventas,
      cholKpiLeads: totales?.leads,
      cholKpiPruebas: totales?.pruebas,
      cholKpiSolicitudes: totales?.solicitudes,
      cholKpiVisitas: totales?.visitas,
      cholKpiCompras: totales?.comprasLead,
    };
    for (const [id, value] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.textContent = num(value);
    }
  }

  function filaHtml(fila) {
    const abierta = abierto === fila.key ? ' is-open' : '';
    const flotilla = fila.ventasFlotilla
      ? `<span class="chol-vend-sub">${num(fila.ventasRetail)} menudeo · ${num(fila.ventasFlotilla)} flotilla</span>`
      : '';
    return `
      <tr class="chol-vend-row${abierta}" data-vendedor="${esc(fila.key)}" tabindex="0">
        <td>${esc(fila.vendedor)}${flotilla}</td>
        <td class="num">${num(fila.ventas)}</td>
        <td class="num">${num(fila.leads)}</td>
        <td class="num">${num(fila.contactados)}</td>
        <td class="num">${num(fila.citas)}</td>
        <td class="num">${num(fila.cotizaciones)}</td>
        <td class="num">${num(fila.pruebas)}</td>
        <td class="num">${num(fila.solicitudes)}</td>
        <td class="num">${num(fila.solicitudesAprobadas)}</td>
        <td class="num">${num(fila.visitas)}</td>
        <td class="num">${num(fila.seguimientos)}</td>
        <td class="num">${num(fila.comprasLead)}</td>
      </tr>`;
  }

  function pintarTabla(vendedores) {
    const body = document.getElementById('cholVendBody');
    if (!body) return;
    if (!vendedores?.length) {
      body.innerHTML = '<tr><td colspan="12" class="empty-row">Sin actividad de Cholula en el periodo.</td></tr>';
      return;
    }
    body.innerHTML = vendedores.map(filaHtml).join('');
  }

  function lista(titulo, filas, columnas) {
    const cuerpo = filas.length
      ? filas.map((fila) => `
          <tr>${columnas.map((col) => `<td>${esc(col.texto(fila))}</td>`).join('')}</tr>
        `).join('')
      : `<tr><td colspan="${columnas.length}" class="empty-row">Sin registros.</td></tr>`;
    const cabeza = columnas.map((col) => `<th>${esc(col.titulo)}</th>`).join('');
    return `
      <section class="chol-vend-bloque">
        <h3>${esc(titulo)} <span>${num(filas.length)}</span></h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>${cabeza}</tr></thead>
            <tbody>${cuerpo}</tbody>
          </table>
        </div>
      </section>`;
  }

  function pintarDetalle(data) {
    const caja = document.getElementById('cholVendDetalle');
    if (!caja) return;
    if (!data) {
      caja.hidden = true;
      caja.innerHTML = '';
      return;
    }
    const si = (v) => (String(v || '').toUpperCase() === 'SI' || Number(v) === 1 ? 'Sí' : 'No');
    caja.hidden = false;
    caja.innerHTML = `
      <h3 class="section-title" style="margin:0 0 10px;font-size:16px">${esc(data.vendedor)}</h3>
      <div class="chol-vend-grid">
        ${lista('Ventas', data.ventas || [], [
          { titulo: 'Fecha', texto: (r) => r.fecha },
          { titulo: 'Factura', texto: (r) => r.factura },
          { titulo: 'Cliente', texto: (r) => r.cliente },
          { titulo: 'Modelo', texto: (r) => r.modelo },
          { titulo: 'Tipo', texto: (r) => r.tipo },
        ])}
        ${lista('Leads', data.leads || [], [
          { titulo: 'Entrada', texto: (r) => r.fecha },
          { titulo: 'Cliente', texto: (r) => r.cliente },
          { titulo: 'Campaña', texto: (r) => r.campana },
          { titulo: 'Auto', texto: (r) => r.auto },
          { titulo: 'Contacto', texto: (r) => si(r.contacto) },
          { titulo: 'Cita', texto: (r) => si(r.cita) },
          { titulo: 'Compra', texto: (r) => (Number(r.compra) === 1 ? 'Sí' : 'No') },
        ])}
        ${lista('Pruebas de manejo', data.pruebas || [], [
          { titulo: 'Fecha', texto: (r) => r.fecha },
          { titulo: 'Cliente', texto: (r) => r.cliente },
          { titulo: 'Auto', texto: (r) => r.auto },
          { titulo: 'Tipo', texto: (r) => r.tipo },
        ])}
        ${lista('Solicitudes', data.solicitudes || [], [
          { titulo: 'Fecha', texto: (r) => r.fecha },
          { titulo: 'Cliente', texto: (r) => r.cliente },
          { titulo: 'Estatus', texto: (r) => r.estatus },
          { titulo: 'Financiera', texto: (r) => r.financiera },
          { titulo: 'Unidad', texto: (r) => r.unidad },
        ])}
        ${lista('Visitas en piso', data.visitas || [], [
          { titulo: 'Fecha', texto: (r) => r.fecha },
          { titulo: 'Cliente', texto: (r) => r.cliente },
          { titulo: 'Auto', texto: (r) => r.auto },
          { titulo: 'Medio', texto: (r) => r.medio },
        ])}
        ${lista('Seguimientos', data.seguimientos || [], [
          { titulo: 'Fecha', texto: (r) => r.fecha },
          { titulo: 'Cliente', texto: (r) => r.cliente },
          { titulo: 'Actividad', texto: (r) => r.tipo },
          { titulo: 'Resultado', texto: (r) => r.resultado },
        ])}
      </div>`;
    caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function abrirDetalle(key) {
    const { fechaInicio, fechaFin } = dates();
    if (!fechaInicio || !fechaFin || !key) return;
    if (abierto === key) {
      abierto = null;
      pintarTabla(lastPayload?.vendedores || []);
      pintarDetalle(null);
      return;
    }
    abierto = key;
    pintarTabla(lastPayload?.vendedores || []);
    const caja = document.getElementById('cholVendDetalle');
    if (caja) {
      caja.hidden = false;
      caja.innerHTML = '<p class="section-subtitle">Cargando detalle…</p>';
    }
    const q = new URLSearchParams({ fechaInicio, fechaFin, vendedor: key });
    const data = await api(`/ventas/monitoreo-cholula?${q}`);
    if (abierto !== key) return;
    pintarDetalle(data);
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    const fi = fechaInicio || dates().fechaInicio;
    const ff = fechaFin || dates().fechaFin;
    if (!fi || !ff) return null;
    const key = `${fi}|${ff}`;
    if (!opts.force && cacheKey === key && lastPayload) {
      pintarTotales(lastPayload.totales);
      pintarTabla(lastPayload.vendedores);
      return lastPayload;
    }
    if (inflight && inflight.key === key) return inflight.promise;
    abierto = null;
    pintarDetalle(null);
    setStatus('Cargando monitoreo de Cholula…');
    const q = new URLSearchParams({ fechaInicio: fi, fechaFin: ff });
    const promise = api(`/ventas/monitoreo-cholula?${q}`).then((data) => {
      cacheKey = key;
      lastPayload = data;
      pintarTotales(data.totales);
      pintarTabla(data.vendedores);
      const vendedores = data.totales?.vendedores ?? 0;
      const aviso = data.ventasError ? ` Las facturas no se pudieron leer: ${data.ventasError}` : '';
      setStatus(`${vendedores} vendedores con actividad en Cholula.${aviso} ${data.nota || ''}`);
      return data;
    }).catch((err) => {
      setStatus(err.message || 'No se pudo cargar el monitoreo.');
      throw err;
    }).finally(() => {
      if (inflight && inflight.key === key) inflight = null;
    });
    inflight = { key, promise };
    return promise;
  }

  document.getElementById('cholVendBody')?.addEventListener('click', (e) => {
    const fila = e.target.closest('[data-vendedor]');
    if (!fila) return;
    abrirDetalle(fila.dataset.vendedor).catch((err) => setStatus(err.message || 'No se pudo abrir el detalle.'));
  });
  document.getElementById('cholVendBody')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const fila = e.target.closest('[data-vendedor]');
    if (!fila) return;
    e.preventDefault();
    abrirDetalle(fila.dataset.vendedor).catch((err) => setStatus(err.message || 'No se pudo abrir el detalle.'));
  });

  window.MonitoreoCholula = {
    hasCache(fi, ff) { return cacheKey === `${fi}|${ff}` && !!lastPayload; },
    load,
  };
})();
