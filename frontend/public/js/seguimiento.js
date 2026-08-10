(function () {
  const { api, showLoading, setText, chartOptions, chartColors } = window.Dashboard;

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const dash = (v) => (v == null || v === '' ? '—' : esc(v));
  const money = (n) => new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n || 0);
  let currentIdContacto = null;
  let currentClientData = null;
  let currentCierresData = null;
  let currentVendedorData = null;
  let currentVista = 'cliente';
  let openVendComercialKpi = null;
  let openKpiKey = null;
  const charts = {};
  let vendedoresCache = [];

  function destroyChart(name) {
    if (charts[name]) {
      charts[name].destroy();
      delete charts[name];
    }
  }

  function createChart(name, canvasId, config) {
    destroyChart(name);
    if (typeof Chart === 'undefined') return null;
    const canvas = el(canvasId);
    if (!canvas) return null;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    charts[name] = new Chart(canvas, config);
    return charts[name];
  }

  function yearOf(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    const m = s.match(/^(\d{4})/) || s.match(/(\d{4})$/);
    if (m) return m[1];
    return null;
  }

  function countBy(list, keyFn) {
    const map = new Map();
    for (const item of list || []) {
      const key = keyFn(item) || '(sin dato)';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function sumByYear(list, dateFn, amountFn) {
    const map = new Map();
    for (const item of list || []) {
      const y = yearOf(dateFn(item));
      if (!y) continue;
      map.set(y, (map.get(y) || 0) + Number(amountFn(item) || 0));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value }));
  }

  function setStatus(text, type = 'ready') {
    const badge = el('statusBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'sidebar-status-line';
    if (type === 'loading') badge.classList.add('status-loading');
    else if (type === 'error') badge.classList.add('status-error');
    const dot = document.querySelector('[data-status-dot]');
    if (dot) {
      dot.classList.toggle('is-loading', type === 'loading');
      dot.classList.toggle('is-error', type === 'error');
    }
  }

  function getPeriod() {
    return {
      fechaInicio: el('fechaInicioOrdenes').value || '',
      fechaFin: el('fechaFinOrdenes').value || '',
    };
  }

  function periodQuery() {
    const { fechaInicio, fechaFin } = getPeriod();
    const p = new URLSearchParams();
    if (fechaInicio) p.set('fechaInicio', fechaInicio);
    if (fechaFin) p.set('fechaFin', fechaFin);
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  }

  async function loadCrmStatus() {
    try {
      const st = await api('/crm/status');
      if (!st.disponible && st.ok === false) {
        setText('crmDbInfo', 'Base CRM no cargada');
        return;
      }
      const parts = [`${Number(st.contactos || 0).toLocaleString('es-MX')} contactos`];
      if (st.leads?.total) parts.push(`${Number(st.leads.total).toLocaleString('es-MX')} leads`);
      if (st.solicitudes?.total) parts.push(`${Number(st.solicitudes.total).toLocaleString('es-MX')} solicitudes`);
      if (st.pruebasManejo?.total) parts.push(`${Number(st.pruebasManejo.total).toLocaleString('es-MX')} pruebas`);
      setText('crmDbInfo', `Base CRM: ${parts.join(' · ')}`);
    } catch {
      setText('crmDbInfo', '');
    }
  }

  async function buscar() {
    const q = el('searchInput').value.trim();
    if (!q) {
      setStatus('Escribe un ID CRM, nombre, VIN, teléfono o correo', 'error');
      return;
    }
    setStatus('Buscando...', 'loading');
    showLoading(true);
    try {
      const { resultados } = await api(`/crm/contactos?q=${encodeURIComponent(q)}&limit=50`);
      renderResults(resultados || []);
      setStatus(`${(resultados || []).length} resultado(s) para "${q}"`);
      if ((resultados || []).length === 1 && resultados[0].id_contacto) {
        openClient(resultados[0].id_contacto);
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  function renderResults(rows) {
    const wrap = el('searchResultsWrap');
    const body = el('searchResults');
    setText('searchCount', rows.length ? `${rows.length} resultado(s)` : 'Sin resultados');
    if (!rows.length) {
      wrap.classList.add('hidden');
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr>
        <td>${dash(r.id_contacto)}</td>
        <td>${dash(r.nombre)}</td>
        <td class="cell-num">${Number(r.leads || 0)}</td>
        <td class="cell-num">${Number(r.ciclos || 0)}</td>
        <td class="cell-num">${Number(r.solicitudes || 0)}</td>
        <td class="cell-num">${Number(r.pruebas_manejo || 0)}</td>
        <td class="cell-num">${Number(r.compras || 0)}</td>
        <td>${dash(r.telefono)}</td>
        <td>${dash(r.correo)}</td>
        <td>${dash(r.ultima_actividad)}</td>
        <td>${r.id_contacto ? `<button type="button" class="chip" data-open="${esc(r.id_contacto)}">Ver 360</button>` : ''}</td>
      </tr>`).join('');
    wrap.classList.remove('hidden');
    body.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => openClient(btn.dataset.open));
    });
  }

  async function cargarCierresPeriodo() {
    const { fechaInicio, fechaFin } = getPeriod();
    if (!fechaInicio || !fechaFin) {
      setStatus('Selecciona desde y hasta para listar clientes cerrados', 'error');
      return;
    }
    if (fechaInicio > fechaFin) {
      setStatus('La fecha inicial no puede ser posterior a la final', 'error');
      return;
    }
    setStatus('Consultando cierres de taller...', 'loading');
    showLoading(true);
    try {
      const data = await api(
        `/crm/cierres-taller?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}&limit=300`
      );
      renderCierres(data);
      setText('periodLabel', `${fechaInicio} — ${fechaFin}`);
      setStatus(
        `${data.totales?.clientes || 0} cliente(s) · ${data.totales?.ordenesCerradas || 0} órdenes · ${money(data.totales?.importeTaller || 0)}`
      );
      el('emptyState').classList.add('hidden');
      el('clientPanel').classList.add('hidden');
      el('vendedorPanel')?.classList.add('hidden');
      el('cierresPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  function setVista(vista) {
    currentVista = vista === 'vendedor' ? 'vendedor' : 'cliente';
    document.querySelectorAll('[data-vista]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.vista === currentVista);
    });
    el('vistaClienteWrap')?.classList.toggle('hidden', currentVista !== 'cliente');
    el('vistaVendedorWrap')?.classList.toggle('hidden', currentVista !== 'vendedor');

    if (currentVista === 'vendedor') {
      el('cierresPanel')?.classList.add('hidden');
      el('searchResultsWrap')?.classList.add('hidden');
      el('clientPanel')?.classList.add('hidden');
      loadVendedoresCatalog().then(() => {
        if (el('vendedorInput')?.value.trim()) cargarVendedorResumen();
        else {
          el('vendedorPanel')?.classList.add('hidden');
          el('emptyState')?.classList.remove('hidden');
          setStatus('Elige un vendedor para ver el acumulado de su cartera');
        }
      });
    } else {
      el('vendedorPanel')?.classList.add('hidden');
      if (!currentIdContacto && !(el('searchResults')?.children?.length)) {
        el('emptyState')?.classList.remove('hidden');
      }
      setStatus('Listo');
    }
  }

  async function loadVendedoresCatalog() {
    try {
      const data = await api('/crm/vendedores?limit=300');
      vendedoresCache = data.vendedores || [];
      const list = el('vendedorDatalist');
      if (list) {
        list.innerHTML = vendedoresCache.map((v) =>
          `<option value="${esc(v.vendedor)}" label="${Number(v.clientes || 0)} clientes"></option>`
        ).join('');
      }
      setText('vendedorHint', `${vendedoresCache.length} vendedor(es)`);
    } catch (err) {
      setText('vendedorHint', '');
      console.warn('[Seguimiento] vendedores', err);
    }
  }

  async function cargarVendedorResumen() {
    const vendedor = el('vendedorInput')?.value.trim();
    if (!vendedor) {
      setStatus('Escribe o elige un vendedor', 'error');
      return;
    }
    const { fechaInicio, fechaFin } = getPeriod();
    if ((fechaInicio && !fechaFin) || (!fechaInicio && fechaFin)) {
      setStatus('Indica ambas fechas del periodo, o déjalas vacías para todo el histórico', 'error');
      return;
    }
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
      setStatus('La fecha inicial no puede ser posterior a la final', 'error');
      return;
    }

    setStatus('Consultando acumulado del vendedor...', 'loading');
    showLoading(true);
    try {
      const qs = new URLSearchParams({ vendedor, limit: '400' });
      if (fechaInicio) qs.set('fechaInicio', fechaInicio);
      if (fechaFin) qs.set('fechaFin', fechaFin);
      const data = await api(`/crm/vendedores/resumen?${qs.toString()}`);
      renderVendedorResumen(data);
      setText('periodLabel', fechaInicio && fechaFin ? `${fechaInicio} — ${fechaFin}` : 'Todo el histórico');
      setStatus(
        `${data.vendedor}: ${data.totales?.clientes || 0} clientes · ${data.totales?.ciclos || 0} ciclos · ${data.totales?.compras || 0} compras`
      );
      el('emptyState').classList.add('hidden');
      el('clientPanel').classList.add('hidden');
      el('cierresPanel')?.classList.add('hidden');
      el('searchResultsWrap')?.classList.add('hidden');
      el('vendedorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  function closeVendComercialDetail() {
    openVendComercialKpi = null;
    const panel = el('vendedorComercialDetail');
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
    document.querySelectorAll('[data-vend-kpi].is-open').forEach((c) => {
      c.classList.remove('is-open');
      c.setAttribute('aria-expanded', 'false');
    });
  }

  function buildVendComercialDetailHtml(key) {
    const data = currentVendedorData;
    if (!data) return null;
    const com = data.comercial || {};
    const fin = com.financiamiento || {};
    const pvas = fin.pvas || {};
    const libro = com.libroVentas || {};

    const titles = {
      libro: 'Unidades vendidas',
      contratos: 'Contratos F&I',
      plazos: 'Distribución de plazos',
      pvas: 'PVAs por producto',
    };
    const title = titles[key];
    if (!title) return null;

    let value = '—';
    let body = '';

    if (key === 'libro') {
      const unidades = libro.unidades ?? libro.sql?.unidades ?? 0;
      value = String(unidades);
      const rows = (libro.sql?.muestra?.length ? libro.sql.muestra : (libro.crm?.muestra || []));
      const hint = libro.sql?.unidades
        ? `${libro.sql.unidades} unidades facturadas en ADE_VTAFI`
        : `${libro.crm?.unidades || 0} facturas en CRM (sin match ADE_VTAFI)`;
      body = `
        <p class="kpi-subtitle" style="margin:0 0 10px">${esc(hint)}</p>
        <div class="table-scroll" style="max-height:320px">
          <table class="data-table">
            <thead><tr>
              <th>Fecha</th><th>Factura</th><th>VIN</th><th>Modelo</th><th>Forma pago</th><th>Cliente</th>
            </tr></thead>
            <tbody>
              ${rows.length
                ? rows.map((r) => `
                  <tr>
                    <td>${dash(r.fecha)}</td>
                    <td>${dash(r.factura)}</td>
                    <td>${dash(r.vin)}</td>
                    <td>${dash(r.modelo)}</td>
                    <td>${dash(r.formaPago || '—')}</td>
                    <td>${dash(r.cliente)}</td>
                  </tr>`).join('')
                : '<tr class="empty-row"><td colspan="6">Sin ventas en libro para la cartera</td></tr>'}
            </tbody>
          </table>
        </div>`;
    } else if (key === 'contratos') {
      value = String(fin.contratos ?? 0);
      const rows = fin.muestra || [];
      const hint = fin.montoFinanciarTotal
        ? `Total financiado ${money(fin.montoFinanciarTotal)} · match ${fin.match || '—'}`
        : `Match ${fin.match || 'ninguno'}`;
      body = `
        <p class="kpi-subtitle" style="margin:0 0 10px">${esc(hint)}</p>
        <div class="table-scroll" style="max-height:320px">
          <table class="data-table">
            <thead><tr>
              <th>Fecha</th><th>Cliente</th><th>Unidad</th><th class="cell-num">Plazo</th>
              <th class="cell-money">Monto</th><th class="cell-num"># PVAs</th><th>PVAs</th>
            </tr></thead>
            <tbody>
              ${rows.length
                ? rows.map((r) => `
                  <tr>
                    <td>${dash(r.fecha)}</td>
                    <td>${dash(r.cliente)}</td>
                    <td>${dash(r.unidad)}</td>
                    <td class="cell-num">${r.plazo != null ? `${r.plazo} m` : '—'}</td>
                    <td class="cell-money">${r.montoFinanciar != null ? money(r.montoFinanciar) : '—'}</td>
                    <td class="cell-num">${Number(r.cantidadPvas ?? (r.pvas || []).length)}</td>
                    <td>${(r.pvas || []).length ? esc((r.pvas || []).join(', ')) : '—'}</td>
                  </tr>`).join('')
                : '<tr class="empty-row"><td colspan="7">Sin contratos de muestra</td></tr>'}
            </tbody>
          </table>
        </div>`;
    } else if (key === 'plazos') {
      const plazos = fin.plazos || [];
      value = fin.plazoPromedio != null ? `${fin.plazoPromedio} m` : '—';
      const hint = fin.plazoPromedio != null
        ? `Promedio ${fin.plazoPromedio} meses · enganche prom. ${fin.enganchePromedio != null ? money(fin.enganchePromedio) : '—'}`
        : 'Sin contratos de financiamiento en el periodo';
      body = `
        <p class="kpi-subtitle" style="margin:0 0 10px">${esc(hint)}</p>
        <div class="table-scroll" style="max-height:320px">
          <table class="data-table">
            <thead><tr>
              <th>Plazo</th><th class="cell-num">Contratos</th><th class="cell-num">%</th>
            </tr></thead>
            <tbody>
              ${plazos.length
                ? plazos.map((p) => `
                  <tr>
                    <td>${dash(p.plazo)} meses</td>
                    <td class="cell-num">${Number(p.count || 0)}</td>
                    <td class="cell-num">${Number(p.pct || 0)}%</td>
                  </tr>`).join('')
                : '<tr class="empty-row"><td colspan="3">Sin plazos registrados</td></tr>'}
            </tbody>
          </table>
        </div>`;
    } else if (key === 'pvas') {
      value = pvas.promedioCantidadPvas != null
        ? String(pvas.promedioCantidadPvas)
        : '—';
      const rows = pvas.porTipo || [];
      const hint = [
        pvas.promedioCantidadPvas != null ? `Promedio ${pvas.promedioCantidadPvas} PVAs/contrato` : null,
        pvas.penetracionPct != null ? `Penetración ${pvas.penetracionPct}%` : null,
        `${pvas.contratosConPva || 0} contratos con PVA`,
        `${pvas.totalCantidadPvas || 0} PVAs en total`,
      ].filter(Boolean).join(' · ');
      body = `
        <p class="kpi-subtitle" style="margin:0 0 10px">${esc(hint)}</p>
        <div class="table-scroll" style="max-height:320px">
          <table class="data-table">
            <thead><tr>
              <th>Producto</th><th class="cell-num">Contratos</th>
              <th class="cell-num">Penetración</th><th class="cell-money">Monto</th>
            </tr></thead>
            <tbody>
              ${rows.length
                ? rows.map((p) => `
                  <tr>
                    <td>${dash(p.tipo)}</td>
                    <td class="cell-num">${Number(p.contratos || 0)}</td>
                    <td class="cell-num">${Number(p.penetracionPct || 0)}%</td>
                    <td class="cell-money">${money(p.montoTotal || 0)}</td>
                  </tr>`).join('')
                : '<tr class="empty-row"><td colspan="4">Sin PVAs en contratos</td></tr>'}
            </tbody>
          </table>
        </div>`;
    }

    return `
      <div class="kpi-detail-panel__head">
        <div>
          <p class="kpi-detail-panel__eyebrow">Desempeño comercial</p>
          <h4 class="kpi-detail-panel__title">${esc(title)}</h4>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="kpi-detail-panel__value">${esc(value)}</span>
          <button type="button" class="kpi-detail-panel__close" data-close-vend-detail aria-label="Cerrar desglose">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      ${body}`;
  }

  function renderVendComercialDetail(key) {
    const panel = el('vendedorComercialDetail');
    if (!panel || !key) return;

    if (openVendComercialKpi === key) {
      closeVendComercialDetail();
      return;
    }

    const html = buildVendComercialDetailHtml(key);
    if (!html) return;

    closeVendComercialDetail();
    panel.innerHTML = html;
    panel.classList.remove('hidden');
    openVendComercialKpi = key;

    const card = document.querySelector(`[data-vend-kpi="${key}"]`);
    if (card) {
      card.classList.add('is-open');
      card.setAttribute('aria-expanded', 'true');
    }
    panel.querySelector('[data-close-vend-detail]')?.addEventListener('click', closeVendComercialDetail);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderVendedorResumen(data) {
    currentVendedorData = data;
    closeVendComercialDetail();
    const panel = el('vendedorPanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    const tot = data.totales || {};
    const com = data.comercial || {};
    const fin = com.financiamiento || {};
    const pvas = fin.pvas || {};
    const retorno = com.retornoTaller || {};
    const libro = com.libroVentas || {};
    const plazos = fin.plazos || [];
    const periodo = data.periodo || {};
    const periodoTxt = periodo.fechaInicio && periodo.fechaFin
      ? `Periodo ${periodo.fechaInicio} — ${periodo.fechaFin}`
      : 'Todo el histórico';
    setText('vendedorSubtitle', `${data.vendedor || '—'} · ${periodoTxt}`);
    setText('kVendClientes', tot.clientes ?? 0);
    setText('kVendCiclos', tot.ciclos ?? 0);
    setText('kVendLeads', tot.leads ?? 0);
    setText('kVendSolicitudes', tot.solicitudes ?? 0);
    setText('kVendPruebas', tot.pruebas ?? 0);
    const libroUnits = Number(libro.unidades ?? libro.sql?.unidades ?? 0);
    setText('vendedorCount', `${(data.clientes || []).length} cliente(s) listado(s)`);

    setText('kVendLibro', libroUnits);
    setText(
      'kVendLibroSub',
      libro.fuente === 'ADE_VTAFI' || Number(libro.sql?.unidades || 0) > 0
        ? 'Facturas registradas en ADE_VTAFI'
        : (libro.fuente === 'crm_facturas'
          ? 'Facturas CRM (sin match en ADE_VTAFI)'
          : 'Sin ventas registradas')
    );
    setText('kVendContratos', fin.contratos ?? 0);
    setText(
      'kVendContratosSub',
      fin.match === 'asesor'
        ? 'Match por asesor F&I'
        : (fin.match === 'vin_cartera' ? 'Match por VIN de cartera' : 'Sin contratos')
    );
    setText('kVendMontoFin', fin.montoFinanciarPromedio != null ? money(fin.montoFinanciarPromedio) : '—');
    setText('kVendPlazo', fin.plazoPromedio != null ? `${fin.plazoPromedio} m` : '—');
    setText(
      'kVendPlazoSub',
      plazos.length
        ? `${plazos.length} plazo(s) distinto(s) · enganche prom. ${fin.enganchePromedio != null ? money(fin.enganchePromedio) : '—'}`
        : (fin.plazoPromedio != null
          ? `Enganche prom. ${fin.enganchePromedio != null ? money(fin.enganchePromedio) : '—'}`
          : 'Sin contratos de financiamiento')
    );
    setText(
      'kVendPvas',
      pvas.promedioCantidadPvas != null ? pvas.promedioCantidadPvas : '—'
    );
    setText(
      'kVendPvasSub',
      pvas.promedioCantidadPvas != null
        ? `${pvas.totalCantidadPvas || 0} PVAs en ${fin.contratos || 0} contratos · ${pvas.penetracionPct ?? 0}% con al menos 1`
        : 'Cantidad promedio de PVAs por contrato'
    );
    setText('kVendRetorno', retorno.tasaRetornoPct != null ? `${retorno.tasaRetornoPct}%` : '—');
    setText(
      'kVendRetornoSub',
      retorno.base === 'clientes_con_compra'
        ? `${retorno.clientesConTaller || 0} de ${retorno.clientesConCompra || 0} con compra · ${retorno.ordenes || 0} órdenes`
        : `${retorno.vinsConTaller || 0} de ${retorno.vinsCartera || 0} VIN · ${retorno.ordenes || 0} órdenes`
    );

    const rows = data.clientes || [];
    el('vendedorClientesTable').innerHTML = rows.length ? rows.map((c) => `
      <tr>
        <td>${dash(c.id_contacto)}</td>
        <td>${dash(c.nombre)}</td>
        <td class="cell-num">${Number(c.leads || 0)}</td>
        <td class="cell-num">${Number(c.ciclos || 0)}</td>
        <td class="cell-num">${Number(c.solicitudes || 0)}</td>
        <td class="cell-num">${Number(c.pruebas || 0)}</td>
        <td class="cell-num">${Number(c.compras || 0)}</td>
        <td class="cell-num">${Number(c.actividades || 0)}</td>
        <td>${dash(c.ultima_actividad)}</td>
        <td>${c.id_contacto ? `<button type="button" class="chip" data-open-vend="${esc(c.id_contacto)}">Ver 360</button>` : ''}</td>
      </tr>
    `).join('') : '<tr class="empty-row"><td colspan="10">Sin clientes vinculados a este vendedor en el periodo.</td></tr>';

    el('vendedorClientesTable').querySelectorAll('[data-open-vend]').forEach((btn) => {
      btn.addEventListener('click', () => openClient(btn.dataset.openVend));
    });

    if (window.KpiInsights?.apply) {
      window.KpiInsights.apply('seguimiento', {
        vista: 'vendedor',
        vendedor: data.vendedor,
        fechaInicio: periodo.fechaInicio || null,
        fechaFin: periodo.fechaFin || null,
        totales: tot,
        comercial: com,
      });
    }
  }

  function renderCierres(data) {
    currentCierresData = data;
    closeKpiDetail();
    const panel = el('cierresPanel');
    panel.classList.remove('hidden');
    const tot = data.totales || {};
    const periodo = data.periodo || {};
    setText('cierresSubtitle', `Cierres del ${periodo.fechaInicio || '—'} al ${periodo.fechaFin || '—'}`);
    setText('kCierreOrdenes', tot.ordenesCerradas ?? 0);
    setText('kCierreClientes', tot.clientes ?? 0);
    setText('kCierreCrm', tot.clientesConIdCrm ?? 0);
    setText('kCierreImporte', money(tot.importeTaller || 0));
    setText('cierresImporte', `Importe: ${money(tot.importeTaller || 0)}`);
    setText('cierresCount', `${(data.clientes || []).length} cliente(s)`);

    const rows = data.clientes || [];
    el('cierresTable').innerHTML = rows.length ? rows.map((c, i) => {
      const modelos = (c.modelos || []).slice(0, 2).join(', ');
      const series = (c.series || []).slice(0, 2).join(', ');
      const detalle = [modelos, series].filter(Boolean).join(' · ') || '—';
      const openBtn = c.idCrm
        ? `<button type="button" class="chip" data-open="${esc(c.idCrm)}">Ver 360</button>`
        : '<span class="top-bar-meta">Sin ID CRM</span>';
      return `
        <tr data-idx="${i}">
          <td>${dash(c.cliente)}</td>
          <td>${dash(c.idCrm)}</td>
          <td>${dash(c.telefono)}</td>
          <td class="cell-num">${Number(c.ordenes || 0)}</td>
          <td class="cell-money">${money(c.importe || 0)}</td>
          <td>${dash(c.ultimaActividad)}</td>
          <td>${esc(detalle)}</td>
          <td>${openBtn}</td>
        </tr>`;
    }).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#94a3b8">Sin clientes con órdenes cerradas en el periodo</td></tr>';

    el('cierresTable').querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => openClient(btn.dataset.open));
    });

    renderCierresCharts(data);

    if (window.KpiInsights?.apply) {
      window.KpiInsights.apply('seguimiento', {
        vista: 'cierres',
        fechaInicio: periodo.fechaInicio || null,
        fechaFin: periodo.fechaFin || null,
        totales: tot,
      });
    }
  }

  function highlightCierreRow(idx) {
    const row = el('cierresTable').querySelector(`tr[data-idx="${idx}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.style.transition = 'background 0.4s';
    row.style.background = 'rgba(45,91,255,0.14)';
    setTimeout(() => { row.style.background = ''; }, 2200);
  }

  function renderCierresCharts(data) {
    const clientes = data.clientes || [];
    const top = clientes.slice(0, 10);
    createChart('cierresTop', 'chartCierresTop', {
      type: 'bar',
      data: {
        labels: top.map((c) => {
          const name = String(c.cliente || 'Sin nombre').trim();
          return name.length > 22 ? `${name.slice(0, 20)}…` : name;
        }),
        datasets: [{
          label: 'Importe taller',
          data: top.map((c) => Math.round(Number(c.importe || 0))),
          backgroundColor: chartColors.primary,
          borderRadius: 8,
          maxBarThickness: 32,
        }],
      },
      options: chartOptions({
        indexAxis: 'y',
        onHover: (evt, elements) => {
          if (evt?.native?.target) {
            evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
          }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const c = top[elements[0].index];
          if (!c) return;
          if (c.idCrm) {
            openClient(c.idCrm);
          } else {
            highlightCierreRow(elements[0].index);
            setStatus(`${c.cliente}: sin ID CRM vinculado; sus datos del periodo están en la tabla`, 'error');
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const c = top[items[0]?.dataIndex];
                return c ? String(c.cliente || 'Sin nombre') : '';
              },
              label: (ctx) => money(ctx.parsed.x),
              afterLabel: (ctx) => {
                const c = top[ctx.dataIndex];
                if (!c) return '';
                const lineas = [
                  `Órdenes: ${Number(c.ordenes || 0)}`,
                  c.ultimaActividad ? `Última actividad: ${c.ultimaActividad}` : null,
                  c.idCrm ? 'Clic para ver la vista 360' : 'Sin ID CRM (clic: ver en tabla)',
                ];
                return lineas.filter(Boolean).join('\n');
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              callback: (v) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`),
            },
          },
        },
      }),
    });

    const conCrm = Number(data.totales?.clientesConIdCrm || 0);
    const totalCli = Number(data.totales?.clientes || 0);
    const sinCrm = Math.max(0, totalCli - conCrm);
    createChart('cierresCrm', 'chartCierresCrm', {
      type: 'doughnut',
      data: {
        labels: ['Con ID CRM', 'Sin ID CRM'],
        datasets: [{
          data: totalCli ? [conCrm, sinCrm] : [0.0001, 1],
          backgroundColor: [chartColors.secondary, '#DDE3EC'],
          borderWidth: 0,
        }],
      },
      options: chartOptions({
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10 } },
        },
      }),
    });
  }

  async function openClient(idContacto) {
    currentIdContacto = idContacto;
    setStatus(`Cargando cliente ${idContacto}...`, 'loading');
    showLoading(true);
    try {
      const h = await api(
        `/crm/contactos/${encodeURIComponent(idContacto)}/historico${periodQuery()}`
      );
      if (!h.encontrado) {
        setStatus(`Cliente ${idContacto} no encontrado`, 'error');
        return;
      }
      renderClient(h);
      el('cierresPanel').classList.add('hidden');
      el('vendedorPanel')?.classList.add('hidden');
      setStatus(`Cliente ${idContacto} · ${h.nombre || ''}`);
      el('clientPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  function badge(text, cls) {
    return `<span class="badge-tipo ${cls}">${esc(text)}</span>`;
  }

  function renderClientCharts(h) {
    const leads = h.leads || [];
    const solicitudes = h.solicitudes || [];
    const pruebasManejo = h.pruebasManejo || [];
    const timeline = h.timeline || [];
    const compras = h.compras || [];
    const ordenes = h.ordenesServicio || [];

    const years = new Set();
    const addYear = (v) => { const y = yearOf(v); if (y) years.add(y); };
    leads.forEach((l) => addYear(l.fecha_entrada));
    solicitudes.forEach((s) => addYear(s.fecha_solicitud));
    pruebasManejo.forEach((p) => addYear(p.fecha));
    timeline.forEach((t) => addYear(t.fecha));
    compras.forEach((c) => addYear(c.fechaFactura));
    ordenes.forEach((o) => addYear(o.ingreso || o.cierre));
    const labels = [...years].sort();

    const countYear = (list, dateFn) => labels.map((y) => list.filter((item) => yearOf(dateFn(item)) === y).length);

    createChart('actividadAnual', 'chartActividadAnual', {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Sin datos'],
        datasets: [
          {
            label: 'Leads',
            data: labels.length ? countYear(leads, (l) => l.fecha_entrada) : [0],
            backgroundColor: chartColors.tertiary,
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: 'Solicitudes F&I',
            data: labels.length ? countYear(solicitudes, (s) => s.fecha_solicitud) : [0],
            backgroundColor: chartColors.rose,
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: 'Pruebas de manejo',
            data: labels.length ? countYear(pruebasManejo, (p) => p.fecha) : [0],
            backgroundColor: chartColors.teal,
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: 'Actividades CRM',
            data: labels.length ? countYear(timeline, (t) => t.fecha) : [0],
            backgroundColor: chartColors.primary,
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: 'Compras',
            data: labels.length ? countYear(compras, (c) => c.fechaFactura) : [0],
            backgroundColor: chartColors.secondary,
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: 'Órdenes taller',
            data: labels.length ? countYear(ordenes, (o) => o.ingreso || o.cierre) : [0],
            backgroundColor: chartColors.violet,
            borderRadius: 6,
            maxBarThickness: 28,
          },
        ],
      },
      options: chartOptions({
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
      }),
    });

    const tallerAnual = sumByYear(
      ordenes.filter((o) => String(o.status || '').toUpperCase() !== 'C'),
      (o) => o.ingreso || o.cierre,
      (o) => o.importe
    );
    const panelTaller = el('panelChartTaller');
    if (panelTaller) panelTaller.classList.toggle('hidden', !tallerAnual.length);
    createChart('tallerAnual', 'chartTallerAnual', {
      type: 'bar',
      data: {
        labels: tallerAnual.length ? tallerAnual.map((r) => r.label) : ['Sin datos'],
        datasets: [{
          label: 'Importe taller',
          data: tallerAnual.length ? tallerAnual.map((r) => Math.round(r.value)) : [0],
          backgroundColor: chartColors.violet,
          borderRadius: 8,
          maxBarThickness: 40,
        }],
      },
      options: chartOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => money(ctx.parsed.y) },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`),
            },
          },
        },
      }),
    });

  }

  function dateMx(value) {
    if (!value) return '—';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : esc(value);
  }

  function renderFicha360(h) {
    const f = h.ficha360 || {};
    const vehicle = el('ficha360Vehicle');
    vehicle.innerHTML = `
      <span class="material-symbols-outlined">directions_car</span>
      <div>
        <strong>${dash(f.modeloActual)}</strong>
        <small>${[f.anModelo ? `Modelo ${esc(f.anModelo)}` : null, f.vinActual].filter(Boolean).map(esc).join(' · ') || 'Unidad sin identificar'}</small>
      </div>`;

    const items = [
      ['event_available', 'Última compra', dateMx(f.fechaUltimaCompra), 'purchase', 'secCompras', null],
      ['description', 'Número de contrato', dash(f.numeroContrato), 'finance', 'secFinanciamiento', 'financiamiento'],
      ['verified_user', 'Seguro del auto', dash(f.seguroAuto), 'finance', 'secFinanciamiento', 'financiamiento', 'seguro'],
      ['credit_card', 'Tipo de compra', dash(f.tipoCompra), 'finance', 'secFinanciamiento', 'financiamiento'],
      ['calendar_month', 'Plazo contratado', f.plazoContratado != null ? `${Number(f.plazoContratado)} meses` : '—', 'finance', 'secFinanciamiento', 'financiamiento'],
      ['task_alt', 'Mensualidades estimadas', f.mensualidadesPagadas != null ? `${Number(f.mensualidadesPagadas)} de ${Number(f.plazoContratado || 0)}` : '—', 'finance', 'secFinanciamiento', 'financiamiento'],
      ['account_balance_wallet', 'Saldo estimado', f.saldoEstimado != null ? money(f.saldoEstimado) : '—', 'finance', 'secFinanciamiento', 'financiamiento'],
      ['sell', 'Valor de referencia', f.valorEstimadoUnidad != null ? money(f.valorEstimadoUnidad) : '—', 'finance', 'secFinanciamiento', null],
      ['build', 'Último servicio', dateMx(f.ultimaVisitaTaller), 'service', 'secOrdenes', 'taller'],
      ['speed', 'Kilometraje registrado', f.kilometraje != null ? `${Number(f.kilometraje).toLocaleString('es-MX')} km` : '—', 'service', 'secOrdenes', 'taller'],
      ['car_repair', 'Servicios realizados', Number(f.serviciosRealizados || 0).toLocaleString('es-MX'), 'service', 'secOrdenes', 'taller'],
      ['support_agent', 'Último contacto comercial', dateMx(f.ultimoContactoComercial), 'relation', 'secTimeline', 'comercial'],
      ['devices', 'Interacciones digitales', Number(f.interaccionesDigitales || 0).toLocaleString('es-MX'), 'relation', 'secLeads', 'digital'],
      ['feedback', 'Quejas o incidencias', Number(f.quejasIncidencias || 0).toLocaleString('es-MX'), 'relation', 'secTimeline', 'queja', 'quejas'],
      ['garage', 'Historial de compras', `${Number(f.historialCompras || 0)} vehículo(s)`, 'purchase', 'secCompras', 'compra', 'compras'],
    ];
    el('ficha360Grid').innerHTML = items.map(([icon, label, value, tone, gotoId, filter, openKpi]) => `
      <button type="button" class="client-360-stat client-360-stat--${tone}" ${openKpi === 'quejas' ? 'id="kQuejas"' : (openKpi === 'seguro' ? 'id="kSeguroAuto"' : '')} data-goto="${esc(gotoId)}" data-timeline-filter="${esc(filter || '')}" ${openKpi ? `data-open-kpi="${esc(openKpi)}"` : ''} title="Ver detalle relacionado">
        <span class="material-symbols-outlined client-360-stat-icon">${icon}</span>
        <div><span>${label}</span><strong>${value}</strong></div>
      </button>`).join('');

    el('ficha360Grid').querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const openKpi = btn.dataset.openKpi;
        if (openKpi) {
          openClientKpiByKey(openKpi, btn.dataset.goto || null);
          return;
        }
        const filter = btn.dataset.timelineFilter;
        if (filter) renderTimeline360(currentTimeline360, filter);
        gotoSection(btn.dataset.goto);
      });
    });

    const method = f.metodologia || {};
    const methodEntries = Object.values(method).filter(Boolean);
    const methodEl = el('ficha360Method');
    methodEl.classList.toggle('hidden', !methodEntries.length);
    methodEl.innerHTML = methodEntries.length
      ? `<span class="material-symbols-outlined">info</span><span><strong>Cómo leer las estimaciones:</strong> ${methodEntries.map(esc).join(' ')}</span>`
      : '';
  }

  let currentTimeline360 = [];

  function renderTimeline360(events, active = 'todos') {
    currentTimeline360 = events || [];
    const list = currentTimeline360;
    const categories = [
      ['todos', 'Todo'],
      ['compra', 'Compras'],
      ['financiamiento', 'Financiamiento'],
      ['taller', 'Taller'],
      ['comercial', 'Comercial'],
      ['digital', 'Digital'],
      ['prueba', 'Pruebas'],
      ['queja', 'Quejas CSI'],
    ].filter(([key]) => key === 'todos' || list.some((event) => event.categoria === key));
    el('timeline360Filters').innerHTML = categories.map(([key, label]) => `
      <button type="button" class="timeline-360-filter${active === key ? ' is-active' : ''}" data-timeline-filter="${key}">
        ${label}<span>${key === 'todos' ? list.length : list.filter((event) => event.categoria === key).length}</span>
      </button>`).join('');
    const filtered = active === 'todos' ? list : list.filter((event) => event.categoria === active);
    setText('timeline360Count', `${filtered.length} evento(s)`);
    const iconByCategory = {
      compra: 'directions_car',
      financiamiento: 'request_quote',
      taller: 'build',
      comercial: 'forum',
      digital: 'devices',
      prueba: 'steering_wheel_heat',
      queja: 'feedback',
    };
    el('timeline360List').innerHTML = filtered.length ? filtered.map((event) => `
      <article class="timeline-360-event timeline-360-event--${esc(event.categoria || 'comercial')}">
        <div class="timeline-360-date">${dateMx(event.fecha)}</div>
        <div class="timeline-360-marker">
          <span class="material-symbols-outlined">${iconByCategory[event.categoria] || 'circle'}</span>
        </div>
        <div class="timeline-360-content">
          <div class="timeline-360-category">${dash(event.categoria)}</div>
          <h4>${dash(event.titulo)}</h4>
          ${event.detalle ? `<p>${esc(event.detalle)}</p>` : ''}
          ${event.vin ? `<small>VIN ${esc(event.vin)}</small>` : ''}
        </div>
      </article>`).join('') : '<p class="timeline-360-empty">No hay eventos en esta categoría.</p>';
    el('timeline360Filters').querySelectorAll('[data-timeline-filter]').forEach((button) => {
      button.addEventListener('click', () => renderTimeline360(list, button.dataset.timelineFilter));
    });
  }

  function renderClient(h) {
    currentClientData = h;
    closeKpiDetail();
    el('emptyState').classList.add('hidden');
    el('clientPanel').classList.remove('hidden');
    renderFicha360(h);
    renderTimeline360(h.timeline360 || []);

    setText('clientName', h.nombre || `Cliente ${h.idContacto}`);
    const metaParts = [`ID CRM: ${h.idContacto}`];
    if (h.vendedor) metaParts.push(`Atiende: ${h.vendedor}`);
    if (h.telefono) metaParts.push(`Tel: ${h.telefono}`);
    if (h.correo) metaParts.push(h.correo);
    if (h.resumen?.primeraActividad) metaParts.push(`Desde ${h.resumen.primeraActividad}`);
    setText('clientMeta', metaParts.join(' · '));

    const badges = [];
    if ((h.resumen?.totalLeads || 0) > 0) badges.push(badge('Entró por lead', 'badge-high'));
    if ((h.resumen?.totalSolicitudes || 0) > 0) badges.push(badge('Solicitud F&I', 'badge-maintenance'));
    if ((h.resumen?.totalPruebasManejo || 0) > 0) badges.push(badge('Realizó prueba de manejo', 'badge-stable'));
    if (h.resumen?.pruebaManejoConCompra) badges.push(badge('Prueba → compra', 'badge-running'));
    if ((h.resumen?.totalCompras || 0) > 0) badges.push(badge('Compró', 'badge-running'));
    if ((h.resumen?.totalUnidadesDistribuidor || 0) > 0) {
      badges.push(badge(`${h.resumen.totalUnidadesDistribuidor} unidades vinculadas`, 'badge-stable'));
    }
    if ((h.ordenesServicio || []).length > 0) badges.push(badge('Cliente de taller', 'badge-stable'));
    Object.entries(h.resumen?.estatusCiclos || {}).forEach(([estatus, n]) => {
      badges.push(badge(`${estatus}: ${n}`, 'badge-maintenance'));
    });
    if (h.sqlError) badges.push(badge('SQL no disponible', 'badge-alert'));
    el('clientBadges').innerHTML = badges.join('');

    setText('kLeads', h.resumen?.totalLeads ?? 0);
    setText('kCiclos', h.resumen?.totalCiclos ?? 0);
    setText('kUnidadesDistribuidor', h.resumen?.totalUnidadesDistribuidor ?? 0);
    setText('kSolicitudes', h.resumen?.totalSolicitudes ?? 0);
    setText('kPruebasManejo', h.resumen?.totalPruebasManejo ?? 0);
    setText('kOrdenes', (h.ordenesServicio || []).length);
    const clv = h.clv || {};
    setText('kClv', money(clv.clv != null ? clv.clv : h.resumen?.clv || 0));
    const varPct = clv.variacionPct != null ? Number(clv.variacionPct) : h.resumen?.clvVariacionPct;
    if (varPct == null || Number.isNaN(varPct)) {
      setText('kClvVar', 'Sin comparación de periodo');
    } else {
      const arrow = varPct > 0 ? '↑' : (varPct < 0 ? '↓' : '→');
      setText('kClvVar', `${arrow} ${Math.abs(varPct).toFixed(1)}% vs. periodo anterior`);
    }
    setText('kClvSub', clv.segmentoLabel
      ? `Valor promedio por cliente · ${clv.segmentoLabel}`
      : 'Valor promedio por cliente');

    renderClientCharts(h);

    if (window.KpiInsights?.apply) {
      window.KpiInsights.apply('seguimiento', {
        vista: 'cliente',
        idContacto: h.idContacto,
        nombre: h.nombre,
        resumen: h.resumen || {},
        ordenesCount: (h.ordenesServicio || []).length,
        quejasCsi: h.quejasCsi || null,
        ficha360: h.ficha360 || {},
      });
    }

    const unidadesDistribuidor = h.unidadesDistribuidor || [];
    setText('unidadesDistribuidorCount', `${unidadesDistribuidor.length} unidad(es)`);
    el('unidadesDistribuidorTable').innerHTML = unidadesDistribuidor.length
      ? unidadesDistribuidor.map((u) => `
        <tr>
          <td>${dash(u.serie)}</td>
          <td>${dash(u.modelo)}</td>
          <td>${dash(u.anModelo)}</td>
          <td class="cell-num">${Number(u.ordenes || 0)}</td>
          <td>${dash(u.primeraVisita)}</td>
          <td>${dash(u.ultimaVisita)}</td>
          <td>${u.ventaEnDistribuidor
            ? badge('Venta registrada', 'badge-running')
            : badge('Sin venta registrada aquí', 'badge-maintenance')}</td>
          <td>${dash(u.facturaVenta)}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#94a3b8">Sin unidades adicionales vinculadas en el DMS</td></tr>';

    const compras = h.compras || [];
    setText('comprasCount', `${compras.length} unidad(es)`);
    el('comprasTable').innerHTML = compras.length ? compras.map((c) => `
      <tr>
        <td>${dash(c.vin)}</td>
        <td>${dash(c.producto)}</td>
        <td>${dash(c.modeloSql)}</td>
        <td>${dash(c.numFactura)}</td>
        <td>${dash(c.fechaFactura)}</td>
        <td>${dash(c.vendedor)}</td>
        <td class="cell-num">${Number(c.totalOrdenes || 0)}</td>
      </tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center;color:#94a3b8">Sin compras registradas (sin VIN en ciclos)</td></tr>';

    const contratos = h.contratosFinanciamiento || [];
    const pvaLabel = (monto) => (Number(monto || 0) > 0 ? money(monto) : '—');
    setText('financiamientoCount', `${contratos.length} contrato(s)`);
    el('financiamientoTable').innerHTML = contratos.length ? contratos.map((c) => `
      <tr>
        <td>${dash(c.vin)}</td>
        <td>${dash(c.no_contrato || c.contrato)}</td>
        <td>${dash(c.unidad)}</td>
        <td>${dash(c.fecha_compra)}</td>
        <td class="cell-num">${c.plazo_meses != null ? `${Number(c.plazo_meses)} meses` : '—'}</td>
        <td>${c.enganche_pct != null ? `${Number(c.enganche_pct).toFixed(2)}%` : '—'}</td>
        <td class="cell-money">${c.enganche_monto != null ? money(c.enganche_monto) : '—'}</td>
        <td>${pvaLabel(c.gap_monto)}</td>
        <td>${pvaLabel(c.garantia_extendida_monto)}</td>
        <td>${Number(c.onstar_monto || 0) > 0
          ? `${money(c.onstar_monto)}${c.plazo_onstar ? ` · ${esc(c.plazo_onstar)}` : ''}`
          : '—'}</td>
        <td>${pvaLabel(c.mantenimiento_integrado_monto)}</td>
        <td>${dash(c.aseguradora)}</td>
        <td>${dash(c.robo_parcial)}</td>
        <td>${dash(c.especial || c.plan_2 || c.plan)}</td>
      </tr>`).join('')
      : '<tr><td colspan="14" style="text-align:center;color:#94a3b8">Sin contratos de financiamiento ligados por VIN</td></tr>';

    const ordenes = h.ordenesServicio || [];
    setText('ordenesCount', `${ordenes.length} orden(es)`);
    setText('ordenesImporte', `Importe generado: ${money(h.resumen?.importeTaller || 0)}`);
    el('ordenesTable').innerHTML = ordenes.length ? ordenes.map((o) => `
      <tr>
        <td>${dash(o.orden)}</td>
        <td>${dash(o.serie)}</td>
        <td>${dash(o.modelo)}</td>
        <td>${dash(o.ingreso)}</td>
        <td>${dash(o.cierre)}</td>
        <td>${dash(o.asesor)}</td>
        <td>${dash(o.facturaTaller)}</td>
        <td class="cell-money">${o.importe ? money(o.importe) : '—'}</td>
      </tr>`).join('')
      : `<tr><td colspan="8" style="text-align:center;color:#94a3b8">${h.sqlError ? 'SQL no disponible: ' + esc(h.sqlError) : 'Sin órdenes de servicio para los VIN del cliente'}</td></tr>`;

    const pruebasManejo = h.pruebasManejo || [];
    setText('pruebasManejoCount', `${pruebasManejo.length} prueba(s)`);
    el('pruebasManejoTable').innerHTML = pruebasManejo.length ? pruebasManejo.map((p) => {
      const km = Number(p.kilometraje_final || 0) - Number(p.kilometraje_inicial || 0);
      return `
      <tr>
        <td>${dash(p.fecha)}</td>
        <td>${dash(p.hora_salida)}</td>
        <td>${dash(p.auto_interes)}</td>
        <td>${dash(p.tipo_auto)}</td>
        <td>${dash(p.vin)}</td>
        <td>${dash(p.ejecutivo_ventas)}</td>
        <td>${dash(p.centro_trabajo)}</td>
        <td class="cell-num">${km >= 0 ? km.toLocaleString('es-MX') : '—'}</td>
      </tr>`;
    }).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#94a3b8">Sin pruebas de manejo registradas</td></tr>';

    const leads = h.leads || [];
    setText('leadsCount', `${leads.length} lead(s)`);
    el('leadsTable').innerHTML = leads.length ? leads.map((l) => `
      <tr>
        <td>${dash(l.fecha_entrada)}</td>
        <td>${dash(l.sucursal)}</td>
        <td>${dash(l.tipo)}</td>
        <td>${dash(l.canal)}</td>
        <td>${dash(l.auto_interes)}</td>
        <td>${dash(l.resultado)}</td>
        <td>${dash(l.ejecutivo_asignado)}</td>
        <td>${l.cita_programada === 'SI' ? badge('Cita', 'badge-running') : '—'}</td>
      </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#94a3b8">Sin leads registrados</td></tr>';
  }

  function gotoSection(targetId) {
    const target = el(targetId);
    if (!target || target.closest('.hidden')) return;
    const panel = target.classList.contains('section-panel')
      || target.classList.contains('client-360-shell')
      || target.classList.contains('client-360-timeline')
      ? target
      : (target.closest('.section-panel, .client-360-shell, .client-360-timeline') || target);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.remove('section-flash');
    void panel.offsetWidth;
    panel.classList.add('section-flash');
    setTimeout(() => panel.classList.remove('section-flash'), 1700);
  }

  // ── Desglose de KPIs ──────────────────────────────────────────────
  const topN = (pairs, n = 8) => (pairs || []).slice(0, n);

  function pctTxt(part, total) {
    if (!total) return '0%';
    return `${Math.round((part / total) * 100)}%`;
  }

  function buildClientKpiDetail(kpi, h) {
    const leads = h.leads || [];
    const solicitudes = h.solicitudes || [];
    const pruebas = h.pruebasManejo || [];
    const compras = h.compras || [];
    const ordenes = h.ordenesServicio || [];
    const unidades = h.unidadesDistribuidor || [];
    const r = h.resumen || {};
    const num = (v) => Number(v || 0).toLocaleString('es-MX');

    switch (kpi) {
      case 'seguro': {
        const f = h.ficha360 || {};
        const contratos = h.contratosFinanciamiento || [];
        return {
          title: 'Seguro del auto',
          value: f.seguroAuto || '—',
          sections: [
            { titulo: 'Seguro', rows: [
              { label: 'Aseguradora', value: f.seguroAuto || '—' },
              { label: 'Contrato', value: f.numeroContrato || '—' },
              { label: 'Unidad', value: f.modeloActual || '—' },
            ] },
            { titulo: 'Por contrato', rows: contratos.length
              ? contratos.map((c) => ({
                label: [c.unidad, c.no_contrato || c.contrato].filter(Boolean).join(' · ') || c.vin || 'Contrato',
                value: c.aseguradora || '—',
              }))
              : [{ label: 'Sin contratos de financiamiento', value: '—' }] },
          ],
        };
      }
      case 'leads': {
        const conCita = leads.filter((l) => String(l.cita_programada || '').toUpperCase() === 'SI').length;
        return {
          title: 'Leads (interesado)',
          value: num(leads.length),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Total de leads', value: num(leads.length) },
              { label: 'Con cita programada', value: `${num(conCita)} (${pctTxt(conCita, leads.length)})` },
              { label: 'Primer lead', value: leads.length ? leads[leads.length - 1].fecha_entrada || '—' : '—' },
              { label: 'Último lead', value: leads.length ? leads[0].fecha_entrada || '—' : '—' },
            ] },
            { titulo: 'Por canal', rows: topN(countBy(leads, (l) => l.canal)).map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Por resultado', rows: topN(countBy(leads, (l) => l.resultado)).map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Por ejecutivo', rows: topN(countBy(leads, (l) => l.ejecutivo_asignado), 6).map((x) => ({ label: x.label, value: num(x.value) })) },
          ],
        };
      }
      case 'ciclos': {
        const estatus = Object.entries(r.estatusCiclos || {}).map(([label, value]) => ({ label, value }));
        const timeline360 = h.timeline360 || [];
        const comerciales = timeline360.filter((e) => e.categoria === 'comercial');
        return {
          title: 'Ciclos de venta',
          value: num(r.totalCiclos ?? 0),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Ciclos en CRM', value: num(r.totalCiclos ?? 0) },
              { label: 'Eventos en línea de tiempo 360', value: num(timeline360.length) },
              { label: 'Contactos comerciales', value: num(comerciales.length) },
              { label: 'Primera actividad', value: r.primeraActividad || '—' },
              { label: 'Última actividad', value: r.ultimaActividad || '—' },
            ] },
            { titulo: 'Por estatus de ciclo', rows: estatus.map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Eventos por categoría', rows: topN(countBy(timeline360, (t) => t.categoria)).map((x) => ({ label: x.label, value: num(x.value) })) },
          ],
        };
      }
      case 'compras': {
        return {
          title: 'Compras (unidades)',
          value: num(compras.length),
          sections: [
            { titulo: 'Unidades compradas', rows: compras.length
              ? compras.map((c) => ({
                label: [c.producto || c.modeloSql, c.vin].filter(Boolean).join(' · ') || 'Unidad',
                value: c.fechaFactura || c.numFactura || '—',
              }))
              : [{ label: 'Sin compras con VIN asignado en ciclo', value: '—' }] },
            { titulo: 'Vendedores', rows: topN(countBy(compras.filter((c) => c.vendedor), (c) => c.vendedor)).map((x) => ({ label: x.label, value: num(x.value) })) },
          ],
        };
      }
      case 'unidades': {
        const conVenta = unidades.filter((u) => u.ventaEnDistribuidor).length;
        return {
          title: 'Unidades vinculadas en el distribuidor',
          value: num(unidades.length),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Total de unidades', value: num(unidades.length) },
              { label: 'Con venta registrada aquí', value: num(conVenta) },
              { label: 'Sin venta registrada aquí', value: num(unidades.length - conVenta) },
            ] },
            { titulo: 'Detalle por unidad', rows: unidades.length
              ? topN(unidades, 10).map((u) => ({
                label: [u.modelo, u.serie].filter(Boolean).join(' · ') || u.serie || 'Unidad',
                value: `${num(u.ordenes)} orden(es) · últ. visita ${u.ultimaVisita || '—'}`,
              }))
              : [{ label: 'Sin unidades vinculadas en el DMS', value: '—' }] },
          ],
        };
      }
      case 'solicitudes': {
        const aprobadas = solicitudes.filter((s) => String(s.estatus || '').toUpperCase().startsWith('APROBADA')).length;
        const engancheTotal = solicitudes.reduce((acc, s) => acc + Number(s.enganche || 0), 0);
        const bioLabel = (v) => {
          const raw = String(v || '').trim().toUpperCase();
          if (raw === 'SI' || raw === 'SÍ' || raw === 'YES') return 'Con biométrico';
          if (raw === 'NO') return 'Sin biométrico';
          return raw || 'n/d';
        };
        return {
          title: 'Solicitudes de crédito (F&I)',
          value: num(solicitudes.length),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Total de solicitudes', value: num(solicitudes.length) },
              { label: 'Aprobadas', value: `${num(aprobadas)} (${pctTxt(aprobadas, solicitudes.length)})` },
              { label: 'Enganche acumulado', value: money(engancheTotal) },
            ] },
            { titulo: 'Por estatus', rows: topN(countBy(solicitudes, (s) => s.estatus)).map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Por financiera', rows: topN(countBy(solicitudes, (s) => s.financiera)).map((x) => ({ label: x.label, value: num(x.value) })) },
            {
              titulo: 'Detalle de solicitudes',
              rows: solicitudes.length
                ? solicitudes.map((s) => ({
                  label: [
                    s.no_solicitud || 'Solicitud',
                    s.estatus || '—',
                    s.financiera || '—',
                    bioLabel(s.biometrico),
                  ].join(' · '),
                  value: s.respuesta_financiera || 'Sin respuesta financiera',
                }))
                : [{ label: 'Sin solicitudes', value: '—' }],
            },
          ],
        };
      }
      case 'pruebas': {
        const kmTotal = pruebas.reduce((acc, p) => {
          const km = Number(p.kilometraje_final || 0) - Number(p.kilometraje_inicial || 0);
          return acc + (km > 0 ? km : 0);
        }, 0);
        return {
          title: 'Pruebas de manejo',
          value: num(pruebas.length),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Total de pruebas', value: num(pruebas.length) },
              { label: 'Km recorridos (total)', value: num(kmTotal) },
              { label: 'Prueba con compra', value: r.pruebaManejoConCompra ? 'Sí' : 'No' },
            ] },
            { titulo: 'Por vehículo', rows: topN(countBy(pruebas, (p) => p.auto_interes)).map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Por ejecutivo', rows: topN(countBy(pruebas, (p) => p.ejecutivo_ventas)).map((x) => ({ label: x.label, value: num(x.value) })) },
          ],
        };
      }
      case 'ordenes': {
        const porAnio = countBy(ordenes, (o) => yearOf(o.ingreso || o.cierre)).sort((a, b) => a.label.localeCompare(b.label));
        return {
          title: 'Órdenes de servicio',
          value: num(ordenes.length),
          sections: [
            { titulo: 'Por status', rows: topN(countBy(ordenes, (o) => o.status)).map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Por año', rows: porAnio.map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Por asesor', rows: topN(countBy(ordenes, (o) => o.asesor), 6).map((x) => ({ label: x.label, value: num(x.value) })) },
          ],
        };
      }
      case 'clv': {
        const clv = h.clv || {};
        const comp = clv.composicion || {};
        const chartRows = (clv.chart || []).filter((x) => Number(x.value || 0) > 0);
        const segRows = (clv.segmentacion || []).map((s) => ({
          label: s.label,
          value: s.activo ? 'Este cliente' : '—',
          badge: s.activo ? s.label : null,
        }));
        return {
          title: 'CLV Promedio',
          value: money(clv.clv || 0),
          chart: {
            canvasId: 'chartClvComposicion',
            labels: chartRows.map((x) => x.label),
            values: chartRows.map((x) => Number(x.value || 0)),
          },
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'CLV Promedio', value: money(clv.clv || 0) },
              { label: 'Clientes analizados', value: num(clv.clientesAnalizados || 1) },
              { label: 'CLV total', value: money(clv.clvTotal || clv.clv || 0) },
              { label: 'Variación vs periodo anterior', value: clv.variacionPct == null
                ? '—'
                : `${clv.variacionPct > 0 ? '↑' : (clv.variacionPct < 0 ? '↓' : '→')} ${Math.abs(Number(clv.variacionPct)).toFixed(1)}%` },
              { label: 'Segmento', value: clv.segmentoLabel || '—' },
            ] },
            { titulo: 'Composición del CLV', rows: [
              { label: 'Venta vehículo', value: money(comp.ventaVehiculo || 0) },
              { label: 'Financiamiento', value: money(comp.financiamiento || 0) },
              { label: 'Accesorios', value: money(comp.accesorios || 0) },
              { label: 'Servicio', value: money(comp.servicio || 0) },
              { label: 'Refacciones', value: money(comp.refacciones || 0) },
              { label: 'Centro de Colisión', value: money(comp.colision || 0) },
              { label: 'Renovación', value: money(comp.renovacion || 0) },
            ] },
            { titulo: 'Segmentación por CLV', rows: segRows.length
              ? segRows
              : [{ label: 'Sin segmentación', value: '—' }] },
          ],
        };
      }
      case 'importeTaller': {
        const noCanceladas = ordenes.filter((o) => String(o.status || '').toUpperCase() !== 'C');
        const porAnio = sumByYear(noCanceladas, (o) => o.ingreso || o.cierre, (o) => o.importe);
        const topOrdenes = noCanceladas
          .slice()
          .sort((a, b) => Number(b.importe || 0) - Number(a.importe || 0))
          .slice(0, 5);
        return {
          title: 'Importe generado en taller',
          value: money(r.importeTaller || 0),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Importe total (no canceladas)', value: money(r.importeTaller || 0) },
              { label: 'Facturado', value: money(r.importeFacturadoTaller || 0) },
              { label: 'Abierto', value: money(r.importeAbiertoTaller || 0) },
            ] },
            { titulo: 'Importe por año', rows: porAnio.map((x) => ({ label: x.label, value: money(x.value) })) },
            { titulo: 'Top órdenes por importe', rows: topOrdenes.map((o) => ({
              label: [o.orden, o.modelo].filter(Boolean).join(' · '),
              value: money(o.importe || 0),
            })) },
          ],
        };
      }
      case 'quejas': {
        const csi = h.quejasCsi || {};
        const posventa = csi.posventa || [];
        const ventas = csi.ventas || [];
        const porArea = Object.entries(csi.porArea || {}).map(([label, value]) => ({ label, value }));
        const rowQueja = (q, kind) => ({
          label: [
            q.incidencia || 'Incidencia',
            kind === 'posventa' && q.orden ? `Orden ${q.orden}` : null,
            kind === 'ventas' && q.serie ? `Serie ${q.serie}` : null,
            q.fecha || null,
          ].filter(Boolean).join(' · '),
          value: q.area || 'Sin área',
          detail: q.queja || q.comentarios || 'Sin comentario',
          badge: q.area || null,
        });
        return {
          title: 'Quejas o incidencias (CSI)',
          value: num(csi.total ?? (posventa.length + ventas.length)),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Total CSI', value: num(csi.total ?? 0) },
              { label: 'Posventa (por orden)', value: num(csi.totalPosventa ?? posventa.length) },
              { label: 'Ventas (por serie/VIN)', value: num(csi.totalVentas ?? ventas.length) },
              { label: 'Área principal inferida', value: csi.areaPrincipal || '—' },
            ] },
            { titulo: 'Por área / departamento', rows: porArea.length
              ? porArea.sort((a, b) => b.value - a.value).map((x) => ({ label: x.label, value: num(x.value) }))
              : [{ label: 'Sin clasificación todavía', value: '—' }] },
            { titulo: 'Posventa', rows: posventa.length
              ? posventa.map((q) => rowQueja(q, 'posventa'))
              : [{ label: 'Sin incidencias CSI Posventa vinculadas por orden/serie', value: '—' }] },
            { titulo: 'Ventas', rows: ventas.length
              ? ventas.map((q) => rowQueja(q, 'ventas'))
              : [{ label: 'Sin incidencias CSI Ventas vinculadas por serie/VIN', value: '—' }] },
          ],
        };
      }
      default:
        return null;
    }
  }

  function buildCierresKpiDetail(kpi, data) {
    const clientes = data.clientes || [];
    const tot = data.totales || {};
    const num = (v) => Number(v || 0).toLocaleString('es-MX');
    const topImporte = clientes.slice().sort((a, b) => Number(b.importe || 0) - Number(a.importe || 0)).slice(0, 8);
    const topOrdenes = clientes.slice().sort((a, b) => Number(b.ordenes || 0) - Number(a.ordenes || 0)).slice(0, 8);
    const conCrm = Number(tot.clientesConIdCrm || 0);
    const totalCli = Number(tot.clientes || 0);

    switch (kpi) {
      case 'cierreOrdenes':
        return {
          title: 'Órdenes cerradas en el periodo',
          value: num(tot.ordenesCerradas ?? 0),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Órdenes cerradas', value: num(tot.ordenesCerradas ?? 0) },
              { label: 'Clientes atendidos', value: num(totalCli) },
              { label: 'Promedio de órdenes por cliente', value: totalCli ? (Number(tot.ordenesCerradas || 0) / totalCli).toFixed(1) : '0' },
            ] },
            { titulo: 'Top clientes por órdenes', rows: topOrdenes.map((c) => ({ label: c.cliente || 'Sin nombre', value: `${num(c.ordenes)} orden(es)` })) },
          ],
        };
      case 'cierreClientes':
        return {
          title: 'Clientes con cierre en el periodo',
          value: num(totalCli),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Total de clientes', value: num(totalCli) },
              { label: 'Identificados en CRM', value: `${num(conCrm)} (${pctTxt(conCrm, totalCli)})` },
              { label: 'Sin ID CRM', value: num(Math.max(0, totalCli - conCrm)) },
            ] },
            { titulo: 'Top clientes por importe', rows: topImporte.map((c) => ({ label: c.cliente || 'Sin nombre', value: money(c.importe || 0) })) },
          ],
        };
      case 'cierreCrm':
        return {
          title: 'Clientes identificados en CRM',
          value: num(conCrm),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Con ID CRM', value: `${num(conCrm)} (${pctTxt(conCrm, totalCli)})` },
              { label: 'Sin ID CRM', value: `${num(Math.max(0, totalCli - conCrm))} (${pctTxt(Math.max(0, totalCli - conCrm), totalCli)})` },
            ] },
            { titulo: 'Identificados con mayor importe', rows: topImporte.filter((c) => c.idCrm).slice(0, 8).map((c) => ({
              label: `${c.cliente || 'Sin nombre'} (ID ${c.idCrm})`,
              value: money(c.importe || 0),
            })) },
          ],
        };
      case 'cierreImporte': {
        const totalOrd = Number(tot.ordenesCerradas || 0);
        return {
          title: 'Importe de taller en el periodo',
          value: money(tot.importeTaller || 0),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Importe total', value: money(tot.importeTaller || 0) },
              { label: 'Ticket promedio por orden', value: money(totalOrd ? Number(tot.importeTaller || 0) / totalOrd : 0) },
              { label: 'Promedio por cliente', value: money(totalCli ? Number(tot.importeTaller || 0) / totalCli : 0) },
            ] },
            { titulo: 'Top clientes por importe', rows: topImporte.map((c) => ({ label: c.cliente || 'Sin nombre', value: money(c.importe || 0) })) },
          ],
        };
      }
      default:
        return null;
    }
  }

  function closeKpiDetail() {
    openKpiKey = null;
    destroyChart('chartClvComposicion');
    ['clientKpiDetail', 'cierresKpiDetail'].forEach((id) => {
      const p = el(id);
      if (p) {
        p.classList.add('hidden');
        p.innerHTML = '';
      }
    });
    document.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('.client-360-stat.is-open').forEach((c) => c.classList.remove('is-open'));
  }

  function fillKpiDetailPanel(panelId, kpi, detail, gotoId, sourceEl) {
    const panel = el(panelId);
    if (!detail || !panel) return;
    const key = `${panelId}:${kpi}`;

    if (openKpiKey === key) {
      closeKpiDetail();
      return;
    }
    closeKpiDetail();

    const sectionsHtml = (detail.sections || [])
      .filter((s) => (s.rows || []).length)
      .map((s) => `
        <div class="kpi-detail-group">
          <h5>${esc(s.titulo)}</h5>
          ${s.rows.map((row) => `
            <div class="kpi-detail-row${row.detail ? ' kpi-detail-row--stack' : ''}">
              <div class="kpi-detail-row__main">
                <span class="lbl" title="${esc(row.label)}">${esc(row.label)}</span>
                <span class="val">${row.badge ? `<span class="badge-tipo badge-flotilla">${esc(row.badge)}</span>` : esc(row.value)}</span>
              </div>
              ${row.detail ? `<p class="kpi-detail-row__detail">${esc(row.detail)}</p>` : ''}
            </div>`).join('')}
        </div>`).join('');

    const chart = detail.chart && detail.chart.labels?.length
      ? `
        <div class="kpi-detail-group kpi-detail-group--chart">
          <h5>Composición promedio del CLV</h5>
          <div class="chart-card" style="min-height:220px;padding:8px 12px">
            <div class="chart-wrap"><canvas id="${esc(detail.chart.canvasId || 'chartKpiDetail')}"></canvas></div>
          </div>
        </div>`
      : '';

    panel.innerHTML = `
      <div class="kpi-detail-panel__head">
        <div>
          <p class="kpi-detail-panel__eyebrow">Desglose</p>
          <h4 class="kpi-detail-panel__title">${esc(detail.title)}</h4>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="kpi-detail-panel__value">${esc(detail.value)}</span>
          <button type="button" class="kpi-detail-panel__close" data-close-detail aria-label="Cerrar desglose">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="kpi-detail-grid">
        ${sectionsHtml || '<p style="color:#94a3b8;margin:8px 0">Sin información para desglosar</p>'}
        ${chart}
      </div>
      ${gotoId ? `
      <div class="kpi-detail-panel__footer">
        <button type="button" class="chip" data-goto-detail="${esc(gotoId)}">Ver tabla completa
          <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">arrow_downward</span>
        </button>
      </div>` : ''}
    `;
    panel.classList.remove('hidden');
    panel.querySelector('[data-close-detail]')?.addEventListener('click', closeKpiDetail);
    panel.querySelector('[data-goto-detail]')?.addEventListener('click', (e) => {
      gotoSection(e.currentTarget.dataset.gotoDetail);
    });

    if (detail.chart && detail.chart.labels?.length) {
      const palette = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#e11d48', '#0f766e'];
      createChart(detail.chart.canvasId || 'chartKpiDetail', detail.chart.canvasId || 'chartKpiDetail', {
        type: 'doughnut',
        data: {
          labels: detail.chart.labels,
          datasets: [{
            data: detail.chart.values,
            backgroundColor: detail.chart.labels.map((_, i) => palette[i % palette.length]),
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const v = Number(ctx.raw || 0);
                  return ` ${ctx.label}: ${money(v)}`;
                },
              },
            },
          },
        },
      });
    }

    openKpiKey = key;
    sourceEl?.classList.add('is-open');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openClientKpiByKey(kpi, gotoId) {
    if (!currentClientData) return;
    const detail = buildClientKpiDetail(kpi, currentClientData);
    const source = document.querySelector(`.client-360-stat[data-open-kpi="${kpi}"]`)
      || document.querySelector(`.kpi-card--clickable[data-kpi="${kpi}"]`);
    fillKpiDetailPanel('clientKpiDetail', kpi, detail, gotoId, source);
  }

  function renderKpiDetail(card) {
    const kpi = card.dataset.kpi;
    const isCierre = kpi.startsWith('cierre');
    const panelId = isCierre ? 'cierresKpiDetail' : 'clientKpiDetail';
    const detail = isCierre
      ? (currentCierresData ? buildCierresKpiDetail(kpi, currentCierresData) : null)
      : (currentClientData ? buildClientKpiDetail(kpi, currentClientData) : null);
    fillKpiDetailPanel(panelId, kpi, detail, card.dataset.goto || null, card);
  }

  document.querySelectorAll('.kpi-card--clickable[data-kpi]').forEach((card) => {
    card.addEventListener('click', () => renderKpiDetail(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        renderKpiDetail(card);
      }
    });
  });

  document.querySelectorAll('[data-vend-kpi]').forEach((card) => {
    card.addEventListener('click', () => renderVendComercialDetail(card.dataset.vendKpi));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        renderVendComercialDetail(card.dataset.vendKpi);
      }
    });
  });

  el('btnBuscar').addEventListener('click', buscar);
  el('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') buscar();
  });

  document.querySelectorAll('[data-vista]').forEach((btn) => {
    btn.addEventListener('click', () => setVista(btn.dataset.vista));
  });
  el('btnVendedor')?.addEventListener('click', cargarVendedorResumen);
  el('vendedorInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') cargarVendedorResumen();
  });

  el('btnPeriodoOrdenes').addEventListener('click', () => {
    setActivePeriodChip(null);
    if (currentVista === 'vendedor') cargarVendedorResumen();
    else cargarCierresPeriodo();
  });

  function setActivePeriodChip(preset) {
    document.querySelectorAll('[data-periodo]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.periodo === preset);
    });
  }

  document.querySelectorAll('[data-periodo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.periodo;
      setActivePeriodChip(preset);
      if (preset === 'todo') {
        el('fechaInicioOrdenes').value = '';
        el('fechaFinOrdenes').value = '';
        setText('periodLabel', 'Todo el histórico');
        el('cierresPanel').classList.add('hidden');
        if (currentVista === 'vendedor') {
          if (el('vendedorInput')?.value.trim()) cargarVendedorResumen();
          else setStatus('Periodo: todo el histórico. Elige un vendedor.');
          return;
        }
        if (currentIdContacto) openClient(currentIdContacto);
        else setStatus('Periodo limpiado. Define fechas o busca un cliente.');
        return;
      }
      const [start, end] = window.Dashboard.getDatePresetRange(preset);
      el('fechaInicioOrdenes').value = window.Dashboard.formatDateInput(start);
      el('fechaFinOrdenes').value = window.Dashboard.formatDateInput(end);
      if (currentVista === 'vendedor') cargarVendedorResumen();
      else cargarCierresPeriodo();
    });
  });

  ['fechaInicioOrdenes', 'fechaFinOrdenes'].forEach((id) => {
    el(id).addEventListener('change', () => setActivePeriodChip(null));
  });

  const params = new URLSearchParams(location.search);
  const initialId = params.get('id');
  const initialQ = params.get('q');
  const initialVendedor = params.get('vendedor');
  const hasUrlPeriod = Boolean(params.get('fechaInicio') && params.get('fechaFin'));

  if (hasUrlPeriod) {
    el('fechaInicioOrdenes').value = params.get('fechaInicio');
    el('fechaFinOrdenes').value = params.get('fechaFin');
    setActivePeriodChip(null);
  } else {
    const [start, end] = window.Dashboard.getDatePresetRange('mes-actual');
    el('fechaInicioOrdenes').value = window.Dashboard.formatDateInput(start);
    el('fechaFinOrdenes').value = window.Dashboard.formatDateInput(end);
    setActivePeriodChip('mes-actual');
  }

  if (initialVendedor) {
    if (el('vendedorInput')) el('vendedorInput').value = initialVendedor;
    setVista('vendedor');
  } else if (hasUrlPeriod && !initialId && !initialQ) {
    cargarCierresPeriodo();
  } else if (!hasUrlPeriod && !initialId && !initialQ) {
    // Por defecto: mes en curso
    cargarCierresPeriodo();
  } else if (initialId) {
    openClient(initialId);
  } else if (initialQ) {
    el('searchInput').value = initialQ;
    buscar();
  }

  loadCrmStatus();
})();
