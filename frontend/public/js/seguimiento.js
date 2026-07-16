(function () {
  const { api, showLoading, setText, chartOptions, chartPalette, chartColors } = window.Dashboard;

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
  let openKpiKey = null;
  const charts = {};

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
    badge.className = 'top-bar-meta';
    if (type === 'loading') badge.classList.add('status-loading');
    else if (type === 'error') badge.classList.add('status-error');
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
      el('cierresPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      showLoading(false);
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

    const porTipo = countBy(ordenes, (o) => o.tipoServicio || o.tipoOrden || o.status);
    const panelTipo = el('panelChartOrdenesTipo');
    if (panelTipo) panelTipo.classList.toggle('hidden', !porTipo.length);
    createChart('ordenesTipo', 'chartOrdenesTipo', {
      type: 'doughnut',
      data: {
        labels: porTipo.length ? porTipo.map((r) => r.label) : ['Sin órdenes'],
        datasets: [{
          data: porTipo.length ? porTipo.map((r) => r.value) : [1],
          backgroundColor: porTipo.length ? chartPalette : ['#DDE3EC'],
          borderWidth: 0,
        }],
      },
      options: chartOptions({
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
      }),
    });

  }

  function renderClient(h) {
    currentClientData = h;
    closeKpiDetail();
    el('emptyState').classList.add('hidden');
    el('clientPanel').classList.remove('hidden');

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
    setText('kCompras', h.resumen?.totalCompras ?? 0);
    setText('kUnidadesDistribuidor', h.resumen?.totalUnidadesDistribuidor ?? 0);
    setText('kSolicitudes', h.resumen?.totalSolicitudes ?? 0);
    setText('kPruebasManejo', h.resumen?.totalPruebasManejo ?? 0);
    setText('kOrdenes', (h.ordenesServicio || []).length);
    setText('kImporteTaller', money(h.resumen?.importeTaller || 0));
    const periodo = h.periodoOrdenes || {};
    const periodText = periodo.fechaInicio || periodo.fechaFin
      ? `${periodo.fechaInicio || 'Inicio'} — ${periodo.fechaFin || 'Hoy'}`
      : 'Todo el histórico';
    setText(
      'kImporteTallerSub',
      `${periodText} · facturado ${money(h.resumen?.importeFacturadoTaller || 0)} · abierto ${money(h.resumen?.importeAbiertoTaller || 0)}`
    );

    renderClientCharts(h);

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
        <td>${dash(c.serieSql)}</td>
        <td>${dash(c.producto)}</td>
        <td>${dash(c.modeloSql)}</td>
        <td>${dash(c.numFactura)}</td>
        <td>${dash(c.facturaVentaSql)}</td>
        <td>${dash(c.fechaFactura)}</td>
        <td>${dash(c.vendedor)}</td>
        <td class="cell-num">${Number(c.totalOrdenes || 0)}</td>
      </tr>`).join('')
      : '<tr><td colspan="9" style="text-align:center;color:#94a3b8">Sin compras registradas (sin VIN en ciclos)</td></tr>';

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
        <td>${dash(o.status)}</td>
        <td>${dash(o.asesor)}</td>
        <td>${dash(o.facturaTaller)}</td>
        <td class="cell-money">${o.importe ? money(o.importe) : '—'}</td>
      </tr>`).join('')
      : `<tr><td colspan="9" style="text-align:center;color:#94a3b8">${h.sqlError ? 'SQL no disponible: ' + esc(h.sqlError) : 'Sin órdenes de servicio para los VIN del cliente'}</td></tr>`;

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

    const solicitudes = h.solicitudes || [];
    setText('solicitudesCount', `${solicitudes.length} solicitud(es)`);
    el('solicitudesTable').innerHTML = solicitudes.length ? solicitudes.map((s) => `
      <tr>
        <td>${dash(s.fecha_solicitud)}</td>
        <td>${dash(s.no_solicitud)}</td>
        <td>${dash(s.financiera)}</td>
        <td>${dash(s.unidad_paquete)}</td>
        <td>${s.estatus ? badge(s.estatus, String(s.estatus).toUpperCase().startsWith('APROBADA') ? 'badge-running' : 'badge-maintenance') : '—'}</td>
        <td>${dash(s.asesor)}</td>
        <td>${dash(s.fi)}</td>
        <td>${dash(s.fecha_aprobacion)}</td>
        <td>${dash(s.fecha_compra)}</td>
        <td class="cell-money">${s.enganche ? money(s.enganche) : '—'}</td>
      </tr>`).join('')
      : '<tr><td colspan="10" style="text-align:center;color:#94a3b8">Sin solicitudes de crédito registradas</td></tr>';

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

    const timeline = (h.timeline || []).slice().reverse();
    setText('timelineCount', `${timeline.length} actividad(es)${h.timelineTruncado ? ' (recientes)' : ''}`);
    el('timelineList').innerHTML = timeline.length ? timeline.map((t) => `
      <div style="display:flex;gap:12px;padding:10px 4px;border-bottom:1px solid rgba(148,163,184,0.15)">
        <div style="min-width:92px;color:#64748b;font-size:12px;font-weight:700">${dash(t.fecha)}</div>
        <div style="flex:1">
          <div style="font-weight:600;color:#1e293b;font-size:13px">${dash(t.tipo)}</div>
          <div style="color:#64748b;font-size:12px">
            ${t.resultado ? esc(t.resultado) : ''}
            ${t.estatusCiclo ? ` · Ciclo: ${esc(t.estatusCiclo)}` : ''}
            ${t.vin ? ` · VIN: ${esc(t.vin)}` : ''}
          </div>
        </div>
      </div>`).join('')
      : '<p style="color:#94a3b8;text-align:center">Sin actividades</p>';
  }

  function gotoSection(targetId) {
    const target = el(targetId);
    if (!target || target.closest('.hidden')) return;
    const panel = target.classList.contains('section-panel')
      ? target
      : (target.closest('.section-panel') || target);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.remove('section-flash');
    // Reinicia la animación si se hace clic dos veces en el mismo KPI
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
    const timeline = h.timeline || [];
    const r = h.resumen || {};
    const num = (v) => Number(v || 0).toLocaleString('es-MX');

    switch (kpi) {
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
        return {
          title: 'Ciclos de venta',
          value: num(r.totalCiclos ?? 0),
          sections: [
            { titulo: 'Resumen', rows: [
              { label: 'Ciclos en CRM', value: num(r.totalCiclos ?? 0) },
              { label: 'Actividades registradas', value: num(timeline.length) },
              { label: 'Primera actividad', value: r.primeraActividad || '—' },
              { label: 'Última actividad', value: r.ultimaActividad || '—' },
            ] },
            { titulo: 'Por estatus de ciclo', rows: estatus.map((x) => ({ label: x.label, value: num(x.value) })) },
            { titulo: 'Actividades por tipo', rows: topN(countBy(timeline, (t) => t.tipo)).map((x) => ({ label: x.label, value: num(x.value) })) },
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
    ['clientKpiDetail', 'cierresKpiDetail'].forEach((id) => {
      const p = el(id);
      if (p) {
        p.classList.add('hidden');
        p.innerHTML = '';
      }
    });
    document.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
  }

  function renderKpiDetail(card) {
    const kpi = card.dataset.kpi;
    const isCierre = kpi.startsWith('cierre');
    const panelId = isCierre ? 'cierresKpiDetail' : 'clientKpiDetail';
    const key = `${panelId}:${kpi}`;

    if (openKpiKey === key) {
      closeKpiDetail();
      return;
    }
    closeKpiDetail();

    const detail = isCierre
      ? (currentCierresData ? buildCierresKpiDetail(kpi, currentCierresData) : null)
      : (currentClientData ? buildClientKpiDetail(kpi, currentClientData) : null);
    const panel = el(panelId);
    if (!detail || !panel) return;

    const sectionsHtml = (detail.sections || [])
      .filter((s) => (s.rows || []).length)
      .map((s) => `
        <div class="kpi-detail-group">
          <h5>${esc(s.titulo)}</h5>
          ${s.rows.map((row) => `
            <div class="kpi-detail-row">
              <span class="lbl" title="${esc(row.label)}">${esc(row.label)}</span>
              <span class="val">${esc(row.value)}</span>
            </div>`).join('')}
        </div>`).join('');

    const gotoId = card.dataset.goto;
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

    openKpiKey = key;
    card.classList.add('is-open');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  el('btnBuscar').addEventListener('click', buscar);
  el('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') buscar();
  });

  el('btnPeriodoOrdenes').addEventListener('click', () => {
    setActivePeriodChip(null);
    cargarCierresPeriodo();
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
        if (currentIdContacto) openClient(currentIdContacto);
        else setStatus('Periodo limpiado. Define fechas o busca un cliente.');
        return;
      }
      const [start, end] = window.Dashboard.getDatePresetRange(preset);
      el('fechaInicioOrdenes').value = window.Dashboard.formatDateInput(start);
      el('fechaFinOrdenes').value = window.Dashboard.formatDateInput(end);
      cargarCierresPeriodo();
    });
  });

  ['fechaInicioOrdenes', 'fechaFinOrdenes'].forEach((id) => {
    el(id).addEventListener('change', () => setActivePeriodChip(null));
  });

  const params = new URLSearchParams(location.search);
  const initialId = params.get('id');
  const initialQ = params.get('q');
  el('fechaInicioOrdenes').value = params.get('fechaInicio') || '';
  el('fechaFinOrdenes').value = params.get('fechaFin') || '';

  if (params.get('fechaInicio') && params.get('fechaFin') && !initialId && !initialQ) {
    cargarCierresPeriodo();
  } else if (initialId) {
    openClient(initialId);
  } else if (initialQ) {
    el('searchInput').value = initialQ;
    buscar();
  }

  loadCrmStatus();
})();
