(function () {
  'use strict';

  let allRecords = [];
  let ytdRecords = [];
  let ytdMeta = null;
  let openSnapshot = [];
  let mesCursoNomenclatura = null;
  let lastDash = null;
  let openOpsKpiKey = null;
  let openAseguradoraKey = null;
  let currentArea = 'posventa';
  let refaccionesData = null;
  let refaccionesLoadedKey = '';
  let refaccionesSubTab = 'ventas';
  const charts = {};
  const MES_CURSO_LETRAS = ['N', 'D', 'Q', 'C', 'X', 'Y'];
  const MES_CURSO_LABELS = {
    N: 'Normal',
    D: 'Reparación',
    Q: 'Normal Zacatelco',
    C: 'Reparación Zacatelco',
    X: 'Reparación Cholula',
    Y: 'Normal Cholula',
  };

  function toIsoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatIsoDisplay(iso) {
    const [y, m, d] = String(iso || '').split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso || '';
  }

  function parseIngresoToIso(r) {
    const s = String(r.ingreso || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (r.ingresoDate && /^\d{4}-\d{2}-\d{2}/.test(String(r.ingresoDate))) {
      return String(r.ingresoDate).slice(0, 10);
    }
    return null;
  }

  function buildMesCursoFromRecords(records) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const fechaInicio = toIsoLocal(new Date(year, month, 1));
    const fechaFin = toIsoLocal(new Date(year, month, now.getDate()));
    const byDate = new Map();

    for (const r of records || []) {
      if (String(r.status || '').toUpperCase() === 'C') continue;
      const letra = String(r.letraOrden || (r.orden || '').trim().charAt(0) || '').toUpperCase();
      if (!MES_CURSO_LETRAS.includes(letra)) continue;
      const fecha = parseIngresoToIso(r);
      if (!fecha || fecha < fechaInicio || fecha > fechaFin) continue;
      if (!byDate.has(fecha)) {
        const row = { fecha, fechaLabel: formatIsoDisplay(fecha), total: 0 };
        MES_CURSO_LETRAS.forEach((L) => { row[L] = 0; });
        byDate.set(fecha, row);
      }
      const day = byDate.get(fecha);
      day[letra] += 1;
      day.total += 1;
    }

    const days = [];
    let acum = 0;
    for (let d = 1; d <= now.getDate(); d += 1) {
      const iso = toIsoLocal(new Date(year, month, d));
      const row = byDate.get(iso) || (() => {
        const empty = { fecha: iso, fechaLabel: formatIsoDisplay(iso), total: 0 };
        MES_CURSO_LETRAS.forEach((L) => { empty[L] = 0; });
        return empty;
      })();
      acum += row.total;
      days.push({ ...row, acumulado: acum });
    }

    const totals = { fechaLabel: 'Total', acumulado: acum, total: 0 };
    MES_CURSO_LETRAS.forEach((L) => {
      totals[L] = days.reduce((s, r) => s + (r[L] || 0), 0);
    });
    totals.total = days.reduce((s, r) => s + (r.total || 0), 0);

    return {
      periodo: { fechaInicio, fechaFin, label: `${formatIsoDisplay(fechaInicio)} — ${formatIsoDisplay(fechaFin)}` },
      letras: MES_CURSO_LETRAS.slice(),
      labels: { ...MES_CURSO_LABELS },
      days,
      totals,
    };
  }

  function resolveMesCursoData() {
    if (mesCursoNomenclatura?.totals?.total > 0) return mesCursoNomenclatura;
    const fromRecords = buildMesCursoFromRecords(allRecords);
    if (fromRecords.totals.total > 0) return fromRecords;
    return mesCursoNomenclatura || fromRecords;
  }

  const FILTER_IDS = {
    status: 'fStatus',
    asesor: 'fAsesor',
    tipo: 'fTipoOptions',
    antiguedad: 'fAntiguedad',
    importeMin: 'fImporteMin',
    importeMax: 'fImporteMax',
    soloCriticas: 'fCriticas',
    promesaVencida: 'fPromesa',
    buscar: 'buscarOrdenes',
  };

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function getSelectedTipos() {
    return [...document.querySelectorAll('#fTipoOptions input[type="checkbox"]:checked')]
      .map((el) => el.value)
      .filter(Boolean);
  }

  function updateTipoLabel() {
    const label = document.getElementById('fTipoLabel');
    const btn = document.getElementById('fTipoBtn');
    if (!label) return;
    const selected = getSelectedTipos();
    const total = document.querySelectorAll('#fTipoOptions input[type="checkbox"]').length;
    let text = 'Todos';
    if (!selected.length && total > 0) {
      text = 'Ninguno';
    } else if (selected.length && selected.length < total) {
      text = selected.length === 1
        ? selected[0]
        : `${selected.length} tipos`;
    }
    label.textContent = text;
    label.title = selected.length ? selected.join(', ') : text;
    btn?.classList.toggle('is-filtered', selected.length !== total && total > 0);
  }

  function setTipoPanelOpen(open) {
    const panel = document.getElementById('fTipoPanel');
    const btn = document.getElementById('fTipoBtn');
    if (!panel || !btn) return;
    panel.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('is-open', open);
  }

  function getFilters() {
    const tipos = getSelectedTipos();
    const total = document.querySelectorAll('#fTipoOptions input[type="checkbox"]').length;
    // null = sin filtro (todos); [] = ninguno marcado; [..] = selección parcial
    let tipo = null;
    if (total > 0) {
      if (tipos.length === 0) tipo = [];
      else if (tipos.length < total) tipo = tipos;
    }
    return {
      area: currentArea || 'servicio',
      status: document.getElementById(FILTER_IDS.status)?.value || '',
      asesor: document.getElementById(FILTER_IDS.asesor)?.value || '',
      tipo,
      antiguedad: document.getElementById(FILTER_IDS.antiguedad)?.value || '',
      importeMin: document.getElementById(FILTER_IDS.importeMin)?.value || '',
      importeMax: document.getElementById(FILTER_IDS.importeMax)?.value || '',
      soloCriticas: document.getElementById(FILTER_IDS.soloCriticas)?.checked || false,
      promesaVencida: document.getElementById(FILTER_IDS.promesaVencida)?.checked || false,
      buscar: document.getElementById(FILTER_IDS.buscar)?.value || '',
    };
  }

  function populateSelect(id, options, allLabel) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>${(options || []).map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')}`;
    if (current && options.includes(current)) sel.value = current;
  }

  function populateTipoMulti(options) {
    const box = document.getElementById('fTipoOptions');
    if (!box) return;
    const prev = new Set(getSelectedTipos());
    const hadSelection = prev.size > 0;
    box.innerHTML = (options || []).map((o) => {
      const checked = !hadSelection || prev.has(o) ? ' checked' : '';
      return `
        <label class="filter-multi__item">
          <input type="checkbox" value="${escHtml(o)}"${checked}/>
          <span>${escHtml(o)}</span>
        </label>`;
    }).join('') || '<p class="filter-multi__empty">Sin tipos disponibles</p>';
    updateTipoLabel();
  }

  function populateFilterOptions(options) {
    populateSelect(FILTER_IDS.status, options.status, 'Todos');
    populateSelect(FILTER_IDS.asesor, options.asesor, 'Todos');
    populateTipoMulti(options.tipo);
    populateSelect(FILTER_IDS.antiguedad, options.antiguedad, 'Todas');
  }

  function kpiCard(title, value, sub, cls, id, opsKey) {
    const idAttr = id ? ` id="${id}"` : '';
    const opsAttr = opsKey ? ` data-ops-kpi="${opsKey}"` : '';
    const interactive = opsKey ? ' kpi-card--clickable' : '';
    const role = opsKey ? ' role="button" tabindex="0"' : '';
    return `<div class="kpi-card kpi-card--${cls || 'blue'}${interactive}"${idAttr}${opsAttr}${role} title="${opsKey ? 'Clic para ver desglose' : ''}">
      <span class="kpi-title">${title}</span>
      <div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
      ${opsKey ? '<span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>' : ''}
      <div class="kpi-accent"></div>
    </div>`;
  }

  function kpiGroup(title, cards) {
    return `<div class="kpi-group"><h4 class="kpi-group-title">${title}</h4><div class="kpi-grid">${cards.join('')}</div></div>`;
  }

  function growthLabel(value, prevHasData) {
    if (!prevHasData) return 'sin mes anterior en el periodo';
    if (value === 0 || value == null || Number.isNaN(value)) return 'sin variación vs mes anterior';
    return 'vs mes anterior';
  }

  function executiveCard(title, value, sub, cls, icon, id) {
    const idAttr = id ? ` id="${id}"` : '';
    return `<div class="kpi-card kpi-card--eeff kpi-card--${cls || 'blue'}"${idAttr}>
      <div class="kpi-card-head"><span class="kpi-title">${title}</span><span class="material-symbols-outlined kpi-icon">${icon || 'insights'}</span></div>
      <div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
    </div>`;
  }

  function countBy(rows, keyFn) {
    const map = new Map();
    for (const r of rows || []) {
      const key = String(keyFn(r) || 'Sin dato').trim() || 'Sin dato';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function sumBy(rows, keyFn, valFn) {
    const map = new Map();
    for (const r of rows || []) {
      const key = String(keyFn(r) || 'Sin dato').trim() || 'Sin dato';
      map.set(key, (map.get(key) || 0) + Number(valFn(r) || 0));
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function monthKeyOf(r) {
    const iso = String(r.ingresoDate || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(iso)) return iso;
    const m = String(r.ingreso || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
    return null;
  }

  function rowsForOpsKpi(kpi, dash) {
    const filtered = dash?.filtered || [];
    const open = PostSalesAnalytics.applyFilters(openSnapshot, getFilters());
    const s = dash?.summary || {};
    const OT = window.PostSalesOrderTypes;
    switch (kpi) {
      case 'ingresadas': return filtered;
      case 'facturadas': return filtered.filter((r) => r.status === 'I');
      case 'abiertas': return open;
      case 'canceladas': return filtered.filter((r) => r.status === 'C');
      case 'cerradas': return filtered.filter((r) => !['A', 'T', 'D', 'P'].includes(r.status));
      case 'importeIngresado': return filtered;
      case 'ticketFacturado': return filtered.filter((r) => r.status === 'I');
      case 'facturadoUltimoMes': {
        const key = s.ultimoMesKey;
        if (!key) return [];
        return filtered.filter((r) => r.status === 'I' && monthKeyOf(r) === key);
      }
      case 'mejorMes':
        // Facturadas del acumulado del año (YTD), no del periodo filtrado
        return PostSalesAnalytics.applyFilters(ytdRecords.length ? ytdRecords : allRecords, getFilters())
          .filter((r) => r.status === 'I');
      case 'aging0_30': return open.filter((r) => r.antiguedad === '0-30');
      case 'aging31_60': return open.filter((r) => r.antiguedad === '31-60');
      case 'aging61_90': return open.filter((r) => r.antiguedad === '61-90');
      case 'aging91_120': return open.filter((r) => r.antiguedad === '91-120');
      case 'aging120p': return open.filter((r) => r.antiguedad === '+120');
      case 'criticas60': return open.filter((r) => r.critica);
      case 'conRefacciones': return open.filter((r) => r.conRefacciones || Number(r.refaccionesLineas || 0) > 0);
      case 'promesasVencidas': return open.filter((r) => r.promesaVencida);
      case 'promedioSemanal': return filtered;
      case 'tiempoPromCiclo':
      case 'tiempoMedCiclo':
        return filtered.filter((r) => r.status === 'I' && (r.cierreDate || r.diasCiclo != null));
      case 'estanciaPromAbiertas':
        return open;
      case 'diasPromMecanica':
        return open.filter(
          (r) => OT?.matchesArea?.(r, 'servicio') && (r.status === 'T' || r.status === 'A'),
        );
      case 'diasPromEsperaRefacc':
        return open.filter(
          (r) => r.status === 'D' || (r.status === 'P' && (r.conRefacciones || Number(r.refaccionesLineas || 0) > 0)),
        );
      case 'diasPromPintura':
        return open.filter((r) => OT?.matchesArea?.(r, 'hyp'));
      case 'cumplimientoPromesa':
        return filtered.filter((r) => r.status === 'I' && r.promesaDate && (r.cierreDate || r.diasCiclo != null));
      case 'retrasoPromesa':
        return filtered.filter((r) => {
          if (r.status !== 'I' || !r.promesaDate || !r.cierreDate) return false;
          const p = new Date(`${r.promesaDate}T12:00:00`);
          const c = new Date(`${r.cierreDate}T12:00:00`);
          return !Number.isNaN(p) && !Number.isNaN(c) && c > p;
        });
      case 'facturasPorSemana':
        return filtered.filter((r) => r.status === 'I');
      case 'sinImporte': return open.filter((r) => r.sinImporte);
      case 'sinAseguradora': return open.filter((r) => r.sinAseguradora);
      case 'sinPromesa': return open.filter((r) => r.abiertaSinPromesa);
      case 'sinFecha': return open.filter((r) => r.sinFechaIngreso);
      case 'excluidos': return filtered.filter((r) => r.excluido);
      default: return [];
    }
  }

  function opsKpiMeta(kpi, dash) {
    const s = dash?.summary || {};
    const o = dash?.operations || {};
    const map = {
      ingresadas: { title: 'Órdenes ingresadas', hint: 'Todas las órdenes del periodo filtrado' },
      facturadas: { title: 'Facturadas', hint: 'Status I · importe facturado' },
      abiertas: { title: 'Abiertas hoy', hint: 'Snapshot de órdenes abiertas en taller' },
      canceladas: { title: 'Canceladas', hint: 'Status C en el periodo' },
      cerradas: { title: 'Cerradas', hint: 'Facturadas + canceladas del periodo (ya no abiertas)' },
      importeIngresado: { title: 'Importe ingresado', hint: 'Suma de importes de órdenes del periodo' },
      ticketFacturado: { title: 'Ticket prom. facturado', hint: 'Promedio por orden facturada' },
      facturadoUltimoMes: { title: `Facturado · ${s.ultimoMesLabel || 'último mes'}`, hint: 'Órdenes facturadas del último mes del periodo' },
      mejorMes: {
        title: `Mejor mes · ${s.mejorMes || '—'}`,
        hint: s.mejorMesStats
          ? `Acumulado ${ytdMeta?.year || 'del año'} · #1 de ${s.mejorMesStats.mesesComparados} meses`
          : 'Mayor importe facturado en el acumulado del año',
      },
      aging0_30: { title: 'Abiertas 0-30 días', hint: 'Backlog reciente' },
      aging31_60: { title: 'Abiertas 31-60 días', hint: 'Antigüedad media' },
      aging61_90: { title: 'Abiertas 61-90 días', hint: 'Riesgo creciente' },
      aging91_120: { title: 'Abiertas 91-120 días', hint: 'Backlog crítico' },
      aging120p: { title: 'Abiertas +120 días', hint: 'Riesgo máximo de cartera' },
      criticas60: { title: 'Críticas +60 días', hint: 'Órdenes abiertas con más de 60 días en taller' },
      conRefacciones: { title: 'Con refacciones', hint: 'Abiertas con líneas de refacciones (RE) cargadas' },
      promesasVencidas: { title: 'Promesas vencidas', hint: 'Fecha promesa menor a hoy' },
      promedioSemanal: { title: 'Promedio semanal', hint: 'Ritmo de ingreso por semana del periodo' },
      tiempoPromCiclo: {
        title: 'Tiempo promedio de ciclo',
        hint: `Promedio ingreso → cierre en facturadas (${o.ciclosConDato || 0} con fechas)`,
      },
      tiempoMedCiclo: {
        title: 'Tiempo mediano de ciclo',
        hint: 'Mediana de días ingreso → cierre en facturadas',
      },
      estanciaPromAbiertas: {
        title: 'Estancia promedio abiertas',
        hint: 'Días promedio desde ingreso hasta hoy en el backlog abierto',
      },
      diasPromMecanica: {
        title: 'Reparación mecánica',
        hint: 'Días promedio de abiertas Servicio en taller/activas (T/A)',
      },
      diasPromEsperaRefacc: {
        title: 'Espera de refacciones',
        hint: 'Días promedio de detenidas (D) o pendientes con refacciones',
      },
      diasPromPintura: {
        title: 'Pintura / HyP',
        hint: 'Días promedio de abiertas en Hojalatería y Pintura',
      },
      cumplimientoPromesa: {
        title: 'Cumplimiento de promesa',
        hint: '% de facturadas cerradas en o antes de la fecha promesa',
      },
      retrasoPromesa: {
        title: 'Retraso promedio vs promesa',
        hint: 'Días promedio de atraso solo en facturadas fuera de promesa',
      },
      facturasPorSemana: {
        title: 'Facturación por semana',
        hint: 'Órdenes facturadas ÷ semanas con ingreso en el periodo',
      },
      sinImporte: { title: 'Sin importe', hint: 'Abiertas sin monto capturado' },
      sinAseguradora: { title: 'Sin aseguradora', hint: 'Abiertas sin aseguradora registrada' },
      sinPromesa: { title: 'Abiertas sin promesa', hint: 'Sin fecha de promesa de entrega' },
      sinFecha: { title: 'Sin fecha ingreso', hint: 'Registros abiertos incompletos' },
      excluidos: { title: 'Registros excluidos', hint: 'Marcados como excluidos del análisis' },
    };
    return map[kpi] || { title: kpi, hint: '' };
  }

  function buildOpsKpiDetail(kpi, dash) {
    const { fmt } = Dashboard;
    const meta = opsKpiMeta(kpi, dash);
    const rows = rowsForOpsKpi(kpi, dash);
    const num = (v) => Number(v || 0).toLocaleString('es-MX');
    const importeTotal = rows.reduce((acc, r) => acc + Number(r.importeAbierto || r.importeFacturado || r.importe || 0), 0);
    const sections = [
      {
        titulo: 'Resumen',
        rows: [
          { label: 'Registros', value: num(rows.length) },
          { label: 'Importe relacionado', value: fmt.currency(importeTotal) },
          { label: 'Alcance', value: meta.hint || '—' },
        ],
      },
    ];

    if (kpi === 'promedioSemanal' || kpi === 'facturasPorSemana') {
      const weekly = dash?.charts?.weeklyFlow || [];
      sections.push({
        titulo: 'Flujo semanal',
        rows: weekly.length
          ? weekly.map((w) => ({
            label: w.label,
            value: `${num(w.ingresadas)} ing. · ${num(w.facturadas)} fact.`,
          }))
          : [{ label: 'Sin semanas en el periodo', value: '—' }],
      });
      const value = kpi === 'facturasPorSemana'
        ? num(dash?.operations?.facturasPorSemana || 0)
        : num(dash?.risk?.promedioSemanal || 0);
      return { title: meta.title, value, sections };
    }

    if (['tiempoPromCiclo', 'tiempoMedCiclo', 'estanciaPromAbiertas', 'diasPromMecanica', 'diasPromEsperaRefacc', 'diasPromPintura', 'cumplimientoPromesa', 'retrasoPromesa'].includes(kpi)) {
      const o = dash?.operations || {};
      const valueMap = {
        tiempoPromCiclo: `${num(o.tiempoPromCiclo || 0)} d`,
        tiempoMedCiclo: `${num(o.tiempoMedCiclo || 0)} d`,
        estanciaPromAbiertas: `${num(o.estanciaPromAbiertas || 0)} d`,
        diasPromMecanica: `${num(o.diasPromMecanica || 0)} d`,
        diasPromEsperaRefacc: `${num(o.diasPromEsperaRefacc || 0)} d`,
        diasPromPintura: `${num(o.diasPromPintura || 0)} d`,
        cumplimientoPromesa: `${num(o.cumplimientoPromesaPct || 0)}%`,
        retrasoPromesa: `${num(o.retrasoPromDias || 0)} d`,
      };
      sections[0].rows.push(
        { label: 'Tiempo prom. ciclo', value: `${num(o.tiempoPromCiclo || 0)} d` },
        { label: 'Estancia prom. abiertas', value: `${num(o.estanciaPromAbiertas || 0)} d` },
        { label: 'Reparación mecánica', value: `${num(o.diasPromMecanica || 0)} d · ${num(o.ordenesMecanica || 0)} órd.` },
        { label: 'Espera refacciones', value: `${num(o.diasPromEsperaRefacc || 0)} d · ${num(o.ordenesEsperaRefacc || 0)} órd.` },
        { label: 'Pintura / HyP', value: `${num(o.diasPromPintura || 0)} d · ${num(o.ordenesPintura || 0)} órd.` },
        { label: 'Cumplimiento promesa', value: `${num(o.cumplimientoPromesaPct || 0)}%` },
      );
      sections.push({
        titulo: 'Por asesor',
        rows: countBy(rows, (r) => r.asesor).slice(0, 8).map((x) => ({ label: x.label, value: num(x.value) })),
      });
      return { title: meta.title, value: valueMap[kpi], sections };
    }

    sections.push({
      titulo: 'Por asesor',
      rows: countBy(rows, (r) => r.asesor).slice(0, 8).map((x) => ({ label: x.label, value: num(x.value) })),
    });
    sections.push({
      titulo: 'Por tipo de orden',
      rows: countBy(rows, (r) => r.tipoOrden || r.tipo).slice(0, 8).map((x) => ({ label: x.label, value: num(x.value) })),
    });
    if (['importeIngresado', 'ticketFacturado', 'facturadoUltimoMes', 'mejorMes', 'abiertas', 'aging120p', 'criticas60', 'conRefacciones', 'tiempoPromCiclo', 'retrasoPromesa'].includes(kpi)) {
      sections.push({
        titulo: 'Importe por asesor',
        rows: sumBy(rows, (r) => r.asesor, (r) => r.importeAbierto || r.importeFacturado || r.importe)
          .slice(0, 6)
          .map((x) => ({ label: x.label, value: fmt.currency(x.value) })),
      });
    }
    const top = rows
      .slice()
      .sort((a, b) => Number(b.importeAbierto || b.importeFacturado || b.importe || 0)
        - Number(a.importeAbierto || a.importeFacturado || a.importe || 0))
      .slice(0, 10);
    sections.push({
      titulo: 'Detalle de órdenes (top 10)',
      rows: top.length
        ? top.map((r) => ({
          label: [r.orden, r.nombre, r.asesor].filter(Boolean).join(' · ') || 'Orden',
          value: fmt.currency(r.importeAbierto || r.importeFacturado || r.importe || 0),
          detail: [r.statusLabel || r.status, r.tipoOrden, r.ingreso ? `Ingreso ${r.ingreso}` : null, r.dias != null ? `${r.dias} días` : null, r.aseguradora]
            .filter(Boolean).join(' · '),
        }))
        : [{ label: 'Sin órdenes en este indicador', value: '—' }],
    });

    const value = ['importeIngresado', 'ticketFacturado', 'facturadoUltimoMes', 'mejorMes'].includes(kpi)
      ? (kpi === 'ticketFacturado'
        ? fmt.currency(rows.length ? importeTotal / rows.length : 0)
        : fmt.currency(importeTotal))
      : num(rows.length);

    return { title: meta.title, value, sections };
  }

  function closeOpsKpiDetail() {
    openOpsKpiKey = null;
    openAseguradoraKey = null;
    const panel = document.getElementById('opsKpiDetail');
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
    if (opsOrdersUi) opsOrdersUi.close();
    document.querySelectorAll('#kpiOperational .kpi-card--clickable.is-open')
      .forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('#tblAseg tr.row-active')
      .forEach((tr) => tr.classList.remove('row-active'));
  }

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stampFile() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  async function downloadXlsx(sheets, filename) {
    const res = await fetch('/api/post-sales/export-xlsx', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheets, filename }),
    });
    if (res.status === 401) {
      window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      throw new Error('Sesión expirada');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || 'No se pudo generar el Excel');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function ordersToExportRows(rows) {
    return (rows || []).map((r) => ({
      Orden: r.orden || '',
      Cliente: r.nombre || '',
      Asesor: r.asesor || '',
      Tipo: r.tipoOrden || r.tipo || '',
      Estatus: r.statusLabel || r.status || '',
      Antigüedad: r.antiguedad || '',
      Días: Number(r.dias || 0),
      Importe: Number(r.importe || 0),
      'Importe abierto': Number(r.importeAbierto || 0),
      'Importe facturado': Number(r.importeFacturado || 0),
      Ingreso: r.ingreso || '',
      Promesa: r.promesa || '',
      Serie: r.serie || '',
      Auto: r.auto || '',
      Modelo: r.modelo || '',
      Aseguradora: r.aseguradora || '',
      Teléfono: r.celular || r.telefono || '',
      Correo: r.correo || '',
      Crítica: r.critica ? 'Sí' : 'No',
      'Promesa vencida': r.promesaVencida ? 'Sí' : 'No',
    }));
  }

  function orderDetailToSheets(data) {
    const o = data?.orden || {};
    const totals = data?.totals || {};
    const cargo = (data?.cargo || []).map((c) => ({
      Concepto: c.label || '',
      Líneas: Number(c.lineas || 0),
      Subtotal: Number(c.subtotal || 0),
      IVA: Number(c.iva || 0),
      Total: Number(c.total || 0),
    }));
    const mapLine = (l) => ({
      Código: l.codigo || '',
      Descripción: l.descripcion || '',
      Clasificación: l.clasific || '',
      Tipo: l.bucketLabel || l.bucket || '',
      Cantidad: Number(l.cantidad || 0),
      Surtido: Number(l.surtido || 0),
      'Precio unitario': Number(l.precio || 0),
      Subtotal: Number(l.subtotal || 0),
      IVA: Number(l.iva || 0),
      Total: Number(l.total || 0),
      Mecánico: l.mecanico || '',
      Estatus: l.status || '',
    });
    const sheets = [
      {
        name: 'Orden',
        rows: [{
          Orden: o.orden || '',
          Cliente: o.nombre || '',
          Asesor: o.asesor || '',
          Tipo: o.tipoOrden || '',
          Estatus: o.statusLabel || o.status || '',
          Antigüedad: o.antiguedad || '',
          Días: Number(o.dias || 0),
          Factura: o.factura || '',
          'Importe orden': Number(totals.total || o.importeAbierto || o.importe || 0),
          Ingreso: o.ingreso || '',
          Promesa: o.promesa || '',
          Serie: o.serie || '',
          Auto: o.auto || '',
          Modelo: o.modelo || '',
          Aseguradora: o.aseguradora || '',
          Teléfono: o.celular || o.telefono || '',
          Correo: o.correo || '',
        }],
      },
    ];
    if (cargo.length) sheets.push({ name: 'Desglose cargo', rows: cargo });
    sheets.push({ name: 'Mano de obra', rows: (data?.manoObra || []).map(mapLine) });
    if ((data?.refacciones || []).length) {
      sheets.push({ name: 'Refacciones', rows: data.refacciones.map(mapLine) });
    }
    if ((data?.hyp || []).length) {
      sheets.push({ name: 'HYP Pintura', rows: data.hyp.map(mapLine) });
    }
    if ((data?.lineas || []).length) {
      sheets.push({ name: 'Todas las líneas', rows: data.lineas.map(mapLine) });
    }
    return sheets;
  }

  let opsOrdersUi = null;
  let opsOrdersRows = [];
  let orderDetailUi = null;

  function ensureOrderDetailPanel() {
    if (orderDetailUi) return orderDetailUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-order-detail-backdrop';
    backdrop.id = 'opsOrderDetailBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-order-detail';
    panel.id = 'opsOrderDetail';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle de orden');
    panel.innerHTML = `
      <div class="ops-order-detail__header">
        <div class="ops-order-detail__title-wrap">
          <span class="material-symbols-outlined ops-order-detail__logo">receipt_long</span>
          <div>
            <h2 class="ops-order-detail__title" data-od-title>Orden</h2>
            <span class="ops-order-detail__status" data-od-status>Cargando…</span>
          </div>
        </div>
        <div class="ops-order-detail__actions">
          <button type="button" class="ops-order-detail__text-btn" data-od-seguimiento disabled title="Ver Seguimiento 360 del VIN/serie" aria-label="Seguimiento 360">
            <span class="material-symbols-outlined">person_search</span>
            <span>Seguimiento 360</span>
          </button>
          <button type="button" class="ops-order-detail__icon-btn" data-od-download title="Descargar Excel" aria-label="Descargar Excel">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="ops-order-detail__icon-btn" data-od-expand title="Expandir" aria-label="Expandir">
            <span class="material-symbols-outlined" data-od-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-order-detail__icon-btn" data-od-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-order-detail__body custom-scrollbar" data-od-body>
        <div class="ops-order-detail__loading">
          <span class="material-symbols-outlined">hourglass_top</span>
          <p>Cargando detalle…</p>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const titleEl = panel.querySelector('[data-od-title]');
    const statusEl = panel.querySelector('[data-od-status]');
    const bodyEl = panel.querySelector('[data-od-body]');
    const expandBtn = panel.querySelector('[data-od-expand]');
    const expandIcon = panel.querySelector('[data-od-expand-icon]');
    const downloadBtn = panel.querySelector('[data-od-download]');
    const seguimientoBtn = panel.querySelector('[data-od-seguimiento]');
    let expanded = false;
    let requestToken = 0;
    let lastDetail = null;

    function openSeguimiento360(serie) {
      const vin = String(serie || '').trim();
      if (!vin) {
        window.alert('Esta orden no tiene número de serie para abrir Seguimiento 360.');
        return;
      }
      const url = `/seguimiento.html?q=${encodeURIComponent(vin)}`;
      window.open(url, '_blank', 'noopener');
    }

    function syncSeguimientoBtn(serie) {
      const vin = String(serie || '').trim();
      if (!seguimientoBtn) return;
      seguimientoBtn.disabled = !vin;
      seguimientoBtn.title = vin
        ? `Seguimiento 360 · serie ${vin}`
        : 'Sin número de serie en esta orden';
    }

    function setExpanded(next) {
      expanded = Boolean(next);
      panel.classList.toggle('ops-order-detail--expanded', expanded);
      if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
      if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
    }

    function close() {
      panel.classList.remove('ops-order-detail--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('ops-order-detail-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ops-order-detail-open');
      setExpanded(false);
      requestToken += 1;
      lastDetail = null;
      syncSeguimientoBtn('');
    }

    function renderError(message) {
      lastDetail = null;
      bodyEl.innerHTML = `
        <div class="ops-order-detail__empty">
          <span class="material-symbols-outlined">error</span>
          <p>${escHtml(message || 'No se pudo cargar el detalle.')}</p>
        </div>`;
    }

    function renderDetail(data) {
      lastDetail = data;
      const { fmt } = Dashboard;
      const o = data.orden || {};
      const cargo = data.cargo || [];
      const refs = data.refacciones || [];
      const mo = data.manoObra || [];
      const hyp = data.hyp || [];
      const totals = data.totals || {};
      const importeOrden = Number(totals.total || o.importeAbierto || o.importe || 0);

      const isFacturada = String(o.status || '').toUpperCase() === 'I' || Boolean(o.factura);
      const facturaLabel = o.factura
        ? escHtml(o.factura)
        : (isFacturada ? 'Sin número capturado' : '—');

      titleEl.textContent = `Orden ${o.orden || ''}`.trim() || 'Orden';
      statusEl.textContent = o.factura
        ? `${o.statusLabel || o.status || '—'} · Factura ${o.factura} · ${fmt.money(importeOrden)}`
        : `${o.statusLabel || o.status || '—'} · ${o.antiguedad || '—'} · ${fmt.money(importeOrden)}`;

      const lineRows = (rows) => rows.length
        ? rows.map((l) => `
          <tr>
            <td>${escHtml(l.codigo || '—')}</td>
            <td>
              <strong>${escHtml(l.descripcion || 'Sin descripción')}</strong>
              ${l.mecanico ? `<span class="ops-order-detail__muted">${escHtml(l.mecanico)}</span>` : ''}
            </td>
            <td class="num">${Number(l.cantidad || 0).toLocaleString('es-MX')}</td>
            <td class="num">${Number(l.surtido || 0).toLocaleString('es-MX')}</td>
            <td class="num">${fmt.money(l.precio || 0)}</td>
            <td class="num">${fmt.money(l.subtotal || 0)}</td>
            <td class="num">${fmt.money(l.iva || 0)}</td>
            <td class="num">${fmt.money(l.total || 0)}</td>
          </tr>`).join('')
        : '<tr><td colspan="8" class="ops-order-detail__empty-cell">Sin líneas en esta sección</td></tr>';

      const sectionTable = (title, rows) => `
        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>${title}</h3>
            <span>${rows.length.toLocaleString('es-MX')}</span>
          </div>
          <div class="ops-order-detail__table-wrap custom-scrollbar">
            <table class="ops-order-detail__table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Cant.</th>
                  <th>Surt.</th>
                  <th>P. unit.</th>
                  <th>Subtotal</th>
                  <th>IVA</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>${lineRows(rows)}</tbody>
            </table>
          </div>
        </section>`;

      bodyEl.innerHTML = `
        <section class="ops-order-detail__meta">
          <div class="ops-order-detail__meta-grid">
            <div><span class="lbl">Orden</span><strong>${escHtml(o.orden || '—')}</strong></div>
            <div><span class="lbl">Factura</span><strong>${facturaLabel}</strong></div>
            <div><span class="lbl">Cliente</span><strong>${escHtml(o.nombre || '—')}</strong></div>
            <div><span class="lbl">Asesor</span><strong>${escHtml(o.asesor || '—')}</strong></div>
            <div><span class="lbl">Tipo</span><strong>${escHtml(o.tipoOrden || '—')}</strong></div>
            <div><span class="lbl">Unidad</span><strong>${escHtml([o.auto, o.modelo].filter(Boolean).join(' ') || '—')}</strong></div>
            <div>
              <span class="lbl">Serie</span>
              <strong class="ops-order-detail__serie-row">
                ${escHtml(o.serie || '—')}
                ${o.serie ? `<button type="button" class="ops-order-detail__serie-link" data-od-serie-360 title="Abrir Seguimiento 360">Seguimiento 360</button>` : ''}
              </strong>
            </div>
            <div><span class="lbl">Aseguradora</span><strong>${escHtml(o.aseguradora || '—')}</strong></div>
            <div><span class="lbl">Ingreso</span><strong>${escHtml(o.ingreso || '—')}</strong></div>
            <div><span class="lbl">Promesa</span><strong>${escHtml(o.promesa || '—')}</strong></div>
            <div><span class="lbl">Días</span><strong>${o.dias != null ? Number(o.dias) : '—'}</strong></div>
            <div><span class="lbl">Importe orden</span><strong>${fmt.money(importeOrden)}</strong></div>
            <div><span class="lbl">Teléfono</span><strong>${escHtml(o.celular || o.telefono || '—')}</strong></div>
            <div><span class="lbl">Correo</span><strong>${escHtml(o.correo || '—')}</strong></div>
          </div>
        </section>

        <section class="ops-order-detail__section">
          <div class="ops-order-detail__section-head">
            <h3>Desglose del cargo</h3>
            <span>${fmt.money(totals.total || 0)} · ${Number(totals.lineas || 0).toLocaleString('es-MX')} líneas</span>
          </div>
          <div class="ops-order-detail__cargo">
            ${cargo.length
              ? cargo.map((c) => `
                <article class="ops-order-detail__cargo-card">
                  <h4>${escHtml(c.label)}</h4>
                  <p class="ops-order-detail__cargo-total">${fmt.money(c.total)}</p>
                  <div class="ops-order-detail__cargo-facts">
                    <span>${Number(c.lineas || 0)} líneas</span>
                    <span>Sub ${fmt.money(c.subtotal)}</span>
                    <span>IVA ${fmt.money(c.iva)}</span>
                  </div>
                </article>`).join('')
              : '<p class="ops-order-detail__hint">Sin cargos registrados en el detalle.</p>'}
          </div>
        </section>

        ${sectionTable('Mano de obra', mo)}
        ${sectionTable('Refacciones cargadas', refs)}
        ${sectionTable('HYP / Pintura', hyp)}
      `;

      syncSeguimientoBtn(o.serie);
      bodyEl.querySelector('[data-od-serie-360]')?.addEventListener('click', () => openSeguimiento360(o.serie));
    }

    async function open(ordenId) {
      const id = String(ordenId || '').trim();
      if (!id) return;
      const token = ++requestToken;
      lastDetail = null;
      syncSeguimientoBtn('');
      titleEl.textContent = id;
      statusEl.textContent = 'Cargando detalle…';
      bodyEl.innerHTML = `
        <div class="ops-order-detail__loading">
          <span class="material-symbols-outlined">hourglass_top</span>
          <p>Consultando refacciones y cargos de ${escHtml(id)}…</p>
        </div>`;
      panel.classList.add('ops-order-detail--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-order-detail-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-order-detail-open');
      setExpanded(true);

      try {
        const data = await Dashboard.api(`/post-sales/orden/${encodeURIComponent(id)}`);
        if (token !== requestToken) return;
        renderDetail(data);
      } catch (err) {
        if (token !== requestToken) return;
        statusEl.textContent = 'Error';
        renderError(err?.message || 'No se pudo cargar el detalle de la orden.');
      }
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-od-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));
    seguimientoBtn?.addEventListener('click', () => {
      openSeguimiento360(lastDetail?.orden?.serie);
    });
    downloadBtn?.addEventListener('click', async () => {
      if (!lastDetail?.orden?.orden) {
        window.alert('Aún no hay detalle cargado para descargar.');
        return;
      }
      try {
        downloadBtn.disabled = true;
        const ordenId = lastDetail.orden.orden;
        await downloadXlsx(
          orderDetailToSheets(lastDetail),
          `orden_${ordenId}_${stampFile()}.xlsx`,
        );
      } catch (err) {
        window.alert(err?.message || 'No se pudo descargar el Excel.');
      } finally {
        downloadBtn.disabled = false;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('ops-order-detail--open')) {
        e.stopPropagation();
        close();
      }
    });

    orderDetailUi = { open, close, panel };
    return orderDetailUi;
  }

  function openOrderDetail(ordenId) {
    ensureOrderDetailPanel().open(ordenId);
  }

  function ensureOpsOrdersDrawer() {
    if (opsOrdersUi) return opsOrdersUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-orders-backdrop';
    backdrop.id = 'opsOrdersBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-orders-drawer';
    panel.id = 'opsOrdersDrawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Indicador operativo');
    panel.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo" data-ops-orders-logo>analytics</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-ops-orders-title>Indicador operativo</h2>
            <span class="ops-orders-drawer__status" data-ops-orders-status>0 órdenes</span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-ops-orders-download title="Descargar Excel" aria-label="Descargar Excel">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-ops-orders-expand title="Expandir" aria-label="Expandir panel">
            <span class="material-symbols-outlined" data-ops-orders-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-ops-orders-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <label class="ops-orders-drawer__search" for="opsOrdersSearch">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="opsOrdersSearch" type="search" placeholder="Buscar orden, cliente, asesor, serie..." autocomplete="off"/>
        </label>
        <button type="button" class="ops-orders-drawer__filter-chip" data-ops-orders-filter-chip hidden title="Quitar filtro"></button>
        <span class="ops-orders-drawer__meta" data-ops-orders-meta></span>
      </div>
      <div class="ops-orders-drawer__main">
        <aside class="ops-orders-drawer__summary custom-scrollbar" data-ops-orders-summary></aside>
        <div class="ops-orders-drawer__body custom-scrollbar" data-ops-orders-body></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-ops-orders-status]');
    const metaEl = panel.querySelector('[data-ops-orders-meta]');
    const bodyEl = panel.querySelector('[data-ops-orders-body]');
    const summaryEl = panel.querySelector('[data-ops-orders-summary]');
    const searchEl = panel.querySelector('#opsOrdersSearch');
    const filterChip = panel.querySelector('[data-ops-orders-filter-chip]');
    const expandBtn = panel.querySelector('[data-ops-orders-expand]');
    const expandIcon = panel.querySelector('[data-ops-orders-expand-icon]');
    const downloadBtn = panel.querySelector('[data-ops-orders-download]');
    const titleEl = panel.querySelector('[data-ops-orders-title]');
    const logoEl = panel.querySelector('[data-ops-orders-logo]');
    let expanded = false;
    /** @type {{ dim: string, value: string, label: string } | null} */
    let activeFilter = null;
    let lastExportRows = [];
    let currentMeta = { kpi: '', title: 'Indicador operativo', hint: '', icon: 'analytics' };

    const FILTER_DIM_LABEL = {
      tipo: 'Tipo',
      asesor: 'Asesor',
      antiguedad: 'Antigüedad',
      status: 'Estatus',
      mes: 'Mes',
    };

    function rowImporte(r) {
      const kpi = currentMeta.kpi;
      if (['facturadas', 'ticketFacturado', 'facturadoUltimoMes', 'mejorMes', 'cerradas'].includes(kpi)) {
        return Number(r.importeFacturado || r.importe || 0);
      }
      if ([
        'abiertas', 'aging0_30', 'aging31_60', 'aging61_90', 'aging91_120', 'aging120p',
        'criticas60', 'conRefacciones', 'promesasVencidas', 'sinImporte', 'sinAseguradora', 'sinPromesa', 'sinFecha',
        'estanciaPromAbiertas',
      ].includes(kpi)) {
        return Number(r.importeAbierto || r.importe || 0);
      }
      if (['tiempoPromCiclo', 'tiempoMedCiclo', 'cumplimientoPromesa', 'retrasoPromesa', 'facturasPorSemana'].includes(kpi)) {
        return Number(r.importeFacturado || r.importe || 0);
      }
      return Number(r.importeAbierto || r.importeFacturado || r.importe || 0);
    }

    function placeNearKpi(card) {
      if (expanded) return;
      const kpiBlock = document.getElementById('kpiOperational');
      const ref = card || kpiBlock;
      const rect = ref?.getBoundingClientRect?.();
      const topPad = 12;
      const minTop = 72;
      let top = 96;
      if (rect) {
        // Sale justo debajo del bloque/tarjeta de KPI (origen visual del indicador)
        top = Math.round(rect.bottom + topPad);
      }
      top = Math.max(minTop, Math.min(top, Math.round(window.innerHeight * 0.28)));
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
      if (expanded) {
        clearPlacement();
      } else if (panel.classList.contains('ops-orders-drawer--open')) {
        placeNearKpi(
          document.querySelector('#kpiOperational [data-ops-kpi].is-open')
            || document.querySelector('#tblAseg tr.row-active'),
        );
      }
    }

    function close() {
      orderDetailUi?.close?.();
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
      const key = openOpsKpiKey;
      openOpsKpiKey = null;
      openAseguradoraKey = null;
      document.querySelectorAll('#kpiOperational .kpi-card--clickable.is-open')
        .forEach((c) => c.classList.remove('is-open'));
      if (key) {
        document.querySelectorAll(`#kpiOperational [data-ops-kpi="${key}"]`)
          .forEach((c) => c.classList.remove('is-open'));
      }
      document.querySelectorAll('#tblAseg tr.row-active')
        .forEach((tr) => tr.classList.remove('row-active'));
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
        ${escHtml(FILTER_DIM_LABEL[activeFilter.dim] || activeFilter.dim)}: ${escHtml(activeFilter.label || activeFilter.value)}
        <span class="material-symbols-outlined" aria-hidden="true">close</span>`;
    }

    function matchesActiveFilter(r) {
      if (!activeFilter) return true;
      if (activeFilter.dim === 'tipo') {
        return String(r.tipoOrden || r.tipo || '') === activeFilter.value;
      }
      if (activeFilter.dim === 'asesor') {
        return String(r.asesor || 'Sin asesor') === activeFilter.value;
      }
      if (activeFilter.dim === 'antiguedad') {
        return String(r.antiguedad || 'Sin antigüedad') === activeFilter.value;
      }
      if (activeFilter.dim === 'status') {
        return String(r.statusLabel || r.status || '') === activeFilter.value;
      }
      if (activeFilter.dim === 'mes') {
        return monthKeyOf(r) === activeFilter.value;
      }
      return true;
    }

    function setFilter(dim, value, label) {
      if (activeFilter && activeFilter.dim === dim && activeFilter.value === value) {
        activeFilter = null;
      } else {
        activeFilter = { dim, value, label: label || value };
      }
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function clearFilter() {
      activeFilter = null;
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function renderSummary(rows) {
      const { fmt } = Dashboard;
      const num = (v) => Number(v || 0).toLocaleString('es-MX');
      const importeTotal = rows.reduce((acc, r) => acc + rowImporte(r), 0);
      const porAsesor = countBy(rows, (r) => r.asesor).slice(0, 8);
      const porTipo = countBy(rows, (r) => r.tipoOrden || r.tipo).slice(0, 8);
      const importeAsesor = sumBy(rows, (r) => r.asesor, (r) => rowImporte(r)).slice(0, 6);
      const porAntiguedad = countBy(rows, (r) => r.antiguedad || 'Sin antigüedad');
      const porStatus = countBy(rows, (r) => r.statusLabel || r.status || 'Sin estatus').slice(0, 8);

      const isActive = (dim, value) => activeFilter
        && activeFilter.dim === dim
        && activeFilter.value === value;

      const block = (titulo, dim, items, formatValue = (x) => num(x.value)) => `
        <div class="ops-orders-drawer__group">
          <h5>${escHtml(titulo)}</h5>
          ${items.length
            ? items.map((x) => `
              <button type="button"
                class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x.label) ? ' is-active' : ''}"
                data-ops-filter-dim="${escHtml(dim)}"
                data-ops-filter-value="${escHtml(x.label)}"
                title="Filtrar por ${escHtml(x.label)}">
                <span class="lbl">${escHtml(x.label)}</span>
                <span class="val">${formatValue(x)}</span>
              </button>`).join('')
            : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
        </div>`;

      const weekly = currentMeta.kpi === 'promedioSemanal'
        ? (lastDash?.charts?.weeklyFlow || [])
        : [];

      const weeklyBlock = weekly.length
        ? `
        <div class="ops-orders-drawer__group">
          <h5>Flujo semanal</h5>
          ${weekly.map((w) => `
            <div class="ops-orders-drawer__row">
              <span class="lbl" title="${escHtml(w.label)}">${escHtml(w.label)}</span>
              <span class="val">${num(w.ingresadas)} ing. · ${num(w.facturadas)} fact.</span>
            </div>`).join('')}
        </div>`
        : '';

      const ms = currentMeta.kpi === 'mejorMes' ? (lastDash?.summary?.mejorMesStats || null) : null;
      const signPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
      const mejorMesBlock = ms
        ? `
        <div class="ops-orders-drawer__group ops-orders-drawer__group--mejor">
          <h5>Comparativo · por qué es el mejor</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Mes ganador</span><span class="val">${escHtml(ms.label)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Facturado del mes</span><span class="val">${fmt.currency(ms.importeFacturado)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Órdenes facturadas</span><span class="val">${num(ms.facturadas)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Ingresadas del mes</span><span class="val">${num(ms.ingresadas)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Ticket prom. del mes</span><span class="val">${fmt.currency(ms.ticket)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">% facturación del mes</span><span class="val">${ms.pctFacturacion}%</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Participación del periodo</span><span class="val">${ms.sharePct}%</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Promedio mensual</span><span class="val">${fmt.currency(ms.promedioMensual)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Vs promedio</span><span class="val">${fmt.currency(ms.vsPromedioImporte)} · ${signPct(ms.vsPromedioPct)}</span></div>
          ${ms.segundoMes ? `
          <div class="ops-orders-drawer__row"><span class="lbl">2.º lugar</span><span class="val">${escHtml(ms.segundoMes)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Vs 2.º lugar</span><span class="val">${fmt.currency(ms.vsSegundoImporte)} · ${signPct(ms.vsSegundoPct)}</span></div>
          ` : '<p class="ops-orders-drawer__hint">Único mes con facturación en el periodo</p>'}
          <p class="ops-orders-drawer__hint">Criterio: mayor importe facturado en el acumulado del año · ${num(ms.mesesComparados)} mes(es)</p>
        </div>
        <div class="ops-orders-drawer__group">
          <h5>Ranking mensual (facturado)</h5>
          ${(ms.ranking || []).map((m) => `
            <button type="button"
              class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('mes', m.key) || (m.esMejor && !activeFilter) ? ' is-active' : ''}"
              data-ops-filter-dim="mes"
              data-ops-filter-value="${escHtml(m.key)}"
              data-ops-filter-label="${escHtml(m.label)}"
              title="Ver órdenes de ${escHtml(m.label)}">
              <span class="lbl">${m.posicion}. ${escHtml(m.label)}${m.esMejor ? ' ★' : ''}</span>
              <span class="val">${fmt.currency(m.importeFacturado)}</span>
            </button>`).join('') || '<p class="ops-orders-drawer__hint">Sin meses</p>'}
        </div>`
        : '';

      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Registros</span><span class="val">${num(rows.length)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Importe relacionado</span><span class="val">${fmt.currency(importeTotal)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Alcance</span><span class="val">${escHtml(currentMeta.hint || 'Indicador operativo')}</span></div>
          ${activeFilter ? '<p class="ops-orders-drawer__hint">Clic en un renglón para filtrar · clic otra vez para quitar</p>' : '<p class="ops-orders-drawer__hint">Clic en tipo, asesor, estatus o antigüedad para filtrar</p>'}
        </div>
        ${mejorMesBlock}
        ${weeklyBlock}
        ${block('Por tipo de orden', 'tipo', porTipo)}
        ${block('Por asesor', 'asesor', porAsesor)}
        ${block('Importe por asesor', 'asesor', importeAsesor, (x) => fmt.currency(x.value))}
        ${block('Por estatus', 'status', porStatus)}
        ${block('Por antigüedad', 'antiguedad', porAntiguedad)}
      `;
    }

    function renderList(term = '') {
      const { fmt } = Dashboard;
      const q = String(term || '').trim().toLowerCase();
      const searched = !q
        ? opsOrdersRows
        : opsOrdersRows.filter((r) => [
          r.orden, r.nombre, r.asesor, r.serie, r.aseguradora, r.tipoOrden, r.statusLabel, r.semaforo, r.antiguedad,
        ].some((v) => String(v || '').toLowerCase().includes(q)));

      const filtered = searched.filter(matchesActiveFilter);
      lastExportRows = filtered;

      const importe = filtered.reduce((acc, r) => acc + rowImporte(r), 0);
      statusEl.textContent = `${filtered.length.toLocaleString('es-MX')} orden(es) · ${fmt.currency(importe)}`;
      metaEl.textContent = activeFilter || q
        ? `${filtered.length} de ${opsOrdersRows.length}`
        : `${opsOrdersRows.length} registros`;

      // El resumen refleja el universo de búsqueda (sin el filtro de resumen) para poder cambiar de opción
      renderSummary(searched);
      updateFilterChip();

      if (!filtered.length) {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__empty">
            <span class="material-symbols-outlined">inbox</span>
            <p>${activeFilter || q ? 'Sin coincidencias con el filtro actual.' : 'No hay órdenes para este indicador.'}</p>
          </div>`;
        return;
      }

      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <h5>Detalle de órdenes</h5>
          <span>${filtered.length.toLocaleString('es-MX')}</span>
        </div>
        ${filtered.map((r) => {
          const critico = r.critica || r.antiguedad === '+120' || r.promesaVencida;
          return `
            <button type="button" class="ops-orders-drawer__item${critico ? ' is-critical' : ''}" data-ops-orden="${escHtml(r.orden || '')}" title="Ver detalle completo">
              <div class="ops-orders-drawer__item-head">
                <strong>${escHtml(r.orden || '—')}</strong>
                <span class="ops-orders-drawer__tag">${escHtml(r.antiguedad || r.statusLabel || 'Orden')}</span>
              </div>
              <p class="ops-orders-drawer__msg">${escHtml(r.nombre || 'Sin cliente')} · ${escHtml(r.asesor || 'Sin asesor')}</p>
              <div class="ops-orders-drawer__facts">
                <span>${escHtml(r.tipoOrden || 'Tipo —')}</span>
                <span>${r.dias != null ? `${Number(r.dias)} días` : '—'}</span>
                <span>${fmt.money(rowImporte(r))}</span>
              </div>
              <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
                <span>Ingreso ${escHtml(r.ingreso || '—')}</span>
                <span>Promesa ${escHtml(r.promesa || '—')}</span>
                <span>${escHtml(r.statusLabel || '')}</span>
              </div>
              ${r.serie || r.aseguradora ? `<p class="ops-orders-drawer__sub">${escHtml([r.serie, r.aseguradora].filter(Boolean).join(' · '))}</p>` : ''}
              <span class="ops-orders-drawer__open-hint">Ver refacciones y cargo →</span>
            </button>`;
        }).join('')}`;
    }

    function open(rows, card, meta = {}) {
      currentMeta = {
        kpi: meta.kpi || '',
        title: meta.title || 'Indicador operativo',
        hint: meta.hint || '',
        icon: meta.icon || 'analytics',
      };
      if (titleEl) titleEl.textContent = currentMeta.title;
      if (logoEl) logoEl.textContent = currentMeta.icon;
      panel.setAttribute('aria-label', currentMeta.title);

      opsOrdersRows = (rows || []).slice().sort((a, b) => rowImporte(b) - rowImporte(a)
        || Number(b.dias || 0) - Number(a.dias || 0));
      if (searchEl) searchEl.value = '';
      activeFilter = null;
      if (currentMeta.kpi === 'mejorMes') {
        const ms = lastDash?.summary?.mejorMesStats;
        if (ms?.key) {
          activeFilter = { dim: 'mes', value: ms.key, label: ms.label };
        }
      }
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
    panel.querySelector('[data-ops-orders-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));
    downloadBtn?.addEventListener('click', async () => {
      if (!lastExportRows.length) {
        window.alert('No hay órdenes seleccionadas para descargar.');
        return;
      }
      try {
        downloadBtn.disabled = true;
        const base = String(currentMeta.title || currentMeta.kpi || 'indicador')
          .replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ]+/gi, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 48) || 'indicador';
        const filterPart = activeFilter
          ? `_${FILTER_DIM_LABEL[activeFilter.dim] || activeFilter.dim}_${activeFilter.value}`
          : '';
        const safeFilter = String(filterPart).replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ]+/gi, '_').slice(0, 40);
        await downloadXlsx(
          [{ name: String(currentMeta.title || 'Indicador').slice(0, 31), rows: ordersToExportRows(lastExportRows) }],
          `${base}${safeFilter}_${stampFile()}.xlsx`,
        );
      } catch (err) {
        window.alert(err?.message || 'No se pudo descargar el Excel.');
      } finally {
        downloadBtn.disabled = false;
      }
    });
    searchEl?.addEventListener('input', () => renderList(searchEl.value));
    filterChip?.addEventListener('click', clearFilter);

    summaryEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ops-filter-dim]');
      if (!btn || !summaryEl.contains(btn)) return;
      setFilter(
        btn.dataset.opsFilterDim,
        btn.dataset.opsFilterValue,
        btn.dataset.opsFilterLabel || btn.dataset.opsFilterValue,
      );
    });

    bodyEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ops-orden]');
      if (!btn || !bodyEl.contains(btn)) return;
      const orden = btn.getAttribute('data-ops-orden');
      if (orden) openOrderDetail(orden);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (orderDetailUi?.panel?.classList.contains('ops-order-detail--open')) return;
      if (panel.classList.contains('ops-orders-drawer--open')) close();
    });

    opsOrdersUi = { open, close, renderList, panel };
    return opsOrdersUi;
  }

  function closeOpsOrdersDrawer() {
    if (opsOrdersUi) opsOrdersUi.close();
  }

  function openOpsOrdersDrawer(rows, card, meta = {}) {
    ensureOpsOrdersDrawer().open(rows, card, meta);
  }

  function opsKpiIcon(kpi) {
    const map = {
      ingresadas: 'input',
      facturadas: 'check_circle',
      abiertas: 'pending_actions',
      canceladas: 'cancel',
      cerradas: 'task_alt',
      importeIngresado: 'payments',
      ticketFacturado: 'receipt_long',
      facturadoUltimoMes: 'calendar_month',
      mejorMes: 'emoji_events',
      aging0_30: 'schedule',
      aging31_60: 'hourglass_bottom',
      aging61_90: 'hourglass_top',
      aging91_120: 'timer',
      aging120p: 'warning',
      criticas60: 'priority_high',
      conRefacciones: 'build',
      promesasVencidas: 'event_busy',
      promedioSemanal: 'trending_up',
      tiempoPromCiclo: 'timer',
      tiempoMedCiclo: 'av_timer',
      estanciaPromAbiertas: 'hourglass_top',
      diasPromMecanica: 'handyman',
      diasPromEsperaRefacc: 'inventory_2',
      diasPromPintura: 'format_paint',
      cumplimientoPromesa: 'verified',
      retrasoPromesa: 'schedule',
      facturasPorSemana: 'speed',
      sinImporte: 'money_off',
      sinAseguradora: 'policy',
      sinPromesa: 'event_available',
      sinFecha: 'edit_calendar',
      excluidos: 'block',
      aseguradora: 'policy',
    };
    return map[kpi] || 'analytics';
  }

  function rowsForAseguradora(name, dash) {
    const target = String(name || '');
    return (dash?.filtered || []).filter((r) => String(r.aseguradora || '') === target);
  }

  function renderAseguradoraDetail(aseguradora, rowEl) {
    if (!lastDash || !aseguradora) return;
    if (openAseguradoraKey === aseguradora) {
      closeOpsKpiDetail();
      return;
    }

    const detailPanel = document.getElementById('opsKpiDetail');
    if (detailPanel) {
      detailPanel.classList.add('hidden');
      detailPanel.innerHTML = '';
    }
    closeOpsOrdersDrawer();

    openOpsKpiKey = null;
    document.querySelectorAll('#kpiOperational .kpi-card--clickable.is-open')
      .forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('#tblAseg tr.row-active')
      .forEach((tr) => tr.classList.remove('row-active'));

    openAseguradoraKey = aseguradora;
    rowEl?.classList.add('row-active');

    const rows = rowsForAseguradora(aseguradora, lastDash);
    openOpsOrdersDrawer(rows, rowEl, {
      kpi: 'aseguradora',
      title: aseguradora,
      hint: 'Órdenes de esta aseguradora en el periodo filtrado',
      icon: 'policy',
    });
  }

  function renderOpsKpiDetail(kpi, card) {
    if (!lastDash) return;
    if (openOpsKpiKey === kpi) {
      closeOpsKpiDetail();
      return;
    }

    const detailPanel = document.getElementById('opsKpiDetail');
    if (detailPanel) {
      detailPanel.classList.add('hidden');
      detailPanel.innerHTML = '';
    }
    closeOpsOrdersDrawer();

    openAseguradoraKey = null;
    document.querySelectorAll('#tblAseg tr.row-active')
      .forEach((tr) => tr.classList.remove('row-active'));

    openOpsKpiKey = kpi;
    const meta = opsKpiMeta(kpi, lastDash);
    openOpsOrdersDrawer(rowsForOpsKpi(kpi, lastDash), card, {
      kpi,
      title: meta.title,
      hint: meta.hint,
      icon: opsKpiIcon(kpi),
    });
  }

  function bindOpsKpiCards() {
    document.querySelectorAll('#kpiOperational [data-ops-kpi]').forEach((card) => {
      const open = () => renderOpsKpiDetail(card.dataset.opsKpi, card);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function renderKpis(d) {
    const { fmt } = Dashboard;
    const s = d.summary || { ...d.executive, ...d.finance };
    const a = d.aging;
    const r = d.risk;
    const o = d.operations || {};

    document.getElementById('kpiExecutive').innerHTML = [
      executiveCard('Importe facturado', fmt.currency(s.importeFacturado), `${fmt.number(s.facturadas)} órdenes · ${s.pctFacturado}% del total`, 'green', 'payments', 'psImporteFacturado'),
      executiveCard('Tasa de facturación', `${s.pctImporteFacturado}%`, `del ${fmt.currency(s.importeIngresado)} ingresado`, 'blue', 'percent', 'psTasaFacturacion'),
      executiveCard('Backlog abierto', fmt.currency(s.importeAbierto), `${fmt.number(s.abiertas)} órdenes en taller hoy`, 'amber', 'pending_actions', 'psBacklog'),
      executiveCard(
        'Crecimiento facturado',
        `${s.crecimientoFacturado > 0 ? '+' : ''}${s.crecimientoFacturado}%`,
        growthLabel(s.crecimientoFacturado, s.tieneMesAnterior),
        s.crecimientoFacturado >= 0 ? 'gain' : 'loss',
        'trending_up',
        'psCrecimiento',
      ),
      executiveCard('Riesgo +120 días', fmt.currency(s.riesgo120), 'importe abierto en órdenes críticas', 'loss', 'warning', 'psRiesgo120'),
    ].join('');

    document.getElementById('kpiOperational').innerHTML = [
      kpiGroup('Volumen del periodo', [
        kpiCard('Órdenes ingresadas', fmt.number(s.totalOrdenes), 'en el rango de fechas', 'blue', null, 'ingresadas'),
        kpiCard('Facturadas', fmt.number(s.facturadas), `${s.pctFacturado}% del total`, 'green', null, 'facturadas'),
        kpiCard(
          'Cerradas',
          fmt.number(s.cerradas),
          `${s.pctCerrado || 0}% del periodo · ${fmt.number(s.facturadas)} fact. · ${fmt.number(s.canceladas)} canc.`,
          'violet',
          null,
          'cerradas',
        ),
        kpiCard('Abiertas hoy', fmt.number(s.abiertas), fmt.currency(s.importeAbierto), 'amber', null, 'abiertas'),
        kpiCard('Canceladas', fmt.number(s.canceladas), 'en el periodo', 'rose', null, 'canceladas'),
      ]),
      kpiGroup('Importes y tickets', [
        kpiCard('Importe ingresado', fmt.currency(s.importeIngresado), `ticket prom. ${fmt.currency(s.ticketPromIngresado)}`, 'violet', null, 'importeIngresado'),
        kpiCard('Ticket prom. facturado', fmt.currency(s.ticketPromFacturado), 'por orden facturada', 'blue', null, 'ticketFacturado'),
        kpiCard(`Facturado · ${s.ultimoMesLabel}`, fmt.currency(s.facturadoUltimoMes), 'último mes del periodo', 'violet', null, 'facturadoUltimoMes'),
        kpiCard(
          'Mejor mes',
          fmt.currency(s.mejorMesImporte),
          (() => {
            const ms = s.mejorMesStats;
            const year = ytdMeta?.year ? ` · ${ytdMeta.year}` : '';
            if (!ms) return `Acumulado del año${year}`;
            const vs = ms.vsPromedioPct == null ? '' : ` · ${ms.vsPromedioPct > 0 ? '+' : ''}${ms.vsPromedioPct}% vs prom.`;
            return `${ms.label}${vs} · #1/${ms.mesesComparados}${year}`;
          })(),
          'green',
          null,
          'mejorMes',
        ),
      ]),
      kpiGroup('Antigüedad de abiertas', [
        kpiCard('0-30 días', fmt.number(a.b0_30), 'backlog reciente', 'green', null, 'aging0_30'),
        kpiCard('31-60 días', fmt.number(a.b31_60), '', 'amber', null, 'aging31_60'),
        kpiCard('61-90 días', fmt.number(a.b61_90), '', 'rose', null, 'aging61_90'),
        kpiCard('91-120 días', fmt.number(a.b91_120), '', 'rose', 'psAging91', 'aging91_120'),
        kpiCard('+120 días', fmt.number(a.b120p), '', 'rose', 'psAging120', 'aging120p'),
      ]),
      kpiGroup('Operación de taller', [
        kpiCard(
          'Tiempo prom. ciclo',
          `${fmt.number(o.tiempoPromCiclo || 0)} d`,
          `${fmt.number(o.ciclosConDato || 0)} facturadas con ingreso/cierre`,
          'blue',
          'psTiempoCiclo',
          'tiempoPromCiclo',
        ),
        kpiCard(
          'Estancia prom. abiertas',
          `${fmt.number(o.estanciaPromAbiertas || 0)} d`,
          'días promedio en backlog actual',
          'amber',
          null,
          'estanciaPromAbiertas',
        ),
        kpiCard(
          'Reparación mecánica',
          `${fmt.number(o.diasPromMecanica || 0)} d`,
          `${fmt.number(o.ordenesMecanica || 0)} abiertas Servicio en taller`,
          'blue',
          'psDiasMecanica',
          'diasPromMecanica',
        ),
        kpiCard(
          'Espera de refacciones',
          `${fmt.number(o.diasPromEsperaRefacc || 0)} d`,
          `${fmt.number(o.ordenesEsperaRefacc || 0)} detenidas / pend. con RE`,
          'amber',
          'psDiasEsperaRefacc',
          'diasPromEsperaRefacc',
        ),
        kpiCard(
          'Pintura / HyP',
          `${fmt.number(o.diasPromPintura || 0)} d`,
          `${fmt.number(o.ordenesPintura || 0)} abiertas en Hojalatería y Pintura`,
          'violet',
          'psDiasPintura',
          'diasPromPintura',
        ),
        kpiCard(
          'Retraso prom. vs promesa',
          `${fmt.number(o.retrasoPromDias || 0)} d`,
          `${fmt.number(o.retrasadas || 0)} órdenes fuera de promesa`,
          (o.retrasoPromDias || 0) > 0 ? 'rose' : 'green',
          null,
          'retrasoPromesa',
        ),
        kpiCard(
          'Promesas vencidas',
          fmt.number(o.promesasVencidas || r.promesasVencidas || 0),
          'abiertas con fecha promesa menor a hoy',
          'amber',
          'psPromesasVencidas',
          'promesasVencidas',
        ),
        kpiCard(
          'Facturación / semana',
          fmt.number(o.facturasPorSemana || 0),
          'órdenes facturadas por semana del periodo',
          'green',
          null,
          'facturasPorSemana',
        ),
      ]),
    ].join('');

    bindOpsKpiCards();
    if (openOpsKpiKey) {
      const card = document.querySelector(`#kpiOperational [data-ops-kpi="${openOpsKpiKey}"]`);
      if (card) {
        const keep = openOpsKpiKey;
        openOpsKpiKey = null;
        renderOpsKpiDetail(keep, card);
      } else {
        closeOpsKpiDetail();
      }
    }
  }

  function renderMesCursoNomenclatura(raw) {
    const body = document.getElementById('tblMesCursoNomen');
    const labelEl = document.getElementById('mesCursoNomenLabel');
    const legendEl = document.getElementById('mesCursoNomenLegend');
    if (!body) return;

    const data = raw || resolveMesCursoData();
    const letras = data?.letras || MES_CURSO_LETRAS;
    if (labelEl) {
      labelEl.textContent = data?.periodo?.label
        ? `${data.periodo.label} · sin canceladas`
        : 'Mes en curso · sin canceladas';
    }
    if (legendEl) {
      const labels = data?.labels || MES_CURSO_LABELS;
      legendEl.textContent = letras.map((L) => `${L}: ${labels[L] || L}`).join(' · ');
    }

    const activeDays = (data?.days || []).filter((r) => (r.total || 0) > 0);
    if (!activeDays.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="9">Sin órdenes N/D/Q/C/X/Y en el mes en curso (excluye canceladas). Usa periodo “Mes actual” y reinicia el backend si acabas de actualizar.</td></tr>`;
      return;
    }

    const cell = (n) => (n ? String(n) : '—');
    const dayRows = activeDays.map((r) => `
      <tr>
        <td><strong>${r.fechaLabel}</strong></td>
        ${letras.map((L) => `<td class="cell-num">${cell(r[L])}</td>`).join('')}
        <td class="cell-num"><strong>${r.total || 0}</strong></td>
        <td class="cell-num">${r.acumulado || 0}</td>
      </tr>`).join('');

    const t = data.totals || {};
    const totalRow = `
      <tr class="row-highlight">
        <td><strong>Total</strong></td>
        ${letras.map((L) => `<td class="cell-num"><strong>${t[L] || 0}</strong></td>`).join('')}
        <td class="cell-num"><strong>${t.total || 0}</strong></td>
        <td class="cell-num"><strong>${t.acumulado || t.total || 0}</strong></td>
      </tr>`;

    body.innerHTML = dayRows + totalRow;
  }

  function renderTables(d) {
    const { fmt } = Dashboard;
    const t = d.tables;

    renderMesCursoNomenclatura();

    document.getElementById('tblCriticas').innerHTML = t.criticas.length
      ? t.criticas.map((r) => `<tr><td><strong>${r.orden}</strong></td><td>${r.nombre}</td><td>${r.asesor}</td><td>${r.dias}</td><td>${fmt.money(r.importe)}</td><td>${r.promesa || '—'}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Sin órdenes críticas en el filtro actual.</td></tr>';

    document.getElementById('tblAsesor').innerHTML = t.productividadAsesor.length
      ? t.productividadAsesor.map((r) => `<tr><td>${r.asesor}</td><td>${r.ordenes}</td><td>${r.facturadas}</td><td>${r.abiertas}</td><td>${fmt.money(r.importe)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="5">Sin datos.</td></tr>';

    document.getElementById('tblAseg').innerHTML = t.controlAseguradora.length
      ? t.controlAseguradora.map((r) => `
        <tr class="row-selectable${openAseguradoraKey === r.aseguradora ? ' row-active' : ''}"
          data-aseguradora="${escHtml(r.aseguradora)}"
          title="Ver resumen de órdenes · ${escHtml(r.aseguradora)}"
          tabindex="0"
          role="button">
          <td>${escHtml(r.aseguradora)}</td>
          <td>${r.ordenes}</td>
          <td>${r.facturadas}</td>
          <td>${fmt.money(r.importeFacturado)}</td>
          <td>${r.abiertas}</td>
          <td>${fmt.money(r.importeAbierto)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Sin órdenes con aseguradora en el filtro actual.</td></tr>';

    document.getElementById('tblControlOrdenes').innerHTML = t.controlOrdenes.length
      ? t.controlOrdenes.map((r) => `<tr><td>${r.tipoOrden}</td><td>${r.ordenes}</td><td>${r.facturadas}</td><td>${fmt.money(r.importeFacturado)}</td><td>${r.abiertas}</td><td>${fmt.money(r.importeAbierto)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Sin órdenes sin aseguradora en el filtro actual.</td></tr>';

    if (openAseguradoraKey) {
      const keep = openAseguradoraKey;
      const row = [...document.querySelectorAll('#tblAseg tr[data-aseguradora]')]
        .find((tr) => tr.getAttribute('data-aseguradora') === keep);
      if (row) {
        openAseguradoraKey = null;
        renderAseguradoraDetail(keep, row);
      } else {
        closeOpsKpiDetail();
      }
    }
  }

  function bindTblAseg() {
    const body = document.getElementById('tblAseg');
    if (!body || body.dataset.boundAseg === '1') return;
    body.dataset.boundAseg = '1';
    const openFromRow = (tr) => {
      const name = tr?.getAttribute('data-aseguradora');
      if (name) renderAseguradoraDetail(name, tr);
    };
    body.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-aseguradora]');
      if (!tr || !body.contains(tr)) return;
      openFromRow(tr);
    });
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr[data-aseguradora]');
      if (!tr || !body.contains(tr)) return;
      e.preventDefault();
      openFromRow(tr);
    });
  }

  function renderCharts(c, opts) {
    const { chartOptions, chartColors, chartPalette } = Dashboard;

    destroyChart('cWeekly');
    charts.cWeekly = new Chart(document.getElementById('cWeekly'), {
      type: 'line',
      data: {
        labels: c.weeklyFlow.map((x) => x.label),
        datasets: [
          { label: 'Ingresadas', data: c.weeklyFlow.map((x) => x.ingresadas), borderColor: chartColors.primary, tension: 0.3 },
          { label: 'Facturadas', data: c.weeklyFlow.map((x) => x.facturadas), borderColor: chartColors.rose, tension: 0.3 },
        ],
      },
      options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
    });

    const weekLabels = c.statusByWeek.map((x) => x.label);
    const weekGroups = [...new Set(c.statusByWeek.flatMap((x) => Object.keys(x.groups)))];
    destroyChart('cStatusWeek');
    charts.cStatusWeek = new Chart(document.getElementById('cStatusWeek'), {
      type: 'bar',
      data: {
        labels: weekLabels,
        datasets: weekGroups.map((g, i) => ({
          label: g,
          data: c.statusByWeek.map((w) => w.groups[g] || 0),
          backgroundColor: chartPalette[i % chartPalette.length],
          borderRadius: 4,
        })),
      },
      options: chartOptions({ scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: 'bottom' } } }),
    });

    destroyChart('cTipo');
    charts.cTipo = new Chart(document.getElementById('cTipo'), {
      type: 'bar',
      data: {
        labels: c.tipoOrden.map((x) => x.label.slice(0, 18)),
        datasets: [{ label: 'Órdenes', data: c.tipoOrden.map((x) => x.value), backgroundColor: chartColors.secondary, borderRadius: 8 }],
      },
      options: chartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });
  }

  function countActiveFilters() {
    const f = getFilters();
    let n = 0;
    if (f.status) n += 1;
    if (f.asesor) n += 1;
    if (f.tipo != null) n += 1;
    if (f.antiguedad) n += 1;
    if (f.importeMin !== '' && f.importeMin != null) n += 1;
    if (f.importeMax !== '' && f.importeMax != null) n += 1;
    if (f.soloCriticas) n += 1;
    if (f.promesaVencida) n += 1;
    if (f.buscar.trim()) n += 1;
    return n;
  }

  function formatPeriodLabel(fi, ff) {
    if (!fi || !ff) return 'Seleccione un rango de fechas';
    const start = new Date(`${fi}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = new Date(`${ff}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Periodo cargado: ${start} → ${end}`;
  }

  function updateFilterUI(filteredCount) {
    const active = countActiveFilters();
    const badge = document.getElementById('filterActiveCount');
    if (badge) {
      badge.textContent = active
        ? `${active} filtro${active === 1 ? '' : 's'} operativo${active === 1 ? '' : 's'}`
        : 'Sin filtros operativos';
      badge.classList.toggle('is-active', active > 0);
    }

    const fi = document.getElementById('fechaInicio')?.value;
    const ff = document.getElementById('fechaFin')?.value;
    const periodEl = document.getElementById('filterPeriodLabel');
    if (periodEl) {
      const base = formatPeriodLabel(fi, ff);
      periodEl.textContent = filteredCount != null && fi && ff
        ? `${base} · ${filteredCount} ${currentArea === 'refacciones' ? 'pedidos' : (currentArea === 'posventa' ? 'registros' : 'órdenes')} visibles`
        : base;
    }

    const opsLbl = document.getElementById('filterOpsLabel');
    if (opsLbl) {
      opsLbl.textContent = active
        ? `${active} activo${active === 1 ? '' : 's'}`
        : 'Todos';
    }
  }

  function clearPresetChips() {
    document.querySelectorAll('.filters-panel [data-preset]').forEach((b) => b.classList.remove('chip--active'));
  }

  function clearOperationalFilters() {
    Object.entries(FILTER_IDS).forEach(([key, id]) => {
      if (key === 'tipo') {
        document.querySelectorAll('#fTipoOptions input[type="checkbox"]').forEach((cb) => {
          cb.checked = true;
        });
        updateTipoLabel();
        setTipoPanelOpen(false);
        return;
      }
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
    refreshDashboard();
  }

  function updateAreaUI() {
    const meta = window.PostSalesOrderTypes?.areaMeta?.(currentArea) || { label: 'PostVenta', hint: '' };
    const hintEl = document.getElementById('postSalesAreaHint');
    if (hintEl) hintEl.textContent = meta.hint || '';

    document.querySelectorAll('#postVentaMainTabs [data-ps-section]').forEach((btn) => {
      const active = btn.getAttribute('data-ps-section') === currentArea;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const isHome = currentArea === 'posventa';
    const isRef = currentArea === 'refacciones';
    const isOrdenes = currentArea === 'servicio' || currentArea === 'hyp';
    const isServicio = currentArea === 'servicio';

    document.getElementById('panelPosVentaHome')?.classList.toggle('hidden', !isHome);
    document.getElementById('panelPostVentaOrdenes')?.classList.toggle('hidden', !isOrdenes);
    document.getElementById('panelPostVentaRefacciones')?.classList.toggle('hidden', !isRef);
    document.getElementById('panelMesCursoNomenclatura')?.classList.toggle('hidden', !isServicio);
  }

  function countOrdersByArea(area) {
    const OT = window.PostSalesOrderTypes;
    if (!OT?.matchesArea) return (allRecords || []).length;
    return (allRecords || []).filter((r) => OT.matchesArea(r, area)).length;
  }

  function renderPosVentaHome() {
    const { fmt } = Dashboard;
    const OT = window.PostSalesOrderTypes;
    const sectionsEl = document.getElementById('posVentaHomeSections');
    const homeKpi = document.getElementById('kpiPosVentaHome');

    const servicioN = countOrdersByArea('servicio');
    const hypN = countOrdersByArea('hyp');
    const refVentas = Number(refaccionesData?.ventas?.financieras?.summary?.ventas || 0);
    const refN = Number(refaccionesData?.pedidos?.summary?.totalPedidos || refaccionesData?.summary?.totalPedidos || 0);
    const refLoaded = Boolean(refaccionesData);

    if (sectionsEl) {
      const card = (id, icon, title, value, sub, cls) => `
        <button type="button" class="kpi-card kpi-card--${cls} kpi-card--clickable" data-ps-home-section="${id}" title="Ir a ${title}">
          <div class="kpi-card-head">
            <span class="kpi-title">${title}</span>
            <span class="material-symbols-outlined kpi-icon">${icon}</span>
          </div>
          <div class="kpi-value">${value}</div>
          <p class="kpi-subtitle">${sub}</p>
          <span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">arrow_forward</span>
          <div class="kpi-accent"></div>
        </button>`;
      sectionsEl.innerHTML = [
        card('servicio', 'build', 'Servicio', fmt.number(servicioN), OT?.areaMeta?.('servicio')?.hint || 'Órdenes de servicio', 'blue'),
        card('refacciones', 'warehouse', 'Refacciones', refLoaded ? fmt.money(refVentas) : '—', refLoaded ? `${fmt.number(refN)} pedidos compra · ventas 048x` : (OT?.areaMeta?.('refacciones')?.hint || 'Ventas e inventario'), 'amber'),
        card('hyp', 'format_paint', 'HyP', fmt.number(hypN), OT?.areaMeta?.('hyp')?.hint || 'Órdenes HyP', 'violet'),
      ].join('');
      sectionsEl.querySelectorAll('[data-ps-home-section]').forEach((btn) => {
        btn.addEventListener('click', () => setPostVentaArea(btn.getAttribute('data-ps-home-section')));
      });
    }

    const dash = PostSalesAnalytics.computeDashboard(allRecords, { ...getFilters(), area: 'posventa' }, openSnapshot, ytdRecords);
    const s = dash.summary || { ...dash.executive, ...dash.finance };
    if (homeKpi) {
      homeKpi.innerHTML = [
        executiveCard('Órdenes ingresadas', fmt.number(s.totalOrdenes), 'todas las nomenclaturas', 'blue', 'assignment', null),
        executiveCard('Facturadas', fmt.number(s.facturadas), `${s.pctFacturado}% del total`, 'green', 'payments', null),
        executiveCard('Importe facturado', fmt.currency(s.importeFacturado), 'periodo consultado', 'violet', 'attach_money', null),
        executiveCard('Backlog abierto', fmt.currency(s.importeAbierto), `${fmt.number(s.abiertas)} en taller`, 'amber', 'pending_actions', null),
      ].join('');
    }
  }

  function formatPedidoFecha(v) {
    if (v == null || v === '') return '—';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return formatIsoDisplay(s.slice(0, 10));
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatIsoDisplay(toIsoLocal(d));
    return s;
  }

  function setRefaccionesSubTab(tab) {
    const next = ['ventas', 'inventario', 'pedidos', 'pendientes'].includes(tab) ? tab : 'ventas';
    refaccionesSubTab = next;
    document.querySelectorAll('#refaccionesSubTabs [data-ref-tab]').forEach((btn) => {
      const active = btn.getAttribute('data-ref-tab') === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('.refacciones-subpanel').forEach((panel) => {
      const id = panel.getAttribute('data-ref-panel');
      panel.classList.toggle('hidden', id !== next);
    });
  }

  function renderRefaccionesDashboard(data) {
    const { fmt } = Dashboard;
    const inv = data?.inventario || {};
    const ped = data?.pedidos || {};
    const pend = data?.pendientes || {};
    const fin = data?.ventas?.financieras || {};
    const most = data?.ventas?.mostrador || {};

    const finS = fin.summary || {};
    const finKpi = document.getElementById('kpiRefaccionesVentas');
    const canalesMeta = document.getElementById('refaccionesVentasCanalesMeta');
    const canalesBody = document.getElementById('tblRefaccionesVentasCanales');
    if (canalesMeta) {
      canalesMeta.textContent = fin.available === false
        ? 'Sin CON_CTAS en el periodo'
        : `${fmt.money(finS.ventas || 0)} ventas · margen ${fmt.number(finS.margenBrutoPct || 0)}%`;
    }
    if (finKpi) {
      finKpi.innerHTML = `
        <div class="kpi-group">
          <h4 class="kpi-group-title">Financiero (0481–0484)</h4>
          <div class="kpi-grid">
            <div class="kpi-card kpi-card--blue"><span class="kpi-title">Ventas</span><div class="kpi-value">${fmt.money(finS.ventas || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--rose"><span class="kpi-title">Costo</span><div class="kpi-value">${fmt.money(finS.costo || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--green"><span class="kpi-title">Utilidad bruta</span><div class="kpi-value">${fmt.money(finS.utilidadBruta || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--violet"><span class="kpi-title">Margen bruto</span><div class="kpi-value">${fmt.number(finS.margenBrutoPct || 0)}%</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--slate"><span class="kpi-title">Utilidad operación</span><div class="kpi-value">${fmt.money(finS.utilidadOperacion || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--amber"><span class="kpi-title">Margen operación</span><div class="kpi-value">${fmt.number(finS.margenOperacionPct || 0)}%</div><div class="kpi-accent"></div></div>
          </div>
        </div>`;
    }
    if (canalesBody) {
      const rows = fin.canales || [];
      canalesBody.innerHTML = rows.length
        ? rows.map((c) => `
          <tr>
            <td>${escHtml(c.label || c.key)}</td>
            <td class="cell-num">${fmt.money(c.ingreso || 0)}</td>
            <td class="cell-num">${fmt.number(c.pctVentas || 0)}%</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="3">Sin movimientos de venta de refacciones en el periodo (0481–0484).</td></tr>';
    }

    const mostS = most.summary || {};
    const mostKpi = document.getElementById('kpiRefaccionesMostrador');
    const mostMeta = document.getElementById('refaccionesMostradorMeta');
    const mostBody = document.getElementById('tblRefaccionesMostrador');
    if (mostMeta) mostMeta.textContent = `${fmt.number(mostS.pedidos || 0)} pedido(s) · ${fmt.money(mostS.importe || 0)}`;
    if (mostKpi) {
      mostKpi.innerHTML = `
        <div class="kpi-group">
          <h4 class="kpi-group-title">Mostrador (PAR_PEDMOST)</h4>
          <div class="kpi-grid">
            <div class="kpi-card kpi-card--blue"><span class="kpi-title">Pedidos</span><div class="kpi-value">${fmt.number(mostS.pedidos || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--green"><span class="kpi-title">Importe</span><div class="kpi-value">${fmt.money(mostS.importe || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--amber"><span class="kpi-title">Pendientes</span><div class="kpi-value">${fmt.number(mostS.pendientes || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--violet"><span class="kpi-title">Cerrados</span><div class="kpi-value">${fmt.number(mostS.cerrados || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--slate"><span class="kpi-title">Imp. cerrados</span><div class="kpi-value">${fmt.money(mostS.importeCerrados || 0)}</div><div class="kpi-accent"></div></div>
          </div>
        </div>`;
    }
    if (mostBody) {
      const rows = most.detalle || [];
      mostBody.innerHTML = rows.length
        ? rows.map((r) => `
          <tr>
            <td class="mono">${escHtml(r.numero)}</td>
            <td>${escHtml(formatPedidoFecha(r.fecha))}</td>
            <td>${escHtml(r.status || '—')}</td>
            <td>${escHtml(r.cliente || '—')}</td>
            <td>${escHtml(r.almacen || '—')}</td>
            <td class="cell-num">${fmt.money(r.neto || 0)}</td>
            <td class="cell-num">${fmt.money(r.iva || 0)}</td>
            <td class="cell-num">${fmt.money(r.total || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="8">No hay pedidos de mostrador en el periodo.</td></tr>';
    }

    const invS = inv.summary || {};
    const invKpi = document.getElementById('kpiRefaccionesInventario');
    const invMeta = document.getElementById('refaccionesInventarioMeta');
    const invBody = document.getElementById('tblRefaccionesInventario');
    if (invMeta) invMeta.textContent = `${fmt.number(invS.lineas || 0)} líneas · ${fmt.money(invS.costo || 0)}`;
    if (invKpi) {
      invKpi.innerHTML = `
        <div class="kpi-group">
          <h4 class="kpi-group-title">Inventario</h4>
          <div class="kpi-grid">
            <div class="kpi-card kpi-card--blue"><span class="kpi-title">Líneas c/stock</span><div class="kpi-value">${fmt.number(invS.lineas || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--green"><span class="kpi-title">Existencia</span><div class="kpi-value">${fmt.number(invS.existencia || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--violet"><span class="kpi-title">Costo</span><div class="kpi-value">${fmt.money(invS.costo || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--slate"><span class="kpi-title">Almacenes</span><div class="kpi-value">${fmt.number(invS.almacenes || 0)}</div><div class="kpi-accent"></div></div>
          </div>
        </div>`;
    }
    if (invBody) {
      const rows = inv.detalle || [];
      invBody.innerHTML = rows.length
        ? rows.map((r) => `
          <tr>
            <td class="mono">${escHtml(r.parte)}</td>
            <td>${escHtml(r.descripcion || '—')}</td>
            <td>${escHtml(r.almacen || '—')}</td>
            <td>${escHtml(r.grupoLabel || r.grupo || '—')}</td>
            <td>${escHtml(r.linea || '—')}</td>
            <td class="cell-num">${fmt.number(r.existencia || 0)}</td>
            <td class="cell-num">${fmt.number(r.apartada || 0)}</td>
            <td class="cell-num">${fmt.money(r.costo || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="8">Sin existencias con stock.</td></tr>';
    }

    const pedS = ped.summary || {};
    const pedKpi = document.getElementById('kpiRefaccionesPedidos');
    const pedMeta = document.getElementById('refaccionesPedidosMeta');
    const pedBody = document.getElementById('tblRefaccionesPedidos');
    const alertas = data?.alertas || data?.pedidos?.alertas || {};
    const alertasEl = document.getElementById('refaccionesAlertas');
    const alertasMeta = document.getElementById('refaccionesAlertasMeta');
    const topVendBody = document.getElementById('tblRefaccionesTopVendidos');
    const topUtilBody = document.getElementById('tblRefaccionesTopUtilidad');
    const trabBody = document.getElementById('tblRefaccionesStockTrabado');

    const aSum = alertas.summary || {};
    if (alertasMeta) {
      alertasMeta.textContent = aSum.trabados90 != null
        ? `${fmt.number(aSum.trabados90)} trabados · ${fmt.number(aSum.bajoMin || 0)} bajo mín · ${fmt.number(aSum.partesVendidas || 0)} partes vendidas`
        : 'Dinámicas según periodo y stock';
    }
    if (alertasEl) {
      const list = alertas.alerts || [];
      alertasEl.innerHTML = list.length
        ? list.map((a) => `
          <article class="ref-alerta ref-alerta--${escHtml(a.severity || 'info')}" data-alerta-id="${escHtml(a.id || '')}">
            <div class="ref-alerta__icon"><span class="material-symbols-outlined" aria-hidden="true">${escHtml(a.icon || 'info')}</span></div>
            <div class="ref-alerta__body">
              <h4 class="ref-alerta__title">${escHtml(a.title || 'Alerta')}</h4>
              <p class="ref-alerta__summary">${escHtml(a.summary || '')}</p>
              <p class="ref-alerta__detail">${escHtml(a.detail || '')}</p>
              ${a.action ? `<p class="ref-alerta__action">${escHtml(a.action)}</p>` : ''}
            </div>
          </article>`).join('')
        : '<p class="ref-alertas__empty">Sin alertas relevantes en este periodo.</p>';
    }
    if (topVendBody) {
      const rows = alertas.topVendidos || [];
      topVendBody.innerHTML = rows.length
        ? rows.slice(0, 6).map((r) => `
          <tr>
            <td class="mono">${escHtml(r.parte)}</td>
            <td>${escHtml(r.descripcion || '—')}</td>
            <td class="cell-num">${fmt.number(r.cantidad || 0)}</td>
            <td class="cell-num">${fmt.money(r.venta || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="4">Sin salidas de venta en el periodo.</td></tr>';
    }
    if (topUtilBody) {
      const rows = alertas.topUtilidad || [];
      topUtilBody.innerHTML = rows.length
        ? rows.slice(0, 6).map((r) => `
          <tr>
            <td class="mono">${escHtml(r.parte)}</td>
            <td>${escHtml(r.descripcion || '—')}</td>
            <td class="cell-num">${fmt.money(r.utilidad || 0)}</td>
            <td class="cell-num">${fmt.number(r.margenPct || 0)}%</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="4">Sin utilidad positiva en el periodo.</td></tr>';
    }
    if (trabBody) {
      const rows = alertas.stockTrabado || [];
      trabBody.innerHTML = rows.length
        ? rows.slice(0, 6).map((r) => `
          <tr>
            <td class="mono">${escHtml(r.parte)}</td>
            <td>${escHtml(r.descripcion || '—')}</td>
            <td class="cell-num">${fmt.number(r.diasSinVenta || 0)}</td>
            <td class="cell-num">${fmt.money(r.costo || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="4">No hay stock trabado significativo.</td></tr>';
    }

    if (pedMeta) pedMeta.textContent = `${fmt.number(pedS.totalPedidos || 0)} pedido(s)`;
    if (pedKpi) {
      pedKpi.innerHTML = `
        <div class="kpi-group">
          <h4 class="kpi-group-title">Pedidos</h4>
          <div class="kpi-grid">
            <div class="kpi-card kpi-card--blue"><span class="kpi-title">Pedidos</span><div class="kpi-value">${fmt.number(pedS.totalPedidos || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--green"><span class="kpi-title">Abiertos</span><div class="kpi-value">${fmt.number(pedS.abiertos || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--amber"><span class="kpi-title">Pend. surtir</span><div class="kpi-value">${fmt.number(pedS.pendientesSurtir || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--violet"><span class="kpi-title">Importe</span><div class="kpi-value">${fmt.money(pedS.importeTotal || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--slate"><span class="kpi-title">Cancelados</span><div class="kpi-value">${fmt.number(pedS.cancelados || 0)}</div><div class="kpi-accent"></div></div>
          </div>
        </div>`;
    }
    if (pedBody) {
      const rows = ped.pedidos || [];
      pedBody.innerHTML = rows.length
        ? rows.map((p) => `
          <tr>
            <td class="mono">${escHtml(p.numero)}</td>
            <td>${escHtml(formatPedidoFecha(p.fecha))}</td>
            <td>${escHtml(p.proveedor || '—')}</td>
            <td>${escHtml(p.status || '—')}</td>
            <td>${escHtml(p.tipoPedido || '—')}</td>
            <td class="cell-num">${fmt.number(p.lineas || 0)}</td>
            <td class="cell-num">${fmt.number(p.cantPedida || 0)}</td>
            <td class="cell-num">${fmt.number(p.cantSurtida || 0)}</td>
            <td class="cell-num">${fmt.number(p.lineasPendientes || 0)}</td>
            <td class="cell-num">${fmt.money(p.importeTotal || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="10">No hay pedidos de refacciones en el periodo.</td></tr>';
    }

    const pendS = pend.summary || {};
    const pendKpi = document.getElementById('kpiRefaccionesPendientes');
    const pendMeta = document.getElementById('refaccionesPendientesMeta');
    const pendBody = document.getElementById('tblRefaccionesPendientes');
    if (pendMeta) pendMeta.textContent = `${fmt.number(pendS.total || 0)} pendiente(s)`;
    if (pendKpi) {
      pendKpi.innerHTML = `
        <div class="kpi-group">
          <h4 class="kpi-group-title">Pendientes</h4>
          <div class="kpi-grid">
            <div class="kpi-card kpi-card--amber"><span class="kpi-title">Pedidos pend.</span><div class="kpi-value">${fmt.number(pendS.total || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--rose"><span class="kpi-title">Líneas pend.</span><div class="kpi-value">${fmt.number(pendS.lineasPendientes || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--violet"><span class="kpi-title">Importe</span><div class="kpi-value">${fmt.money(pendS.importe || 0)}</div><div class="kpi-accent"></div></div>
          </div>
        </div>`;
    }
    if (pendBody) {
      const rows = pend.pedidos || [];
      pendBody.innerHTML = rows.length
        ? rows.map((p) => `
          <tr>
            <td class="mono">${escHtml(p.numero)}</td>
            <td>${escHtml(formatPedidoFecha(p.fecha))}</td>
            <td>${escHtml(p.proveedor || '—')}</td>
            <td>${escHtml(p.status || '—')}</td>
            <td>${escHtml(p.tipoPedido || '—')}</td>
            <td class="cell-num">${fmt.number(p.lineasPendientes || 0)}</td>
            <td class="cell-num">${fmt.number(p.cantPedida || 0)}</td>
            <td class="cell-num">${fmt.number(p.cantSurtida || 0)}</td>
            <td class="cell-num">${fmt.money(p.importeTotal || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="9">No hay pedidos pendientes de surtir en el periodo.</td></tr>';
    }

    setRefaccionesSubTab(refaccionesSubTab);
  }

  async function loadRefaccionesPedidos(fechaInicio, fechaFin, force = false) {
    const key = `${fechaInicio}|${fechaFin}`;
    if (!force && refaccionesLoadedKey === key && refaccionesData) {
      renderRefaccionesDashboard(refaccionesData);
      return refaccionesData;
    }
    const data = await Dashboard.api(`/post-sales/refacciones?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`);
    refaccionesData = data;
    refaccionesLoadedKey = key;
    renderRefaccionesDashboard(data);
    return data;
  }

  async function setPostVentaArea(area) {
    const next = String(area || 'posventa').toLowerCase();
    if (!['posventa', 'servicio', 'refacciones', 'hyp'].includes(next)) return;
    currentArea = next;
    updateAreaUI();

    try {
      const hash = next === 'posventa' ? '' : `#${next}`;
      if (window.location.hash !== hash) {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
      }
    } catch {
      /* ignore */
    }

    if (currentArea === 'posventa') {
      const fi = document.getElementById('fechaInicio')?.value;
      const ff = document.getElementById('fechaFin')?.value;
      if (fi && ff && !refaccionesData) {
        try {
          await loadRefaccionesPedidos(fi, ff);
        } catch (err) {
          console.warn('[PosVenta home refacciones]', err.message);
        }
      }
      renderPosVentaHome();
      Dashboard.setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')} · PostVenta`);
      updateFilterUI(allRecords.length);
      return;
    }

    if (currentArea === 'refacciones') {
      const fi = document.getElementById('fechaInicio')?.value;
      const ff = document.getElementById('fechaFin')?.value;
      if (fi && ff) {
        try {
          showLoading(true);
          await loadRefaccionesPedidos(fi, ff);
          Dashboard.setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')} · Refacciones`);
          updateFilterUI(refaccionesData?.ventas?.financieras?.summary?.ventas
            ? Math.round(Number(refaccionesData.ventas.financieras.summary.ventas))
            : (refaccionesData?.pedidos?.summary?.totalPedidos || 0));
        } catch (err) {
          console.error(err);
          window.alert(err.message || 'No se pudieron cargar los pedidos de refacciones.');
        } finally {
          showLoading(false);
        }
      }
      return;
    }

    refreshDashboard();
  }

  function refreshDashboard() {
    updateAreaUI();
    if (currentArea === 'refacciones') return;
    if (currentArea === 'posventa') {
      renderPosVentaHome();
      return;
    }

    renderMesCursoNomenclatura();
    if (!allRecords.length && !openSnapshot.length) return;
    const dash = PostSalesAnalytics.computeDashboard(allRecords, getFilters(), openSnapshot, ytdRecords);
    lastDash = dash;
    renderKpis(dash);
    renderCharts(dash.charts);
    renderTables(dash);
    Dashboard.setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')} · ${dash.filtered.length} órdenes`);
    updateFilterUI(dash.filtered.length);

    if (window.KpiInsights?.apply) {
      const s = dash.summary || { ...dash.executive, ...dash.finance };
      const aging = dash.aging || {};
      const risk = dash.risk || {};
      const b120 = Number(aging.b120p ?? 0);
      const riesgo120 = Number(s.riesgo120 ?? 0);
      window.KpiInsights.apply('post-sales', {
        fechaInicio: document.getElementById('fechaInicio')?.value || null,
        fechaFin: document.getElementById('fechaFin')?.value || null,
        summary: { ...s, riesgo120 },
        aging: { ...aging, b120p: b120 },
        risk,
      }).catch?.(() => {});
    }
  }

  async function loadData(fechaInicio, fechaFin) {
    const data = await Dashboard.api(`/post-sales?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    allRecords = data.records || [];
    ytdRecords = data.recordsYtd || data.records || [];
    ytdMeta = data.ytd || null;
    openSnapshot = data.openSnapshot || [];
    mesCursoNomenclatura = data.mesCursoNomenclatura || null;
    refaccionesData = null;
    refaccionesLoadedKey = '';
    populateFilterOptions(PostSalesAnalytics.buildFilterOptions(allRecords, openSnapshot));
    await setPostVentaArea(currentArea || getSectionFromUrl() || 'posventa');
    return allRecords.length;
  }

  function getSectionFromUrl() {
    const h = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
    if (['posventa', 'servicio', 'refacciones', 'hyp'].includes(h)) return h;
    return 'posventa';
  }

  function bindFilterEvents() {
    const rerender = () => {
      if (currentArea === 'refacciones' || currentArea === 'posventa') return;
      refreshDashboard();
    };
    ['fStatus', 'fAsesor', 'fAntiguedad'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', rerender);
    });
    ['fImporteMin', 'fImporteMax', 'buscarOrdenes'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', rerender);
    });
    ['fCriticas', 'fPromesa'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', rerender);
    });

    document.querySelectorAll('#postVentaMainTabs [data-ps-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.getAttribute('data-ps-section');
        setPostVentaArea(section);
      });
    });

    document.querySelectorAll('#refaccionesSubTabs [data-ref-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setRefaccionesSubTab(btn.getAttribute('data-ref-tab')));
    });

    const tipoBtn = document.getElementById('fTipoBtn');
    const tipoPanel = document.getElementById('fTipoPanel');
    const tipoOptions = document.getElementById('fTipoOptions');
    tipoBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = tipoBtn.getAttribute('aria-expanded') !== 'true';
      setTipoPanelOpen(open);
    });
    tipoPanel?.addEventListener('click', (e) => e.stopPropagation());
    tipoOptions?.addEventListener('change', (e) => {
      if (e.target?.matches?.('input[type="checkbox"]')) {
        updateTipoLabel();
        rerender();
      }
    });
    tipoPanel?.querySelectorAll('[data-tipo-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-tipo-action');
        const check = action === 'all';
        document.querySelectorAll('#fTipoOptions input[type="checkbox"]').forEach((cb) => {
          cb.checked = check;
        });
        updateTipoLabel();
        rerender();
      });
    });
    document.addEventListener('click', () => setTipoPanelOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setTipoPanelOpen(false);
    });

    document.getElementById('btnClearFilters')?.addEventListener('click', clearOperationalFilters);

    document.querySelectorAll('.filters-panel [data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filters-panel [data-preset]').forEach((b) => b.classList.remove('chip--active'));
        btn.classList.add('chip--active');
      });
    });

    ['fechaInicio', 'fechaFin'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', clearPresetChips);
    });

    window.addEventListener('hashchange', () => {
      const section = getSectionFromUrl();
      if (section !== currentArea) setPostVentaArea(section);
    });

    currentArea = getSectionFromUrl();
    updateAreaUI();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindFilterEvents();
    bindTblAseg();
    Dashboard.initDateFilter({
      onConsult: async (fi, ff) => {
        const n = await loadData(fi, ff);
        return n;
      },
    });
  });
})();
