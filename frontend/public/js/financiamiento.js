/**
 * Sección Financiamiento en Ventas — KPIs dinámicos + notas persistentes.
 * Penetración GMF = entregas SOFIA con GMF / total entregas SOFIA (no facturación).
 */
(function () {
  const CONTADO = new Set(['CONTADO']);
  const EXCLUDE = new Set(['FLOTILLA', 'PERDIDA']);
  const MIX_KEYS = new Set(['facturasGmf', 'gmfDispTimbrar', 'penGmf', 'gmfSofia', 'noGmfSofia', 'mixFinanciera']);

  let state = {
    data: null,
    retailMix: null,
    sofiaRegistros: [],
    facturasGmfRegistros: [],
    facturaNotesByDocto: {},
    gerentesCatalog: null,
    openKpi: null,
    mixSearch: '',
    notes: [],
    fechaInicio: null,
    fechaFin: null,
    search: '',
  };

  const els = {};
  let mixDrawerUi = null;
  let facturaDetailUi = null;

  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return fmt.money(Number(n));
  }

  function num(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return fmt.number(Number(n));
  }

  function pct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Number(n).toFixed(1)}%`;
  }

  function dash(v) {
    return v == null || v === '' ? '—' : String(v);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normKey(v) {
    return String(v || '').trim().toUpperCase();
  }

  function personTokenKey(v) {
    const s = String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if (!s || s === 'NULL') return null;
    const tokens = s.split(' ').filter(Boolean);
    return tokens.length ? tokens.sort().join(' ') : null;
  }

  function buildGerenteIndex(catalog) {
    const byToken = new Map();
    for (const row of catalog?.asesores || []) {
      const asesor = String(row.asesor || '').trim();
      const gerente = String(row.gerente || '').trim();
      if (!asesor || !gerente) continue;
      const tok = personTokenKey(asesor);
      if (tok) byToken.set(tok, gerente);
      const lit = asesor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
      if (lit) byToken.set(lit, gerente);
    }
    return {
      byToken,
      gerentes: catalog?.gerentes || [],
    };
  }

  function resolveGerenteFi(vendedorNombre, index) {
    if (!vendedorNombre || !index?.byToken?.size) return null;
    const tok = personTokenKey(vendedorNombre);
    if (tok && index.byToken.has(tok)) return index.byToken.get(tok);
    const lit = String(vendedorNombre)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if (lit && index.byToken.has(lit)) return index.byToken.get(lit);
    if (tok) {
      const tokens = new Set(tok.split(' '));
      for (const [key, gerente] of index.byToken.entries()) {
        const keyTokens = key.split(' ');
        if (keyTokens.length < 2) continue;
        if (keyTokens.every((t) => tokens.has(t))) return gerente;
        if (tokens.size >= 2 && [...tokens].every((t) => keyTokens.includes(t))) return gerente;
      }
    }
    return null;
  }

  function tipoOf(row) {
    return String(row?.TIPOVENTA || '').trim().toUpperCase() || '(SIN DATO)';
  }

  function isGmfRow(row) {
    return tipoOf(row) === 'GMF' || row?.isGmf === true;
  }

  function enrichSofiaEntregas(entregas, registrosVentas, gerenteIndex) {
    const byVin = new Map();
    const byFactura = new Map();
    for (const r of registrosVentas || []) {
      const vin = normKey(r.VTE_SERIE);
      const doc = normKey(r.VTE_DOCTO);
      if (vin) byVin.set(vin, r);
      if (doc) byFactura.set(doc, r);
    }

    return (entregas || []).map((e) => {
      const vin = normKey(e.SOF_VIN);
      const fact = normKey(e.SOF_Factura);
      const venta = (vin && byVin.get(vin)) || (fact && byFactura.get(fact)) || null;
      const tipo = venta ? tipoOf(venta) : '(SIN DATO)';
      const vendedor = venta?.VENDEDOR || e.SOF_CveUSu || null;
      const gerenteFi = resolveGerenteFi(vendedor, gerenteIndex) || 'Sin gerente F&I';
      return {
        ...e,
        TIPOVENTA: tipo,
        FORMAPAGO_ORIGINAL: venta?.FORMAPAGO_ORIGINAL || null,
        VENDEDOR: vendedor,
        GERENTE_FI: gerenteFi,
        VEH_TIPOAUTO: venta?.VEH_TIPOAUTO || null,
        CANAL_LABEL: venta?.CANAL_LABEL || null,
        VTE_DOCTO: venta?.VTE_DOCTO || e.SOF_Factura || null,
        VTE_SERIE: venta?.VTE_SERIE || e.SOF_VIN || null,
        VTE_FECHDOCTO: e.FECHA_PERIODO || e.SOF_FechFact || e.SOF_FechAct || null,
        CLIENTE: e.CLIENTE || venta?.CLIENTE || null,
        isGmf: tipo === 'GMF',
        _match: venta ? (vin && byVin.has(vin) ? 'vin' : 'factura') : null,
      };
    });
  }

  function buildFacturasGmf(registrosVentas, gerenteIndex, sofiaRows = []) {
    const sofiaByFactura = new Set();
    for (const e of sofiaRows || []) {
      const fact = normKey(e.SOF_Factura || e.VTE_DOCTO);
      if (fact) sofiaByFactura.add(fact);
    }

    return (registrosVentas || [])
      .filter((r) => tipoOf(r) === 'GMF')
      .map((r) => {
        const vendedor = r.VENDEDOR || null;
        const docto = normKey(r.VTE_DOCTO);
        return {
          ...r,
          SOF_Factura: r.VTE_DOCTO || null,
          SOF_VIN: r.VTE_SERIE || null,
          VTE_FECHDOCTO: r.VTE_FECHDOCTO || null,
          GERENTE_FI: resolveGerenteFi(vendedor, gerenteIndex) || 'Sin gerente F&I',
          isGmf: true,
          enSofia: docto ? sofiaByFactura.has(docto) : false,
          _match: 'factura',
          _kind: 'facturaGmf',
        };
      });
  }

  function notePreviewForFactura(docto) {
    const key = normKey(docto);
    if (!key) return null;
    const notes = state.facturaNotesByDocto[key];
    if (!notes || !notes.length) return null;
    return notes[0];
  }

  function normalizeNoteText(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function facturaHasNotaContratoComprado(docto) {
    const key = normKey(docto);
    if (!key) return false;
    const notes = state.facturaNotesByDocto[key] || [];
    return notes.some((n) => normalizeNoteText(n.text).includes('CONTRATO COMPRADO'));
  }

  function facturasGmfDisponiblesTimbrar() {
    return facturasGmfRows().filter((r) => {
      if (r.enSofia) return false;
      return facturaHasNotaContratoComprado(r.SOF_Factura || r.VTE_DOCTO);
    });
  }

  function updateDisponiblesTimbrarMix() {
    if (!state.retailMix) state.retailMix = {};
    const rows = facturasGmfDisponiblesTimbrar();
    state.retailMix.gmfDisponiblesTimbrar = rows.length;
    return rows;
  }

  function setFacturaNotesIndex(notes) {
    const map = {};
    for (const n of notes || []) {
      const key = normKey(n.factura);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(n);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    }
    state.facturaNotesByDocto = map;
    updateDisponiblesTimbrarMix();
  }

  async function loadFacturaNotesIndex() {
    try {
      const res = await fetch('/api/ventas/financiamiento/notas?soloFacturas=1', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar notas de facturas');
      setFacturaNotesIndex(data.notes || []);
    } catch (err) {
      console.warn('[FI] notas facturas', err.message);
      state.facturaNotesByDocto = {};
    }
  }

  /** Penetración = GMF / entregas SOFIA (solo GMF cuenta como financiera). */
  function buildSofiaGmfMix(sofiaRows = [], facturasGmf = []) {
    const rows = sofiaRows || [];
    const total = rows.length;
    const gmf = rows.filter(isGmfRow).length;
    const noGmf = total - gmf;
    const sinMatch = rows.filter((r) => !r._match).length;
    const facturasGmfCount = (facturasGmf || []).length;

    const tipoMap = new Map();
    for (const r of rows) {
      const label = tipoOf(r);
      tipoMap.set(label, (tipoMap.get(label) || 0) + 1);
    }
    const porTipo = [...tipoMap.entries()]
      .map(([label, count]) => ({
        label,
        count,
        pct: total ? Math.round((count / total) * 1000) / 10 : null,
      }))
      .sort((a, b) => b.count - a.count);

    const penetracionGmfPct = total ? Math.round((gmf / total) * 1000) / 10 : null;

    return {
      totalSofia: total,
      facturasGmf: facturasGmfCount,
      gmfDisponiblesTimbrar: 0,
      gmf,
      noGmf,
      sinMatch,
      penetracionGmfPct,
      porTipo,
      porFinanciera: porTipo.filter((e) => e.label === 'GMF' || (!CONTADO.has(e.label) && !EXCLUDE.has(e.label))),
      totalRetail: total,
      credito: gmf,
      contado: noGmf,
      penetracionCreditoPct: penetracionGmfPct,
      penetracionContadoPct: total ? Math.round((noGmf / total) * 1000) / 10 : null,
    };
  }

  function kpiCard(title, value, sub, cls, opsKey) {
    const interactive = opsKey ? ' kpi-card--clickable' : '';
    const opsAttr = opsKey ? ` data-fi-kpi="${opsKey}"` : '';
    const role = opsKey ? ' role="button" tabindex="0"' : '';
    return `<div class="kpi-card kpi-card--${cls || 'blue'}${interactive}"${opsAttr}${role} title="${opsKey ? 'Clic para ver desglose' : ''}">
      <span class="kpi-title">${title}</span>
      <div class="kpi-value">${value}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
      ${opsKey ? '<span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>' : ''}
      <div class="kpi-accent"></div>
    </div>`;
  }

  function kpiGroup(title, cards) {
    return `<div class="kpi-group"><h4 class="kpi-group-title">${title}</h4><div class="kpi-grid">${cards.join('')}</div></div>`;
  }

  function mixKpiGroupHtml(mix) {
    return kpiGroup('Penetración GMF · entregas SOFIA', [
      kpiCard('Facturas GMF', num(mix.facturasGmf), 'crédito GMF facturado', 'blue', 'facturasGmf'),
      kpiCard(
        'GMF Disponibles para timbrar',
        num(mix.gmfDisponiblesTimbrar),
        'sin SOFIA + nota CONTRATO COMPRADO',
        'amber',
        'gmfDispTimbrar'
      ),
      kpiCard('GMF en SOFIA', num(mix.gmf), `${pct(mix.penetracionGmfPct)} de entregas`, 'green', 'gmfSofia'),
      kpiCard('Sin GMF', num(mix.noGmf), 'entregas SOFIA no GMF', 'slate', 'noGmfSofia'),
      kpiCard('Penetración GMF', pct(mix.penetracionGmfPct), `${num(mix.gmf)} de ${num(mix.totalSofia)} entregas`, 'violet', 'penGmf'),
      kpiCard('Mix por tipo', num(mix.porTipo?.length || 0), 'sobre entregas SOFIA', 'amber', 'mixFinanciera'),
    ]);
  }

  function contracts() {
    return state.data?.contratos || [];
  }

  function sofiaRows() {
    return state.sofiaRegistros || [];
  }

  function facturasGmfRows() {
    return state.facturasGmfRegistros || [];
  }

  function rowsForMixKpi(key) {
    switch (key) {
      case 'facturasGmf':
        return facturasGmfRows();
      case 'gmfDispTimbrar':
        return facturasGmfDisponiblesTimbrar();
      case 'penGmf':
      case 'mixFinanciera':
        return sofiaRows();
      case 'gmfSofia':
        return sofiaRows().filter(isGmfRow);
      case 'noGmfSofia':
        return sofiaRows().filter((r) => !isGmfRow(r));
      default:
        return [];
    }
  }

  function rowsForKpi(key) {
    const list = contracts();
    const sol = state.data?.solicitudes;
    switch (key) {
      case 'contratos':
      case 'montoTotal':
      case 'montoPromedio':
      case 'enganche':
      case 'plazo':
        return list;
      case 'unidades': {
        const seen = new Set();
        return list.filter((c) => {
          const v = String(c.vin || '').toUpperCase();
          if (!v || seen.has(v)) return false;
          seen.add(v);
          return true;
        });
      }
      case 'conPva':
        return list.filter((c) => Number(c.cantidadPvas || 0) > 0);
      case 'pvaGap':
        return list.filter((c) => c.pvas?.some((p) => p.key === 'gap'));
      case 'pvaGarantia':
        return list.filter((c) => c.pvas?.some((p) => p.key === 'garantia'));
      case 'pvaAccesorios':
        return list.filter((c) => c.pvas?.some((p) => p.key === 'accesorios'));
      case 'pvaOnstar':
        return list.filter((c) => c.pvas?.some((p) => p.key === 'onstar'));
      case 'pvaMant':
        return list.filter((c) => c.pvas?.some((p) => p.key === 'mantenimiento'));
      case 'solicitudes':
        return (sol?.muestra || []).map((r) => ({
          _kind: 'solicitud',
          fecha: r.fecha,
          cliente: r.cliente,
          vin: r.vin,
          contrato: r.contrato,
          asesor: r.asesor || r.financiera,
          unidad: r.unidad || r.estatus,
          tipoCompra: r.estatus,
          plan: r.financiera,
          plazoMeses: null,
          engancheMonto: r.enganche,
          montoFinanciar: null,
          pvas: [],
          cantidadPvas: 0,
        }));
      case 'aprobadas':
        return rowsForKpi('solicitudes').filter((r) =>
          String(r.tipoCompra || '').toUpperCase().includes('APROBADA')
        );
      default:
        return list;
    }
  }

  function kpiMeta(key) {
    const mix = state.retailMix || {};
    const map = {
      facturasGmf: { title: 'Facturas GMF', hint: 'Facturas a crédito GMF del periodo (DMS)' },
      gmfDispTimbrar: {
        title: 'GMF Disponibles para timbrar',
        hint: 'Facturas GMF sin entrega en SOFIA y con nota que contiene CONTRATO COMPRADO',
      },
      penGmf: { title: 'Penetración GMF', hint: `GMF / entregas SOFIA · ${num(mix.gmf)} de ${num(mix.totalSofia)}` },
      gmfSofia: { title: 'Entregas GMF (SOFIA)', hint: 'Entregas SOFIA con forma de pago GMF' },
      noGmfSofia: { title: 'Entregas sin GMF', hint: 'Entregas SOFIA que no son GMF (contado u otras)' },
      mixFinanciera: { title: 'Mix por tipo (SOFIA)', hint: 'Distribución de tipo de venta en entregas SOFIA' },
      contratos: { title: 'Contratos colocados', hint: 'Contratos F&I en el periodo (CRM)' },
      unidades: { title: 'Unidades financiadas', hint: 'VIN distintos con contrato' },
      montoTotal: { title: 'Monto a financiar', hint: 'Suma de monto_financiar' },
      montoPromedio: { title: 'Monto promedio', hint: 'Promedio por contrato' },
      enganche: { title: 'Enganche promedio', hint: 'Promedio de enganche monetario' },
      plazo: { title: 'Plazo promedio', hint: 'Meses promedio contratados' },
      conPva: { title: 'Con PVA', hint: 'Contratos con al menos un producto PVA' },
      pvaGap: { title: 'GAP', hint: 'Contratos con GAP' },
      pvaGarantia: { title: 'Garantía extendida', hint: 'Contratos con GE' },
      pvaAccesorios: { title: 'Accesorios', hint: 'Contratos con accesorios' },
      pvaOnstar: { title: 'OnStar', hint: 'Contratos con OnStar' },
      pvaMant: { title: 'Mantenimientos', hint: 'Contratos con mantenimiento integrado' },
      solicitudes: { title: 'Solicitudes F&I', hint: 'Solicitudes del periodo' },
      aprobadas: { title: 'Solicitudes aprobadas', hint: 'Estatus contiene APROBADA' },
    };
    return map[key] || { title: key, hint: '' };
  }

  function countByField(rows, keyFn) {
    const map = new Map();
    for (const r of rows || []) {
      const label = String(keyFn(r) || 'Sin dato').trim() || 'Sin dato';
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function mixKpiIcon(key) {
    const map = {
      facturasGmf: 'receipt_long',
      gmfDispTimbrar: 'assignment_turned_in',
      penGmf: 'percent',
      gmfSofia: 'notifications_active',
      noGmfSofia: 'payments',
      mixFinanciera: 'pie_chart',
    };
    return map[key] || 'analytics';
  }

  function downloadMixCsv(rows, title) {
    const headers = ['Fecha', 'Factura', 'VIN', 'Cliente', 'Vendedor', 'GerenteFI', 'Modelo', 'Canal', 'Tipo', 'FormaPago', 'Match'];
    const lines = [headers.join(',')];
    for (const r of rows || []) {
      const vals = [
        r.VTE_FECHDOCTO || r.FECHA_PERIODO, r.SOF_Factura || r.VTE_DOCTO, r.SOF_VIN || r.VTE_SERIE,
        r.CLIENTE, r.VENDEDOR, r.GERENTE_FI, r.VEH_TIPOAUTO, r.CANAL_LABEL, r.TIPOVENTA, r.FORMAPAGO_ORIGINAL, r._match,
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
      lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    const safe = String(title || 'penetracion_gmf_sofia').replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ]+/gi, '_').slice(0, 40);
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}_${state.fechaInicio || 'periodo'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function ensureFiMixDrawer() {
    if (mixDrawerUi) return mixDrawerUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-orders-backdrop';
    backdrop.id = 'fiMixBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-orders-drawer';
    panel.id = 'fiMixDrawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Penetración GMF SOFIA');
    panel.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo" data-fi-mix-logo>account_balance</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-fi-mix-title>Penetración GMF</h2>
            <span class="ops-orders-drawer__status" data-fi-mix-status>0 unidades</span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-fi-mix-download title="Descargar CSV" aria-label="Descargar CSV">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-fi-mix-expand title="Expandir" aria-label="Expandir panel">
            <span class="material-symbols-outlined" data-fi-mix-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-fi-mix-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <label class="ops-orders-drawer__search" for="fiMixSearch">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="fiMixSearch" type="search" placeholder="Buscar factura, VIN, cliente, tipo..." autocomplete="off"/>
        </label>
        <button type="button" class="ops-orders-drawer__filter-chip" data-fi-mix-filter-chip hidden title="Quitar filtro"></button>
        <span class="ops-orders-drawer__meta" data-fi-mix-meta></span>
      </div>
      <div class="ops-orders-drawer__main">
        <aside class="ops-orders-drawer__summary custom-scrollbar" data-fi-mix-summary></aside>
        <div class="ops-orders-drawer__body custom-scrollbar" data-fi-mix-body></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-fi-mix-status]');
    const metaEl = panel.querySelector('[data-fi-mix-meta]');
    const bodyEl = panel.querySelector('[data-fi-mix-body]');
    const summaryEl = panel.querySelector('[data-fi-mix-summary]');
    const searchEl = panel.querySelector('#fiMixSearch');
    const filterChip = panel.querySelector('[data-fi-mix-filter-chip]');
    const expandBtn = panel.querySelector('[data-fi-mix-expand]');
    const expandIcon = panel.querySelector('[data-fi-mix-expand-icon]');
    const downloadBtn = panel.querySelector('[data-fi-mix-download]');
    const titleEl = panel.querySelector('[data-fi-mix-title]');
    const logoEl = panel.querySelector('[data-fi-mix-logo]');

    let expanded = false;
    let activeFilter = null;
    let sourceRows = [];
    let lastExportRows = [];
    let currentMeta = { kpi: '', title: 'Penetración GMF', hint: '', icon: 'account_balance' };
    let lastCard = null;

    const FILTER_DIM_LABEL = {
      tipo: 'Tipo',
      vendedor: 'Vendedor',
      canal: 'Canal',
      gmf: 'GMF',
      gerente: 'Gerente F&I',
      sofia: 'SOFIA',
    };

    function placeNearKpi(card) {
      if (expanded) return;
      const kpiBlock = els.kpiRoot || document.getElementById('fiKpiOperational');
      const ref = card || kpiBlock;
      const rect = ref?.getBoundingClientRect?.();
      let top = 96;
      if (rect) top = Math.round(rect.bottom + 12);
      top = Math.max(72, Math.min(top, Math.round(window.innerHeight * 0.28)));
      const maxHeight = Math.max(360, window.innerHeight - top - 24);
      panel.style.top = `${top}px`;
      panel.style.right = window.innerWidth < 640 ? '12px' : '28px';
      panel.style.left = window.innerWidth < 640 ? '12px' : 'auto';
      panel.style.bottom = 'auto';
      panel.style.height = `${Math.min(680, maxHeight)}px`;
    }

    function clearPlacement() {
      panel.style.top = '';
      panel.style.right = '';
      panel.style.left = '';
      panel.style.bottom = '';
      panel.style.height = '';
    }

    function setExpanded(next) {
      expanded = Boolean(next);
      panel.classList.toggle('ops-orders-drawer--expanded', expanded);
      if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
      if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
      if (expanded) clearPlacement();
      else if (panel.classList.contains('ops-orders-drawer--open')) placeNearKpi(lastCard);
    }

    function updateFilterChip() {
      if (!filterChip) return;
      if (!activeFilter) {
        filterChip.hidden = true;
        filterChip.textContent = '';
        return;
      }
      filterChip.hidden = false;
      filterChip.innerHTML = `
        <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
        ${escapeHtml(FILTER_DIM_LABEL[activeFilter.dim] || activeFilter.dim)}: ${escapeHtml(activeFilter.label || activeFilter.value)}
        <span class="material-symbols-outlined" aria-hidden="true">close</span>`;
    }

    function matchesActiveFilter(r) {
      if (!activeFilter) return true;
      if (activeFilter.dim === 'tipo') return tipoOf(r) === activeFilter.value;
      if (activeFilter.dim === 'vendedor') return String(r.VENDEDOR || 'Sin vendedor') === activeFilter.value;
      if (activeFilter.dim === 'canal') return String(r.CANAL_LABEL || 'Sin canal') === activeFilter.value;
      if (activeFilter.dim === 'gerente') return String(r.GERENTE_FI || 'Sin gerente F&I') === activeFilter.value;
      if (activeFilter.dim === 'gmf') {
        return activeFilter.value === 'GMF' ? isGmfRow(r) : !isGmfRow(r);
      }
      if (activeFilter.dim === 'sofia') {
        return activeFilter.value === 'EN_SOFIA' ? Boolean(r.enSofia) : !r.enSofia;
      }
      return true;
    }

    function setFilter(dim, value, label) {
      if (activeFilter && activeFilter.dim === dim && activeFilter.value === value) activeFilter = null;
      else activeFilter = { dim, value, label: label || value };
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function clearFilter() {
      activeFilter = null;
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function renderSummary(rows) {
      const mix = state.retailMix || {};
      const isFacturas = currentMeta.kpi === 'facturasGmf' || currentMeta.kpi === 'gmfDispTimbrar';
      const porGerente = countByField(rows, (r) => r.GERENTE_FI || 'Sin gerente F&I');
      const porTipo = countByField(rows, (r) => tipoOf(r)).slice(0, 10);
      const porVendedor = countByField(rows, (r) => r.VENDEDOR || 'Sin vendedor').slice(0, 8);
      const porCanal = countByField(rows, (r) => r.CANAL_LABEL || 'Sin canal').slice(0, 8);
      const isActive = (dim, value) => activeFilter && activeFilter.dim === dim && activeFilter.value === value;

      const block = (titulo, dim, items) => `
        <div class="ops-orders-drawer__group">
          <h5>${escapeHtml(titulo)}</h5>
          ${items.length
            ? items.map((x) => `
              <button type="button"
                class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x.label) ? ' is-active' : ''}"
                data-fi-filter-dim="${escapeHtml(dim)}"
                data-fi-filter-value="${escapeHtml(x.label)}"
                title="Filtrar por ${escapeHtml(x.label)}">
                <span class="lbl">${escapeHtml(x.label)}</span>
                <span class="val">${num(x.value)}</span>
              </button>`).join('')
            : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
        </div>`;

      if (isFacturas) {
        const enSofiaCount = rows.filter((r) => r.enSofia).length;
        const sinSofiaCount = rows.length - enSofiaCount;
        const isDisp = currentMeta.kpi === 'gmfDispTimbrar';
        summaryEl.innerHTML = `
          <div class="ops-orders-drawer__group">
            <h5>Resumen</h5>
            <div class="ops-orders-drawer__row"><span class="lbl">${isDisp ? 'Disponibles para timbrar' : 'Facturas GMF'}</span><span class="val">${num(rows.length)}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Timbradas en SOFIA</span><span class="val">${num(enSofiaCount)}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Sin SOFIA</span><span class="val">${num(sinSofiaCount)}</span></div>
            <p class="ops-orders-drawer__hint">${isDisp
              ? 'GMF sin SOFIA con nota CONTRATO COMPRADO'
              : 'Solo facturas a crédito GMF del periodo'}</p>
            <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
          </div>
          ${block('Por gerente F&I', 'gerente', porGerente)}
          <div class="ops-orders-drawer__group">
            <h5>Filtro rápido</h5>
            <button type="button" class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('sofia', 'EN_SOFIA') ? ' is-active' : ''}"
              data-fi-filter-dim="sofia" data-fi-filter-value="EN_SOFIA" data-fi-filter-label="Timbrada en SOFIA"
              title="Filtrar timbradas en SOFIA">
              <span class="lbl">Timbrada en SOFIA</span>
              <span class="val">${num(enSofiaCount)}</span>
            </button>
            <button type="button" class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('sofia', 'SIN_SOFIA') ? ' is-active' : ''}"
              data-fi-filter-dim="sofia" data-fi-filter-value="SIN_SOFIA" data-fi-filter-label="Sin SOFIA"
              title="Filtrar sin entrega en SOFIA">
              <span class="lbl">Sin SOFIA</span>
              <span class="val">${num(sinSofiaCount)}</span>
            </button>
          </div>
          ${block('Por canal', 'canal', porCanal)}
        `;
        return;
      }

      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Facturas GMF</span><span class="val">${num(mix.facturasGmf)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Entregas SOFIA</span><span class="val">${num(mix.totalSofia)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">GMF en SOFIA</span><span class="val">${num(mix.gmf)} (${pct(mix.penetracionGmfPct)})</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Sin GMF</span><span class="val">${num(mix.noGmf)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Sin match factura/VIN</span><span class="val">${num(mix.sinMatch)}</span></div>
          <p class="ops-orders-drawer__hint">Penetración = GMF ÷ entregas SOFIA (no facturación)</p>
          <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
        </div>
        ${block('Por gerente F&I', 'gerente', porGerente)}
        <div class="ops-orders-drawer__group">
          <h5>Filtro rápido</h5>
          <button type="button" class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('gmf', 'GMF') ? ' is-active' : ''}"
            data-fi-filter-dim="gmf" data-fi-filter-value="GMF"><span class="lbl">Solo GMF</span><span class="val">${num(mix.gmf)}</span></button>
          <button type="button" class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('gmf', 'NO_GMF') ? ' is-active' : ''}"
            data-fi-filter-dim="gmf" data-fi-filter-value="NO_GMF"><span class="lbl">Sin GMF</span><span class="val">${num(mix.noGmf)}</span></button>
        </div>
        ${block('Por tipo', 'tipo', porTipo)}
        ${block('Por vendedor', 'vendedor', porVendedor)}
        ${block('Por canal', 'canal', porCanal)}
      `;
    }

    function renderList(term = '') {
      const q = String(term || '').trim().toLowerCase();
      const searched = !q
        ? sourceRows
        : sourceRows.filter((r) => [
          r.VTE_FECHDOCTO, r.FECHA_PERIODO, r.SOF_Factura, r.VTE_DOCTO, r.SOF_VIN, r.VTE_SERIE,
          r.CLIENTE, r.VENDEDOR, r.GERENTE_FI, r.VEH_TIPOAUTO, r.CANAL_LABEL, r.TIPOVENTA, r.FORMAPAGO_ORIGINAL,
        ].some((v) => String(v || '').toLowerCase().includes(q)));

      const filtered = searched.filter(matchesActiveFilter);
      lastExportRows = filtered;

      const isFacturas = currentMeta.kpi === 'facturasGmf' || currentMeta.kpi === 'gmfDispTimbrar';
      const isDisp = currentMeta.kpi === 'gmfDispTimbrar';
      statusEl.textContent = isDisp
        ? `${filtered.length.toLocaleString('es-MX')} disponible(s) para timbrar`
        : isFacturas
          ? `${filtered.length.toLocaleString('es-MX')} factura(s) GMF`
          : `${filtered.length.toLocaleString('es-MX')} entrega(s)`;
      metaEl.textContent = activeFilter || q
        ? `${filtered.length} de ${sourceRows.length}`
        : `${sourceRows.length} registros`;

      renderSummary(searched);
      updateFilterChip();

      if (!filtered.length) {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__empty">
            <span class="material-symbols-outlined">inbox</span>
            <p>${activeFilter || q
              ? 'Sin coincidencias con el filtro actual.'
              : (isDisp
                ? 'No hay GMF sin SOFIA con nota CONTRATO COMPRADO.'
                : (isFacturas ? 'No hay facturas GMF en el periodo.' : 'No hay entregas SOFIA para este indicador.'))}</p>
          </div>`;
        return;
      }

      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <h5>${isFacturas
            ? (currentMeta.kpi === 'gmfDispTimbrar' ? 'GMF disponibles para timbrar' : 'Detalle de facturas GMF')
            : 'Detalle de entregas SOFIA'}</h5>
          <span>${filtered.length.toLocaleString('es-MX')}</span>
        </div>
        ${filtered.map((r) => {
          const tipo = tipoOf(r);
          const gmfTag = isGmfRow(r) ? 'GMF' : tipo;
          const docto = String(r.SOF_Factura || r.VTE_DOCTO || '').trim();
          const clickable = isFacturas && docto;
          const tag = clickable ? 'button' : 'div';
          const attrs = clickable
            ? `type="button" class="ops-orders-drawer__item" data-fi-factura="${escapeHtml(docto)}"`
            : 'class="ops-orders-drawer__item" style="cursor:default"';
          const note = clickable ? notePreviewForFactura(docto) : null;
          const enSofia = clickable ? Boolean(r.enSofia) : null;
          const sofiaChip = clickable
            ? `<span class="fi-list-chip ${enSofia ? 'fi-list-chip--ok' : 'fi-list-chip--warn'}">${enSofia ? 'Timbrada en SOFIA' : 'Sin SOFIA'}</span>`
            : '';
          const noteBlock = clickable
            ? (note
              ? `<p class="fi-list-note" title="${escapeHtml(note.text)}"><span class="material-symbols-outlined" aria-hidden="true">sticky_note_2</span>${escapeHtml(note.text)}</p>`
              : '<p class="fi-list-note fi-list-note--empty">Sin nota</p>')
            : '';
          return `
            <${tag} ${attrs}>
              <div class="ops-orders-drawer__item-head">
                <strong>${escapeHtml(dash(docto))}</strong>
                <span class="ops-orders-drawer__tag">${escapeHtml(gmfTag)}</span>
              </div>
              ${clickable ? `<div class="fi-list-meta">${sofiaChip}${noteBlock}</div>` : ''}
              <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.CLIENTE))} · ${escapeHtml(dash(r.VENDEDOR))}</p>
              <div class="ops-orders-drawer__facts">
                <span>${escapeHtml(dash(r.VEH_TIPOAUTO))}</span>
                <span class="mono">${escapeHtml(dash(r.SOF_VIN || r.VTE_SERIE))}</span>
                <span>${escapeHtml(dash(r.CANAL_LABEL))}</span>
              </div>
              <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
                <span>${escapeHtml(dash(r.VTE_FECHDOCTO || r.FECHA_PERIODO))}</span>
                <span>${escapeHtml(dash(r.FORMAPAGO_ORIGINAL || 'sin forma pago'))}</span>
                <span>${r._match ? `match ${escapeHtml(r._match)}` : 'sin match venta'}</span>
              </div>
              <p class="ops-orders-drawer__sub">Gerente F&amp;I: ${escapeHtml(dash(r.GERENTE_FI))}${clickable ? ' · Ver movimientos' : ''}</p>
            </${tag}>`;
        }).join('')}`;
    }

    function close() {
      closeFacturaDetail();
      panel.classList.remove('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ops-orders-drawer-open');
      expanded = false;
      panel.classList.remove('ops-orders-drawer--expanded');
      if (expandIcon) expandIcon.textContent = 'open_in_full';
      if (expandBtn) expandBtn.title = 'Expandir';
      clearPlacement();
      activeFilter = null;
      lastCard = null;
      const key = state.openKpi;
      if (MIX_KEYS.has(key)) state.openKpi = null;
      els.kpiRoot?.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => {
        const k = c.getAttribute('data-fi-kpi');
        if (MIX_KEYS.has(k)) c.classList.remove('is-open');
      });
    }

    function open(rows, card, meta = {}) {
      currentMeta = {
        kpi: meta.kpi || '',
        title: meta.title || 'Penetración GMF',
        hint: meta.hint || '',
        icon: meta.icon || 'account_balance',
      };
      lastCard = card || null;
      if (titleEl) titleEl.textContent = currentMeta.title;
      if (logoEl) logoEl.textContent = currentMeta.icon;
      panel.setAttribute('aria-label', currentMeta.title);

      sourceRows = (rows || []).slice();
      if (searchEl) searchEl.value = '';
      activeFilter = null;
      updateFilterChip();
      placeNearKpi(card);
      setExpanded(true);
      renderList('');
      panel.classList.add('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-orders-drawer-open');
      card?.classList.add('is-open');
      window.setTimeout(() => searchEl?.focus({ preventScroll: true }), 180);
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-fi-mix-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));
    downloadBtn?.addEventListener('click', () => {
      if (!lastExportRows.length) {
        window.alert('No hay entregas para descargar.');
        return;
      }
      downloadMixCsv(lastExportRows, currentMeta.title);
    });
    searchEl?.addEventListener('input', () => renderList(searchEl.value));
    filterChip?.addEventListener('click', clearFilter);
    summaryEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fi-filter-dim]');
      if (!btn || !summaryEl.contains(btn)) return;
      setFilter(
        btn.dataset.fiFilterDim,
        btn.dataset.fiFilterValue,
        btn.dataset.fiFilterLabel || btn.dataset.fiFilterValue
      );
    });
    bodyEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fi-factura]');
      if (!btn || !bodyEl.contains(btn)) return;
      const docto = btn.getAttribute('data-fi-factura');
      if (docto) openFacturaDetail(docto);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (facturaDetailUi?.isOpen?.()) {
        closeFacturaDetail();
        return;
      }
      if (panel.classList.contains('ops-orders-drawer--open')) close();
    });

    mixDrawerUi = {
      open,
      close,
      panel,
      refresh() {
        if (panel.classList.contains('ops-orders-drawer--open')) {
          renderList(searchEl?.value || '');
        }
      },
    };
    return mixDrawerUi;
  }

  function formatDateShort(v) {
    if (v == null || v === '') return '—';
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return d.toLocaleDateString('es-MX');
  }

  function ensureFacturaDetailPanel() {
    if (facturaDetailUi) return facturaDetailUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-order-detail-backdrop';
    backdrop.id = 'fiFacturaDetailBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-order-detail';
    panel.id = 'fiFacturaDetail';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle de factura');
    panel.innerHTML = `
      <div class="ops-order-detail__header">
        <div class="ops-order-detail__title-wrap">
          <span class="material-symbols-outlined ops-order-detail__logo">payments</span>
          <div>
            <h2 class="ops-order-detail__title" data-fd-title>Factura</h2>
            <span class="ops-order-detail__status" data-fd-status>Cargando…</span>
          </div>
        </div>
        <div class="ops-order-detail__actions">
          <button type="button" class="ops-order-detail__icon-btn" data-fd-expand title="Expandir" aria-label="Expandir">
            <span class="material-symbols-outlined" data-fd-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-order-detail__icon-btn" data-fd-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-order-detail__body custom-scrollbar" data-fd-body>
        <div class="ops-order-detail__loading">
          <span class="material-symbols-outlined">hourglass_top</span>
          <p>Cargando movimientos…</p>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const titleEl = panel.querySelector('[data-fd-title]');
    const statusEl = panel.querySelector('[data-fd-status]');
    const bodyEl = panel.querySelector('[data-fd-body]');
    const expandBtn = panel.querySelector('[data-fd-expand]');
    const expandIcon = panel.querySelector('[data-fd-expand-icon]');
    let expanded = false;
    let requestToken = 0;
    let currentDocto = null;
    let currentNotes = [];

    function setExpanded(next) {
      expanded = Boolean(next);
      panel.classList.toggle('ops-order-detail--expanded', expanded);
      if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
      if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
    }

    function isOpen() {
      return panel.classList.contains('ops-order-detail--open');
    }

    function close() {
      panel.classList.remove('ops-order-detail--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('ops-order-detail-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ops-order-detail-open');
      setExpanded(false);
      requestToken += 1;
      currentDocto = null;
      currentNotes = [];
    }

    function renderNotesBlock(notes) {
      currentNotes = notes || [];
      if (!currentNotes.length) {
        return '<p class="ops-order-detail__hint">Sin notas en esta factura. Escriba una y guárdela.</p>';
      }
      return currentNotes.map((n) => {
        const when = n.updatedAt || n.createdAt;
        const whenLabel = when ? new Date(when).toLocaleString('es-MX') : '';
        return `<article class="fi-note fi-note--factura" data-fd-note-id="${escapeHtml(n.id)}">
          <div class="fi-note-head">
            <strong>${escapeHtml(n.author || 'usuario')}</strong>
            <time datetime="${escapeHtml(when || '')}">${escapeHtml(whenLabel)}</time>
          </div>
          <p class="fi-note-text">${escapeHtml(n.text)}</p>
          <div class="fi-note-actions">
            <button type="button" class="btn-glass btn-sm" data-fd-note-edit="${escapeHtml(n.id)}">Editar</button>
            <button type="button" class="btn-glass btn-sm btn-danger-soft" data-fd-note-del="${escapeHtml(n.id)}">Eliminar</button>
          </div>
        </article>`;
      }).join('');
    }

    function renderDetail(data) {
      const f = data.factura || {};
      const resumen = data.resumen || {};
      const sofia = data.sofia || {};
      const cfdi = data.cfdi || {};
      const movs = data.movimientos || [];
      currentNotes = data.notes || [];

      titleEl.textContent = f.factura || currentDocto || 'Factura';
      const sofiaBadge = sofia.enSofia ? 'En SOFIA' : 'Sin SOFIA';
      statusEl.textContent = resumen.tieneMovimientos
        ? `${resumen.cantidadMovimientos} movimiento(s) · Saldo ${money(resumen.saldo)} · ${sofiaBadge}`
        : `Sin movimientos · Total ${money(resumen.totalFactura)} · ${sofiaBadge}`;

      const movRows = movs.length
        ? movs.map((m) => `
          <tr>
            <td>${escapeHtml(formatDateShort(m.fecha))}</td>
            <td>${escapeHtml(dash(m.tipoPago))}</td>
            <td class="mono">${escapeHtml(dash(m.folioPago))}</td>
            <td>${escapeHtml(dash(m.referencia))}</td>
            <td class="cell-num">${money(m.importe)}</td>
            <td class="cell-num">${m.saldoInsoluto != null ? money(m.saldoInsoluto) : '—'}</td>
          </tr>`).join('')
        : '<tr><td colspan="6" class="ops-order-detail__empty-cell">No hay pagos ni aplicaciones registrados a esta factura.</td></tr>';

      const sofiaClass = sofia.enSofia ? 'fi-badge fi-badge--ok' : 'fi-badge fi-badge--warn';
      const cfdiClass = cfdi.timbrado ? 'fi-badge fi-badge--ok' : 'fi-badge fi-badge--muted';
      const sofiaExtra = sofia.enSofia
        ? `${escapeHtml(formatDateShort(sofia.fechaEntrega))}${sofia.horaEntrega ? ` ${escapeHtml(sofia.horaEntrega)}` : ''}${sofia.estatus ? ` · ${escapeHtml(sofia.estatus)}` : ''}`
        : 'Pendiente de entrega/reporte en SOFIA';

      bodyEl.innerHTML = `
        <section class="ops-order-detail__meta">
          <div class="ops-order-detail__meta-grid">
            <div><span class="lbl">Factura a nombre de</span><strong>${escapeHtml(dash(f.cliente))}</strong></div>
            <div><span class="lbl">RFC</span><strong class="mono">${escapeHtml(dash(f.rfc))}</strong></div>
            <div><span class="lbl">Número</span><strong>${escapeHtml(dash(f.telefono || f.celular))}</strong></div>
            <div><span class="lbl">Correo</span><strong>${escapeHtml(dash(f.correo))}</strong></div>
            <div><span class="lbl">Fecha</span><strong>${escapeHtml(formatDateShort(f.fecha))}</strong></div>
            <div><span class="lbl">Serie / VIN</span><strong class="mono">${escapeHtml(dash(f.serie))}</strong></div>
            <div><span class="lbl">Forma de pago</span><strong>${escapeHtml(dash(f.formaPago))}</strong></div>
            <div><span class="lbl">Estatus DMS</span><strong>${escapeHtml(dash(f.status))}</strong></div>
            <div><span class="lbl">Total factura</span><strong>${money(resumen.totalFactura)}</strong></div>
            <div><span class="lbl">Aplicado</span><strong>${money(resumen.totalAplicado)}</strong></div>
            <div><span class="lbl">Saldo</span><strong>${money(resumen.saldo)}</strong></div>
          </div>
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>SOFIA y timbrado</h3>
          </div>
          <div class="ops-order-detail__meta-grid fi-factura-status-grid">
            <div>
              <span class="lbl">En SOFIA</span>
              <strong><span class="${sofiaClass}">${escapeHtml(sofia.label || (sofia.enSofia ? 'Sí' : 'No'))}</span></strong>
              <p class="ops-order-detail__hint">${sofiaExtra}</p>
            </div>
            <div>
              <span class="lbl">CFDI</span>
              <strong><span class="${cfdiClass}">${escapeHtml(cfdi.label || (cfdi.timbrado ? 'Timbrado' : 'Sin timbrar'))}</span></strong>
              <p class="ops-order-detail__hint">${cfdi.timbrado
                ? `${escapeHtml(formatDateShort(cfdi.fechaTimbrado))}${cfdi.uuid ? ` · ${escapeHtml(cfdi.uuid)}` : ''}`
                : 'Sin UUID fiscal registrado'}</p>
            </div>
          </div>
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Movimientos de dinero</h3>
            <span>${num(resumen.cantidadMovimientos)}</span>
          </div>
          <div class="ops-order-detail__table-wrap custom-scrollbar">
            <table class="ops-order-detail__table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Folio</th>
                  <th>Referencia</th>
                  <th>Importe</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>${movRows}</tbody>
            </table>
          </div>
        </section>

        <section class="ops-order-detail__section fi-factura-notes">
          <div class="ops-order-detail__section-head">
            <h3>Notas de la factura</h3>
            <span>${num(currentNotes.length)}</span>
          </div>
          <form class="fi-factura-notes__form" data-fd-note-form>
            <textarea rows="3" maxlength="4000" placeholder="Escriba una nota sobre esta factura…" data-fd-note-text required></textarea>
            <button type="submit" class="btn-glass btn-sm">Guardar nota</button>
          </form>
          <div class="fi-factura-notes__list" data-fd-notes-list>
            ${renderNotesBlock(currentNotes)}
          </div>
        </section>
      `;
    }

    async function refreshNotesList() {
      if (!currentDocto) return;
      try {
        const res = await fetch(`/api/ventas/financiamiento/notas?factura=${encodeURIComponent(currentDocto)}`, {
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las notas');
        const listEl = bodyEl.querySelector('[data-fd-notes-list]');
        if (listEl) listEl.innerHTML = renderNotesBlock(data.notes || []);
        const headCount = bodyEl.querySelector('.fi-factura-notes .ops-order-detail__section-head span');
        if (headCount) headCount.textContent = num((data.notes || []).length);
      } catch (err) {
        console.warn('[FI] notas factura', err);
      }
    }

    async function open(docto) {
      const id = String(docto || '').trim();
      if (!id) return;
      currentDocto = id;
      const token = ++requestToken;
      titleEl.textContent = id;
      statusEl.textContent = 'Cargando…';
      bodyEl.innerHTML = `
        <div class="ops-order-detail__loading">
          <span class="material-symbols-outlined">hourglass_top</span>
          <p>Cargando movimientos de ${escapeHtml(id)}…</p>
        </div>`;
      setExpanded(true);
      panel.classList.add('ops-order-detail--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-order-detail-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-order-detail-open');

      try {
        const res = await fetch(`/api/ventas/financiamiento/factura/${encodeURIComponent(id)}`, {
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (token !== requestToken) return;
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar el detalle de la factura.');
        renderDetail(data);
      } catch (err) {
        if (token !== requestToken) return;
        statusEl.textContent = 'Error';
        bodyEl.innerHTML = `
          <div class="ops-order-detail__empty">
            <span class="material-symbols-outlined">error</span>
            <p>${escapeHtml(err?.message || 'No se pudo cargar el detalle de la factura.')}</p>
          </div>`;
      }
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-fd-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));

    bodyEl.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-fd-note-form]');
      if (!form || !bodyEl.contains(form)) return;
      e.preventDefault();
      if (!currentDocto) return;
      const ta = form.querySelector('[data-fd-note-text]');
      const text = String(ta?.value || '').trim();
      if (!text) return;
      try {
        const res = await fetch('/api/ventas/financiamiento/notas', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, factura: currentDocto }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar la nota.');
        if (ta) ta.value = '';
        await refreshNotesList();
        await syncFacturaNotesAndList();
      } catch (err) {
        window.alert(err?.message || 'No se pudo guardar la nota.');
      }
    });

    bodyEl.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-fd-note-edit]');
      const delBtn = e.target.closest('[data-fd-note-del]');
      if (editBtn && bodyEl.contains(editBtn)) {
        const id = editBtn.getAttribute('data-fd-note-edit');
        const note = currentNotes.find((n) => n.id === id);
        const next = window.prompt('Editar nota', note?.text || '');
        if (next == null) return;
        const cleaned = String(next).trim();
        if (!cleaned) return;
        try {
          const res = await fetch(`/api/ventas/financiamiento/notas/${encodeURIComponent(id)}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cleaned }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la nota.');
          await refreshNotesList();
          await syncFacturaNotesAndList();
        } catch (err) {
          window.alert(err?.message || 'No se pudo actualizar la nota.');
        }
        return;
      }
      if (delBtn && bodyEl.contains(delBtn)) {
        const id = delBtn.getAttribute('data-fd-note-del');
        if (!window.confirm('¿Eliminar esta nota?')) return;
        try {
          const res = await fetch(`/api/ventas/financiamiento/notas/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la nota.');
          await refreshNotesList();
          await syncFacturaNotesAndList();
        } catch (err) {
          window.alert(err?.message || 'No se pudo eliminar la nota.');
        }
      }
    });

    facturaDetailUi = { open, close, isOpen, panel };
    return facturaDetailUi;
  }

  function refreshFiMixList() {
    if (mixDrawerUi?.refresh) mixDrawerUi.refresh();
  }

  async function syncFacturaNotesAndList() {
    await loadFacturaNotesIndex();
    renderKpis();
    if (state.openKpi === 'gmfDispTimbrar' && mixDrawerUi?.panel?.classList.contains('ops-orders-drawer--open')) {
      const card = els.kpiRoot?.querySelector('[data-fi-kpi="gmfDispTimbrar"]');
      ensureFiMixDrawer().open(rowsForMixKpi('gmfDispTimbrar'), card, {
        kpi: 'gmfDispTimbrar',
        title: kpiMeta('gmfDispTimbrar').title,
        hint: kpiMeta('gmfDispTimbrar').hint,
        icon: mixKpiIcon('gmfDispTimbrar'),
      });
    } else {
      refreshFiMixList();
    }
  }

  function openFacturaDetail(docto) {
    ensureFacturaDetailPanel().open(docto);
  }

  function closeFacturaDetail() {
    if (facturaDetailUi) facturaDetailUi.close();
  }

  function closeFiMixDrawer() {
    closeFacturaDetail();
    if (mixDrawerUi) mixDrawerUi.close();
  }

  function renderKpis() {
    const root = els.kpiRoot;
    if (!root) return;
    const s = state.data?.summary || {};
    const mix = state.retailMix || {};
    const sol = s.solicitudes || {};
    const pva = Object.fromEntries((s.porTipoPva || []).map((t) => [t.key, t]));
    const mixBlock = mixKpiGroupHtml(mix);

    if (!state.data?.fuente?.crm) {
      root.innerHTML = [
        mixBlock,
        `<div class="fi-empty">
          <p>No hay base CRM de financiamiento disponible.</p>
          <p class="section-subtitle">La penetración GMF sí se calcula con entregas SOFIA del periodo consultado.</p>
        </div>`,
      ].join('');
      bindKpiCards();
      restoreOpenKpi();
      return;
    }

    root.innerHTML = [
      mixBlock,
      kpiGroup('Volumen F&I', [
        kpiCard('Contratos', num(s.contratos), 'colocados en el periodo', 'blue', 'contratos'),
        kpiCard('Unidades', num(s.unidades), 'VIN distintos', 'green', 'unidades'),
        kpiCard('Monto a financiar', money(s.montoFinanciarTotal), `prom. ${money(s.montoFinanciarPromedio)}`, 'violet', 'montoTotal'),
        kpiCard('Enganche prom.', money(s.enganchePromedio), 'por contrato', 'amber', 'enganche'),
        kpiCard('Plazo prom.', s.plazoPromedio != null ? `${s.plazoPromedio} mes` : '—', 'meses contratados', 'slate', 'plazo'),
      ]),
      kpiGroup('Productos PVA', [
        kpiCard('Con PVA', num(s.contratosConPva), `penetración ${pct(s.penetracionPvaPct)}`, 'green', 'conPva'),
        kpiCard('GAP', num(pva.gap?.contratos || 0), pct(pva.gap?.penetracionPct), 'violet', 'pvaGap'),
        kpiCard('Garantía ext.', num(pva.garantia?.contratos || 0), pct(pva.garantia?.penetracionPct), 'blue', 'pvaGarantia'),
        kpiCard('Accesorios', num(pva.accesorios?.contratos || 0), pct(pva.accesorios?.penetracionPct), 'amber', 'pvaAccesorios'),
        kpiCard('OnStar', num(pva.onstar?.contratos || 0), pct(pva.onstar?.penetracionPct), 'slate', 'pvaOnstar'),
        kpiCard('Mantenimientos', num(pva.mantenimiento?.contratos || 0), pct(pva.mantenimiento?.penetracionPct), 'rose', 'pvaMant'),
      ]),
      kpiGroup('Solicitudes F&I', [
        kpiCard('Solicitudes', num(sol.total), 'en el periodo', 'blue', 'solicitudes'),
        kpiCard('Aprobadas', num(sol.aprobadas), `tasa ${pct(sol.tasaAprobacionPct)}`, 'green', 'aprobadas'),
      ]),
    ].join('');

    bindKpiCards();
    restoreOpenKpi();
  }

  function restoreOpenKpi() {
    if (!state.openKpi) return;
    const card = els.kpiRoot?.querySelector(`[data-fi-kpi="${state.openKpi}"]`);
    if (card) {
      const keep = state.openKpi;
      state.openKpi = null;
      openKpiDetail(keep, card);
    }
  }

  function bindKpiCards() {
    els.kpiRoot?.querySelectorAll('[data-fi-kpi]').forEach((card) => {
      const key = card.getAttribute('data-fi-kpi');
      const activate = () => {
        if (state.openKpi === key) {
          closeKpiDetail();
          return;
        }
        openKpiDetail(key, card);
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activate();
        }
      });
    });
  }

  function closeKpiDetail() {
    state.openKpi = null;
    state.mixSearch = '';
    els.kpiRoot?.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
    if (els.detailPanel) els.detailPanel.classList.add('hidden');
    closeFiMixDrawer();
    renderTable(contracts());
  }

  function openKpiDetail(key, card) {
    state.openKpi = key;
    els.kpiRoot?.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
    card?.classList.add('is-open');

    if (MIX_KEYS.has(key)) {
      if (els.detailPanel) els.detailPanel.classList.add('hidden');
      const meta = kpiMeta(key);
      ensureFiMixDrawer().open(rowsForMixKpi(key), card, {
        kpi: key,
        title: meta.title,
        hint: meta.hint,
        icon: mixKpiIcon(key),
      });
      renderTable(contracts());
      return;
    }

    closeFiMixDrawer();
    const meta = kpiMeta(key);
    const rows = rowsForKpi(key);
    const s = state.data?.summary || {};

    let summaryHtml = `<p class="section-subtitle" style="margin:0">${escapeHtml(meta.hint)}</p>`;
    if (key === 'plazo') {
      summaryHtml += `<ul class="fi-detail-stats">${(s.plazos || []).slice(0, 6).map((p) =>
        `<li><strong>${escapeHtml(p.label)}</strong>: ${num(p.count)} (${pct(p.pct)})</li>`
      ).join('')}</ul>`;
    } else if (['conPva', 'pvaGap', 'pvaGarantia', 'pvaAccesorios', 'pvaOnstar', 'pvaMant'].includes(key)) {
      summaryHtml += `<p class="section-subtitle">Monto PVA total del periodo: <strong>${money(s.montoTotalPvas)}</strong></p>`;
    }

    if (els.detailTitle) els.detailTitle.textContent = meta.title;
    if (els.detailResumen) els.detailResumen.innerHTML = summaryHtml;
    if (els.detailPanel) els.detailPanel.classList.remove('hidden');
    renderTable(rows);
  }

  function filteredRows(rows) {
    const q = String(state.search || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.fecha, r.cliente, r.asesor, r.unidad, r.vin, r.contrato, r.factura,
        r.plan, r.tipoCompra, r.plazoMeses, ...(r.pvas || []).map((p) => p.label),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderTable(rows) {
    const body = els.tableBody;
    const meta = els.searchMeta;
    if (!body) return;
    const list = filteredRows(rows || contracts());
    if (meta) {
      meta.textContent = `${list.length} registro${list.length === 1 ? '' : 's'}`;
      meta.classList.toggle('hidden', !state.search && list.length === (rows || contracts()).length);
    }
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty-row">Sin unidades en financiamiento para este filtro.</td></tr>';
      return;
    }
    body.innerHTML = list.map((r) => {
      const pva = (r.pvas || []).map((p) => p.label).join(', ') || '—';
      return `<tr>
        <td>${escapeHtml(dash(r.fecha))}</td>
        <td>${escapeHtml(dash(r.cliente))}</td>
        <td>${escapeHtml(dash(r.asesor))}</td>
        <td>${escapeHtml(dash(r.unidad))}</td>
        <td class="mono">${escapeHtml(dash(r.vin))}</td>
        <td>${escapeHtml(dash(r.contrato))}</td>
        <td>${escapeHtml(dash(r.tipoCompra || r.plan))}${pva !== '—' ? `<div class="fi-pva-tags">${escapeHtml(pva)}</div>` : ''}</td>
        <td class="cell-num">${r.plazoMeses != null ? num(r.plazoMeses) : '—'}</td>
        <td class="cell-num">${r.montoFinanciar != null ? money(r.montoFinanciar) : '—'}</td>
      </tr>`;
    }).join('');
  }

  function renderNotes() {
    const list = els.notesList;
    if (!list) return;
    if (!state.notes.length) {
      list.innerHTML = '<p class="section-subtitle fi-notes-empty">Sin notas aún. Escriba una y guárdela.</p>';
      return;
    }
    list.innerHTML = state.notes.map((n) => {
      const when = n.updatedAt || n.createdAt;
      const whenLabel = when ? new Date(when).toLocaleString('es-MX') : '';
      const period = n.periodo
        ? `<span class="fi-note-period">${escapeHtml(n.periodo.fechaInicio)} → ${escapeHtml(n.periodo.fechaFin)}</span>`
        : '<span class="fi-note-period">General</span>';
      return `<article class="fi-note" data-note-id="${escapeHtml(n.id)}">
        <div class="fi-note-head">
          <strong>${escapeHtml(n.author || 'usuario')}</strong>
          ${period}
          <time datetime="${escapeHtml(when || '')}">${escapeHtml(whenLabel)}</time>
        </div>
        <p class="fi-note-text">${escapeHtml(n.text)}</p>
        <div class="fi-note-actions">
          <button type="button" class="btn-glass btn-sm" data-note-edit="${escapeHtml(n.id)}">Editar</button>
          <button type="button" class="btn-glass btn-sm btn-danger-soft" data-note-del="${escapeHtml(n.id)}">Eliminar</button>
        </div>
      </article>`;
    }).join('');

    list.querySelectorAll('[data-note-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteNote(btn.getAttribute('data-note-del')));
    });
    list.querySelectorAll('[data-note-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-note-edit');
        const note = state.notes.find((n) => n.id === id);
        if (!note || !els.noteInput) return;
        els.noteInput.value = note.text;
        els.noteInput.dataset.editId = id;
        els.noteInput.focus();
        if (els.btnSaveNote) els.btnSaveNote.textContent = 'Actualizar nota';
      });
    });
  }

  async function loadNotes() {
    if (!state.fechaInicio || !state.fechaFin) return;
    const qs = `fechaInicio=${encodeURIComponent(state.fechaInicio)}&fechaFin=${encodeURIComponent(state.fechaFin)}`;
    const res = await fetch(`/api/ventas/financiamiento/notas?${qs}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las notas');
    state.notes = data.notes || [];
    renderNotes();
  }

  async function saveNote() {
    const text = String(els.noteInput?.value || '').trim();
    if (!text) return;
    const editId = els.noteInput?.dataset.editId;
    const scopeGlobal = !!els.noteScopeGlobal?.checked;

    let res;
    if (editId) {
      res = await fetch(`/api/ventas/financiamiento/notas/${encodeURIComponent(editId)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } else {
      res = await fetch('/api/ventas/financiamiento/notas', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          scope: scopeGlobal ? 'global' : 'periodo',
          fechaInicio: state.fechaInicio,
          fechaFin: state.fechaFin,
        }),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la nota');
    if (els.noteInput) {
      els.noteInput.value = '';
      delete els.noteInput.dataset.editId;
    }
    if (els.btnSaveNote) els.btnSaveNote.textContent = 'Guardar nota';
    await loadNotes();
  }

  async function deleteNote(id) {
    if (!id || !window.confirm('¿Eliminar esta nota?')) return;
    const res = await fetch(`/api/ventas/financiamiento/notas/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo eliminar');
    await loadNotes();
  }

  async function loadGerentesCatalog() {
    try {
      const res = await fetch('/api/ventas/financiamiento/gerentes', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar gerentes F&I');
      state.gerentesCatalog = buildGerenteIndex(data);
      return state.gerentesCatalog;
    } catch (err) {
      console.warn('[Financiamiento gerentes]', err.message);
      state.gerentesCatalog = buildGerenteIndex({ asesores: [], gerentes: [] });
      return state.gerentesCatalog;
    }
  }

  async function load(fechaInicio, fechaFin, _porTipoVentaRetail, registrosVentas, entregasSofia) {
    state.fechaInicio = fechaInicio;
    state.fechaFin = fechaFin;
    const gerenteIndex = state.gerentesCatalog || await loadGerentesCatalog();
    state.sofiaRegistros = enrichSofiaEntregas(entregasSofia || [], registrosVentas || [], gerenteIndex);
    state.facturasGmfRegistros = buildFacturasGmf(registrosVentas || [], gerenteIndex, state.sofiaRegistros);
    state.retailMix = buildSofiaGmfMix(state.sofiaRegistros, state.facturasGmfRegistros);
    state.search = '';
    state.mixSearch = '';
    if (els.searchInput) els.searchInput.value = '';
    await loadFacturaNotesIndex();
    updateDisponiblesTimbrarMix();

    if (els.subtitle) {
      els.subtitle.textContent = `Periodo ${fechaInicio} → ${fechaFin} · Penetración GMF sobre entregas SOFIA`;
    }

    try {
      const res = await fetch(
        `/api/ventas/financiamiento?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
        { credentials: 'same-origin' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error financiamiento (${res.status})`);
      state.data = data;
    } catch (err) {
      console.error('[Financiamiento]', err);
      state.data = {
        fuente: { crm: false, reason: err.message },
        summary: {},
        contratos: [],
        solicitudes: { total: 0, aprobadas: 0, muestra: [] },
      };
      if (els.subtitle) els.subtitle.textContent = err.message;
    }

    renderKpis();
    closeKpiDetail();
    renderTable(contracts());
    try {
      await loadNotes();
    } catch (err) {
      console.warn('[Financiamiento notas]', err.message);
      state.notes = [];
      renderNotes();
    }
  }

  function bindDom() {
    els.root = document.getElementById('secFinanciamiento');
    els.subtitle = document.getElementById('fiSubtitle');
    els.kpiRoot = document.getElementById('fiKpiOperational');
    els.detailPanel = document.getElementById('fiKpiDetail');
    els.detailTitle = document.getElementById('fiDetailTitle');
    els.detailResumen = document.getElementById('fiDetailResumen');
    els.btnCloseDetail = document.getElementById('btnCerrarFiDetail');
    els.tableBody = document.getElementById('fiTableBody');
    els.searchInput = document.getElementById('buscarFiPreview');
    els.searchMeta = document.getElementById('fiPreviewSearchMeta');
    els.notesList = document.getElementById('fiNotesList');
    els.noteInput = document.getElementById('fiNoteInput');
    els.btnSaveNote = document.getElementById('btnFiSaveNote');
    els.noteScopeGlobal = document.getElementById('fiNoteScopeGlobal');

    els.btnCloseDetail?.addEventListener('click', closeKpiDetail);
    els.searchInput?.addEventListener('input', () => {
      state.search = els.searchInput.value || '';
      if (state.openKpi && !MIX_KEYS.has(state.openKpi)) {
        openKpiDetail(state.openKpi, els.kpiRoot?.querySelector(`[data-fi-kpi="${state.openKpi}"]`));
      } else {
        renderTable(contracts());
      }
    });
    els.btnSaveNote?.addEventListener('click', () => {
      saveNote().catch((err) => {
        console.error(err);
        window.alert(err.message || 'Error al guardar nota');
      });
    });
  }

  function init() {
    bindDom();
    loadGerentesCatalog().catch(() => {});
  }

  window.FinanciamientoVentas = { init, load };
})();
