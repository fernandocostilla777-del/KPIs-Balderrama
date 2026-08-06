/**
 * Sección Financiamiento en Ventas — KPIs dinámicos.
 * Penetración GMF = entregas SOFIA con GMF / total entregas SOFIA (no facturación).
 */
(function () {
  const CONTADO = new Set(['CONTADO']);
  const EXCLUDE = new Set(['FLOTILLA', 'PERDIDA']);
  const MIX_KEYS = new Set(['facturasGmf', 'gmfDispTimbrar', 'penGmf', 'gmfSofia', 'noGmfSofia']);
  const ONSTAR_KEYS = new Set(['onstarTech']);
  const PVA_KEYS = new Set(['conPva', 'pvaGap', 'pvaGarantia', 'pvaAccesorios', 'pvaOnstar', 'pvaMant']);
  const PVA_SERIES_KEY = {
    conPva: 'conPva',
    pvaGap: 'gap',
    pvaGarantia: 'garantia',
    pvaAccesorios: 'accesorios',
    pvaOnstar: 'onstar',
    pvaMant: 'mantenimiento',
  };

  let state = {
    data: null,
    retailMix: null,
    onstarTech: null,
    pvaTrimestreYtd: null,
    pvaTrimestresOpciones: [],
    pvaQuarterKey: null,
    sofiaRegistros: [],
    facturasGmfRegistros: [],
    facturaNotesByDocto: {},
    gerentesCatalog: null,
    openKpi: null,
    mixSearch: '',
    fechaInicio: null,
    fechaFin: null,
    search: '',
    cacheKey: null,
    mixReady: false,
    loadSeq: 0,
    desiredKey: null,
    inflightKey: null,
    inflightPromise: null,
  };

  const els = {};
  let mixDrawerUi = null;
  let facturaDetailUi = null;
  let contratoDetailUi = null;

  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return fmt.money(Number(n));
  }

  /** Montos en KPI: compactos para que no se partan/encimen en la tarjeta. */
  function moneyKpi(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return fmt.currency(Number(n));
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
      kpiCard('Contado', num(mix.noGmf), 'entregas SOFIA de contado', 'slate', 'noGmfSofia'),
      kpiCard('Penetración GMF', pct(mix.penetracionGmfPct), `${num(mix.gmf)} de ${num(mix.totalSofia)} entregas`, 'violet', 'penGmf'),
      (() => {
        const os = state.onstarTech || {};
        const mesLabel = os.periodo?.label ? `mes ${os.periodo.label}` : 'mes actual';
        return kpiCard(
          'OnStar',
          pct(os.penetracionPct),
          `${num(os.conContrato)} de ${num(os.elegibles)} elegibles SOFIA · ${mesLabel}`,
          'amber',
          'onstarTech'
        );
      })(),
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
    const list = contracts().map((c) => ({
      ...c,
      gerenteFi: String(c.fi || '').trim() || 'Sin gerente F&I',
    }));
    const sol = state.data?.solicitudes;
    switch (key) {
      case 'onstarTech':
        return (state.onstarTech?.muestra || []).map((c) => ({
          ...c,
          gerenteFi: String(c.fi || c.gerenteFi || '').trim() || 'Sin gerente F&I',
        }));
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
      case 'unidadesNuevos':
        return list.filter((c) => volumeTipoOf(c) === 'nuevo');
      case 'unidadesSeminuevos':
        return list.filter((c) => volumeTipoOf(c) === 'seminuevo');
      case 'unidadesFlotilla':
        return list.filter((c) => volumeTipoOf(c) === 'flotilla');
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
          idCrm: r.idCrm || null,
          noSolicitud: r.noSolicitud || null,
          contrato: r.contrato,
          asesor: r.asesor || null,
          financiera: r.financiera || null,
          unidad: r.unidad || null,
          tipoCompra: r.estatus,
          plan: r.financiera,
          estatus: r.estatus || null,
          respuestaFinanciera: r.respuestaFinanciera || null,
          biometrico: r.biometrico || null,
          fi: r.fi || null,
          afi: r.afi || null,
          gerenteFi: String(r.fi || '').trim() || 'Sin gerente F&I',
          plazoMeses: null,
          engancheMonto: r.enganche,
          montoFinanciar: null,
          pvas: [],
          cantidadPvas: 0,
        }));
      case 'aprobadas':
        return rowsForKpi('solicitudes').filter((r) =>
          String(r.estatus || r.tipoCompra || '').toUpperCase().includes('APROBADA')
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
      noGmfSofia: { title: 'Entregas de contado', hint: 'Entregas SOFIA sin GMF · ventas de contado' },
      onstarTech: {
        title: 'OnStar',
        hint: (() => {
          const os = state.onstarTech || {};
          const mes = os.periodo?.label || 'mes actual';
          return `Contrato OnStar (Sheets) ÷ entregas SOFIA con tech OnStar · ${mes}`;
        })(),
      },
      contratos: { title: 'Contratos colocados', hint: 'Contratos F&I en el periodo (CRM)' },
      unidades: { title: 'Unidades financiadas', hint: 'VIN distintos con contrato' },
      unidadesNuevos: {
        title: 'Nuevos',
        hint: 'Contratos de unidades nuevas (sin flotillas)',
      },
      unidadesSeminuevos: {
        title: 'Seminuevos',
        hint: 'Contratos de unidades seminuevas',
      },
      unidadesFlotilla: {
        title: 'Flotillas',
        hint: 'Contratos de flotilla (restadas de Nuevos)',
      },
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
      onstarTech: 'cell_tower',
      contratos: 'description',
      unidades: 'directions_car',
      unidadesNuevos: 'directions_car',
      unidadesSeminuevos: 'airport_shuttle',
      unidadesFlotilla: 'local_shipping',
      montoTotal: 'payments',
      montoPromedio: 'payments',
      enganche: 'account_balance_wallet',
      plazo: 'schedule',
      conPva: 'workspace_premium',
      pvaGap: 'security',
      pvaGarantia: 'verified',
      pvaAccesorios: 'build',
      pvaOnstar: 'sensors',
      pvaMant: 'car_repair',
      solicitudes: 'request_quote',
      aprobadas: 'check_circle',
    };
    return map[key] || 'analytics';
  }

  function isMixKpi(key) {
    return MIX_KEYS.has(key);
  }

  function isOnstarKpi(key) {
    return ONSTAR_KEYS.has(key);
  }

  function isPvaKpi(key) {
    return PVA_KEYS.has(key);
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

  function downloadCrmCsv(rows, title) {
    const isOnstar = String(title || '').toLowerCase().includes('onstar') || state.openKpi === 'onstarTech';
    const headers = isOnstar
      ? ['Fecha', 'Cliente', 'Asesor', 'Unidad', 'VIN', 'Contrato', 'OnStar', 'Plazo OnStar', 'Monto OnStar', 'GerenteFI']
      : ['Fecha', 'Cliente', 'Asesor', 'Unidad', 'VIN', 'Contrato', 'Factura', 'Tipo', 'Especial', 'Plan', 'Plazo', 'Enganche', 'Monto', 'PVAs'];
    const lines = [headers.join(',')];
    for (const r of rows || []) {
      const vals = isOnstar
        ? [
          r.fecha, r.cliente, r.asesor, r.unidad, r.vin, r.contrato,
          r.hasOnstarContrato ? 'SI' : 'NO', r.plazoOnstar, r.onstarMonto, r.gerenteFi || r.fi,
        ]
        : [
          r.fecha, r.cliente, r.asesor, r.unidad, r.vin, r.contrato, r.factura,
          r.tipoCompra, r.especial, r.plan, r.plazoMeses, r.engancheMonto, r.montoFinanciar,
          (r.pvas || []).map((p) => p.label).join(' | '),
        ];
      lines.push(vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    const safe = String(title || 'financiamiento').replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ]+/gi, '_').slice(0, 40);
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
      <div class="ops-orders-drawer__main" data-fi-mix-main>
        <div class="ops-orders-drawer__data" data-fi-mix-data>
          <aside class="ops-orders-drawer__summary custom-scrollbar" data-fi-mix-summary></aside>
          <div class="ops-orders-drawer__body custom-scrollbar" data-fi-mix-body></div>
        </div>
        <div class="fi-pva-ytd-panel hidden" data-fi-pva-ytd-panel>
          <div class="fi-pva-ytd-panel__head">
            <div class="fi-pva-ytd-panel__head-main">
              <h5 data-fi-pva-ytd-title>YTD trimestre</h5>
              <label class="fi-pva-ytd-panel__quarter" for="fiPvaQuarterSelect">
                <span class="visually-hidden">Trimestre</span>
                <select id="fiPvaQuarterSelect" data-fi-pva-ytd-quarter aria-label="Seleccionar trimestre"></select>
              </label>
              <label class="fi-pva-ytd-panel__width" for="fiPvaWidthSelect">
                <span class="visually-hidden">Ancho de gráfica</span>
                <select id="fiPvaWidthSelect" data-fi-pva-ytd-width aria-label="Ancho de la gráfica">
                  <option value="sm">Ancho: compacto</option>
                  <option value="md" selected>Ancho: medio</option>
                  <option value="lg">Ancho: amplio</option>
                  <option value="xl">Ancho: extra</option>
                </select>
              </label>
            </div>
            <span class="fi-pva-ytd-panel__meta" data-fi-pva-ytd-meta></span>
          </div>
          <div class="fi-pva-ytd-panel__chart">
            <canvas data-fi-pva-ytd-chart aria-label="Gráfica YTD PVA trimestre"></canvas>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-fi-mix-status]');
    const metaEl = panel.querySelector('[data-fi-mix-meta]');
    const bodyEl = panel.querySelector('[data-fi-mix-body]');
    const summaryEl = panel.querySelector('[data-fi-mix-summary]');
    const mainEl = panel.querySelector('[data-fi-mix-main]');
    const searchEl = panel.querySelector('#fiMixSearch');
    const filterChip = panel.querySelector('[data-fi-mix-filter-chip]');
    const expandBtn = panel.querySelector('[data-fi-mix-expand]');
    const expandIcon = panel.querySelector('[data-fi-mix-expand-icon]');
    const downloadBtn = panel.querySelector('[data-fi-mix-download]');
    const titleEl = panel.querySelector('[data-fi-mix-title]');
    const logoEl = panel.querySelector('[data-fi-mix-logo]');
    const pvaYtdPanel = panel.querySelector('[data-fi-pva-ytd-panel]');
    const pvaYtdTitle = panel.querySelector('[data-fi-pva-ytd-title]');
    const pvaYtdMeta = panel.querySelector('[data-fi-pva-ytd-meta]');
    const pvaYtdCanvas = panel.querySelector('[data-fi-pva-ytd-chart]');
    const pvaYtdQuarter = panel.querySelector('[data-fi-pva-ytd-quarter]');
    const pvaYtdWidth = panel.querySelector('[data-fi-pva-ytd-width]');

    let expanded = false;
    let activeFilter = null;
    let sourceRows = [];
    let lastExportRows = [];
    let currentMeta = { kpi: '', title: 'Penetración GMF', hint: '', icon: 'account_balance' };
    let lastCard = null;
    let pvaYtdChart = null;
    const PVA_WIDTH_KEY = 'fiPvaChartWidth';
    const PVA_WIDTHS = new Set(['sm', 'md', 'lg', 'xl']);

    function applyPvaChartWidth(size) {
      const next = PVA_WIDTHS.has(size) ? size : 'md';
      if (pvaYtdPanel) pvaYtdPanel.dataset.chartWidth = next;
      if (pvaYtdWidth && pvaYtdWidth.value !== next) pvaYtdWidth.value = next;
      try { localStorage.setItem(PVA_WIDTH_KEY, next); } catch { /* ignore */ }
      if (pvaYtdChart) {
        window.requestAnimationFrame(() => {
          try { pvaYtdChart.resize(); } catch { /* ignore */ }
        });
      }
    }

    function initPvaChartWidth() {
      let saved = 'md';
      try {
        const raw = localStorage.getItem(PVA_WIDTH_KEY);
        if (PVA_WIDTHS.has(raw)) saved = raw;
      } catch { /* ignore */ }
      applyPvaChartWidth(saved);
    }

    const FILTER_DIM_LABEL = {
      tipo: 'Tipo',
      vendedor: 'Vendedor',
      canal: 'Canal',
      gmf: 'GMF',
      gerente: 'Gerente F&I',
      sofia: 'SOFIA',
      asesor: 'Asesor',
      plan: 'Plan',
      plazo: 'Plazo',
      onstar: 'OnStar',
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
      if (!isMixKpi(currentMeta.kpi)) {
        if (activeFilter.dim === 'asesor') return String(r.asesor || 'Sin asesor') === activeFilter.value;
        if (activeFilter.dim === 'tipo') return String(r.tipoCompra || r.plan || 'Sin tipo') === activeFilter.value;
        if (activeFilter.dim === 'plan') return String(r.plan || 'Sin plan') === activeFilter.value;
        if (activeFilter.dim === 'gerente') {
          return String(r.gerenteFi || r.fi || 'Sin gerente F&I') === activeFilter.value;
        }
        if (activeFilter.dim === 'plazo') {
          const label = r.plazoMeses != null ? `${r.plazoMeses} mes` : 'Sin plazo';
          return label === activeFilter.value;
        }
        if (activeFilter.dim === 'onstar') {
          return activeFilter.value === 'CON'
            ? Boolean(r.hasOnstarContrato)
            : !r.hasOnstarContrato;
        }
        return true;
      }
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

      if (!isMixKpi(currentMeta.kpi)) {
        const s = state.data?.summary || {};
        const isSolicitudes = currentMeta.kpi === 'solicitudes' || currentMeta.kpi === 'aprobadas';
        const isOnstar = isOnstarKpi(currentMeta.kpi);
        const porGerente = countByField(rows, (r) => r.gerenteFi || r.fi || 'Sin gerente F&I');
        const porAsesor = countByField(rows, (r) => r.asesor || 'Sin asesor').slice(0, 10);
        const porTipo = countByField(rows, (r) => r.tipoCompra || r.plan || 'Sin tipo').slice(0, 10);
        const porPlan = countByField(rows, (r) => r.plan || 'Sin plan').slice(0, 8);
        const porPlazo = countByField(rows, (r) => (r.plazoMeses != null ? `${r.plazoMeses} mes` : 'Sin plazo')).slice(0, 8);
        const monto = rows.reduce((acc, r) => acc + Number(r.montoFinanciar || 0), 0);
        const enganche = rows.reduce((acc, r) => acc + Number(r.engancheMonto || 0), 0);

        if (isOnstar) {
          const os = state.onstarTech || {};
          const con = rows.filter((r) => r.hasOnstarContrato).length;
          const sin = rows.length - con;
          const porUnidad = countByField(rows, (r) => r.unidad || 'Sin unidad').slice(0, 10);
          summaryEl.innerHTML = `
            <div class="ops-orders-drawer__group">
              <h5>Resumen</h5>
              <div class="ops-orders-drawer__row"><span class="lbl">Elegibles (tech OnStar)</span><span class="val">${num(os.elegibles ?? rows.length)}</span></div>
              <div class="ops-orders-drawer__row"><span class="lbl">Con contrato OnStar</span><span class="val">${num(os.conContrato ?? con)}</span></div>
              <div class="ops-orders-drawer__row"><span class="lbl">Sin contrato</span><span class="val">${num(os.sinContrato ?? sin)}</span></div>
              <div class="ops-orders-drawer__row"><span class="lbl">Penetración</span><span class="val">${pct(os.penetracionPct)}</span></div>
              <p class="ops-orders-drawer__hint">Base: entregas SOFIA del mes ${escapeHtml(os.periodo?.label || '')} · contrato desde Sheets (plazo/monto OnStar)</p>
              <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
            </div>
            <div class="ops-orders-drawer__group">
              <h5>Filtro rápido</h5>
              <button type="button" class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('onstar', 'CON') ? ' is-active' : ''}"
                data-fi-filter-dim="onstar" data-fi-filter-value="CON" data-fi-filter-label="Con contrato OnStar"
                title="Filtrar con contrato OnStar">
                <span class="lbl">Con contrato</span>
                <span class="val">${num(con)}</span>
              </button>
              <button type="button" class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('onstar', 'SIN') ? ' is-active' : ''}"
                data-fi-filter-dim="onstar" data-fi-filter-value="SIN" data-fi-filter-label="Sin contrato OnStar"
                title="Filtrar sin contrato OnStar">
                <span class="lbl">Sin contrato</span>
                <span class="val">${num(sin)}</span>
              </button>
            </div>
            ${block('Por unidad', 'tipo', porUnidad)}
            ${block('Por gerente F&I', 'gerente', porGerente)}
            ${block('Por asesor', 'asesor', porAsesor)}
          `;
          return;
        }

        summaryEl.innerHTML = `
          <div class="ops-orders-drawer__group">
            <h5>Resumen</h5>
            <div class="ops-orders-drawer__row"><span class="lbl">Registros</span><span class="val">${num(rows.length)}</span></div>
            ${isSolicitudes ? '' : `
            <div class="ops-orders-drawer__row"><span class="lbl">Monto a financiar</span><span class="val">${money(monto)}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Enganche</span><span class="val">${money(enganche)}</span></div>
            `}
            ${currentMeta.kpi === 'plazo' && (s.plazos || []).length
              ? `<p class="ops-orders-drawer__hint">Distribución de plazos del periodo</p>`
              : ''}
            <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
          </div>
          ${block('Por gerente F&I', 'gerente', porGerente)}
          ${block('Por asesor', 'asesor', porAsesor)}
          ${block(isSolicitudes ? 'Por estatus' : 'Por tipo', 'tipo', porTipo)}
          ${isSolicitudes
            ? block('Por financiera', 'plan', porPlan)
            : `${block('Por plan', 'plan', porPlan)}${block('Por plazo', 'plazo', porPlazo)}`}
        `;
        return;
      }

      const porGerente = countByField(rows, (r) => r.GERENTE_FI || 'Sin gerente F&I');
      const porTipo = countByField(rows, (r) => tipoOf(r)).slice(0, 10);
      const porVendedor = countByField(rows, (r) => r.VENDEDOR || 'Sin vendedor').slice(0, 8);
      const porCanal = countByField(rows, (r) => r.CANAL_LABEL || 'Sin canal').slice(0, 8);

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
          <div class="ops-orders-drawer__row"><span class="lbl">Contado</span><span class="val">${num(mix.noGmf)}</span></div>
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
            data-fi-filter-dim="gmf" data-fi-filter-value="NO_GMF"><span class="lbl">Contado</span><span class="val">${num(mix.noGmf)}</span></button>
        </div>
        ${block('Por tipo', 'tipo', porTipo)}
        ${block('Por vendedor', 'vendedor', porVendedor)}
        ${block('Por canal', 'canal', porCanal)}
      `;
    }

    function renderList(term = '') {
      const q = String(term || '').trim().toLowerCase();
      const crmMode = !isMixKpi(currentMeta.kpi);

      const searched = !q
        ? sourceRows
        : sourceRows.filter((r) => {
          const fields = crmMode
            ? [r.fecha, r.cliente, r.asesor, r.unidad, r.vin, r.contrato, r.factura, r.plan, r.tipoCompra, r.especial, r.plazoMeses,
              r.estatus, r.financiera, r.respuestaFinanciera, r.biometrico, r.idCrm, r.noSolicitud,
              r.gerenteFi, r.fi, r.afi, r.plazoOnstar, r.onstarMonto,
              r.hasOnstarContrato ? 'con onstar' : 'sin onstar',
              ...(r.pvas || []).map((p) => p.label)]
            : [r.VTE_FECHDOCTO, r.FECHA_PERIODO, r.SOF_Factura, r.VTE_DOCTO, r.SOF_VIN, r.VTE_SERIE,
              r.CLIENTE, r.VENDEDOR, r.GERENTE_FI, r.VEH_TIPOAUTO, r.CANAL_LABEL, r.TIPOVENTA, r.FORMAPAGO_ORIGINAL];
          return fields.some((v) => String(v || '').toLowerCase().includes(q));
        });

      const filtered = searched.filter(matchesActiveFilter);
      lastExportRows = filtered;

      const isFacturas = currentMeta.kpi === 'facturasGmf' || currentMeta.kpi === 'gmfDispTimbrar';
      const isDisp = currentMeta.kpi === 'gmfDispTimbrar';
      if (crmMode) {
        statusEl.textContent = isOnstarKpi(currentMeta.kpi)
          ? `${filtered.length.toLocaleString('es-MX')} unidad(es) elegible(s)`
          : `${filtered.length.toLocaleString('es-MX')} registro(s)`;
      } else {
        statusEl.textContent = isDisp
          ? `${filtered.length.toLocaleString('es-MX')} disponible(s) para timbrar`
          : isFacturas
            ? `${filtered.length.toLocaleString('es-MX')} factura(s) GMF`
            : `${filtered.length.toLocaleString('es-MX')} entrega(s)`;
      }
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
              : (crmMode
                ? 'No hay registros para este indicador.'
                : (isDisp
                  ? 'No hay GMF sin SOFIA con nota CONTRATO COMPRADO.'
                  : (isFacturas ? 'No hay facturas GMF en el periodo.' : 'No hay entregas SOFIA para este indicador.')))}</p>
          </div>`;
        return;
      }

      if (crmMode) {
        const isSolicitudes = currentMeta.kpi === 'solicitudes' || currentMeta.kpi === 'aprobadas';
        const isOnstar = isOnstarKpi(currentMeta.kpi);
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__list-head">
            <h5>${isSolicitudes ? 'Detalle solicitudes' : (isOnstar ? 'Entregas SOFIA · tech OnStar' : 'Detalle F&amp;I')}</h5>
            <span>${filtered.length.toLocaleString('es-MX')}</span>
          </div>
          ${filtered.map((r, idx) => {
            if (r._kind === 'solicitud' || isSolicitudes) {
              const bioRaw = String(r.biometrico || '').trim().toUpperCase();
              const bioLabel = bioRaw === 'SI' || bioRaw === 'SÍ' || bioRaw === 'YES'
                ? 'Con biométrico'
                : (bioRaw === 'NO'
                  ? 'Sin biométrico'
                  : (bioRaw ? bioRaw : 'Biométrico n/d'));
              const bioClass = bioRaw === 'SI' || bioRaw === 'SÍ' || bioRaw === 'YES'
                ? 'fi-list-chip--ok'
                : (bioRaw === 'NO' ? 'fi-list-chip--warn' : '');
              const idCrm = String(r.idCrm || '').trim();
              const respuesta = String(r.respuestaFinanciera || '').trim();
              const estatus = r.estatus || r.tipoCompra || 'Solicitud';
              return `
              <div class="ops-orders-drawer__item" style="cursor:default">
                <div class="ops-orders-drawer__item-head">
                  <strong>${escapeHtml(dash(r.noSolicitud || r.cliente))}</strong>
                  <span class="ops-orders-drawer__tag">${escapeHtml(dash(estatus))}</span>
                </div>
                ${idCrm ? `
                  <a class="fi-seguimiento-link" href="/seguimiento.html?id=${encodeURIComponent(idCrm)}" target="_blank" rel="noopener">
                    <span class="material-symbols-outlined" aria-hidden="true">hub</span>
                    Ver Seguimiento 360
                  </a>` : `
                  <p class="fi-seguimiento-link fi-seguimiento-link--disabled">Sin ID CRM para Seguimiento 360</p>`}
                <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.cliente))} · ${escapeHtml(dash(r.asesor))}</p>
                <div class="ops-orders-drawer__facts">
                  <span>${escapeHtml(dash(r.financiera || r.plan))}</span>
                  <span class="fi-list-chip ${bioClass}">${escapeHtml(bioLabel)}</span>
                  <span>${escapeHtml(dash(r.gerenteFi || r.fi))}</span>
                </div>
                <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
                  <span>${escapeHtml(dash(r.fecha))}</span>
                  <span>${r.engancheMonto != null ? `Eng. ${money(r.engancheMonto)}` : '—'}</span>
                  <span>${idCrm ? `CRM ${escapeHtml(idCrm)}` : 'Sin CRM'}</span>
                </div>
                <p class="ops-orders-drawer__sub fi-respuesta-financiera" title="${escapeHtml(respuesta || 'Sin respuesta financiera')}">
                  <span class="fi-respuesta-financiera__label">Respuesta financiera:</span>
                  ${escapeHtml(respuesta || 'Sin respuesta registrada')}
                </p>
              </div>`;
            }

            const pva = (r.pvas || []).map((p) => p.label).join(', ') || 'Sin PVA';
            const isOnstar = isOnstarKpi(currentMeta.kpi) || r._kind === 'onstarTech';
            const tipoLabel = String(r.tipoCompra || '').trim() || null;
            const especialLabel = String(r.especial || '').trim() || null;
            const tag = isOnstar
              ? (r.hasOnstarContrato ? 'Con OnStar' : 'Sin OnStar')
              : (tipoLabel || especialLabel || r.plan || 'Contrato');
            const onstarFacts = isOnstar
              ? `<div class="ops-orders-drawer__facts">
                  <span class="fi-list-chip ${r.hasOnstarContrato ? 'fi-list-chip--ok' : 'fi-list-chip--warn'}">${r.hasOnstarContrato ? 'Contrato OnStar' : 'Sin contrato'}</span>
                  <span>${r.plazoOnstar ? `Plazo ${escapeHtml(String(r.plazoOnstar))}` : 'Sin plazo OnStar'}</span>
                  <span>${r.onstarMonto != null && Number(r.onstarMonto) > 0 ? money(r.onstarMonto) : 'Sin monto'}</span>
                </div>`
              : `<div class="ops-orders-drawer__facts">
                  <span>${escapeHtml(dash(r.unidad))}</span>
                  <span>${r.plazoMeses != null ? `${num(r.plazoMeses)} mes` : '—'}</span>
                  <span>${escapeHtml(dash(r.gerenteFi || r.fi))}</span>
                </div>`;
            const contratoNo = dash(r.contrato || r.noContrato);
            const facturaNo = dash(r.factura);
            const title = r.contrato || r.noContrato || r.vin || r.cliente || 'Contrato';
            return `
              <button type="button" class="ops-orders-drawer__item" data-fi-contrato-idx="${idx}" title="Ver detalle del contrato">
                <div class="ops-orders-drawer__item-head">
                  <strong>${escapeHtml(dash(title))}</strong>
                  <span class="ops-orders-drawer__tag">${escapeHtml(dash(tag))}</span>
                </div>
                <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.cliente))} · ${escapeHtml(dash(r.asesor))}</p>
                ${onstarFacts}
                <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
                  <span>${escapeHtml(dash(r.fecha))}</span>
                  ${isOnstar
                    ? `<span>${escapeHtml(dash(r.unidad))}</span><span>${escapeHtml(dash(r.gerenteFi || r.fi))}</span>`
                    : `<span>${r.montoFinanciar != null ? money(r.montoFinanciar) : '—'}</span>
                       <span>${r.engancheMonto != null ? `Eng. ${money(r.engancheMonto)}` : '—'}</span>`}
                </div>
                ${isOnstar ? '' : `
                <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
                  <span class="mono">VIN ${escapeHtml(dash(r.vin))}</span>
                  <span>Contrato ${escapeHtml(contratoNo)}</span>
                  <span>Factura ${escapeHtml(facturaNo)}</span>
                </div>
                <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
                  <span>${escapeHtml(tipoLabel || 'Sin tipo')}</span>
                  <span>${escapeHtml(especialLabel || 'Sin especial')}</span>
                  <span>${escapeHtml(dash(r.plan))}</span>
                </div>`}
                <p class="ops-orders-drawer__sub">${escapeHtml(isOnstar ? (r.contrato || pva) : pva)} · Clic para ver detalle</p>
                <span class="ops-orders-drawer__open-hint">
                  <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                  Abrir detalle
                </span>
              </button>`;
          }).join('')}`;
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
          const serie = String(r.SOF_VIN || r.VTE_SERIE || '').trim();
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
                <strong>${escapeHtml(dash(serie))}</strong>
                <span class="ops-orders-drawer__tag">${escapeHtml(gmfTag)}</span>
              </div>
              ${clickable ? `<div class="fi-list-meta">${sofiaChip}${noteBlock}</div>` : ''}
              <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.CLIENTE))} · ${escapeHtml(dash(r.VENDEDOR))}</p>
              <div class="ops-orders-drawer__facts">
                <span>${escapeHtml(dash(r.VEH_TIPOAUTO))}</span>
                <span>${escapeHtml(dash(r.CANAL_LABEL))}</span>
                <span>Doc. ${escapeHtml(dash(docto))}</span>
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

    function destroyPvaYtdChart() {
      if (pvaYtdChart) {
        try { pvaYtdChart.destroy(); } catch { /* ignore */ }
        pvaYtdChart = null;
      }
      if (pvaYtdPanel) pvaYtdPanel.classList.add('hidden');
      mainEl?.classList.remove('ops-orders-drawer__main--with-pva');
    }

    function fillPvaQuarterSelect(ytd) {
      if (!pvaYtdQuarter) return;
      const opts = state.pvaTrimestresOpciones || state.data?.pvaTrimestresOpciones || [];
      const selectedKey = state.pvaQuarterKey
        || ytd?.key
        || (ytd?.anio && ytd?.trimestre ? `${ytd.anio}-T${ytd.trimestre}` : null)
        || opts[0]?.key
        || '';
      if (!opts.length) {
        pvaYtdQuarter.innerHTML = selectedKey
          ? `<option value="${escapeHtml(selectedKey)}">${escapeHtml(ytd?.label || selectedKey)}</option>`
          : '';
        return;
      }
      pvaYtdQuarter.innerHTML = opts.map((o) => {
        const sel = o.key === selectedKey ? ' selected' : '';
        return `<option value="${escapeHtml(o.key)}"${sel}>${escapeHtml(o.label)}</option>`;
      }).join('');
      if (selectedKey) state.pvaQuarterKey = selectedKey;
    }

    async function loadPvaTrimestre(anio, trimestre) {
      try {
        const qs = new URLSearchParams({
          anio: String(anio),
          trimestre: String(trimestre),
        });
        const res = await fetch(`/api/ventas/financiamiento/pva-trimestre?${qs}`, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Error PVA (${res.status})`);
        state.pvaTrimestreYtd = data.pvaTrimestreYtd || null;
        if (Array.isArray(data.pvaTrimestresOpciones) && data.pvaTrimestresOpciones.length) {
          state.pvaTrimestresOpciones = data.pvaTrimestresOpciones;
        }
        if (state.pvaTrimestreYtd?.key) state.pvaQuarterKey = state.pvaTrimestreYtd.key;
        else state.pvaQuarterKey = `${anio}-T${trimestre}`;
      } catch (err) {
        console.error('[Financiamiento PVA trimestre]', err);
        if (pvaYtdMeta) pvaYtdMeta.textContent = err.message || 'No se pudo cargar el trimestre';
      }
    }

    function renderPvaYtdChart(kpiKey) {
      destroyPvaYtdChart();
      if (!isPvaKpi(kpiKey) || !pvaYtdPanel || !pvaYtdCanvas) return;

      const ytd = state.pvaTrimestreYtd || state.data?.pvaTrimestreYtd;
      const seriesKey = PVA_SERIES_KEY[kpiKey];
      const serie = ytd?.series?.[seriesKey];

      mainEl?.classList.add('ops-orders-drawer__main--with-pva');
      pvaYtdPanel.classList.remove('hidden');
      fillPvaQuarterSelect(ytd);

      if (!ytd || !serie) {
        if (pvaYtdTitle) pvaYtdTitle.textContent = currentMeta.title || 'PVA por mes';
        if (pvaYtdMeta) pvaYtdMeta.textContent = 'Sin datos del trimestre';
        return;
      }

      if (typeof Chart === 'undefined') {
        if (pvaYtdMeta) pvaYtdMeta.textContent = 'Chart.js no disponible';
        return;
      }

      if (pvaYtdTitle) {
        pvaYtdTitle.textContent = `${currentMeta.title || 'PVA'} por mes`;
      }
      const mensual = serie.mensual || [];
      const totalMeses = mensual.reduce((s, n) => s + Number(n || 0), 0);
      if (pvaYtdMeta) {
        pvaYtdMeta.textContent = `${totalMeses.toLocaleString('es-MX')} unidades en el trimestre`;
      }

      const labels = ytd.labels || [];
      pvaYtdChart = new Chart(pvaYtdCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              type: 'bar',
              label: 'Unidades del mes',
              data: mensual,
              backgroundColor: 'rgba(37, 99, 235, 0.55)',
              borderColor: '#2563EB',
              borderWidth: 1,
              borderRadius: 6,
              yAxisID: 'y',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { boxWidth: 10, font: { size: 11 } },
            },
            tooltip: {
              callbacks: {
                afterBody(items) {
                  const idx = items?.[0]?.dataIndex;
                  if (idx == null) return '';
                  const pen = serie.penetracionMesPct?.[idx];
                  return pen != null ? `Penetración del mes: ${pen}%` : '';
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11 } },
            },
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0,
                font: { size: 11 },
              },
              grid: { color: 'rgba(148, 163, 184, 0.25)' },
            },
          },
        },
      });
    }

    function close() {
      closeFacturaDetail();
      destroyPvaYtdChart();
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
      state.openKpi = null;
      els.kpiRoot?.querySelectorAll('.kpi-card--clickable.is-open').forEach((c) => c.classList.remove('is-open'));
    }

    function open(rows, card, meta = {}) {
      currentMeta = {
        kpi: meta.kpi || '',
        title: meta.title || 'Financiamiento',
        hint: meta.hint || '',
        icon: meta.icon || 'analytics',
      };
      lastCard = card || null;
      if (titleEl) titleEl.textContent = currentMeta.title;
      if (logoEl) logoEl.textContent = currentMeta.icon;
      panel.setAttribute('aria-label', currentMeta.title);
      if (searchEl) {
        searchEl.placeholder = isMixKpi(currentMeta.kpi)
          ? 'Buscar factura, VIN, cliente, tipo...'
          : (currentMeta.kpi === 'solicitudes' || currentMeta.kpi === 'aprobadas'
            ? 'Buscar cliente, solicitud, financiera, respuesta, CRM...'
            : (isOnstarKpi(currentMeta.kpi)
              ? 'Buscar VIN, unidad, cliente, plazo OnStar...'
              : 'Buscar cliente, VIN, asesor, contrato, PVA...'));
      }

      sourceRows = (rows || []).slice();
      if (searchEl) searchEl.value = '';
      activeFilter = null;
      updateFilterChip();
      placeNearKpi(card);
      setExpanded(true);
      renderList('');
      renderPvaYtdChart(currentMeta.kpi);
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
        window.alert('No hay registros para descargar.');
        return;
      }
      if (isMixKpi(currentMeta.kpi)) downloadMixCsv(lastExportRows, currentMeta.title);
      else downloadCrmCsv(lastExportRows, currentMeta.title);
    });
    pvaYtdQuarter?.addEventListener('change', async () => {
      const key = String(pvaYtdQuarter.value || '');
      const m = key.match(/^(\d{4})-T([1-4])$/);
      if (!m || !isPvaKpi(currentMeta.kpi)) return;
      state.pvaQuarterKey = key;
      if (pvaYtdMeta) pvaYtdMeta.textContent = 'Cargando trimestre…';
      await loadPvaTrimestre(Number(m[1]), Number(m[2]));
      renderPvaYtdChart(currentMeta.kpi);
    });
    pvaYtdWidth?.addEventListener('change', () => {
      applyPvaChartWidth(pvaYtdWidth.value);
    });
    initPvaChartWidth();
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
      const facturaBtn = e.target.closest('[data-fi-factura]');
      if (facturaBtn && bodyEl.contains(facturaBtn)) {
        const docto = facturaBtn.getAttribute('data-fi-factura');
        if (docto) openFacturaDetail(docto);
        return;
      }
      const contratoBtn = e.target.closest('[data-fi-contrato-idx]');
      if (contratoBtn && bodyEl.contains(contratoBtn)) {
        const idx = Number(contratoBtn.getAttribute('data-fi-contrato-idx'));
        const row = Number.isFinite(idx) ? lastExportRows[idx] : null;
        if (row) openContratoDetail(row);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (contratoDetailUi?.isOpen?.()) {
        closeContratoDetail();
        return;
      }
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

  function openContratoDetail(row) {
    ensureContratoDetailPanel().open(row);
  }

  function closeContratoDetail() {
    if (contratoDetailUi) contratoDetailUi.close();
  }

  function ensureContratoDetailPanel() {
    if (contratoDetailUi) return contratoDetailUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-order-detail-backdrop';
    backdrop.id = 'fiContratoDetailBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-order-detail';
    panel.id = 'fiContratoDetail';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle de contrato');
    panel.innerHTML = `
      <div class="ops-order-detail__header">
        <div class="ops-order-detail__title-wrap">
          <span class="material-symbols-outlined ops-order-detail__logo">description</span>
          <div>
            <h2 class="ops-order-detail__title" data-cd-title>Contrato</h2>
            <span class="ops-order-detail__status" data-cd-status></span>
          </div>
        </div>
        <div class="ops-order-detail__actions">
          <button type="button" class="ops-order-detail__icon-btn" data-cd-expand title="Expandir" aria-label="Expandir">
            <span class="material-symbols-outlined" data-cd-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-order-detail__icon-btn" data-cd-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-order-detail__body custom-scrollbar" data-cd-body></div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const titleEl = panel.querySelector('[data-cd-title]');
    const statusEl = panel.querySelector('[data-cd-status]');
    const bodyEl = panel.querySelector('[data-cd-body]');
    const expandBtn = panel.querySelector('[data-cd-expand]');
    const expandIcon = panel.querySelector('[data-cd-expand-icon]');
    let expanded = false;

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
    }

    function row(label, value) {
      return `
        <div class="ops-orders-drawer__row">
          <span class="lbl">${escapeHtml(label)}</span>
          <span class="val">${escapeHtml(value == null || value === '' ? '—' : String(value))}</span>
        </div>`;
    }

    function rowMoney(label, value) {
      const v = value != null && Number.isFinite(Number(value)) ? money(value) : '—';
      return `
        <div class="ops-orders-drawer__row">
          <span class="lbl">${escapeHtml(label)}</span>
          <span class="val">${escapeHtml(v)}</span>
        </div>`;
    }

    function open(record) {
      const r = record || {};
      const title = r.contrato || r.noContrato || r.vin || 'Contrato';
      titleEl.textContent = title;
      statusEl.textContent = [r.tipoCompra, r.especial].filter(Boolean).join(' · ') || 'Detalle F&I';

      const pvas = (r.pvas || []).length
        ? (r.pvas || []).map((p) => `
            <div class="ops-orders-drawer__row">
              <span class="lbl">${escapeHtml(p.label || p.key)}</span>
              <span class="val">${p.monto != null ? escapeHtml(money(p.monto)) : '—'}</span>
            </div>`).join('')
        : '<p class="ops-order-detail__hint">Sin productos PVA en este contrato.</p>';

      bodyEl.innerHTML = `
        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Identificación</h3>
          </div>
          ${row('No. contrato', r.contrato || r.noContrato)}
          ${row('Factura', r.factura)}
          ${row('VIN', r.vin)}
          ${row('Fecha', r.fecha)}
          ${row('Modalidad', r.modalidadLabel || r.modalidad)}
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Cliente y equipo</h3>
          </div>
          ${row('Cliente', r.cliente)}
          ${row('Asesor', r.asesor)}
          ${row('Gerente F&I', r.gerenteFi || r.fi)}
          ${row('AFI', r.afi)}
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Unidad y plan</h3>
          </div>
          ${row('Unidad', r.unidad)}
          ${row('Tipo compra', r.tipoCompra)}
          ${row('Especial', r.especial)}
          ${row('Plan', r.plan)}
          ${row('Plan 2', r.plan2)}
          ${row('Plazo', r.plazoMeses != null ? `${r.plazoMeses} meses` : null)}
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Montos</h3>
          </div>
          ${rowMoney('Monto a financiar', r.montoFinanciar)}
          ${rowMoney('Enganche', r.engancheMonto)}
          ${row('Enganche %', r.enganchePct != null ? `${r.enganchePct}%` : null)}
          ${rowMoney('Comisión', r.comision)}
          ${rowMoney('MAF comisión', r.mafComision)}
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>OnStar</h3>
          </div>
          ${row('Con contrato OnStar', r.hasOnstarContrato ? 'Sí' : 'No')}
          ${row('Plazo OnStar', r.plazoOnstar)}
          ${rowMoney('Monto OnStar', r.onstarMonto)}
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Productos PVA</h3>
            <span>${num((r.pvas || []).length)}</span>
          </div>
          ${pvas}
          ${rowMoney('Total PVAs', r.montoPvas)}
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Otros</h3>
          </div>
          ${row('Seguro gratis', r.seguroGratis)}
          ${row('Robo parcial', r.roboParcial)}
        </section>
      `;

      setExpanded(true);
      panel.classList.add('ops-order-detail--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-order-detail-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-order-detail-open');
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-cd-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));

    contratoDetailUi = { open, close, isOpen, panel };
    return contratoDetailUi;
  }

  function closeFiMixDrawer() {
    closeContratoDetail();
    closeFacturaDetail();
    if (mixDrawerUi) mixDrawerUi.close();
  }

  function volumeTipoOf(c) {
    const an = String(c?.tipoCompra || '').trim().toUpperCase();
    const ao = String(c?.especial || '').toUpperCase();
    if (ao.includes('FLOTILLA')) return 'flotilla';
    if (an === 'SEMINUEVO') return 'seminuevo';
    if (an === 'NUEVO') return 'nuevo';
    return 'otro';
  }

  function volumeByTipoCompra(contracts = []) {
    let nuevos = 0;
    let seminuevos = 0;
    let flotillas = 0;
    for (const c of contracts || []) {
      const tipo = volumeTipoOf(c);
      if (tipo === 'flotilla') flotillas += 1;
      else if (tipo === 'seminuevo') seminuevos += 1;
      else if (tipo === 'nuevo') nuevos += 1;
    }
    return { nuevos, seminuevos, flotillas };
  }

  function renderKpis() {
    const root = els.kpiRoot;
    if (!root) return;
    const s = state.data?.summary || {};
    const mix = state.retailMix || {};
    const sol = s.solicitudes || {};
    const pva = Object.fromEntries((s.porTipoPva || []).map((t) => [t.key, t]));
    const mixBlock = mixKpiGroupHtml(mix);
    // Calcular en cliente (AN/AO) por si el API aún no trae los campos nuevos.
    const vol = volumeByTipoCompra(state.data?.contratos || []);
    const nNuevos = Number.isFinite(Number(s.unidadesNuevos)) ? Number(s.unidadesNuevos) : vol.nuevos;
    const nSemi = Number.isFinite(Number(s.unidadesSeminuevos)) ? Number(s.unidadesSeminuevos) : vol.seminuevos;
    const nFlot = Number.isFinite(Number(s.unidadesFlotilla)) ? Number(s.unidadesFlotilla) : vol.flotillas;

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
      kpiGroup('Solicitudes F&I', [
        kpiCard('Solicitudes', num(sol.total), 'en el periodo', 'blue', 'solicitudes'),
        kpiCard('Aprobadas', num(sol.aprobadas), `tasa ${pct(sol.tasaAprobacionPct)}`, 'green', 'aprobadas'),
      ]),
      kpiGroup('Volumen F&I', [
        kpiCard('Contratos', num(s.contratos), 'colocados en el periodo', 'blue', 'contratos'),
        kpiCard(
          'Nuevos',
          num(nNuevos),
          `de ${num(s.contratos)} contratos`,
          'green',
          'unidadesNuevos'
        ),
        kpiCard(
          'Seminuevos',
          num(nSemi),
          'en el periodo',
          'amber',
          'unidadesSeminuevos'
        ),
        kpiCard(
          'Flotillas',
          num(nFlot),
          'restadas de Nuevos',
          'slate',
          'unidadesFlotilla'
        ),
        kpiCard('Monto a financiar', moneyKpi(s.montoFinanciarTotal), `prom. ${moneyKpi(s.montoFinanciarPromedio)}`, 'violet', 'montoTotal'),
        kpiCard('Enganche prom.', moneyKpi(s.enganchePromedio), 'por contrato', 'amber', 'enganche'),
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

    if (els.detailPanel) els.detailPanel.classList.add('hidden');

    const meta = kpiMeta(key);
    const rows = isMixKpi(key) ? rowsForMixKpi(key) : rowsForKpi(key);
    ensureFiMixDrawer().open(rows, card, {
      kpi: key,
      title: meta.title,
      hint: meta.hint,
      icon: mixKpiIcon(key),
    });
    renderTable(isMixKpi(key) ? contracts() : rows);
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

  async function fetchVentasContext(fechaInicio, fechaFin) {
    const res = await fetch(
      `/api/ventas?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
      { credentials: 'same-origin' }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ventas (${res.status})`);
    const regs = (data.registros || []).map((row) => (
      window.CanalesVenta?.enrichRegistro ? window.CanalesVenta.enrichRegistro(row) : row
    ));
    return {
      registrosVentas: regs,
      entregasSofia: data.entregasSofia || [],
      porTipoVentaRetail: data.resumen?.porTipoVentaRetail || null,
    };
  }

  function paint() {
    renderKpis();
    closeKpiDetail();
    renderTable(contracts());
  }

  async function load(fechaInicio, fechaFin, _porTipoVentaRetail, registrosVentas, entregasSofia, opts = {}) {
    const force = Boolean(opts.force);
    const key = `${fechaInicio}|${fechaFin}`;
    state.fechaInicio = fechaInicio;
    state.fechaFin = fechaFin;
    state.desiredKey = key;
    state.loadSeq = (state.loadSeq || 0) + 1;
    const seq = state.loadSeq;
    const isCurrent = () => state.loadSeq === seq && state.desiredKey === key;

    if (
      !force
      && state.cacheKey === key
      && state.data
      && !state.data?.fuente?.reason
      && state.mixReady
    ) {
      paint();
      return state.data;
    }

    // Misma clave en curso: reutilizar (evita anular la carga anterior).
    if (!force && state.inflightKey === key && state.inflightPromise) {
      return state.inflightPromise;
    }

    // Invalidar caché del periodo anterior para que una respuesta vieja no vuelva a pintar.
    if (state.cacheKey && state.cacheKey !== key) {
      state.cacheKey = null;
      state.mixReady = false;
    }

    state.inflightKey = key;
    if (els.subtitle) {
      els.subtitle.textContent = `Periodo ${fechaInicio} → ${fechaFin} · Cargando contratos, facturas y SOFIA…`;
    }
    if (els.kpiRoot) {
      els.kpiRoot.innerHTML = '<div class="fi-empty"><p>Cargando contratos, facturas y SOFIA…</p></div>';
    }

    state.inflightPromise = (async () => {
      let regs = Array.isArray(registrosVentas) ? registrosVentas : [];
      let sofia = Array.isArray(entregasSofia) ? entregasSofia : [];

      try {
        const res = await fetch(
          `/api/ventas/financiamiento?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
          { credentials: 'same-origin' }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Error financiamiento (${res.status})`);

        // Respuesta obsoleta (el usuario ya cambió el filtro).
        if (!isCurrent()) return state.data;

        state.data = data;
        state.onstarTech = data.onstarTech || null;
        state.pvaTrimestreYtd = data.pvaTrimestreYtd || null;
        state.pvaTrimestresOpciones = data.pvaTrimestresOpciones || [];
        state.pvaQuarterKey = data.pvaTrimestreYtd?.key
          || (data.pvaTrimestreYtd?.anio && data.pvaTrimestreYtd?.trimestre
            ? `${data.pvaTrimestreYtd.anio}-T${data.pvaTrimestreYtd.trimestre}`
            : null);

        const gerenteIndex = state.gerentesCatalog || await loadGerentesCatalog();
        if (!isCurrent()) return state.data;

        // Priorizar bundle del API (mismo periodo). Solo usar regs/sofia del cliente si vienen.
        if (data.mixReady && data.sofiaGmfMix && !sofia.length && !regs.length) {
          state.sofiaRegistros = (data.sofiaRegistros || []).map((r) => ({
            ...r,
            GERENTE_FI: resolveGerenteFi(r.VENDEDOR, gerenteIndex) || r.GERENTE_FI || 'Sin gerente F&I',
          }));
          state.facturasGmfRegistros = (data.facturasGmfRegistros || []).map((r) => ({
            ...r,
            GERENTE_FI: resolveGerenteFi(r.VENDEDOR, gerenteIndex) || r.GERENTE_FI || 'Sin gerente F&I',
          }));
          state.retailMix = data.sofiaGmfMix;
          state.mixReady = true;
        } else if (sofia.length || regs.length) {
          state.sofiaRegistros = enrichSofiaEntregas(sofia, regs, gerenteIndex);
          state.facturasGmfRegistros = buildFacturasGmf(regs, gerenteIndex, state.sofiaRegistros);
          state.retailMix = buildSofiaGmfMix(state.sofiaRegistros, state.facturasGmfRegistros);
          state.mixReady = true;
        } else if (data.mixReady && data.sofiaGmfMix) {
          state.sofiaRegistros = (data.sofiaRegistros || []).map((r) => ({
            ...r,
            GERENTE_FI: resolveGerenteFi(r.VENDEDOR, gerenteIndex) || r.GERENTE_FI || 'Sin gerente F&I',
          }));
          state.facturasGmfRegistros = (data.facturasGmfRegistros || []).map((r) => ({
            ...r,
            GERENTE_FI: resolveGerenteFi(r.VENDEDOR, gerenteIndex) || r.GERENTE_FI || 'Sin gerente F&I',
          }));
          state.retailMix = data.sofiaGmfMix;
          state.mixReady = true;
        } else {
          const ctx = await fetchVentasContext(fechaInicio, fechaFin);
          if (!isCurrent()) return state.data;
          regs = ctx.registrosVentas;
          sofia = ctx.entregasSofia;
          state.sofiaRegistros = enrichSofiaEntregas(sofia, regs, gerenteIndex);
          state.facturasGmfRegistros = buildFacturasGmf(regs, gerenteIndex, state.sofiaRegistros);
          state.retailMix = buildSofiaGmfMix(state.sofiaRegistros, state.facturasGmfRegistros);
          state.mixReady = true;
        }

        if (!isCurrent()) return state.data;

        state.cacheKey = key;
        updateDisponiblesTimbrarMix();
        if (els.subtitle) {
          const mixNote = data.mixError
            ? ` · Aviso facturas: ${data.mixError}`
            : ' · Penetración GMF sobre entregas SOFIA';
          els.subtitle.textContent = `Periodo ${fechaInicio} → ${fechaFin}${mixNote}`;
        }
        paint();

        loadFacturaNotesIndex()
          .then(() => {
            if (!isCurrent() || state.cacheKey !== key) return;
            updateDisponiblesTimbrarMix();
            paint();
          })
          .catch(() => {});
      } catch (err) {
        if (!isCurrent()) return state.data;
        console.error('[Financiamiento]', err);
        state.cacheKey = null;
        state.mixReady = false;
        state.data = {
          fuente: { crm: false, reason: err.message },
          summary: {},
          contratos: [],
          solicitudes: { total: 0, aprobadas: 0, muestra: [] },
        };
        state.onstarTech = null;
        state.retailMix = buildSofiaGmfMix([], []);
        state.sofiaRegistros = [];
        state.facturasGmfRegistros = [];
        if (els.subtitle) els.subtitle.textContent = err.message;
        paint();
      } finally {
        if (state.inflightKey === key && state.loadSeq === seq) {
          state.inflightKey = null;
          state.inflightPromise = null;
        }
      }
      return state.data;
    })();

    return state.inflightPromise;
  }

  function hasCache(fechaInicio, fechaFin) {
    if (state.cacheKey !== `${fechaInicio}|${fechaFin}` || !state.data || state.data?.fuente?.reason) {
      return false;
    }
    if (!state.mixReady) return false;
    return true;
  }

  async function applyVentasMix(registrosVentas, entregasSofia) {
    const key = `${state.fechaInicio}|${state.fechaFin}`;
    // No pisar otro periodo ni una carga más nueva.
    if (state.desiredKey !== key || state.cacheKey !== key) return state.retailMix;
    const seq = state.loadSeq;
    const regs = Array.isArray(registrosVentas) ? registrosVentas : [];
    const sofia = Array.isArray(entregasSofia) ? entregasSofia : [];
    if (!sofia.length && !regs.length) return state.retailMix;
    const gerenteIndex = state.gerentesCatalog || await loadGerentesCatalog();
    if (state.loadSeq !== seq || state.desiredKey !== key) return state.retailMix;
    state.sofiaRegistros = enrichSofiaEntregas(sofia, regs, gerenteIndex);
    state.facturasGmfRegistros = buildFacturasGmf(regs, gerenteIndex, state.sofiaRegistros);
    state.retailMix = buildSofiaGmfMix(state.sofiaRegistros, state.facturasGmfRegistros);
    state.mixReady = true;
    updateDisponiblesTimbrarMix();
    paint();
    return state.retailMix;
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

    els.btnCloseDetail?.addEventListener('click', closeKpiDetail);
    els.searchInput?.addEventListener('input', () => {
      state.search = els.searchInput.value || '';
      if (state.openKpi) {
        openKpiDetail(state.openKpi, els.kpiRoot?.querySelector(`[data-fi-kpi="${state.openKpi}"]`));
      } else {
        renderTable(contracts());
      }
    });
  }

  function init() {
    bindDom();
    loadGerentesCatalog().catch(() => {});
  }

  window.FinanciamientoVentas = { init, load, hasCache, applyVentasMix };
})();
