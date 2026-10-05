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
  let client360Drawer = null;
  let client360Backdrop = null;
  let client360DrawerExpanded = false;
  let client360LastSource = null;

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

  function refreshEmptyStateCopy() {
    const lead = el('emptyStateLead');
    const root = el('emptyState');
    if (!root) return;
    root.querySelectorAll('[data-empty-mode]').forEach((card) => {
      card.classList.toggle('is-active', card.getAttribute('data-empty-mode') === currentVista);
    });
    if (!lead) return;
    lead.textContent = currentVista === 'vendedor'
      ? 'Resumen del periodo abajo. Elige un vendedor para ver el acumulado de su cartera.'
      : 'Resumen del periodo abajo. Busca por ID CRM, nombre, VIN, teléfono o correo para abrir el 360.';
  }

  function renderEmptySummary(data) {
    const tot = data?.totales || {};
    const periodo = data?.periodo || {};
    const fi = periodo.fechaInicio || '';
    const ff = periodo.fechaFin || '';
    setText('emptySummaryPeriod', fi && ff ? `Periodo ${fi} — ${ff}` : 'Periodo seleccionado');
    setText('emptyKpiOrdenes', tot.ordenesCerradas ?? 0);
    setText('emptyKpiClientes', tot.clientes ?? 0);
    setText('emptyKpiCrm', tot.clientesConIdCrm ?? 0);
    setText('emptyKpiImporte', money(tot.importeTaller || 0));
    const conCrm = Number(tot.clientesConIdCrm || 0);
    const clientes = Number(tot.clientes || 0);
    const completos = Number(tot.clientesCompletos || 0);
    const note = clientes
      ? `${clientes} cliente(s) con cierre de taller · ${conCrm} con ID CRM listos para abrir 360${completos ? ` · ${completos} con unidad comprada y datos completos` : ''}.`
      : 'Sin cierres de taller en este periodo. Ajusta las fechas o busca un cliente.';
    setText('emptySummaryNote', note);
    setText('emptyKpiCrmPct', clientes ? `${Math.round((conCrm / clientes) * 100)}% del total` : '');
    el('emptySummary')?.setAttribute('aria-busy', 'false');
    renderEmptyCharts(data);
    renderEmptyQuick(data);
    // Misma alerta de «cierres sin ID CRM», anclada a la tarjeta del inicio.
    window.KpiSection.alert('seguimiento', {
      vista: 'cierres',
      anchorCrm: 'emptyCardCrm',
      fechaInicio: fi || null,
      fechaFin: ff || null,
      totales: tot,
    });
  }

  function renderEmptyCharts(data) {
    const clientes = data?.clientes || [];
    const tot = data?.totales || {};
    const top = clientes.filter((c) => Number(c.importe) > 0).slice(0, 6);
    const P = window.KpiSection.palette;
    window.KpiSection.chart('emptyTop', el('chartEmptyTop'), {
      type: 'hbar',
      unit: '$',
      labels: top.map((c) => {
        const name = String(c.cliente || 'Sin nombre').trim();
        return name.length > 20 ? `${name.slice(0, 18)}…` : name;
      }),
      values: top.map((c) => Math.round(Number(c.importe || 0))),
      colors: top.map((c) => (c.idCrm ? P.primary : P.muted)),
      clickable: (i) => Boolean(top[i]?.idCrm),
      onClick: (i) => openClient(top[i].idCrm),
    });
    const total = Number(tot.clientes || 0);
    const conCrm = Number(tot.clientesConIdCrm || 0);
    window.KpiSection.chart('emptyCrm', el('chartEmptyCrm'), {
      type: 'doughnut',
      labels: ['Con ID CRM', 'Sin ID CRM'],
      values: total ? [conCrm, Math.max(total - conCrm, 0)] : [0, 1],
      colors: total ? [P.success, P.muted] : ['#e2e8f0', '#e2e8f0'],
    });
  }

  function renderEmptyQuick(data) {
    const root = el('emptyQuick');
    const list = el('emptyQuickList');
    if (!root || !list) return;
    // Prioridad: expediente completo (unidad comprada en CRM + teléfono + actividad),
    // luego puntaje de calidad y por último importe de taller.
    const candidatos = (data?.clientes || []).filter((c) => c.idCrm);
    const completos = candidatos.filter((c) => c.calidad?.completo);
    const rows = (completos.length >= 3 ? completos : candidatos)
      .slice()
      .sort((a, b) => (
        Number(Boolean(b.calidad?.completo)) - Number(Boolean(a.calidad?.completo))
        || Number(b.calidad?.score || 0) - Number(a.calidad?.score || 0)
        || Number(b.importe || 0) - Number(a.importe || 0)
      ))
      .slice(0, 5);
    root.classList.toggle('hidden', !rows.length);
    const sub = root.querySelector('.vista360-empty__quick-sub');
    if (sub) {
      sub.textContent = completos.length
        ? `${completos.length} cliente(s) del periodo con expediente completo: unidad comprada en CRM, teléfono y actividad registrada.`
        : 'Clientes del periodo con ID CRM, por mayor importe de taller.';
    }
    list.innerHTML = rows.map((c) => {
      const q = c.calidad || {};
      const partes = [];
      if (q.compras) partes.push(`${q.compras} unidad(es) comprada(s)`);
      partes.push(`${Number(c.ordenes || 0)} orden(es)`);
      partes.push(money(c.importe || 0));
      const chip = '<span class="chip">Ver 360</span>';
      return `
      <li>
        <button type="button" class="vista360-empty__quick-item${q.completo ? ' is-complete' : ''}" data-open-quick="${esc(c.idCrm)}" title="Abrir expediente 360">
          <span class="vista360-empty__quick-name">${dash(c.cliente)}</span>
          <span class="vista360-empty__quick-meta">${partes.join(' · ')}</span>
          ${chip}
        </button>
      </li>`;
    }).join('');
    list.querySelectorAll('[data-open-quick]').forEach((btn) => {
      btn.addEventListener('click', () => openClient(btn.dataset.openQuick));
    });
  }

  /* ───────── P-VTA-4 · Tiempo de maduración comercial (inicio sin expediente) ───────── */

  let currentMaduracionData = null;
  const ORIGEN_LABEL = { cartera: 'Cartera', lead: 'Lead', sin_clasificar: 'Sin clasificar' };
  const dias = (v) => (v == null ? '—' : `${Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })} d`);
  const mesCorto = (ym) => {
    const [y, m] = String(ym || '').split('-');
    const nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return m ? `${nombres[Number(m) - 1] || m} ${String(y).slice(2)}` : ym;
  };

  function resetMaduracionLoading(texto = 'Cargando maduración…') {
    el('emptyMaduracion')?.setAttribute('aria-busy', 'true');
    ['kMaduracionValor', 'kMaduracionOrigenValor', 'kCoberturaValor', 'kProspectosMadurosValor'].forEach((id) => setText(id, '…'));
    ['kMaduracionSub', 'kMaduracionOrigenSub', 'kCoberturaSub', 'kProspectosMadurosSub', 'emptyMadPeriodo'].forEach((id) => setText(id, ''));
    setText('emptyMadNota', texto);
  }

  async function loadEmptyMaduracion() {
    const root = el('emptyMaduracion');
    if (!root || el('emptyState')?.classList.contains('hidden')) return;
    const { fechaInicio, fechaFin } = getPeriod();
    if (!fechaInicio || !fechaFin) {
      resetMaduracionLoading('Selecciona fechas para medir la maduración del periodo.');
      root.setAttribute('aria-busy', 'false');
      return;
    }
    resetMaduracionLoading();
    try {
      const data = await api(
        `/seguimiento-360/maduracion?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`
      );
      currentMaduracionData = data;
      if (!el('emptyState')?.classList.contains('hidden')) renderMaduracion(data);
    } catch (err) {
      setText('emptyMadNota', err.message || 'No se pudo calcular la maduración.');
      ['kMaduracionValor', 'kMaduracionOrigenValor', 'kCoberturaValor', 'kProspectosMadurosValor'].forEach((id) => setText(id, '—'));
      root.setAttribute('aria-busy', 'false');
    }
  }

  function renderMaduracion(data) {
    const g = data.general || {};
    const o = data.origenes || {};
    const cob = data.cobertura || {};
    const per = data.periodo || {};
    const zona = data.zonaMaduracion || {};
    setText('emptyMadPeriodo', per.fechaInicio && per.fechaFin ? `Ventas facturadas ${per.fechaInicio} — ${per.fechaFin}` : '');

    // Tarjeta 1: días de maduración = promedio de los últimos 12 meses.
    const cardMad = el('kMaduracion');
    const anio = data.anual || {};
    setText('kMaduracionValor', anio.n ? dias(anio.promedio) : '—');
    setText('kMaduracionSub', anio.n
      ? `promedio últimos 12 meses · mediana ${dias(anio.mediana)} · ${Number(anio.n).toLocaleString('es-MX')} ventas`
      : 'Sin ventas medidas en los últimos 12 meses');
    cardMad?.classList.toggle('vista360-empty__kpi--muted', !anio.n);

    // Tarjeta 2: cartera vs lead.
    const cart = o.cartera || {};
    const lead = o.lead || {};
    const sinC = o.sin_clasificar || {};
    setText('kMaduracionOrigenValor', (cart.n || lead.n)
      ? `${cart.n ? dias(cart.promedio) : '—'} / ${lead.n ? dias(lead.promedio) : '—'}`
      : '—');
    setText('kMaduracionOrigenSub', g.n
      ? `mezcla ${Math.round(cart.mezclaPct || 0)}% cartera · ${Math.round(lead.mezclaPct || 0)}% lead · ${Math.round(sinC.mezclaPct || 0)}% sin clasificar`
      : 'Cartera = compra previa · Lead = entró por STREGA');

    // Tarjeta 3: cobertura del objetivo.
    const cardCob = el('kCobertura');
    let cobValor = '—';
    let cobSub = '';
    if (cob.periodoCerrado) {
      cobValor = cob.objetivo != null ? `${cob.facturadas} / ${cob.objetivo}` : `${cob.facturadas || 0}`;
      cobSub = cob.objetivo != null
        ? `periodo cerrado · ${Math.round((Number(cob.facturadas || 0) / Number(cob.objetivo)) * 100)}% del objetivo facturado`
        : 'periodo cerrado · sin objetivo retail capturado en Ventas';
    } else if (cob.objetivo == null) {
      cobValor = `≈${cob.esperadas ?? 0}`;
      cobSub = `ventas esperadas en ${cob.horizonteDias} días · captura el objetivo retail en Ventas para medir cobertura`;
    } else if (Number(cob.faltante) === 0) {
      cobValor = '100%';
      cobSub = `objetivo ${cob.objetivo} ya cubierto con ${cob.facturadas} facturadas`;
    } else {
      cobValor = cob.pct != null ? `${Number(cob.pct).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%` : '—';
      cobSub = `≈${cob.esperadas} esperadas vs ${cob.faltante} que faltan · ${cob.horizonteDias} días restantes`;
    }
    setText('kCoberturaValor', cobValor);
    setText('kCoberturaSub', cobSub);
    cardCob?.classList.toggle('vista360-empty__kpi--muted', !cob.aplica);

    // Tarjeta 4: prospectos activos.
    setText('kProspectosMadurosValor', Number(cob.prospectosActivos || 0).toLocaleString('es-MX'));
    setText('kProspectosMadurosSub', zona.desde != null
      ? `${Number(cob.prospectosMaduros || 0).toLocaleString('es-MX')} con ${zona.desde}+ días (zona ${zona.desde}–${zona.hasta} d)`
      : 'ciclos en cartera activa con actividad en 180 días');

    renderMaduracionCharts(data);

    const ex = data.excluidas || {};
    const datos = data.datos || {};
    const partes = [];
    if (g.n) partes.push(`${g.n} venta(s) medidas`);
    if (ex.total) partes.push(`${ex.total} excluida(s): ${Object.entries(ex.motivos || {}).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    if (data.movil3?.n) partes.push(`móvil 3 meses ${dias(data.movil3.promedio)} vs histórico ${dias(data.historico?.promedio)}`);
    if (datos.ciclosEnVivo && datos.ciclosEnVivoSync) {
      const sync = String(datos.ciclosEnVivoSync).replace('T', ' ').slice(0, 16);
      partes.push(`ciclos en vivo al ${sync} (se actualizan una vez al día)`);
    }
    if (datos.ultimoCicloAbierto) partes.push(`ciclos abiertos hasta ${datos.ultimoCicloAbierto}`);
    if (datos.ultimaFactura) partes.push(`última factura CRM ${datos.ultimaFactura}`);
    setText('emptyMadNota', partes.length ? `${partes.join(' · ')}.` : 'Sin datos de maduración para este periodo.');
    el('emptyMaduracion')?.setAttribute('aria-busy', 'false');

    const serie = data.serie || [];
    const previos = serie.slice(0, -1).filter((m) => m.mezclaCarteraPct != null).slice(-3);
    const mezclaPrevia = previos.length
      ? previos.reduce((s, m) => s + Number(m.mezclaCarteraPct), 0) / previos.length
      : null;
    window.KpiSection.alert('seguimiento', {
      vista: 'maduracion',
      fechaInicio: per.fechaInicio || null,
      fechaFin: per.fechaFin || null,
      general: g,
      origenes: o,
      movil3: data.movil3 || null,
      historico: data.historico || null,
      cobertura: cob,
      mezclaCarteraPrevia: mezclaPrevia,
    });
  }

  function renderMaduracionCharts(data) {
    const P = window.KpiSection.palette;
    const serie = data.serie || [];
    const lineOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y == null ? '—' : `${ctx.parsed.y} d`}`,
            afterBody: (items) => {
              const m = serie[items[0]?.dataIndex];
              return m ? [`Ventas medidas: ${m.ventas}`, m.mezclaCarteraPct != null ? `Cartera: ${m.mezclaCarteraPct}%` : ''] : [];
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.2)' }, ticks: { font: { size: 11 }, callback: (v) => `${v} d` } },
      },
    };
    createChart('madSerie', 'chartMadSerie', {
      type: 'line',
      data: {
        labels: serie.map((m) => mesCorto(m.mes)),
        datasets: [
          { label: 'General', data: serie.map((m) => m.general?.promedio ?? null), borderColor: P.navy, backgroundColor: P.navy, tension: .3, pointRadius: 3, borderWidth: 2, spanGaps: true },
          { label: 'Cartera', data: serie.map((m) => m.cartera?.promedio ?? null), borderColor: P.success, backgroundColor: P.success, tension: .3, pointRadius: 2, borderWidth: 1.5, borderDash: [4, 3], spanGaps: true },
          { label: 'Lead', data: serie.map((m) => m.lead?.promedio ?? null), borderColor: P.primary, backgroundColor: P.primary, tension: .3, pointRadius: 2, borderWidth: 1.5, borderDash: [4, 3], spanGaps: true },
        ],
      },
      options: lineOpts,
    });

    const edades = data.activosPorEdad || [];
    const zona = data.zonaMaduracion || {};
    const caption = el('chartMadEdadCaption');
    if (caption) {
      caption.textContent = zona.desde != null
        ? `Prospectos activos por edad · zona de maduración ${zona.desde}–${zona.hasta} d`
        : 'Prospectos activos por edad';
    }
    window.KpiSection.chart('madEdad', el('chartMadEdad'), {
      type: 'bar',
      labels: edades.map((b) => b.label),
      values: edades.map((b) => b.n),
      colors: edades.map((b) => (b.enZona ? P.warn : P.sky)),
    });

    const cob = data.cobertura || {};
    const objetivo = Number(cob.objetivo || 0);
    const facturadas = Number(cob.facturadas || 0);
    const esperadas = cob.periodoCerrado ? 0 : Number(cob.esperadas || 0);
    const barOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      indexAxis: 'y',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.x || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 })} u` } },
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: 'rgba(148,163,184,.2)' }, ticks: { font: { size: 11 } } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    };
    createChart('madObjetivo', 'chartMadObjetivo', {
      type: 'bar',
      data: {
        labels: ['Objetivo', 'Pipeline'],
        datasets: [
          { label: 'Objetivo retail', data: [objetivo || null, null], backgroundColor: P.muted, borderRadius: 6, maxBarThickness: 26 },
          { label: 'Facturadas (CRM)', data: [null, facturadas], backgroundColor: P.success, borderRadius: 6, maxBarThickness: 26 },
          { label: 'Esperadas del pipeline', data: [null, esperadas], backgroundColor: P.warn, borderRadius: 6, maxBarThickness: 26 },
        ],
      },
      options: barOpts,
    });
  }

  function buildMaduracionKpiDetail(kpi, data) {
    const g = data.general || {};
    const o = data.origenes || {};
    const cob = data.cobertura || {};
    const num = (v) => Number(v || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 });
    const origenChip = (origen) => ORIGEN_LABEL[origen] || origen || '—';
    const filaVenta = (v) => ({
      label: `${v.nombre || v.idContacto} · ${v.producto || 'unidad'}`,
      value: dias(v.dias),
      detail: [
        `Llegó ${v.llegada} (${v.llegadaFuente || 'ciclo'})`,
        `facturó ${v.fechaFactura}`,
        origenChip(v.origen),
        v.canal ? `canal ${v.canal}` : null,
        v.ciclosHastaCerrar > 1 ? `${v.ciclosHastaCerrar} ciclos hasta cerrar` : null,
        v.vendedor ? `ejecutivo ${v.vendedor}` : null,
      ].filter(Boolean).join(' · '),
    });

    switch (kpi) {
      case 'maduracion': {
        const ventas = (data.ventas || []).slice().sort((a, b) => Number(b.dias) - Number(a.dias));
        const anio = data.anual || {};
        return {
          title: 'Días de maduración · P-VTA-4',
          value: anio.n ? dias(anio.promedio) : '—',
          sections: [
            { titulo: 'Promedio del año (últimos 12 meses)', rows: [
              { label: 'Promedio', value: dias(anio.promedio) },
              { label: 'Mediana', value: dias(anio.mediana) },
              { label: 'Percentil 75', value: dias(anio.p75) },
              { label: 'Ventas medidas', value: num(anio.n) },
            ] },
            { titulo: 'Resumen del periodo', rows: [
              { label: 'Promedio', value: dias(g.promedio) },
              { label: 'Mediana', value: dias(g.mediana) },
              { label: 'Percentil 75', value: dias(g.p75) },
              { label: 'Mínimo · máximo', value: `${dias(g.min)} · ${dias(g.max)}` },
              { label: 'Ventas medidas', value: num(g.n) },
              { label: 'Excluidas', value: num(data.excluidas?.total), detail: Object.entries(data.excluidas?.motivos || {}).map(([k, v]) => `${v} ${k}`).join(', ') || undefined },
            ] },
            { titulo: 'Tendencia', rows: [
              { label: 'Promedio móvil 3 meses', value: dias(data.movil3?.promedio), detail: `${num(data.movil3?.n)} ventas` },
              { label: 'Histórico (9 meses previos)', value: dias(data.historico?.promedio), detail: `${num(data.historico?.n)} ventas` },
              { label: 'Rango intercuartil 12 meses', value: data.anual?.p25 != null ? `${data.anual.p25}–${data.anual.p75} d` : '—', detail: 'Zona de maduración: donde cierra la mitad central de las ventas.' },
            ] },
            { titulo: 'Ventas más lentas del periodo', rows: ventas.slice(0, 10).map(filaVenta) },
            { titulo: 'Cómo se mide', rows: Object.values(data.metodologia || {}).slice(0, 3).map((t) => ({ label: t, value: '' })) },
          ],
        };
      }
      case 'origen': {
        const canales = data.leadsPorCanal || [];
        const filaOrigen = (key) => {
          const s = o[key] || {};
          return {
            label: ORIGEN_LABEL[key],
            value: s.n ? dias(s.promedio) : '—',
            detail: s.n
              ? `${num(s.n)} ventas · ${num(s.mezclaPct)}% de la mezcla · mediana ${dias(s.mediana)} · P75 ${dias(s.p75)}${s.ciclosHastaCerrar ? ` · ${num(s.ciclosHastaCerrar)} ciclos hasta cerrar` : ''}`
              : 'Sin ventas de este origen en el periodo',
          };
        };
        return {
          title: 'Maduración por origen',
          value: `${num(o.cartera?.mezclaPct)}% cartera · ${num(o.lead?.mezclaPct)}% lead`,
          sections: [
            { titulo: 'Por origen', rows: ['cartera', 'lead', 'sin_clasificar'].map(filaOrigen) },
            { titulo: 'Leads por canal de entrada', rows: canales.length
              ? canales.map((c) => ({ label: c.canal, value: dias(c.promedio), detail: `${num(c.n)} ventas · mediana ${dias(c.mediana)}` }))
              : [{ label: 'Sin ventas de lead en el periodo', value: '—' }] },
            { titulo: 'Ventas de cartera', rows: (data.ventas || []).filter((v) => v.origen === 'cartera').slice(0, 8).map(filaVenta) },
            { titulo: 'Criterio', rows: [{ label: data.metodologia?.origen || '', value: '' }] },
          ],
        };
      }
      case 'cobertura':
      case 'prospectos': {
        const prospectos = data.prospectos || [];
        const edades = data.activosPorEdad || [];
        const esCobertura = kpi === 'cobertura';
        return {
          title: esCobertura ? 'Cobertura del objetivo' : 'Prospectos activos',
          value: esCobertura
            ? (cob.aplica && cob.pct != null ? `${num(cob.pct)}%` : (cob.periodoCerrado ? 'Periodo cerrado' : 'Sin objetivo'))
            : num(cob.prospectosActivos),
          sections: [
            { titulo: 'Objetivo del periodo', rows: [
              { label: 'Objetivo retail (Ventas)', value: cob.objetivo != null ? num(cob.objetivo) : '—', detail: cob.objetivoFuente ? `fuente: ${cob.objetivoFuente === 'saved' ? 'capturado' : 'histórico'}` : 'Captura el objetivo retail del mes en Ventas para medir la cobertura.' },
              { label: 'Facturadas (ventas CRM)', value: num(cob.facturadas) },
              { label: 'Faltante', value: cob.faltante != null ? num(cob.faltante) : '—' },
              { label: 'Esperadas del pipeline', value: cob.periodoCerrado ? '—' : `≈${num(cob.esperadas)}`, detail: cob.periodoCerrado ? 'El periodo ya cerró: no hay días restantes para madurar.' : `en los ${cob.horizonteDias} días que faltan del periodo` },
              { label: 'Prospectos nuevos necesarios', value: cob.prospectosNecesarios ? `≈${num(cob.prospectosNecesarios)}` : '—', detail: 'Si el pipeline actual no alcanza, prospectos adicionales a la tasa promedio de conversión del pipeline.' },
            ] },
            { titulo: 'Prospectos activos por edad', rows: edades.map((b) => ({ label: b.label, value: num(b.n), badge: b.enZona ? 'zona de maduración' : undefined })) },
            { titulo: 'Prospectos con mayor probabilidad de cierre', rows: prospectos.slice(0, 15).map((p) => ({
              label: `${p.nombre || p.idContacto} · ${p.estatus || 'sin estatus'}`,
              value: cob.periodoCerrado ? `${num(p.edad)} d` : `${Math.round(Number(p.probabilidad || 0) * 100)}%`,
              detail: `${num(p.edad)} días desde ${p.llegada} · ${origenChip(p.origen)}${p.canal ? ` · ${p.canal}` : ''} · última actividad ${p.ultimaActividad || '—'}${p.vendedor ? ` · ${p.vendedor}` : ''}`,
            })) },
            { titulo: 'Curva histórica', rows: [{
              label: `Base: ${num(cob.curva?.compras)} compras y ${num(cob.curva?.perdidos)} prospectos perdidos con llegada entre ${cob.curva?.desde || '—'} y ${cob.curva?.hasta || '—'}.`,
              value: '',
              detail: data.metodologia?.cobertura,
            }] },
          ],
        };
      }
      default:
        return null;
    }
  }

  function openMaduracionKpi(card) {
    if (!currentMaduracionData) return;
    const kpi = card.dataset.madKpi;
    const detail = buildMaduracionKpiDetail(kpi, currentMaduracionData);
    fillKpiDetailPanel('maduracionKpiDetail', kpi, detail, null, card);
  }

  document.querySelectorAll('[data-mad-kpi]').forEach((card) => {
    card.addEventListener('click', () => openMaduracionKpi(card));
  });

  function resetEmptySummaryLoading() {
    el('emptySummary')?.setAttribute('aria-busy', 'true');
    setText('emptyKpiOrdenes', '…');
    setText('emptyKpiClientes', '…');
    setText('emptyKpiCrm', '…');
    setText('emptyKpiImporte', '…');
    setText('emptySummaryNote', 'Cargando resumen…');
  }

  async function loadEmptySummary() {
    const root = el('emptyState');
    if (!root || root.classList.contains('hidden')) return;
    const { fechaInicio, fechaFin } = getPeriod();
    if (!fechaInicio || !fechaFin) {
      setText('emptySummaryPeriod', 'Define un periodo arriba');
      setText('emptyKpiOrdenes', '—');
      setText('emptyKpiClientes', '—');
      setText('emptyKpiCrm', '—');
      setText('emptyKpiImporte', '—');
      setText('emptySummaryNote', 'Selecciona fechas para ver el resumen de cierres de taller.');
      el('emptySummary')?.setAttribute('aria-busy', 'false');
      loadEmptyMaduracion();
      return;
    }
    resetEmptySummaryLoading();
    setText('emptySummaryPeriod', `Periodo ${fechaInicio} — ${fechaFin}`);
    // P-VTA-4 se carga en paralelo; no bloquea el resumen de cierres.
    loadEmptyMaduracion();
    try {
      const data = await api(
        `/crm/cierres-taller?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}&limit=300`
      );
      currentCierresData = data;
      // Solo pintar si seguimos sin expediente abierto
      if (!el('emptyState')?.classList.contains('hidden')) {
        renderEmptySummary(data);
        setText('periodLabel', `${fechaInicio} — ${fechaFin}`);
        setStatus(
          `Resumen · ${data.totales?.clientes || 0} cliente(s) · ${data.totales?.ordenesCerradas || 0} órdenes`
        );
      }
    } catch (err) {
      setText('emptySummaryNote', err.message || 'No se pudo cargar el resumen');
      el('emptySummary')?.setAttribute('aria-busy', 'false');
      setStatus(err.message, 'error');
    }
  }

  function showEmptyState() {
    el('emptyState')?.classList.remove('hidden');
    el('cierresPanel')?.classList.add('hidden');
    el('clientPanel')?.classList.add('hidden');
    el('vendedorPanel')?.classList.add('hidden');
    refreshEmptyStateCopy();
    loadEmptySummary();
  }

  function setVista(vista) {
    currentVista = vista === 'vendedor' ? 'vendedor' : 'cliente';
    document.querySelectorAll('[data-vista]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.vista === currentVista);
    });
    el('vistaClienteWrap')?.classList.toggle('hidden', currentVista !== 'cliente');
    el('vistaVendedorWrap')?.classList.toggle('hidden', currentVista !== 'vendedor');
    refreshEmptyStateCopy();

    if (currentVista === 'vendedor') {
      el('cierresPanel')?.classList.add('hidden');
      el('searchResultsWrap')?.classList.add('hidden');
      el('clientPanel')?.classList.add('hidden');
      loadVendedoresCatalog().then(() => {
        if (el('vendedorInput')?.value.trim()) cargarVendedorResumen();
        else {
          el('vendedorPanel')?.classList.add('hidden');
          showEmptyState();
          setStatus('Elige un vendedor para ver el acumulado de su cartera');
        }
      });
    } else {
      el('vendedorPanel')?.classList.add('hidden');
      if (!currentIdContacto && !(el('searchResults')?.children?.length)) {
        showEmptyState();
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

  function dateMx(value) {
    if (!value) return '—';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : esc(value);
  }

  function etiquetaUnidad(unidad) {
    const modelo = String(unidad?.modelo || unidad?.ficha?.modeloActual || 'Unidad').trim();
    const anio = unidad?.anModelo || unidad?.ficha?.anModelo;
    const vin = unidad?.vin || unidad?.ficha?.vinActual || '';
    return [anio ? `${modelo} ${anio}` : modelo, vin].filter(Boolean).join(' · ');
  }

  // Postventa del EIP tomada de las series del expediente 360 (unidadesRadiografia).
  function renderPosventaEip(h, vinSeleccionado = null) {
    const opciones = h?.unidadesRadiografia || [];
    const elegida = vinSeleccionado
      ? opciones.find((u) => String(u.vin) === String(vinSeleccionado))
      : null;
    const unidad = elegida || opciones[0] || null;
    const f = unidad?.ficha || h?.ficha360 || null;
    if (!f) return '';
    const serie = f.vinActual || unidad?.vin || null;
    const serieNorm = String(serie || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ordenes = (h?.ordenesServicio || []).filter((o) => {
      if (String(o.status || '').trim().toUpperCase() === 'C') return false;
      if (!serieNorm) return true;
      const ordenSerie = String(o.serie || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return ordenSerie.includes(serieNorm) || serieNorm.includes(ordenSerie);
    });
    const importe = ordenes.reduce((sum, o) => sum + Number(o.importe || 0), 0);
    const selector = opciones.length > 1
      ? `<select id="eipPosventaUnidad" class="kpi-subtitle" style="margin-left:8px" aria-label="Serie para postventa">${opciones.map((u) => `
          <option value="${esc(u.vin)}"${String(u.vin) === String(unidad?.vin) ? ' selected' : ''}>${esc(etiquetaUnidad(u))}</option>`).join('')}</select>`
      : '';
    return `<article class="kpi-card kpi-card--blue" id="eipPosventaCard"><div class="kpi-card-head"><span class="kpi-title">Postventa de la serie</span>${selector}</div><p class="kpi-subtitle">${dash(f.modeloActual)}${serie ? ` · serie ${esc(serie)}` : ''} · ${Number(f.serviciosRealizados || 0)} servicio(s) · último ${dateMx(f.ultimaVisitaTaller)} · ${f.kilometraje != null ? `${Number(f.kilometraje).toLocaleString('es-MX')} km` : 'sin kilometraje'} · importe ${money(importe)} · ${Number(f.quejasPosventa || 0)} queja(s) CSI posventa</p></article>`;
  }

  async function cargarExpedienteProspecto(idContacto) {
    const body = el('htPro1Body');
    const nota = el('htPro1Nota');
    if (!body || !idContacto) return;
    body.innerHTML = '<p class="section-subtitle">Cargando expediente…</p>';
    try {
      const data = await api(`/seguimiento-360/expediente/${encodeURIComponent(idContacto)}`);
      const p = data.prospecto;
      const ciclos = data.ciclos || [];
      const activos = ciclos.filter((c) => c.enCarteraActiva);
      const vigentes = activos.filter((c) => c.gestionVigente).length;
      if (nota) {
        nota.textContent = activos.length
          ? `Cobertura de gestión de este prospecto: ${vigentes} de ${activos.length} ciclos activos con acción siguiente.`
          : 'Este contacto no tiene un ciclo en la cartera activa.';
      }
      const origen = p?.origen || null;
      const canalOrigen = origen?.canal || p?.canal || null;
      const campanaOrigen = origen?.campana || p?.campana || null;
      const cambioCanal = origen && p && (
        (origen.canal || '') !== (p.canal || '') || (origen.campana || '') !== (p.campana || '')
      );
      const origenHtml = p
        ? `<p class="kpi-subtitle" style="margin-top:6px"><strong>Origen:</strong> canal ${dash(canalOrigen)} · campaña ${dash(campanaOrigen)}${origen?.fechaEntrada && origen.fechaEntrada !== p.fechaEntrada ? ` · primer registro ${esc(origen.fechaEntrada)}` : ''}${cambioCanal ? `<br><small>Lead vigente por canal ${dash(p.canal)} · campaña ${dash(p.campana)}</small>` : ''}</p>`
        : '';
      const hoja = p
        ? `<article class="kpi-card kpi-card--blue"><div class="kpi-card-head"><span class="kpi-title">Hoja STREGA</span></div><p class="kpi-subtitle">Entrada ${dash(p.fechaEntrada)} · resultado ${dash(p.resultado)} · contacto BDC ${dash(p.contactoBdc)} · ejecutivo ${dash(p.ejecutivo)}</p>${origenHtml}</article>`
        : '<article class="kpi-card kpi-card--slate"><div class="kpi-card-head"><span class="kpi-title">Hoja STREGA</span></div><p class="kpi-subtitle">Sin lead de este ID.</p></article>';
      const cicloCards = ciclos.slice(0, 4).map((c) => `
        <article class="kpi-card kpi-card--${c.gestionVigente ? 'green' : 'amber'}">
          <div class="kpi-card-head"><span class="kpi-title">${esc(c.estatus || 'Sin estatus')}</span></div>
          <p class="kpi-subtitle">${c.gestionVigente ? 'Gestión vigente' : 'Sin acción siguiente'} · siguiente ${dash(c.accionSiguiente)} · ejecutivo ${dash(c.vendedor)}</p>
        </article>`).join('');
      const faltan = (data.faltantes || []).map((f) => `<li>${esc(f)}</li>`).join('');
      body.innerHTML = `${hoja}${cicloCards}${renderPosventaEip(currentClientData)}<article class="kpi-card kpi-card--slate"><div class="kpi-card-head"><span class="kpi-title">Aún no medible</span></div><ul class="kpi-subtitle" style="margin:8px 0 0;padding-left:18px">${faltan}</ul></article>`;
      const enlazarPosventa = () => {
        body.querySelector('#eipPosventaUnidad')?.addEventListener('change', (event) => {
          const card = body.querySelector('#eipPosventaCard');
          if (card) card.outerHTML = renderPosventaEip(currentClientData, event.target.value);
          enlazarPosventa();
        });
      };
      enlazarPosventa();
    } catch (err) {
      body.innerHTML = `<p class="section-subtitle">${esc(err.message)}</p>`;
    }
  }

  async function cargarCarteraEjecutivo(vendedor, fechaFin) {
    const body = el('htPro2Body');
    if (!body || !vendedor) return;
    setText('kHtPro2Cartera', '…');
    setText('kHtPro2Vigentes', '…');
    setText('kHtPro2Cobertura', '…');
    try {
      const qs = new URLSearchParams({ vendedor });
      if (fechaFin) qs.set('fechaFin', fechaFin);
      const data = await api(`/seguimiento-360/cartera?${qs.toString()}`);
      setText('kHtPro2Cartera', data.cartera ?? 0);
      setText('kHtPro2Vigentes', data.vigentes ?? 0);
      setText('kHtPro2Cobertura', data.coberturaPct == null ? '—' : `${Number(data.coberturaPct).toFixed(1)}%`);
      const nota = el('htPro2Nota');
      if (nota) {
        nota.textContent = `Corte ${data.corte}. ${data.sinGestion || 0} prospectos de la cartera no tienen acción siguiente. Meta 100 %.`;
      }
      const lista = data.lista || [];
      body.innerHTML = lista.length
        ? lista.map((row) => `
          <tr>
            <td>${dash(row.nombre)}</td>
            <td>${dash(row.estatus)}</td>
            <td>${dash(row.accionSiguiente)}</td>
            <td>${row.gestionVigente ? 'Vigente' : 'Pendiente'}</td>
            <td>${row.idContacto ? `<a href="/seguimiento.html?id=${encodeURIComponent(row.idContacto)}">Expediente</a>` : ''}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="5">Este ejecutivo no tiene ciclos en la cartera activa.</td></tr>';
    } catch (err) {
      setText('kHtPro2Cartera', '—');
      setText('kHtPro2Vigentes', '—');
      setText('kHtPro2Cobertura', '—');
      body.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(err.message)}</td></tr>`;
    }
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
    cargarCarteraEjecutivo(data.vendedor, periodo.fechaFin);
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

  function renderFicha360(h, vinSeleccionado = null) {
    const opciones = Array.isArray(h.unidadesRadiografia) ? h.unidadesRadiografia : [];
    const elegida = vinSeleccionado
      ? opciones.find((u) => String(u.vin) === String(vinSeleccionado))
      : null;
    const f = elegida?.ficha || h.ficha360 || {};
    h.fichaVista = f;
    const vehicle = el('ficha360Vehicle');
    const resumenUnidad = `
      <div>
        <strong>${dash(f.modeloActual)}</strong>
        <small>${[f.anModelo ? `Modelo ${esc(f.anModelo)}` : null, f.vinActual].filter(Boolean).map(esc).join(' · ') || 'Unidad sin identificar'}</small>
      </div>`;
    if (opciones.length > 1) {
      const vinActivo = elegida?.vin || f.vinActual || opciones[0].vin;
      vehicle.classList.add('client-360-vehicle--multi');
      vehicle.innerHTML = `
        <span class="material-symbols-outlined">directions_car</span>
        ${resumenUnidad}
        <span class="material-symbols-outlined client-360-vehicle__chevron" aria-hidden="true">unfold_more</span>
        <select id="ficha360Unidad" class="client-360-vehicle__select" aria-label="Cambiar unidad analizada" title="Cambiar unidad analizada (${opciones.length})">
          ${opciones.map((u) => `
            <option value="${esc(u.vin)}"${String(u.vin) === String(vinActivo) ? ' selected' : ''}>${esc(etiquetaUnidad(u))}</option>
          `).join('')}
        </select>`;
      vehicle.querySelector('#ficha360Unidad')?.addEventListener('change', (event) => {
        closeKpiDetail();
        renderFicha360(h, event.target.value);
      });
    } else {
      vehicle.classList.remove('client-360-vehicle--multi');
      vehicle.innerHTML = `
        <span class="material-symbols-outlined">directions_car</span>
        ${resumenUnidad}`;
    }

    // icon, label, value, tone, gotoId, openKpi
    const items = [
      ['event_available', 'Última compra', dateMx(f.fechaUltimaCompra), 'purchase', 'secCompras', 'compras'],
      ['description', 'Número de contrato', dash(f.numeroContrato), 'finance', 'secFinanciamiento', 'financiamiento'],
      ['verified_user', 'Seguro del auto', dash(f.seguroAuto), 'finance', 'secFinanciamiento', 'seguro'],
      ['credit_card', 'Tipo de compra', dash(f.tipoCompra), 'finance', 'secFinanciamiento', 'financiamiento'],
      ['payments', 'Mensualidad estimada',
        f.mensualidadEstimada != null
          ? money(f.mensualidadEstimada)
          : (f.mensualidadesPagadas != null
            ? `${Number(f.mensualidadesPagadas)} de ${Number(f.plazoContratado || 0)} meses`
            : (f.plazoContratado != null ? `${Number(f.plazoContratado)} meses` : '—')),
        'finance', 'secFinanciamiento', 'financiamiento',
        f.mensualidadEstimada != null && f.plazoContratado != null
          ? (f.mensualidadesPagadas != null
            ? `${Number(f.mensualidadesPagadas)} de ${Number(f.plazoContratado)} meses`
            : `Plazo ${Number(f.plazoContratado)} meses`)
          : null],
      ['account_balance_wallet', 'Saldo estimado', f.saldoEstimado != null ? money(f.saldoEstimado) : '—', 'finance', 'secFinanciamiento', 'financiamiento'],
      ['sell', 'Valor de referencia', f.valorEstimadoUnidad != null ? money(f.valorEstimadoUnidad) : '—', 'finance', 'secFinanciamiento', 'financiamiento'],
      ['build', 'Último servicio', dateMx(f.ultimaVisitaTaller), 'service', 'secOrdenes', 'ordenes'],
      ['speed', 'Kilometraje registrado', f.kilometraje != null ? `${Number(f.kilometraje).toLocaleString('es-MX')} km` : '—', 'service', 'secOrdenes', 'ordenes'],
      ['car_repair', 'Servicios realizados', Number(f.serviciosRealizados || 0).toLocaleString('es-MX'), 'service', 'secOrdenes', 'ordenes'],
      ['support_agent', 'Último contacto comercial', dateMx(f.ultimoContactoComercial), 'relation', 'secTimeline', 'ciclos'],
      ['devices', 'Interacciones digitales', Number(f.interaccionesDigitales || 0).toLocaleString('es-MX'), 'relation', 'secLeads', 'leads'],
      ['feedback', 'Quejas o incidencias', Number(f.quejasIncidencias || 0).toLocaleString('es-MX'), 'relation', 'secTimeline', 'quejas'],
      ['garage', 'Historial de compras', `${Number(f.historialCompras || 0)} vehículo(s)`, 'purchase', 'secCompras', 'compras'],
    ];
    el('ficha360Grid').innerHTML = items.map(([icon, label, value, tone, gotoId, openKpi, hint]) => `
      <button type="button" class="client-360-stat client-360-stat--${tone}" ${openKpi === 'quejas' ? 'id="kQuejas"' : (openKpi === 'seguro' ? 'id="kSeguroAuto"' : '')} data-goto="${esc(gotoId || '')}" data-open-kpi="${esc(openKpi)}" title="Ver desglose">
        <span class="material-symbols-outlined client-360-stat-icon">${icon}</span>
        <div><span>${label}</span><strong>${value}</strong>${hint ? `<small>${hint}</small>` : ''}</div>
      </button>`).join('');

    el('ficha360Grid').querySelectorAll('[data-open-kpi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openClientKpiByKey(btn.dataset.openKpi, btn.dataset.goto || null, btn);
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

  function renderTimeline360(events, active = null) {
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
      <button type="button" class="timeline-360-filter${active === key ? ' is-active' : ''}" data-timeline-filter="${key}" aria-pressed="${active === key ? 'true' : 'false'}">
        ${label}<span>${key === 'todos' ? list.length : list.filter((event) => event.categoria === key).length}</span>
      </button>`).join('');
    const filtered = !active
      ? []
      : (active === 'todos' ? list : list.filter((event) => event.categoria === active));
    setText('timeline360Count', active ? `${filtered.length} evento(s)` : '');
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
      </article>`).join('') : (
      active
        ? '<p class="timeline-360-empty">No hay eventos en esta categoría.</p>'
        : '<p class="timeline-360-empty">Elige una categoría para ver los eventos.</p>'
    );
    el('timeline360Filters').querySelectorAll('[data-timeline-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.timelineFilter;
        renderTimeline360(list, key === active ? null : key);
      });
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
    cargarExpedienteProspecto(h.idContacto);

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
      case 'financiamiento': {
        const f = h.fichaVista || h.ficha360 || {};
        const contratos = h.contratosFinanciamiento || [];
        return {
          title: 'Financiamiento y contrato',
          value: f.numeroContrato || f.tipoCompra || '—',
          sections: [
            { titulo: 'Radiografía', rows: [
              { label: 'Número de contrato', value: f.numeroContrato || '—' },
              { label: 'Tipo de compra', value: f.tipoCompra || '—' },
              { label: 'Mensualidad estimada', value: f.mensualidadEstimada != null ? money(f.mensualidadEstimada) : '—' },
              { label: 'Plazo y avance', value: f.mensualidadesPagadas != null ? `${Number(f.mensualidadesPagadas)} de ${Number(f.plazoContratado || 0)} meses` : (f.plazoContratado != null ? `${Number(f.plazoContratado)} meses` : '—') },
              { label: 'Saldo estimado', value: f.saldoEstimado != null ? money(f.saldoEstimado) : '—' },
              { label: 'Valor de referencia', value: f.valorEstimadoUnidad != null ? money(f.valorEstimadoUnidad) : '—' },
              { label: 'Seguro', value: f.seguroAuto || '—' },
              { label: 'Unidad', value: f.modeloActual || '—' },
            ] },
            { titulo: 'Contratos', rows: contratos.length
              ? contratos.map((c) => ({
                label: [c.no_contrato || c.contrato, c.unidad || c.vin].filter(Boolean).join(' · ') || 'Contrato',
                value: [c.financiera || c.tipo_compra, c.plazo != null ? `${c.plazo} m` : null].filter(Boolean).join(' · ') || '—',
                detail: [
                  c.aseguradora ? `Seguro: ${c.aseguradora}` : null,
                  c.saldo != null ? `Saldo: ${money(c.saldo)}` : null,
                ].filter(Boolean).join(' · ') || null,
              }))
              : [{ label: 'Sin contratos de financiamiento ligados por VIN', value: '—' }] },
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

  function ensureClient360Drawer() {
    if (client360Drawer && client360Backdrop) return client360Drawer;
    client360Backdrop = document.createElement('div');
    client360Backdrop.className = 'ops-orders-backdrop';
    client360Backdrop.addEventListener('click', closeKpiDetail);

    client360Drawer = document.createElement('aside');
    client360Drawer.className = 'ops-orders-drawer';
    client360Drawer.setAttribute('aria-hidden', 'true');
    client360Drawer.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo">analytics</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-c360-title>Desglose</h2>
            <span class="ops-orders-drawer__status" data-c360-status>—</span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-c360-expand title="Expandir" aria-label="Expandir panel">
            <span class="material-symbols-outlined">open_in_full</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-c360-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <span class="ops-orders-drawer__meta" data-c360-meta>Radiografía 360</span>
      </div>
      <div class="ops-orders-drawer__main">
        <div class="ops-orders-drawer__body custom-scrollbar" data-c360-body></div>
      </div>
      <div class="ops-orders-drawer__footer" data-c360-footer hidden></div>
    `;

    document.body.appendChild(client360Backdrop);
    document.body.appendChild(client360Drawer);

    client360Drawer.querySelector('[data-c360-close]')?.addEventListener('click', closeKpiDetail);
    client360Drawer.querySelector('[data-c360-expand]')?.addEventListener('click', () => {
      client360DrawerExpanded = !client360DrawerExpanded;
      client360Drawer.classList.toggle('ops-orders-drawer--expanded', client360DrawerExpanded);
      const icon = client360Drawer.querySelector('[data-c360-expand] .material-symbols-outlined');
      if (icon) icon.textContent = client360DrawerExpanded ? 'close_fullscreen' : 'open_in_full';
      if (client360DrawerExpanded) {
        client360Drawer.style.top = '';
        client360Drawer.style.right = '';
        client360Drawer.style.left = '';
        client360Drawer.style.height = '';
      } else {
        placeClient360Drawer(client360LastSource);
      }
    });
    return client360Drawer;
  }

  function placeClient360Drawer(sourceEl) {
    if (!client360Drawer || client360DrawerExpanded) return;
    const ref = sourceEl || el('ficha360Grid') || el('clientKpis');
    const rect = ref?.getBoundingClientRect?.();
    let top = 96;
    if (rect) top = Math.round(rect.bottom + 12);
    top = Math.max(72, Math.min(top, Math.round(window.innerHeight * 0.28)));
    const maxHeight = Math.max(360, window.innerHeight - top - 24);
    client360Drawer.style.top = `${top}px`;
    client360Drawer.style.right = window.innerWidth < 640 ? '12px' : '28px';
    client360Drawer.style.left = window.innerWidth < 640 ? '12px' : 'auto';
    client360Drawer.style.bottom = 'auto';
    client360Drawer.style.height = `${Math.min(680, maxHeight)}px`;
  }

  function closeKpiDetail() {
    openKpiKey = null;
    destroyChart('chartClvComposicion');
    destroyChart('chartKpiDetail');
    ['clientKpiDetail', 'cierresKpiDetail'].forEach((id) => {
      const p = el(id);
      if (p) {
        p.classList.add('hidden');
        p.innerHTML = '';
      }
    });
    if (client360Drawer) {
      client360Drawer.classList.remove('ops-orders-drawer--open', 'ops-orders-drawer--expanded');
      client360Drawer.setAttribute('aria-hidden', 'true');
    }
    if (client360Backdrop) client360Backdrop.classList.remove('ops-orders-backdrop--visible');
    client360DrawerExpanded = false;
    client360LastSource = null;
    document.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('.client-360-stat.is-open').forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('.vista360-empty__kpi--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
  }

  function fillKpiDetailPanel(panelId, kpi, detail, gotoId, sourceEl) {
    if (!detail) return;
    const key = `${panelId}:${kpi}`;
    if (openKpiKey === key) {
      closeKpiDetail();
      return;
    }
    closeKpiDetail();

    const drawer = ensureClient360Drawer();
    const body = drawer.querySelector('[data-c360-body]');
    const footer = drawer.querySelector('[data-c360-footer]');
    const titleEl = drawer.querySelector('[data-c360-title]');
    const statusEl = drawer.querySelector('[data-c360-status]');
    const metaEl = drawer.querySelector('[data-c360-meta]');
    if (titleEl) titleEl.textContent = detail.title || 'Desglose';
    if (statusEl) statusEl.textContent = detail.value != null ? String(detail.value) : '—';
    if (metaEl) {
      metaEl.textContent = panelId === 'cierresKpiDetail'
        ? 'Cierres de taller'
        : (panelId === 'maduracionKpiDetail'
          ? 'Tiempo de maduración comercial · P-VTA-4'
          : 'Radiografía 360 · desglose');
    }

    const sectionsHtml = (detail.sections || [])
      .filter((s) => (s.rows || []).length)
      .map((s) => `
        <div class="ops-orders-drawer__group">
          <h5>${esc(s.titulo)}</h5>
          ${(s.rows || []).map((row) => `
            <div class="ops-orders-drawer__row${row.detail ? ' ops-orders-drawer__row--stack' : ''}">
              <div class="kpi-detail-row__main" style="width:100%;display:flex;justify-content:space-between;gap:12px">
                <span class="lbl" title="${esc(row.label)}">${esc(row.label)}</span>
                <span class="val">${row.badge ? `<span class="badge-tipo badge-flotilla">${esc(row.badge)}</span>` : esc(row.value)}</span>
              </div>
              ${row.detail ? `<p class="kpi-detail-row__detail">${esc(row.detail)}</p>` : ''}
            </div>`).join('')}
        </div>`).join('');

    const chart = detail.chart && detail.chart.labels?.length
      ? `
        <div class="ops-orders-drawer__group">
          <h5>Composición promedio del CLV</h5>
          <div class="chart-card" style="min-height:200px;padding:8px 12px;background:transparent;box-shadow:none">
            <div class="chart-wrap"><canvas id="${esc(detail.chart.canvasId || 'chartKpiDetail')}"></canvas></div>
          </div>
        </div>`
      : '';

    if (body) {
      body.innerHTML = sectionsHtml || chart
        ? `${sectionsHtml}${chart}`
        : '<p class="ops-orders-drawer__hint">Sin información para desglosar</p>';
    }
    if (footer) {
      const target = gotoId ? el(gotoId) : null;
      if (target) {
        footer.hidden = false;
        footer.innerHTML = `
          <button type="button" class="chip" data-goto-detail="${esc(gotoId)}">Ver en el expediente
            <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">arrow_downward</span>
          </button>`;
        footer.querySelector('[data-goto-detail]')?.addEventListener('click', (e) => {
          closeKpiDetail();
          gotoSection(e.currentTarget.dataset.gotoDetail);
        });
      } else {
        footer.hidden = true;
        footer.innerHTML = '';
      }
    }

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
    client360LastSource = sourceEl || null;
    sourceEl?.classList.add('is-open');
    placeClient360Drawer(sourceEl);
    client360Backdrop.classList.add('ops-orders-backdrop--visible');
    drawer.classList.add('ops-orders-drawer--open');
    drawer.setAttribute('aria-hidden', 'false');
  }

  function openClientKpiByKey(kpi, gotoId, sourceEl) {
    if (!currentClientData) return;
    const detail = buildClientKpiDetail(kpi, currentClientData);
    const source = sourceEl
      || document.querySelector(`.client-360-stat[data-open-kpi="${kpi}"]`)
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openKpiKey) closeKpiDetail();
  });

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
    if (currentVista === 'vendedor') {
      if (el('vendedorInput')?.value.trim()) cargarVendedorResumen();
      else showEmptyState();
      return;
    }
    if (currentIdContacto) openClient(currentIdContacto);
    else if (!el('cierresPanel')?.classList.contains('hidden')) cargarCierresPeriodo();
    else showEmptyState();
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
          else {
            showEmptyState();
            setStatus('Periodo: todo el histórico. Elige un vendedor.');
          }
          return;
        }
        if (currentIdContacto) openClient(currentIdContacto);
        else {
          showEmptyState();
          setStatus('Periodo limpiado. Define fechas o busca un cliente.');
        }
        return;
      }
      const [start, end] = window.Dashboard.getDatePresetRange(preset);
      el('fechaInicioOrdenes').value = window.Dashboard.formatDateInput(start);
      el('fechaFinOrdenes').value = window.Dashboard.formatDateInput(end);
      if (currentVista === 'vendedor') {
        if (el('vendedorInput')?.value.trim()) cargarVendedorResumen();
        else showEmptyState();
        return;
      }
      if (currentIdContacto) openClient(currentIdContacto);
      else showEmptyState();
    });
  });

  ['fechaInicioOrdenes', 'fechaFinOrdenes'].forEach((id) => {
    el(id).addEventListener('change', () => setActivePeriodChip(null));
  });

  el('btnEmptyVerCierres')?.addEventListener('click', () => cargarCierresPeriodo());
  document.querySelectorAll('#emptyState .vista360-empty__mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-empty-mode');
      setVista(mode);
      (mode === 'vendedor' ? el('vendedorInput') : el('searchInput'))?.focus();
    });
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
  } else if (initialId) {
    openClient(initialId);
  } else if (initialQ) {
    el('searchInput').value = initialQ;
    buscar();
  } else if (hasUrlPeriod) {
    cargarCierresPeriodo();
  } else {
    showEmptyState();
  }

  loadCrmStatus();
})();
