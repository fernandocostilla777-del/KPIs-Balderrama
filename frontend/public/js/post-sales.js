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
  let hypCobranzaData = null;
  let hypCobranzaLoadedKey = '';
  let openHypCobranzaKey = null;
  let hypGarantiasData = null;
  let hypGarantiasLoadedKey = '';
  let openHypGarantiasKey = null;
  let cuadreOrdenesHypData = null;
  let cuadreOrdenesHypLoadedKey = '';
  /** Segmentación HyP: grupos Externas / Internas (filtro por letra de orden). */
  const HYP_OPS_CHIP_GROUPS = [
    {
      id: 'externas',
      legend: 'Externas',
      chips: [
        { key: 'A', label: 'Aseguradoras', title: 'A — Aseguradoras' },
        { key: 'F', label: 'Aseg. particulares', title: 'F — Aseguradoras particulares' },
        { key: 'V', label: 'Aseguradora Body 31', title: 'V — Aseguradora Body 31' },
        { key: 'Z', label: 'Particulares Body 31', title: 'Z — Particulares Body 31' },
      ],
    },
    {
      id: 'internas',
      legend: 'Internas',
      chips: [
        { key: 'J', label: 'Interna HyP', title: 'J — Interna HYP' },
        { key: 'H', label: 'Seminuevos HyP', title: 'H — Interna seminuevos HYP' },
        { key: 'Ó', label: 'Nuevos HyP', title: 'Ó — Interna nuevos HYP' },
        { key: 'I', label: 'Interna', title: 'I — Interna (Jair / Brian / Edel)' },
        { key: 'E', label: 'Empleados', title: 'E — Empleados (Jair / Brian / Edel)' },
      ],
    },
  ];
  const HYP_OPS_CHIP_DEFS = HYP_OPS_CHIP_GROUPS.flatMap((g) => g.chips);
  const HYP_OPS_ALL_KEYS = HYP_OPS_CHIP_DEFS.map((c) => c.key);
  let hypOpsLetras = new Set(HYP_OPS_ALL_KEYS);
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
      fechaInicio: document.getElementById('fechaInicio')?.value || '',
      fechaFin: document.getElementById('fechaFin')?.value || '',
      status: document.getElementById(FILTER_IDS.status)?.value || '',
      asesor: document.getElementById(FILTER_IDS.asesor)?.value || '',
      tipo,
      hypLetras: currentArea === 'hyp' ? [...hypOpsLetras] : null,
      antiguedad: document.getElementById(FILTER_IDS.antiguedad)?.value || '',
      importeMin: document.getElementById(FILTER_IDS.importeMin)?.value || '',
      importeMax: document.getElementById(FILTER_IDS.importeMax)?.value || '',
      soloCriticas: document.getElementById(FILTER_IDS.soloCriticas)?.checked || false,
      promesaVencida: document.getElementById(FILTER_IDS.promesaVencida)?.checked || false,
      buscar: document.getElementById(FILTER_IDS.buscar)?.value || '',
    };
  }

  function hypOpsAllSelected() {
    return HYP_OPS_ALL_KEYS.every((k) => hypOpsLetras.has(k));
  }

  function ensureHypOpsChips() {
    const wrap = document.getElementById('hypOpsTipoChips');
    if (!wrap || wrap.dataset.ready === '1') return wrap;

    const chipBtn = (c) => `
      <button type="button" class="chip hyp-seg__chip active" data-hyp-ops-letra="${c.key}"
        aria-pressed="true" title="${escHtml(c.title)}">${escHtml(c.label)}</button>`;

    const groupsHtml = HYP_OPS_CHIP_GROUPS.map((g) => `
      <div class="hyp-seg__group" data-hyp-seg-group="${escHtml(g.id)}">
        <span class="hyp-seg__legend">${escHtml(g.legend)}</span>
        <div class="hyp-seg__chips">${g.chips.map(chipBtn).join('')}</div>
      </div>`).join('');

    wrap.innerHTML = `
      <button type="button" class="chip hyp-seg__chip hyp-seg__chip--all active" data-hyp-ops-all
        aria-pressed="true" title="Mostrar todos los tipos">Todas</button>
      ${groupsHtml}`;
    wrap.dataset.ready = '1';

    wrap.addEventListener('click', (e) => {
      const allBtn = e.target.closest('[data-hyp-ops-all]');
      if (allBtn) {
        hypOpsLetras = new Set(HYP_OPS_ALL_KEYS);
        syncHypOpsChips();
        refreshDashboard();
        return;
      }
      const btn = e.target.closest('[data-hyp-ops-letra]');
      if (!btn) return;
      const letra = btn.getAttribute('data-hyp-ops-letra');
      if (!letra) return;
      if (hypOpsLetras.has(letra)) {
        if (hypOpsLetras.size <= 1) return;
        hypOpsLetras.delete(letra);
      } else {
        hypOpsLetras.add(letra);
      }
      syncHypOpsChips();
      refreshDashboard();
    });
    return wrap;
  }

  function syncHypOpsChips() {
    const wrap = ensureHypOpsChips();
    if (!wrap) return;
    const allOn = hypOpsAllSelected();
    const allBtn = wrap.querySelector('[data-hyp-ops-all]');
    if (allBtn) {
      allBtn.classList.toggle('active', allOn);
      allBtn.setAttribute('aria-pressed', allOn ? 'true' : 'false');
    }
    wrap.querySelectorAll('[data-hyp-ops-letra]').forEach((btn) => {
      const letra = btn.getAttribute('data-hyp-ops-letra');
      const on = hypOpsLetras.has(letra);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function updateHypOpsChipsVisibility() {
    const bar = document.getElementById('hypSegmentacionBar');
    const wrap = ensureHypOpsChips();
    const show = currentArea === 'hyp';
    bar?.classList.toggle('hidden', !show);
    if (show && wrap) syncHypOpsChips();
  }

  function populateSelect(id, options, allLabel) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>${(options || []).map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')}`;
    if (current && options.includes(current)) sel.value = current;
  }

  function populateTipoMulti(options, { selectAll = false } = {}) {
    const box = document.getElementById('fTipoOptions');
    if (!box) return;
    const prev = new Set(getSelectedTipos());
    const hadSelection = prev.size > 0;
    box.innerHTML = (options || []).map((o) => {
      const checked = selectAll || !hadSelection || prev.has(o) ? ' checked' : '';
      return `
        <label class="filter-multi__item">
          <input type="checkbox" value="${escHtml(o)}"${checked}/>
          <span>${escHtml(o)}</span>
        </label>`;
    }).join('') || '<p class="filter-multi__empty">Sin tipos disponibles</p>';
    updateTipoLabel();
  }

  function populateFilterOptions(options, opts = {}) {
    populateSelect(FILTER_IDS.status, options.status, 'Todos');
    populateSelect(FILTER_IDS.asesor, options.asesor, 'Todos');
    populateTipoMulti(options.tipo, opts);
    populateSelect(FILTER_IDS.antiguedad, options.antiguedad, 'Todas');
  }

  function kpiCard(title, value, sub, cls, id, opsKey, extraClass = '') {
    const idAttr = id ? ` id="${id}"` : '';
    const opsAttr = opsKey ? ` data-ops-kpi="${opsKey}"` : '';
    const interactive = opsKey ? ' kpi-card--clickable' : '';
    const role = opsKey ? ' role="button" tabindex="0"' : '';
    const extra = extraClass ? ` ${extraClass}` : '';
    return `<div class="kpi-card kpi-card--${cls || 'blue'}${interactive}${extra}"${idAttr}${opsAttr}${role} title="${opsKey ? 'Clic para ver desglose' : ''}">
      <span class="kpi-title">${title}</span>
      <div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
      ${opsKey ? '<span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>' : ''}
      <div class="kpi-accent"></div>
    </div>`;
  }

  function kpiSpacer() {
    return '<div class="kpi-card-spacer" aria-hidden="true"></div>';
  }

  function kpiGroup(title, cards, gridClass = '') {
    const gridCls = gridClass ? ` ${gridClass}` : '';
    return `<div class="kpi-group"><h4 class="kpi-group-title">${title}</h4><div class="kpi-grid${gridCls}">${cards.join('')}</div></div>`;
  }

  /** Importes + antigüedad a la izquierda; Resultado mensual (vs mejor) a la derecha. */
  function kpiImportesAgingConMejorMes(importesCards, agingCards, mejorMesCard) {
    return `<div class="kpi-ops-mejor-duo">
      <div class="kpi-ops-mejor-duo__main">
        ${kpiGroup('Importes y tickets', importesCards)}
        ${kpiGroup('Antigüedad de abiertas', agingCards)}
      </div>
      <div class="kpi-ops-mejor-duo__side">
        <h4 class="kpi-group-title kpi-ops-mejor-duo__side-title">Resultado mensual</h4>
        <div class="kpi-ops-mejor-duo__side-body">${mejorMesCard}</div>
      </div>
    </div>`;
  }

  function kpiMesEnCursoCard(s) {
    const mc = s.mesEnCursoStats;
    if (!mc) {
      return kpiCard('Resultado mensual', '—', 'Sin datos del año', 'green', null, 'mejorMes', 'kpi-card--mejor-mes');
    }
    const pct = mc.pctVsMejor == null ? '—' : `${mc.pctVsMejor}%`;
    const ritmo = mc.pctRitmoVsMejor == null
      ? ''
      : ` · ritmo proy. ${mc.pctRitmoVsMejor}% del mejor`;
    const avanceLabel = mc.mesCerrado
      ? `mes completo · ${Dashboard.fmt.number(mc.facturadas)} facturadas`
      : `día ${mc.diaDelMes}/${mc.diasEnMes} · ${Dashboard.fmt.number(mc.facturadas)} facturadas`;
    const footLabel = mc.mesCerrado
      ? `Resultado ${Dashboard.fmt.currency(mc.importeFacturado)} vs mejor ${Dashboard.fmt.currency(mc.mejorMesImporte)}${pct !== '—' ? ` · ${pct} del mejor` : ''}`
      : `Proyección ${Dashboard.fmt.currency(mc.ritmoProyectado)} vs mejor ${Dashboard.fmt.currency(mc.mejorMesImporte)}${ritmo}`;
    return `<div class="kpi-card kpi-card--green kpi-card--clickable kpi-card--mejor-mes kpi-card--mes-curso" data-ops-kpi="mejorMes" role="button" tabindex="0" title="Clic para ver desglose">
      <span class="kpi-title">Resultado mensual · ${escHtml(mc.label)}</span>
      <div class="mes-curso-head">
        <div class="mes-curso-total">
          <div class="kpi-value money">${Dashboard.fmt.currency(mc.importeFacturado)}</div>
          <p class="kpi-subtitle">${avanceLabel}</p>
        </div>
        <div class="mes-curso-mini">
          <div class="mes-curso-mini-chart"><canvas id="cMesCursoMini" aria-label="Comparativo mes vs mejor"></canvas></div>
          <p class="mes-curso-mini-caption">${pct} del mejor (${escHtml(mc.mejorMesLabel)})</p>
        </div>
      </div>
      <div class="mes-curso-chart-wrap">
        <p class="mes-curso-chart-label">Mejores meses del año</p>
        <div class="mes-curso-chart"><canvas id="cMesCursoRanking" aria-label="Ranking de mejores meses"></canvas></div>
      </div>
      <p class="kpi-subtitle mes-curso-foot">${footLabel}</p>
      <span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>
      <div class="kpi-accent"></div>
    </div>`;
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
      case 'abiertas': {
        const periodoKeys = new Set(
          filtered
            .filter((r) => ['A', 'T', 'D', 'P'].includes(String(r.status || '').trim().toUpperCase()))
            .map((r) => String(r.orden || '').trim().toUpperCase())
            .filter(Boolean),
        );
        return open.filter((r) => !periodoKeys.has(String(r.orden || '').trim().toUpperCase()));
      }
      case 'abiertasPeriodo': return filtered.filter((r) => ['A', 'T', 'D', 'P'].includes(String(r.status || '').trim().toUpperCase()));
      case 'canceladas': return filtered.filter((r) => r.status === 'C');
      case 'cerradas': return filtered.filter((r) => {
        const st = String(r.status || '').trim().toUpperCase();
        return st && !['A', 'T', 'D', 'P', 'I', 'C'].includes(st);
      });
      case 'importeIngresado': return filtered;
      case 'ticketFacturado': return filtered.filter((r) => {
        if (r.status !== 'I') return false;
        return PostSalesOrderTypes.isAseguradora
          ? PostSalesOrderTypes.isAseguradora(r)
          : ['A', 'F', 'V'].includes(String(r?.letraOrden || r?.orden || '').trim().toUpperCase().charAt(0));
      });
      case 'facturadoUltimoMes': {
        const key = s.ultimoMesKey;
        if (!key) return [];
        return filtered.filter((r) => r.status === 'I' && monthKeyOf(r) === key);
      }
      case 'mejorMes': {
        // Facturadas del mes calendario en curso (YTD)
        const mesKey = s.mesEnCursoStats?.key;
        const rows = PostSalesAnalytics.applyFilters(ytdRecords.length ? ytdRecords : allRecords, getFilters())
          .filter((r) => r.status === 'I');
        if (!mesKey) return rows;
        return rows.filter((r) => monthKeyOf(r) === mesKey);
      }
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
      case 'tiempoMedCiclo': {
        const hypCiclo = new Set(['A', 'F', 'H', 'J', 'V', 'Z', 'Ó', '\u00D3']);
        return filtered.filter((r) => {
          if (r.status !== 'I' || !r.cierreDate) return false;
          if (currentArea === 'hyp') {
            const L = OT?.letterOfRecord?.(r) || String(r.letraOrden || r.orden || '').trim().charAt(0).toUpperCase();
            return hypCiclo.has(L);
          }
          return true;
        });
      }
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
      ingresadas: {
        title: 'Órdenes ingresadas',
        hint: 'Órdenes del periodo · unidades únicas validadas por VIN (MO+RE de misma serie = 1 unidad)',
      },
      facturadas: { title: 'Facturadas', hint: 'Status I · importe facturado' },
      abiertas: {
        title: 'Abiertas acumuladas',
        hint: 'Backlog abierto actual menos las abiertas ingresadas en el periodo',
      },
      abiertasPeriodo: {
        title: 'Abiertas del periodo',
        hint: 'De las ingresadas en el rango, las que siguen abiertas (A/T/D/P)',
      },
      canceladas: { title: 'Canceladas', hint: 'Status C en el periodo' },
      cerradas: {
        title: 'Cerradas',
        hint: 'Ingresadas del periodo que no están abiertas, ni facturadas (I), ni canceladas (C)',
      },
      importeIngresado: { title: 'Importe ingresado', hint: 'Suma de importes de órdenes del periodo' },
      ticketFacturado: { title: 'Ticket prom. facturado', hint: 'Promedio por orden facturada de aseguradoras (A / F / V)' },
      facturadoUltimoMes: { title: `Facturado · ${s.ultimoMesLabel || 'último mes'}`, hint: 'Órdenes facturadas del último mes del periodo' },
      mejorMes: {
        title: s.mesEnCursoStats
          ? `Resultado mensual · ${s.mesEnCursoStats.label}`
          : `Mejor mes · ${s.mejorMes || '—'}`,
        hint: s.mesEnCursoStats
          ? `Facturado del mes del filtro (${s.mesEnCursoStats.label}) vs mejor mes ${s.mesEnCursoStats.mejorMesLabel || ''} (${ytdMeta?.year || 'YTD'})`
          : (s.mejorMesStats
            ? `Acumulado ${ytdMeta?.year || 'del año'} · #1 de ${s.mejorMesStats.mesesComparados} meses`
            : 'Comparativo mensual del año'),
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
        hint: `ORE_FECHAORD → ORE_FECHACIE − ${o.cicloAjusteValuacionDias || 3} d valuación · letras A/F/H/J/V/Z/Ó (${o.ciclosConDato || 0} con cierre)`,
      },
      tiempoMedCiclo: {
        title: 'Tiempo mediano de ciclo',
        hint: `Mediana ORE_FECHAORD → ORE_FECHACIE − ${o.cicloAjusteValuacionDias || 3} d valuación (A/F/H/J/V/Z/Ó)`,
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
    if (['importeIngresado', 'ticketFacturado', 'facturadoUltimoMes', 'mejorMes', 'abiertas', 'abiertasPeriodo', 'aging120p', 'criticas60', 'conRefacciones', 'tiempoPromCiclo', 'retrasoPromesa'].includes(kpi)) {
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

  function normalizeVin(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  /** Aseguradoras que suelen abrir MO + refacciones (2 órdenes = 1 unidad). */
  const ASEG_DOBLE_ORDEN = ['CHUBB', 'ZURICH', 'BANORTE'];

  function isAsegDobleOrden(aseguradora) {
    const a = String(aseguradora || '').trim().toUpperCase();
    if (!a) return false;
    return ASEG_DOBLE_ORDEN.some((name) => a.includes(name));
  }

  /**
   * Unidades ingresadas sin repetir VIN/serie.
   * CHUBB / ZURICH / BANORTE suelen tener 2 órdenes (MO + refacciones) por unidad.
   */
  function computeUnidadesPorVin(rows = []) {
    const byVin = new Map();
    let sinSerie = 0;
    let ordenesAsegDoble = 0;

    for (const r of rows) {
      if (isAsegDobleOrden(r.aseguradora)) ordenesAsegDoble += 1;
      const vin = normalizeVin(r.serie);
      if (!vin) {
        sinSerie += 1;
        continue;
      }
      if (!byVin.has(vin)) byVin.set(vin, []);
      byVin.get(vin).push(r);
    }

    const vinsMulti = [...byVin.entries()].filter(([, list]) => list.length > 1);
    const ordenesExtra = vinsMulti.reduce((s, [, list]) => s + (list.length - 1), 0);
    const unidadesConVin = byVin.size;
    const unidades = unidadesConVin + sinSerie;
    const ordenes = rows.length;
    const pctUnicas = ordenes > 0 ? Math.round((unidades / ordenes) * 1000) / 10 : 0;

    const porAsegMulti = new Map();
    for (const [, list] of vinsMulti) {
      const aseg = String(list[0]?.aseguradora || 'Sin aseguradora').trim() || 'Sin aseguradora';
      const cur = porAsegMulti.get(aseg) || { unidades: 0, ordenes: 0 };
      cur.unidades += 1;
      cur.ordenes += list.length;
      porAsegMulti.set(aseg, cur);
    }

    return {
      ordenes,
      unidades,
      unidadesConVin,
      sinSerie,
      vinsConMultiOrden: vinsMulti.length,
      ordenesExtra,
      pctUnicas,
      ordenesAsegDoble,
      porAsegMulti: [...porAsegMulti.entries()]
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.ordenes - a.ordenes),
    };
  }

  function kpiUnidadesVinCard(stats) {
    const num = (v) => Number(v || 0).toLocaleString('es-MX');
    if (!stats || !stats.ordenes) {
      return `
        <div class="ops-orders-drawer__group ops-orders-drawer__group--carry-sim">
          <aside class="carry-over-sim-card carry-over-sim-card--drawer carry-over-sim-card--vin" aria-label="Unidades por VIN">
            <span class="carry-over-sim-label">Unidades ingresadas · VIN único</span>
            <div class="carry-over-sim-pct">0</div>
            <p class="carry-over-sim-formula">Sin órdenes en el periodo</p>
          </aside>
        </div>`;
    }
    return `
      <div class="ops-orders-drawer__group ops-orders-drawer__group--carry-sim">
        <aside class="carry-over-sim-card carry-over-sim-card--drawer carry-over-sim-card--vin" aria-label="Unidades por VIN">
          <span class="carry-over-sim-label">Unidades ingresadas · VIN único</span>
          <div class="carry-over-sim-pct">${num(stats.unidades)}</div>
          <p class="carry-over-sim-formula">
            ${num(stats.ordenes)} órdenes → ${num(stats.unidades)} unidades
            (${stats.pctUnicas}% sin repetir serie)
          </p>
        </aside>
      </div>`;
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
          Proceso: data?.proceso?.actualLabel || data?.proceso?.resumen || '',
          'Proceso detalle': data?.proceso?.resumen || '',
        }],
      },
    ];
    if (data?.proceso?.etapas?.length) {
      sheets.push({
        name: 'Proceso taller',
        rows: data.proceso.etapas.map((e) => ({
          Etapa: e.label || '',
          Estatus: e.statusLabel || e.status || '',
          'Fecha fin': e.fechaFin || '',
          Mecánico: e.mecanico || '',
          Actual: e.current ? 'Sí' : '',
          Terminada: e.done ? 'Sí' : '',
        })),
      });
    }
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
      const proceso = data.proceso || {};
      const importeOrden = Number(totals.total || o.importeAbierto || o.importe || 0);

      const isFacturada = String(o.status || '').toUpperCase() === 'I' || Boolean(o.factura);
      const facturaLabel = o.factura
        ? escHtml(o.factura)
        : (isFacturada ? 'Sin número capturado' : '—');

      titleEl.textContent = `Orden ${o.orden || ''}`.trim() || 'Orden';
      const procesoBadge = proceso.disponible && proceso.actualLabel
        ? ` · ${proceso.actualLabel}`
        : '';
      statusEl.textContent = o.factura
        ? `${o.statusLabel || o.status || '—'} · Factura ${o.factura} · ${fmt.money(importeOrden)}${procesoBadge}`
        : `${o.statusLabel || o.status || '—'} · ${o.antiguedad || '—'} · ${fmt.money(importeOrden)}${procesoBadge}`;

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

      const procesoSection = (() => {
        const etapas = proceso.etapas || [];
        if (!proceso.disponible || !etapas.length) {
          return `
            <section class="ops-order-detail__section ops-order-detail__proceso">
              <div class="ops-order-detail__section-head">
                <h3>Proceso de taller</h3>
                <span>Sin datos</span>
              </div>
              <p class="ops-order-detail__hint">No hay líneas de hojalatería, pintura, pulido u otras etapas de proceso en el detalle.</p>
            </section>`;
        }
        const steps = etapas.map((e) => {
          const tone = e.current ? 'current' : (e.done ? 'done' : 'pending');
          const icon = e.done ? 'check_circle' : (e.current ? 'pending' : 'radio_button_unchecked');
          return `
            <li class="ops-proceso-step ops-proceso-step--${tone}">
              <span class="material-symbols-outlined ops-proceso-step__icon">${icon}</span>
              <div class="ops-proceso-step__body">
                <strong>${escHtml(e.label)}</strong>
                <span>${escHtml(e.statusLabel || '—')}${e.fechaFin ? ` · ${escHtml(e.fechaFin)}` : ''}${e.mecanico ? ` · ${escHtml(e.mecanico)}` : ''}</span>
              </div>
            </li>`;
        }).join('');
        return `
          <section class="ops-order-detail__section ops-order-detail__proceso">
            <div class="ops-order-detail__section-head">
              <h3>Proceso de taller</h3>
              <span>${escHtml(proceso.actualLabel || '—')}</span>
            </div>
            <p class="ops-order-detail__proceso-resumen">${escHtml(proceso.resumen || '')}</p>
            <ol class="ops-proceso-track">${steps}</ol>
            <p class="ops-order-detail__hint">Inferido del detalle de la orden (líneas terminadas vs pendientes).</p>
          </section>`;
      })();

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
            <div><span class="lbl">Proceso</span><strong>${escHtml(proceso.disponible ? (proceso.actualLabel || proceso.resumen || '—') : 'Sin datos')}</strong></div>
            <div><span class="lbl">Teléfono</span><strong>${escHtml(o.celular || o.telefono || '—')}</strong></div>
            <div><span class="lbl">Correo</span><strong>${escHtml(o.correo || '—')}</strong></div>
          </div>
        </section>

        ${procesoSection}

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
      aseguradora: 'Aseguradora',
      cliente: 'Cliente',
    };

    function rowImporte(r) {
      const kpi = currentMeta.kpi;
      if (String(kpi || '').startsWith('hypCob-') || String(kpi || '').startsWith('hypGar-')) {
        if (kpi === 'hypCob-pendiente' || kpi === 'hypCob-saldo'
          || kpi === 'hypGar-pendiente' || kpi === 'hypGar-saldo') {
          return Number(r.saldo ?? r.importeAbierto ?? 0);
        }
        if (kpi === 'hypCob-parcial' || kpi === 'hypGar-parcial') {
          return Number(r.saldo ?? r.importeAbierto ?? r.importeFacturado ?? 0);
        }
        return Number(r.importeFacturado || r.importe || 0);
      }
      if (['facturadas', 'ticketFacturado', 'facturadoUltimoMes', 'mejorMes', 'cerradas'].includes(kpi)) {
        return Number(r.importeFacturado || r.importe || 0);
      }
      if ([
        'abiertas', 'abiertasPeriodo', 'aging0_30', 'aging31_60', 'aging61_90', 'aging91_120', 'aging120p',
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
            || document.querySelector('#kpiHypCobranza [data-hyp-cob].is-open')
            || document.querySelector('#kpiHypGarantias [data-hyp-gar].is-open')
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
      openHypCobranzaKey = null;
      openHypGarantiasKey = null;
      document.querySelectorAll('#kpiOperational .kpi-card--clickable.is-open')
        .forEach((c) => c.classList.remove('is-open'));
      document.querySelectorAll('#kpiHypCobranza .kpi-card--clickable.is-open, #kpiHypGarantias .kpi-card--clickable.is-open')
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
      if (activeFilter.dim === 'aseguradora') {
        return String(r.aseguradora || 'Sin aseguradora') === activeFilter.value;
      }
      if (activeFilter.dim === 'cliente') {
        return String(r.cliente || r.nombre || 'Sin cliente') === activeFilter.value;
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
      const isHypCob = String(currentMeta.kpi || '').startsWith('hypCob-');
      const isHypGar = String(currentMeta.kpi || '').startsWith('hypGar-');
      const isHypCobAny = isHypCob || isHypGar;
      const porAseguradora = sumBy(
        rows,
        (r) => r.aseguradora || 'Sin aseguradora',
        (r) => rowImporte(r),
      ).slice(0, 20);
      const countAseguradora = countBy(rows, (r) => r.aseguradora || 'Sin aseguradora').slice(0, 20);
      const porCliente = sumBy(
        rows,
        (r) => r.cliente || r.nombre || 'Sin cliente',
        (r) => rowImporte(r),
      ).slice(0, 20);
      const countCliente = countBy(rows, (r) => r.cliente || r.nombre || 'Sin cliente').slice(0, 20);

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
      const mc = currentMeta.kpi === 'mejorMes' ? (lastDash?.summary?.mesEnCursoStats || null) : null;
      const signPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
      const mesCursoBlock = mc
        ? `
        <div class="ops-orders-drawer__group ops-orders-drawer__group--mejor">
          <h5>Resultado mensual · ${escHtml(mc.label)}</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Facturado del mes</span><span class="val">${fmt.currency(mc.importeFacturado)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Día del mes</span><span class="val">${mc.diaDelMes} / ${mc.diasEnMes} (${mc.pctMesTranscurrido}%)</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Órdenes facturadas</span><span class="val">${num(mc.facturadas)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Mejor mes del año</span><span class="val">${escHtml(mc.mejorMesLabel)} · ${fmt.currency(mc.mejorMesImporte)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">% vs mejor mes</span><span class="val">${mc.pctVsMejor == null ? '—' : `${mc.pctVsMejor}%`}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Falta para empatar</span><span class="val">${fmt.currency(Math.max(0, mc.gapVsMejor || 0))}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Proyección a fin de mes</span><span class="val">${fmt.currency(mc.ritmoProyectado)} · ${mc.pctRitmoVsMejor == null ? '—' : `${mc.pctRitmoVsMejor}% del mejor`}</span></div>
        </div>`
        : '';
      const mejorMesBlock = ms
        ? `
        ${mesCursoBlock}
        <div class="ops-orders-drawer__group ops-orders-drawer__group--mejor">
          <h5>Comparativo · mejor mes del año</h5>
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
              <span class="lbl">${m.posicion}. ${escHtml(m.label)}${m.esMejor ? ' ★' : ''}${m.key === mc?.key ? ' · actual' : ''}</span>
              <span class="val">${fmt.currency(m.importeFacturado)}</span>
            </button>`).join('') || '<p class="ops-orders-drawer__hint">Sin meses</p>'}
        </div>`
        : mesCursoBlock;

      const vinStats = currentMeta.kpi === 'ingresadas' ? computeUnidadesPorVin(rows) : null;
      const vinBlock = vinStats ? kpiUnidadesVinCard(vinStats) : '';

      summaryEl.innerHTML = `
        ${vinBlock}
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Registros</span><span class="val">${num(rows.length)}</span></div>
          ${vinStats ? `<div class="ops-orders-drawer__row"><span class="lbl">Unidades (VIN único)</span><span class="val">${num(vinStats.unidades)}</span></div>` : ''}
          <div class="ops-orders-drawer__row"><span class="lbl">Importe relacionado</span><span class="val">${fmt.currency(importeTotal)}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Alcance</span><span class="val">${escHtml(currentMeta.hint || 'Indicador operativo')}</span></div>
          ${activeFilter
            ? '<p class="ops-orders-drawer__hint">Clic en un renglón para filtrar · clic otra vez para quitar</p>'
            : (isHypCob
              ? '<p class="ops-orders-drawer__hint">Clic en una aseguradora para filtrar pendientes / facturas</p>'
              : (isHypGar
                ? '<p class="ops-orders-drawer__hint">Clic en un cliente o tipo para filtrar facturas</p>'
                : '<p class="ops-orders-drawer__hint">Clic en tipo, asesor, estatus o antigüedad para filtrar</p>'))}
        </div>
        ${mejorMesBlock}
        ${weeklyBlock}
        ${isHypCob ? block('Por aseguradora (saldo / importe)', 'aseguradora', porAseguradora, (x) => fmt.currency(x.value)) : ''}
        ${isHypCob ? block('Por aseguradora (órdenes)', 'aseguradora', countAseguradora) : ''}
        ${isHypGar ? block('Por cliente (saldo / importe)', 'cliente', porCliente, (x) => fmt.currency(x.value)) : ''}
        ${isHypGar ? block('Por cliente (órdenes)', 'cliente', countCliente) : ''}
        ${block('Por tipo de orden', 'tipo', porTipo)}
        ${block('Por asesor', 'asesor', porAsesor)}
        ${isHypCobAny ? '' : block('Importe por asesor', 'asesor', importeAsesor, (x) => fmt.currency(x.value))}
        ${block('Por estatus', 'status', porStatus)}
        ${isHypCobAny ? '' : block('Por antigüedad', 'antiguedad', porAntiguedad)}
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
        const mc = lastDash?.summary?.mesEnCursoStats;
        if (mc?.key) {
          activeFilter = { dim: 'mes', value: mc.key, label: mc.label };
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
      abiertasPeriodo: 'hourglass_top',
      canceladas: 'cancel',
      cerradas: 'task_alt',
      importeIngresado: 'payments',
      ticketFacturado: 'receipt_long',
      facturadoUltimoMes: 'calendar_month',
      mejorMes: 'calendar_month',
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

  function renderMesEnCursoCharts(s) {
    const mc = s?.mesEnCursoStats;
    destroyChart('cMesCursoMini');
    destroyChart('cMesCursoRanking');
    const miniEl = document.getElementById('cMesCursoMini');
    const rankEl = document.getElementById('cMesCursoRanking');
    if (!mc || !miniEl || !rankEl || typeof Chart === 'undefined') return;

    const { chartColors, chartOptions, fmt } = Dashboard;
    const moneyTick = (v) => fmt.currency(Number(v) || 0);

    charts.cMesCursoMini = new Chart(miniEl, {
      type: 'bar',
      data: {
        labels: ['Mes', 'Mejor'],
        datasets: [{
          data: [mc.importeFacturado || 0, mc.mejorMesImporte || 0],
          backgroundColor: [chartColors.primary, chartColors.secondary],
          borderRadius: 5,
          barThickness: 12,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => fmt.currency(ctx.raw || 0) },
          },
        },
        scales: {
          x: { display: false, beginAtZero: true, grid: { display: false } },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 10, weight: '700' }, color: '#64748b' },
          },
        },
      },
    });

    const top = Array.isArray(mc.topMeses) ? mc.topMeses : [];
    const bg = top.map((m) => {
      if (m.esActual) return chartColors.primary;
      if (m.esMejor) return chartColors.secondary;
      return 'rgba(148, 163, 184, 0.5)';
    });

    charts.cMesCursoRanking = new Chart(rankEl, {
      type: 'bar',
      data: {
        labels: top.map((m) => m.label),
        datasets: [{
          data: top.map((m) => m.importeFacturado || 0),
          backgroundColor: bg,
          borderRadius: 6,
          maxBarThickness: 28,
        }],
      },
      options: chartOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const m = top[ctx.dataIndex];
                const tags = [m?.esMejor ? 'mejor' : null, m?.esActual ? 'mes actual' : null].filter(Boolean);
                return `${fmt.currency(ctx.raw || 0)}${tags.length ? ` · ${tags.join(', ')}` : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, weight: '600' }, maxRotation: 40, minRotation: 0 },
          },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 9 },
              callback: moneyTick,
              maxTicksLimit: 6,
            },
            grid: { color: 'rgba(148, 163, 184, 0.18)' },
          },
        },
      }),
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
        kpiCard(
          'Órdenes ingresadas',
          fmt.number(s.totalOrdenes),
          'En el periodo',
          'blue',
          null,
          'ingresadas',
        ),
        kpiCard('Facturadas', fmt.number(s.facturadas), `${s.pctFacturado}% del total`, 'green', null, 'facturadas'),
        kpiCard('Canceladas', fmt.number(s.canceladas), 'en el periodo', 'rose', null, 'canceladas'),
        kpiCard(
          'Abiertas del periodo',
          fmt.number(s.abiertasPeriodo || 0),
          `${s.pctAbiertasPeriodo || 0}% de ingresadas · ${fmt.currency(s.importeAbiertoPeriodo || 0)}`,
          'amber',
          null,
          'abiertasPeriodo',
        ),
        kpiCard(
          'Cerradas',
          fmt.number(s.cerradas),
          `${s.pctCerrado || 0}% del periodo · sin facturar ni cancelar`,
          'violet',
          null,
          'cerradas',
        ),
        kpiCard(
          'Abiertas acumuladas',
          fmt.number(s.abiertasAcumuladas ?? Math.max(0, (s.abiertas || 0) - (s.abiertasPeriodo || 0))),
          `${fmt.currency(s.importeAbiertoAcumulado ?? s.importeAbierto)} · excluye abiertas del periodo`,
          'amber',
          null,
          'abiertas',
        ),
      ]),
        kpiImportesAgingConMejorMes(
        [
          kpiCard('Importe ingresado', fmt.currency(s.importeIngresado), `ticket prom. ${fmt.currency(s.ticketPromIngresado)}`, 'violet', null, 'importeIngresado'),
          kpiCard('Ticket prom. facturado', fmt.currency(s.ticketPromFacturado), 'aseguradoras A / F / V', 'blue', null, 'ticketFacturado'),
          kpiCard(`Facturado · ${s.ultimoMesLabel}`, fmt.currency(s.facturadoUltimoMes), 'último mes del periodo', 'violet', null, 'facturadoUltimoMes'),
        ],
        [
          kpiCard('0-30 días', fmt.number(a.b0_30), 'backlog reciente', 'green', null, 'aging0_30'),
          kpiCard('31-60 días', fmt.number(a.b31_60), '', 'amber', null, 'aging31_60'),
          kpiCard('61-90 días', fmt.number(a.b61_90), '', 'rose', null, 'aging61_90'),
          kpiCard('+120 días', fmt.number(a.b120p), '', 'rose', 'psAging120', 'aging120p'),
        ],
        kpiMesEnCursoCard(s),
      ),
      kpiGroup('Operación de taller', [
        kpiCard(
          'Tiempo prom. ciclo',
          `${fmt.number(o.tiempoPromCiclo || 0)} d`,
          `${fmt.number(o.ciclosConDato || 0)} con ORE_FECHACIE · A/F/H/J/V/Z/Ó · −${o.cicloAjusteValuacionDias || 3} d`,
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
    renderMesEnCursoCharts(s);
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

  function renderCharts(c) {
    const { chartOptions, chartColors, chartPalette } = Dashboard;
    const weeklyEl = document.getElementById('cWeekly');
    const statusWeekEl = document.getElementById('cStatusWeek');

    destroyChart('cWeekly');
    if (weeklyEl && c.weeklyFlow) {
      charts.cWeekly = new Chart(weeklyEl, {
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
    }

    destroyChart('cStatusWeek');
    if (statusWeekEl && c.statusByWeek) {
      const weekLabels = c.statusByWeek.map((x) => x.label);
      const weekGroups = [...new Set(c.statusByWeek.flatMap((x) => Object.keys(x.groups)))];
      charts.cStatusWeek = new Chart(statusWeekEl, {
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
    }
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
    const isHyp = currentArea === 'hyp';

    document.getElementById('panelPosVentaHome')?.classList.toggle('hidden', !isHome);
    document.getElementById('panelPostVentaOrdenes')?.classList.toggle('hidden', !isOrdenes);
    document.getElementById('panelPostVentaRefacciones')?.classList.toggle('hidden', !isRef);
    document.getElementById('panelMesCursoNomenclatura')?.classList.toggle('hidden', !isServicio);
    document.getElementById('panelHypCobranza')?.classList.toggle('hidden', !isHyp);
    document.getElementById('panelCuadreOrdenesHyp')?.classList.toggle('hidden', !isHyp);
    document.querySelectorAll('#panelPostVentaOrdenes [data-hyp-hide]').forEach((el) => {
      el.classList.toggle('hidden', isHyp);
    });
    updateHypOpsChipsVisibility();
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

    const tr = data?.traspasos || {};
    const trS = tr.summary || {};
    const trMeta = document.getElementById('refaccionesTraspasosMeta');
    const trKpi = document.getElementById('kpiRefaccionesTraspasos');
    if (trMeta) {
      const f = data?.filtros || {};
      trMeta.textContent = f.fechaInicio && f.fechaFin
        ? `${f.fechaInicio} — ${f.fechaFin} · ${fmt.number(trS.piezas || 0)} pzas`
        : `${fmt.number(trS.piezas || 0)} pzas`;
    }
    if (trKpi) {
      trKpi.innerHTML = `
        <div class="kpi-group">
          <h4 class="kpi-group-title">Traspasos</h4>
          <div class="kpi-grid">
            <div class="kpi-card kpi-card--blue"><span class="kpi-title">Piezas movidas</span><div class="kpi-value">${fmt.number(trS.piezas || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--violet"><span class="kpi-title">Partes</span><div class="kpi-value">${fmt.number(trS.partes || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--green"><span class="kpi-title">Documentos</span><div class="kpi-value">${fmt.number(trS.documentos || 0)}</div><div class="kpi-accent"></div></div>
            <div class="kpi-card kpi-card--amber"><span class="kpi-title">Costo</span><div class="kpi-value">${fmt.money(trS.costo || 0)}</div><div class="kpi-accent"></div></div>
          </div>
        </div>`;
    }
    const trRutas = document.getElementById('tblRefaccionesTraspasosRutas');
    if (trRutas) {
      const rows = tr.rutas || [];
      trRutas.innerHTML = rows.length
        ? rows.slice(0, 20).map((r) => `
          <tr>
            <td>${escHtml(r.ruta || `${r.origen} → ${r.destino}`)}</td>
            <td class="cell-num">${fmt.number(r.piezas || 0)}</td>
            <td class="cell-num">${fmt.money(r.costo || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="3">Sin traspasos en el periodo.</td></tr>';
    }
    const trTop = document.getElementById('tblRefaccionesTraspasosTop');
    if (trTop) {
      const rows = tr.topPartes || [];
      trTop.innerHTML = rows.length
        ? rows.slice(0, 20).map((r) => `
          <tr>
            <td class="mono">${escHtml(r.parte || '')}</td>
            <td>${escHtml(r.descripcion || '—')}</td>
            <td class="cell-num">${fmt.number(r.piezas || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="3">Sin partes.</td></tr>';
    }
    const trDet = document.getElementById('tblRefaccionesTraspasosDetalle');
    if (trDet) {
      const rows = tr.detalle || [];
      trDet.innerHTML = rows.length
        ? rows.slice(0, 80).map((r) => `
          <tr>
            <td>${escHtml(r.fecha || '—')}</td>
            <td class="mono">${escHtml(r.parte || '')}</td>
            <td>${escHtml(r.origen || '—')}</td>
            <td>${escHtml(r.destino || '—')}</td>
            <td class="cell-num">${fmt.number(r.piezas || 0)}</td>
            <td class="cell-num">${fmt.money(r.costo || 0)}</td>
          </tr>`).join('')
        : '<tr class="empty-row"><td colspan="6">Sin detalle.</td></tr>';
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

  function mapHypCobranzaRow(r) {
    return {
      ...r,
      tipoOrden: r.segmentoLabel || r.tipoPorLetra || r.tipoOrden || '—',
      statusLabel: r.pagoEstadoLabel || r.statusLabel || '—',
      antiguedad: r.pagoEstadoLabel || '—',
      importe: Number(r.importeFacturado || 0),
      importeAbierto: Number(r.saldo || 0),
      critica: r.pagoEstado === 'pendiente',
      promesa: r.factura || '—',
      dias: null,
    };
  }

  function rowsForHypCobranza(key) {
    const rows = (hypCobranzaData?.registros || []).map(mapHypCobranzaRow);
    switch (key) {
      case 'hypCob-body31':
        return rows.filter((r) => r.segmento === 'body31');
      case 'hypCob-matriz':
        return rows.filter((r) => r.segmento === 'matriz');
      case 'hypCob-pendiente':
        return rows.filter((r) => r.pagoEstado === 'pendiente');
      case 'hypCob-parcial':
        return rows.filter((r) => r.pagoEstado === 'parcial');
      case 'hypCob-pagado':
        return rows.filter((r) => r.pagoEstado === 'pagado');
      case 'hypCob-enviado':
        return rows.filter((r) => r.enviadoAPago);
      case 'hypCob-total':
      default:
        return rows;
    }
  }

  function hypCobranzaMeta(key) {
    const map = {
      'hypCob-total': { title: 'Facturadas V/A', hint: 'Órdenes facturadas Body 31 (V*) y matriz (A*)', icon: 'receipt_long' },
      'hypCob-body31': { title: 'Aseguradora Body 31', hint: 'Folio V* · sucursal 31', icon: 'garage' },
      'hypCob-matriz': { title: 'Aseguradoras (matriz)', hint: 'Folio A* · sucursal matriz', icon: 'apartment' },
      'hypCob-pendiente': { title: 'Pendiente de pago', hint: 'Sin aplicación CXC sobre la factura', icon: 'hourglass_empty' },
      'hypCob-parcial': { title: 'Pago parcial / enviado', hint: 'Hay movimiento CXC pero aún hay saldo', icon: 'sync_alt' },
      'hypCob-pagado': { title: 'Pagado', hint: 'Saldo cubierto por aplicaciones CXC', icon: 'paid' },
      'hypCob-enviado': { title: 'Enviado a pago', hint: 'Con al menos un movimiento CXC', icon: 'send_money' },
    };
    return map[key] || { title: 'Cobranza aseguradoras', hint: '', icon: 'account_balance' };
  }

  function openHypCobranzaDetail(key, card) {
    if (!hypCobranzaData) return;
    if (openHypCobranzaKey === key) {
      closeOpsOrdersDrawer();
      return;
    }
    closeOpsOrdersDrawer();
    openOpsKpiKey = null;
    openAseguradoraKey = null;
    openHypGarantiasKey = null;
    openHypCobranzaKey = key;
    document.querySelectorAll('#kpiOperational .kpi-card--clickable.is-open')
      .forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('#tblAseg tr.row-active')
      .forEach((tr) => tr.classList.remove('row-active'));
    document.querySelectorAll('#kpiHypCobranza .kpi-card--clickable.is-open, #kpiHypGarantias .kpi-card--clickable.is-open')
      .forEach((c) => c.classList.remove('is-open'));
    card?.classList.add('is-open');

    const meta = hypCobranzaMeta(key);
    const rows = rowsForHypCobranza(key);

    openOpsOrdersDrawer(rows, card, {
      kpi: key,
      title: meta.title,
      hint: meta.hint,
      icon: meta.icon,
    });
  }

  function renderHypCobranza(data) {
    const { fmt } = Dashboard;
    const root = document.getElementById('kpiHypCobranza');
    if (!root) return;

    if (!data) {
      root.innerHTML = '';
      return;
    }

    const s = data.summary || {};

    const card = (title, value, sub, cls, key) => `
      <div class="kpi-card kpi-card--${cls || 'blue'} kpi-card--clickable" data-hyp-cob="${key}" role="button" tabindex="0" title="Clic para ver desglose">
        <span class="kpi-title">${title}</span>
        <div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>
        ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
        <span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>
        <div class="kpi-accent"></div>
      </div>`;

    root.innerHTML = [
      kpiGroup('Volumen facturado', [
        card('Facturadas V/A', fmt.number(s.totalFacturadas || 0), fmt.currency(s.importeFacturado || 0), 'blue', 'hypCob-total'),
        card('Body 31 (V*)', fmt.number(s.body31?.ordenes || 0), `${fmt.currency(s.body31?.importe || 0)} · ${fmt.number(s.body31?.pendientes || 0)} pend.`, 'violet', 'hypCob-body31'),
        card('Matriz (A*)', fmt.number(s.matriz?.ordenes || 0), `${fmt.currency(s.matriz?.importe || 0)} · ${fmt.number(s.matriz?.pendientes || 0)} pend.`, 'violet', 'hypCob-matriz'),
      ]),
      kpiGroup('Estado de cobranza', [
        card('Pendiente de pago', fmt.number(s.pendientePago?.ordenes || 0), fmt.currency(s.pendientePago?.saldo || 0), 'rose', 'hypCob-pendiente'),
        card('Parcial / enviado', fmt.number(s.enviadoParcial?.ordenes || 0), `saldo ${fmt.currency(s.enviadoParcial?.saldo || 0)}`, 'amber', 'hypCob-parcial'),
        card('Pagado', fmt.number(s.pagado?.ordenes || 0), fmt.currency(s.pagado?.pagado || 0), 'green', 'hypCob-pagado'),
        card('Enviado a pago', fmt.number(s.enviadoAPago?.ordenes || 0), 'con movimiento CXC', 'blue', 'hypCob-enviado'),
      ]),
    ].join('');

    root.querySelectorAll('[data-hyp-cob]').forEach((el) => {
      const open = () => openHypCobranzaDetail(el.getAttribute('data-hyp-cob'), el);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  async function loadHypCobranza(fechaInicio, fechaFin, force = false) {
    const key = `${fechaInicio}|${fechaFin}`;
    const asegCached = !force && hypCobranzaData && hypCobranzaLoadedKey === key;
    const garCached = !force && hypGarantiasData && hypGarantiasLoadedKey === key;
    if (asegCached && garCached) {
      renderHypCobranza(hypCobranzaData);
      renderHypGarantias(hypGarantiasData);
      return { aseguradoras: hypCobranzaData, garantias: hypGarantiasData };
    }

    const [asegRes, garRes] = await Promise.allSettled([
      asegCached
        ? Promise.resolve(hypCobranzaData)
        : Dashboard.api(`/post-sales/hyp/aseguradoras-cobranza?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`),
      garCached
        ? Promise.resolve(hypGarantiasData)
        : Dashboard.api(`/post-sales/hyp/garantias-cobranza?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`),
    ]);

    if (asegRes.status === 'fulfilled') {
      hypCobranzaData = asegRes.value;
      hypCobranzaLoadedKey = key;
      renderHypCobranza(hypCobranzaData);
    } else {
      console.warn('[HyP cobranza aseguradoras]', asegRes.reason?.message || asegRes.reason);
      renderHypCobranza(null);
    }

    if (garRes.status === 'fulfilled') {
      hypGarantiasData = garRes.value;
      hypGarantiasLoadedKey = key;
      renderHypGarantias(hypGarantiasData);
    } else {
      console.warn('[HyP cobranza garantías]', garRes.reason?.message || garRes.reason);
      renderHypGarantias(null);
    }

    return { aseguradoras: hypCobranzaData, garantias: hypGarantiasData };
  }

  function renderCuadreOrdenesHyp(data) {
    const { fmt } = Dashboard;
    const kpiRoot = document.getElementById('kpiCuadreOrdenesHyp');
    const metaEl = document.getElementById('cuadreOrdenesHypMeta');
    const tblCuentas = document.getElementById('tblCuadreOrdenesHypCuentas');
    const tblMatriz = document.getElementById('tblCuadreOrdenesHypMatriz');

    if (!data) {
      if (kpiRoot) kpiRoot.innerHTML = '';
      if (metaEl) metaEl.textContent = 'Sin datos';
      if (tblCuentas) tblCuentas.innerHTML = '<tr><td colspan="6">No se pudo cargar el cuadre.</td></tr>';
      if (tblMatriz) tblMatriz.innerHTML = '<tr><td colspan="11">—</td></tr>';
      return;
    }

    const r = data.resumen || {};
    const dif = Number(r.diferencia || 0);
    const difCls = Math.abs(dif) < 0.02 ? 'green' : 'rose';

    if (kpiRoot) {
      kpiRoot.innerHTML = [
        executiveCard('Total Contpaq', fmt.currency(r.totalContpaq || 0), 'MOVDET VS/DVS', 'blue', 'account_balance', null),
        executiveCard('Total DMS', fmt.currency(r.totalDms || 0), 'facturas SRV/S000', 'violet', 'receipt_long', null),
        executiveCard('Diferencia', fmt.currency(dif), Math.abs(dif) < 0.02 ? 'cuadrado' : 'revisar', difCls, 'compare_arrows', null),
        executiveCard('VINs únicos', fmt.number(r.vinsUnicos || 0), `${fmt.number(r.facturas || 0)} facturas · ${fmt.number(r.ordenes || 0)} órdenes`, 'amber', 'directions_car', null),
      ].join('');
    }

    if (metaEl) {
      const p = data.periodo || {};
      metaEl.textContent = `${p.fechaInicio || '—'} a ${p.fechaFin || '—'} · ${fmt.number(r.facturas || 0)} facturas`;
    }

    if (tblCuentas) {
      const cuentas = r.cuentas || [];
      tblCuentas.innerHTML = cuentas.length
        ? cuentas.map((c) => {
          const d = Number(c.diferencia || 0);
          return `<tr>
            <td>${escHtml(c.cuenta)}</td>
            <td>${escHtml(c.label || '')}</td>
            <td class="cell-num">${fmt.currency(c.contpaq)}</td>
            <td class="cell-num">${fmt.currency(c.dms)}</td>
            <td class="cell-num">${fmt.currency(d)}</td>
            <td class="cell-num">${fmt.number(c.lineas || 0)}</td>
          </tr>`;
        }).join('')
        : '<tr><td colspan="6">Sin cuentas</td></tr>';
    }

    if (tblMatriz) {
      const rows = (data.facturas || []).slice().sort((a, b) => {
        const va = String(a.vin || '');
        const vb = String(b.vin || '');
        return va.localeCompare(vb) || String(a.orden || '').localeCompare(String(b.orden || ''));
      });
      tblMatriz.innerHTML = rows.length
        ? rows.map((f) => {
          const pc = f.porCuenta || {};
          return `<tr>
            <td>${escHtml(f.orden || '')}</td>
            <td>${escHtml(f.docto || '')}</td>
            <td>${escHtml(f.vin || '—')}</td>
            <td>${escHtml(f.cierre || '—')}</td>
            <td>${escHtml(f.letra || '')}</td>
            <td>${escHtml(f.st || '')}</td>
            <td class="cell-num">${fmt.currency(pc['0477'] || 0)}</td>
            <td class="cell-num">${fmt.currency(pc['0470'] || 0)}</td>
            <td class="cell-num">${fmt.currency(pc['0479'] || 0)}</td>
            <td class="cell-num">${fmt.currency(pc['0476'] || 0)}</td>
            <td class="cell-num">${fmt.currency(f.neto || 0)}</td>
          </tr>`;
        }).join('')
        : '<tr><td colspan="11">Sin facturas en el periodo</td></tr>';
    }
  }

  function setCuadreOrdenesHypLoading(periodoLabel) {
    const kpiRoot = document.getElementById('kpiCuadreOrdenesHyp');
    const metaEl = document.getElementById('cuadreOrdenesHypMeta');
    const tblCuentas = document.getElementById('tblCuadreOrdenesHypCuentas');
    const tblMatriz = document.getElementById('tblCuadreOrdenesHypMatriz');
    if (kpiRoot) {
      kpiRoot.innerHTML = `<p class="section-subtitle" style="margin:0">Cargando cuadre Contpaq ↔ DMS${periodoLabel ? ` · ${periodoLabel}` : ''}…</p>`;
    }
    if (metaEl) metaEl.textContent = 'Consultando…';
    if (tblCuentas) tblCuentas.innerHTML = '<tr><td colspan="6">Consultando cuentas 0470 / 0476 / 0477 / 0479…</td></tr>';
    if (tblMatriz) tblMatriz.innerHTML = '<tr><td colspan="11">Armando matriz orden / factura…</td></tr>';
  }

  async function loadCuadreOrdenesHyp(fechaInicio, fechaFin, force = false) {
    const key = `${fechaInicio}|${fechaFin}`;
    if (!force && cuadreOrdenesHypData && cuadreOrdenesHypLoadedKey === key) {
      renderCuadreOrdenesHyp(cuadreOrdenesHypData);
      return cuadreOrdenesHypData;
    }
    setCuadreOrdenesHypLoading(`${fechaInicio} — ${fechaFin}`);
    const data = await Dashboard.api(
      `/post-sales/hyp/cuadre-ordenes?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
    );
    cuadreOrdenesHypData = data;
    cuadreOrdenesHypLoadedKey = key;
    renderCuadreOrdenesHyp(data);
    return data;
  }

  function mapHypGarantiasRow(r) {
    return {
      ...r,
      cliente: r.cliente || r.nombre || 'Sin cliente',
      tipoOrden: r.segmentoLabel || r.tipoPorLetra || '—',
      tipo: r.segmentoLabel || r.tipoPorLetra || '—',
      statusLabel: r.pagoEstadoLabel || r.statusLabel || '—',
      antiguedad: r.pagoEstadoLabel || '—',
      importe: Number(r.importeFacturado || 0),
      importeAbierto: Number(r.saldo || 0),
      critica: r.pagoEstado === 'pendiente',
      promesa: r.factura || '—',
      dias: null,
    };
  }

  function rowsForHypGarantias(key) {
    const rows = (hypGarantiasData?.registros || []).map(mapHypGarantiasRow);
    switch (key) {
      case 'hypGar-interna':
        return rows.filter((r) => r.segmento === 'internaHyp');
      case 'hypGar-seminuevos':
        return rows.filter((r) => r.segmento === 'seminuevosHyp');
      case 'hypGar-nuevos':
        return rows.filter((r) => r.segmento === 'nuevosHyp');
      case 'hypGar-pendiente':
        return rows.filter((r) => r.pagoEstado === 'pendiente');
      case 'hypGar-parcial':
        return rows.filter((r) => r.pagoEstado === 'parcial');
      case 'hypGar-pagado':
        return rows.filter((r) => r.pagoEstado === 'pagado');
      case 'hypGar-enviado':
        return rows.filter((r) => r.enviadoAPago);
      case 'hypGar-total':
      default:
        return rows;
    }
  }

  function hypGarantiasMeta(key) {
    const map = {
      'hypGar-total': { title: 'Facturadas J/H/Ó', hint: 'Órdenes internas HyP facturadas', icon: 'receipt_long' },
      'hypGar-interna': { title: 'Interna HYP (J*)', hint: 'Folio J* · Interna HYP', icon: 'build' },
      'hypGar-seminuevos': { title: 'Seminuevos HYP (H*)', hint: 'Folio H* · Interna seminuevos HYP', icon: 'directions_car' },
      'hypGar-nuevos': { title: 'Nuevos HYP (Ó*)', hint: 'Folio Ó* · Interna nuevos HYP', icon: 'new_releases' },
      'hypGar-pendiente': { title: 'Pendiente de pago', hint: 'Sin aplicación CXC sobre la factura', icon: 'hourglass_empty' },
      'hypGar-parcial': { title: 'Pago parcial / enviado', hint: 'Hay movimiento CXC pero aún hay saldo', icon: 'sync_alt' },
      'hypGar-pagado': { title: 'Pagado', hint: 'Saldo cubierto por aplicaciones CXC', icon: 'paid' },
      'hypGar-enviado': { title: 'Enviado a pago', hint: 'Con al menos un movimiento CXC', icon: 'send_money' },
    };
    return map[key] || { title: 'Cobranza garantías', hint: '', icon: 'verified' };
  }

  function openHypGarantiasDetail(key, card) {
    if (!hypGarantiasData) return;
    if (openHypGarantiasKey === key) {
      closeOpsOrdersDrawer();
      return;
    }
    closeOpsOrdersDrawer();
    openOpsKpiKey = null;
    openAseguradoraKey = null;
    openHypCobranzaKey = null;
    openHypGarantiasKey = key;
    document.querySelectorAll('#kpiOperational .kpi-card--clickable.is-open')
      .forEach((c) => c.classList.remove('is-open'));
    document.querySelectorAll('#tblAseg tr.row-active')
      .forEach((tr) => tr.classList.remove('row-active'));
    document.querySelectorAll('#kpiHypCobranza .kpi-card--clickable.is-open, #kpiHypGarantias .kpi-card--clickable.is-open')
      .forEach((c) => c.classList.remove('is-open'));
    card?.classList.add('is-open');

    const meta = hypGarantiasMeta(key);
    const rows = rowsForHypGarantias(key);

    openOpsOrdersDrawer(rows, card, {
      kpi: key,
      title: meta.title,
      hint: meta.hint,
      icon: meta.icon,
    });
  }

  function renderHypGarantias(data) {
    const { fmt } = Dashboard;
    const root = document.getElementById('kpiHypGarantias');
    if (!root) return;

    if (!data) {
      root.innerHTML = '';
      return;
    }

    const s = data.summary || {};

    const card = (title, value, sub, cls, key) => `
      <div class="kpi-card kpi-card--${cls || 'blue'} kpi-card--clickable" data-hyp-gar="${key}" role="button" tabindex="0" title="Clic para ver desglose">
        <span class="kpi-title">${title}</span>
        <div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>
        ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
        <span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>
        <div class="kpi-accent"></div>
      </div>`;

    root.innerHTML = [
      kpiGroup('Volumen facturado', [
        card('Facturadas J/H/Ó', fmt.number(s.totalFacturadas || 0), fmt.currency(s.importeFacturado || 0), 'blue', 'hypGar-total'),
        card('Interna (J*)', fmt.number(s.internaHyp?.ordenes || 0), `${fmt.currency(s.internaHyp?.importe || 0)} · ${fmt.number(s.internaHyp?.pendientes || 0)} pend.`, 'violet', 'hypGar-interna'),
        card('Seminuevos (H*)', fmt.number(s.seminuevosHyp?.ordenes || 0), `${fmt.currency(s.seminuevosHyp?.importe || 0)} · ${fmt.number(s.seminuevosHyp?.pendientes || 0)} pend.`, 'violet', 'hypGar-seminuevos'),
        card('Nuevos (Ó*)', fmt.number(s.nuevosHyp?.ordenes || 0), `${fmt.currency(s.nuevosHyp?.importe || 0)} · ${fmt.number(s.nuevosHyp?.pendientes || 0)} pend.`, 'violet', 'hypGar-nuevos'),
      ]),
      kpiGroup('Estado de cobranza', [
        card('Pendiente de pago', fmt.number(s.pendientePago?.ordenes || 0), fmt.currency(s.pendientePago?.saldo || 0), 'rose', 'hypGar-pendiente'),
        card('Parcial / enviado', fmt.number(s.enviadoParcial?.ordenes || 0), `saldo ${fmt.currency(s.enviadoParcial?.saldo || 0)}`, 'amber', 'hypGar-parcial'),
        card('Pagado', fmt.number(s.pagado?.ordenes || 0), fmt.currency(s.pagado?.pagado || 0), 'green', 'hypGar-pagado'),
        card('Enviado a pago', fmt.number(s.enviadoAPago?.ordenes || 0), 'con movimiento CXC', 'blue', 'hypGar-enviado'),
      ]),
    ].join('');

    root.querySelectorAll('[data-hyp-gar]').forEach((el) => {
      const open = () => openHypGarantiasDetail(el.getAttribute('data-hyp-gar'), el);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
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

    try {
      refreshDashboard();
    } catch (err) {
      console.warn('[PostVenta refresh]', err?.message || err);
    }

    if (currentArea === 'hyp') {
      const fi = document.getElementById('fechaInicio')?.value;
      const ff = document.getElementById('fechaFin')?.value;
      if (fi && ff) {
        const loading = window.showLoading || Dashboard.showLoading;
        try {
          loading?.(true);
          document.getElementById('panelCuadreOrdenesHyp')?.classList.remove('hidden');
          setCuadreOrdenesHypLoading(`${fi} — ${ff}`);
          try {
            await loadHypCobranza(fi, ff);
          } catch (err) {
            console.warn('[HyP cobranza]', err.message);
            renderHypCobranza(null);
            renderHypGarantias(null);
          }
          try {
            await loadCuadreOrdenesHyp(fi, ff, true);
            document.getElementById('panelCuadreOrdenesHyp')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (err) {
            console.error('[Cuadre órdenes HyP]', err);
            renderCuadreOrdenesHyp(null);
            const metaEl = document.getElementById('cuadreOrdenesHypMeta');
            if (metaEl) metaEl.textContent = err.message || 'Error al cargar';
            window.alert(err.message || 'No se pudo cargar el Cuadre de Órdenes HyP. Reinicia el backend si la ruta no existe.');
          }
        } finally {
          loading?.(false);
        }
      }
    }
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
    if (currentArea !== 'hyp') {
      renderCharts(dash.charts);
    }
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
    hypCobranzaData = null;
    hypCobranzaLoadedKey = '';
    openHypCobranzaKey = null;
    hypGarantiasData = null;
    hypGarantiasLoadedKey = '';
    openHypGarantiasKey = null;
    cuadreOrdenesHypData = null;
    cuadreOrdenesHypLoadedKey = '';
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
