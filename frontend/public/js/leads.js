/**
 * Sección Leads en Ventas — seguimiento de conversión oportunidad → venta.
 * Cohorte por fecha_entrada; compra = VIN en ciclo CRM del mismo ID CRM.
 * KPIs dinámicos: drawer con filtros + listado (mismo patrón que Ventas/Inventario).
 */
(function () {
  let state = {
    data: null,
    fechaInicio: null,
    fechaFin: null,
    search: '',
    openKpi: null,
    groupView: 'canal',
  };

  const els = {};
  let leadsDrawerUi = null;

  function num(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return (window.Dashboard?.fmt || { number: (x) => String(x) }).number(Number(n));
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

  function formatDate(v) {
    if (!v) return '—';
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    return s.slice(0, 10);
  }

  function summary() {
    return state.data?.summary || {};
  }

  function detalle() {
    return state.data?.detalle || [];
  }

  function kpiMeta(key) {
    const s = summary();
    const map = {
      leads: {
        title: 'Leads / oportunidades',
        hint: `${num(s.leads)} leads · ${num(s.oportunidades)} IDs CRM · ${num(s.conEjecutivo)} con ejecutivo`,
        icon: 'diversity_3',
        filter: () => true,
      },
      contactados: {
        title: 'Contactados',
        hint: `${num(s.contactados)} contactados (${pct(s.conversionContactoPct)} del total)`,
        icon: 'call',
        filter: (r) => Boolean(r.contactado),
      },
      citas: {
        title: 'Citas programadas',
        hint: `${num(s.citas)} citas · ${num(s.citasAsistidas)} asistidas`,
        icon: 'event',
        filter: (r) => Boolean(r.cita),
      },
      cotizados: {
        title: 'Cotizados',
        hint: `${num(s.cotizados)} con cotización (${pct(s.conversionCotizacionPct)})`,
        icon: 'request_quote',
        filter: (r) => Boolean(r.cotizado),
      },
      compras: {
        title: 'Compras (VIN)',
        hint: `${num(s.compras)} con VIN · conversión ${pct(s.conversionCompraPct)}. La compra puede ser posterior al periodo.`,
        icon: 'sell',
        filter: (r) => Boolean(r.conCompra),
      },
      sinCompra: {
        title: 'Sin compra',
        hint: `${num(s.sinCompra)} leads de la cohorte aún sin VIN vinculado`,
        icon: 'hourglass_empty',
        filter: (r) => !r.conCompra,
      },
      convCompra: {
        title: 'Lead → compra',
        hint: `Conversión de cohorte: ${pct(s.conversionCompraPct)} (${num(s.compras)} / ${num(s.leads)})`,
        icon: 'trending_up',
        filter: () => true,
        highlight: 'compras',
      },
      convCitaCompra: {
        title: 'Cita → compra',
        hint: `${pct(s.conversionCitaACompraPct)} sobre leads con cita`,
        icon: 'conversion_path',
        filter: (r) => Boolean(r.cita),
        highlight: 'compras',
      },
      convContactoCompra: {
        title: 'Contacto → compra',
        hint: `${pct(s.conversionContactoACompraPct)} sobre contactados`,
        icon: 'handshake',
        filter: (r) => Boolean(r.contactado),
        highlight: 'compras',
      },
    };
    return map[key] || {
      title: 'Detalle',
      hint: '',
      icon: 'diversity_3',
      filter: () => true,
    };
  }

  function rowsForKpi(key) {
    const meta = kpiMeta(key);
    return detalle().filter(meta.filter);
  }

  function filteredDetalle() {
    let rows = state.openKpi ? rowsForKpi(state.openKpi) : detalle();
    const q = String(state.search || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.nombre, r.telefono, r.ejecutivo, r.canal, r.sucursal, r.vin,
        r.idCrm, r.idOportunidad, r.resultado, r.autoInteres, r.campana, r.estatusCiclo,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }

  function countByField(rows, keyFn) {
    const map = new Map();
    for (const r of rows) {
      const label = keyFn(r) || 'Sin dato';
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function kpiCard(key, title, value, sub, cls, icon) {
    const active = state.openKpi === key ? ' is-active' : '';
    return `
      <button type="button" class="kpi-card kpi-card--${cls} kpi-card--interactive${active}"
        data-ld-kpi="${escapeHtml(key)}"
        aria-pressed="${state.openKpi === key ? 'true' : 'false'}"
        aria-expanded="${state.openKpi === key ? 'true' : 'false'}"
        title="Clic para ver detalle dinámico">
        <div class="kpi-card-head">
          <span class="kpi-title">${escapeHtml(title)}</span>
          <span class="material-symbols-outlined kpi-icon" aria-hidden="true">${icon}</span>
        </div>
        <div class="kpi-value">${value}</div>
        <p class="kpi-subtitle">${escapeHtml(sub || '')}</p>
        <div class="kpi-accent"></div>
      </button>`;
  }

  function renderKpis() {
    if (!els.kpiRoot) return;
    const s = summary();
    els.kpiRoot.innerHTML = `
      <div class="kpi-group">
        <h4 class="kpi-group-title">Embudo de conversión</h4>
        <div class="kpi-grid" id="ldKpiGrid">
          ${kpiCard('leads', 'Leads', num(s.leads), `${num(s.oportunidades)} oportunidades CRM`, 'blue', 'diversity_3')}
          ${kpiCard('contactados', 'Contactados', num(s.contactados), pct(s.conversionContactoPct) + ' del total', 'slate', 'call')}
          ${kpiCard('citas', 'Citas', num(s.citas), pct(s.conversionCitaPct) + ' del total', 'amber', 'event')}
          ${kpiCard('cotizados', 'Cotizados', num(s.cotizados), pct(s.conversionCotizacionPct) + ' del total', 'violet', 'request_quote')}
          ${kpiCard('compras', 'Compras (VIN)', num(s.compras), pct(s.conversionCompraPct) + ' conversión', 'green', 'sell')}
          ${kpiCard('sinCompra', 'Sin compra', num(s.sinCompra), 'Oportunidades abiertas / perdidas', 'rose', 'hourglass_empty')}
        </div>
      </div>
      <div class="kpi-group" style="margin-top:14px">
        <h4 class="kpi-group-title">Tasas clave</h4>
        <div class="kpi-grid">
          ${kpiCard('convCompra', 'Lead → compra', pct(s.conversionCompraPct), 'Conversión de cohorte', 'green', 'trending_up')}
          ${kpiCard('convCitaCompra', 'Cita → compra', pct(s.conversionCitaACompraPct), 'Eficiencia de citas', 'violet', 'conversion_path')}
          ${kpiCard('convContactoCompra', 'Contacto → compra', pct(s.conversionContactoACompraPct), 'Sobre contactados', 'blue', 'handshake')}
        </div>
      </div>`;
  }

  function renderFunnel() {
    if (!els.funnel) return;
    const steps = state.data?.funnel || [];
    if (!steps.length) {
      els.funnel.innerHTML = '<p class="section-subtitle">Sin datos de embudo en el periodo.</p>';
      return;
    }
    const max = Math.max(...steps.map((s) => Number(s.value || 0)), 1);
    els.funnel.innerHTML = `
      <div class="ld-funnel">
        ${steps.map((s) => `
          <div class="ld-funnel-row">
            <div class="ld-funnel-label">
              <strong>${escapeHtml(s.label)}</strong>
              <span>${num(s.value)} · ${pct(s.pct)}</span>
            </div>
            <div class="ld-funnel-track" aria-hidden="true">
              <span class="ld-funnel-fill" style="width:${Math.max(4, (Number(s.value || 0) / max) * 100)}%"></span>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  function groupRows() {
    const key = state.groupView;
    if (key === 'ejecutivo') return state.data?.porEjecutivo || [];
    if (key === 'resultado') return state.data?.porResultado || [];
    if (key === 'sucursal') return state.data?.porSucursal || [];
    return state.data?.porCanal || [];
  }

  function renderGroups() {
    if (!els.groupsBody) return;
    const rows = groupRows();
    els.groupsBody.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.grupo)}</td>
          <td class="cell-num">${num(r.leads)}</td>
          <td class="cell-num">${num(r.contactados)}</td>
          <td class="cell-num">${num(r.citas)}</td>
          <td class="cell-num">${num(r.cotizados)}</td>
          <td class="cell-num">${num(r.compras)}</td>
          <td class="cell-num">${pct(r.conversionPct)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="7">Sin agrupaciones en el periodo.</td></tr>';
  }

  function renderCampanasConversion() {
    if (!els.campanasConvBody) return;
    const rows = state.data?.campanasConversion || [];
    const tot = state.data?.campanasConversionTotales || null;
    const regla = state.data?.campanasConversionRegla || null;
    const vida = Number(regla?.vidaDias || tot?.vidaDias || 90);

    if (els.campanasConvNota) {
      els.campanasConvNota.innerHTML =
        `<strong>Vida del lead: ${vida} días.</strong> `
        + 'Una vez culminado ese plazo, la oportunidad ya no cuenta para conversión de estas campañas documentadas, aunque después se concrete una venta.';
    }

    if (els.campanasConvResumen) {
      if (tot && rows.length) {
        const fuera = Number(tot.vendidosFueraVida || 0);
        const fueraTxt = fuera > 0 ? ` · ${num(fuera)} ventas fuera de ${vida}d (no cuentan)` : '';
        els.campanasConvResumen.textContent =
          `${rows.length} campañas · Total ${num(tot.total)} · Contactados ${num(tot.contactados)} · Vendidos ≤${vida}d ${num(tot.vendidos)} · Conv. ${pct(tot.conversionPct)}${fueraTxt}`;
      } else {
        els.campanasConvResumen.textContent =
          `Campañas reactivas monitoreadas · vendidos solo dentro de ${vida} días de vida del lead`;
      }
    }

    if (!rows.length) {
      els.campanasConvBody.innerHTML = '<tr class="empty-row"><td colspan="5">Sin campañas de conversión en el periodo.</td></tr>';
      if (els.campanasConvFoot) els.campanasConvFoot.innerHTML = '';
      return;
    }

    els.campanasConvBody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${escapeHtml(r.campana)}</strong></td>
        <td class="cell-num">${num(r.total)}</td>
        <td class="cell-num">${num(r.contactados)}</td>
        <td class="cell-num">${num(r.vendidos)}</td>
        <td class="cell-num">${pct(r.conversionPct)}</td>
      </tr>
    `).join('');

    if (els.campanasConvFoot && tot) {
      els.campanasConvFoot.innerHTML = `
        <tr>
          <th>Total</th>
          <th class="cell-num">${num(tot.total)}</th>
          <th class="cell-num">${num(tot.contactados)}</th>
          <th class="cell-num">${num(tot.vendidos)}</th>
          <th class="cell-num">${pct(tot.conversionPct)}</th>
        </tr>`;
    }
  }

  function etapaBadge(etapa, conCompra) {
    if (conCompra) return '<span class="ld-badge ld-badge--ok">Compra</span>';
    if (etapa === 'cita') return '<span class="ld-badge ld-badge--warn">Cita</span>';
    if (etapa === 'contacto') return '<span class="ld-badge ld-badge--info">Contacto</span>';
    return '<span class="ld-badge">Lead</span>';
  }

  function renderTable() {
    if (!els.tableBody) return;
    const rows = filteredDetalle();
    if (els.searchMeta) {
      const total = (state.openKpi ? rowsForKpi(state.openKpi) : detalle()).length;
      if (state.search || state.openKpi) {
        els.searchMeta.classList.remove('hidden');
        els.searchMeta.textContent = state.openKpi
          ? `${rows.length} de ${total} · filtro KPI`
          : `${rows.length} de ${total}`;
      } else {
        els.searchMeta.classList.add('hidden');
        els.searchMeta.textContent = '';
      }
    }
    els.tableBody.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${escapeHtml(formatDate(r.fechaEntrada))}</td>
          <td>${escapeHtml(dash(r.nombre))}</td>
          <td>${escapeHtml(dash(r.ejecutivo))}</td>
          <td>${escapeHtml(dash(r.canal))}</td>
          <td>${escapeHtml(dash(r.autoInteres))}</td>
          <td>${etapaBadge(r.etapa, r.conCompra)}</td>
          <td class="mono">${escapeHtml(dash(r.vin))}</td>
          <td>${escapeHtml(dash(r.resultado || r.estatusCiclo))}</td>
          <td class="mono">${escapeHtml(dash(r.idCrm))}</td>
        </tr>`).join('')
      : `<tr class="empty-row"><td colspan="9">${state.search || state.openKpi ? 'Sin coincidencias.' : 'Consulte un periodo para ver leads.'}</td></tr>`;
  }

  function downloadCsv(rows, title) {
    const safeName = String(title || 'leads').replace(/[^\w\-]+/g, '_').slice(0, 48);
    const stamp = new Date().toISOString().slice(0, 10);
    const headers = [
      'Entrada', 'Cliente', 'Telefono', 'Ejecutivo', 'Canal', 'Sucursal',
      'Interes', 'Etapa', 'VIN', 'Resultado', 'ID_CRM', 'Cita', 'Contactado', 'Compra',
    ];
    const lines = rows.map((r) => [
      r.fechaEntrada || '',
      r.nombre || '',
      r.telefono || '',
      r.ejecutivo || '',
      r.canal || '',
      r.sucursal || '',
      r.autoInteres || '',
      r.conCompra ? 'compra' : (r.etapa || ''),
      r.vin || '',
      r.resultado || r.estatusCiclo || '',
      r.idCrm || '',
      r.cita ? 'SI' : 'NO',
      r.contactado ? 'SI' : 'NO',
      r.conCompra ? 'SI' : 'NO',
    ]);
    const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(escapeCell).join(',')]
      .concat(lines.map((row) => row.map(escapeCell).join(',')))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function ensureLeadsKpiDrawer() {
    if (leadsDrawerUi) return leadsDrawerUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-orders-backdrop';
    backdrop.id = 'ldKpiBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-orders-drawer';
    panel.id = 'ldKpiDrawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle de leads');
    panel.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo" data-ld-kpi-logo>diversity_3</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-ld-kpi-title>Detalle de leads</h2>
            <span class="ops-orders-drawer__status" data-ld-kpi-status>0 registros</span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-ld-kpi-download title="Descargar CSV" aria-label="Descargar CSV">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-ld-kpi-expand title="Expandir" aria-label="Expandir panel">
            <span class="material-symbols-outlined" data-ld-kpi-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-ld-kpi-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <label class="ops-orders-drawer__search" for="ldKpiSearch">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="ldKpiSearch" type="search" placeholder="Buscar cliente, ejecutivo, canal, VIN…" autocomplete="off"/>
        </label>
        <button type="button" class="ops-orders-drawer__filter-chip" data-ld-kpi-filter-chip hidden title="Quitar filtro"></button>
        <span class="ops-orders-drawer__meta" data-ld-kpi-meta></span>
      </div>
      <div class="ops-orders-drawer__main">
        <aside class="ops-orders-drawer__summary custom-scrollbar" data-ld-kpi-summary></aside>
        <div class="ops-orders-drawer__body custom-scrollbar" data-ld-kpi-body></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-ld-kpi-status]');
    const metaEl = panel.querySelector('[data-ld-kpi-meta]');
    const bodyEl = panel.querySelector('[data-ld-kpi-body]');
    const summaryEl = panel.querySelector('[data-ld-kpi-summary]');
    const searchEl = panel.querySelector('#ldKpiSearch');
    const filterChip = panel.querySelector('[data-ld-kpi-filter-chip]');
    const expandBtn = panel.querySelector('[data-ld-kpi-expand]');
    const expandIcon = panel.querySelector('[data-ld-kpi-expand-icon]');
    const downloadBtn = panel.querySelector('[data-ld-kpi-download]');
    const titleEl = panel.querySelector('[data-ld-kpi-title]');
    const logoEl = panel.querySelector('[data-ld-kpi-logo]');

    let expanded = false;
    let activeFilter = null;
    let sourceRows = [];
    let lastExportRows = [];
    let currentMeta = { kpi: '', title: 'Leads', hint: '', icon: 'diversity_3' };
    let lastCard = null;

    const FILTER_DIM_LABEL = {
      canal: 'Canal',
      ejecutivo: 'Ejecutivo',
      sucursal: 'Sucursal',
      etapa: 'Etapa',
      interes: 'Interés',
    };

    function placeNearKpi(card) {
      if (expanded) return;
      const kpiBlock = document.getElementById('ldKpiGrid') || document.getElementById('ldKpiOperational');
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
      const { dim, value } = activeFilter;
      if (dim === 'canal') return String(r.canal || 'Sin canal') === value;
      if (dim === 'ejecutivo') return String(r.ejecutivo || 'Sin ejecutivo') === value;
      if (dim === 'sucursal') return String(r.sucursal || 'Sin sucursal') === value;
      if (dim === 'etapa') {
        const etapa = r.conCompra ? 'Compra' : (r.etapa === 'cita' ? 'Cita' : (r.etapa === 'contacto' ? 'Contacto' : 'Lead'));
        return etapa === value;
      }
      if (dim === 'interes') return String(r.autoInteres || 'Sin interés') === value;
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
      const isActive = (dim, value) => activeFilter && activeFilter.dim === dim && activeFilter.value === value;
      const block = (titulo, dim, items) => `
        <div class="ops-orders-drawer__group">
          <h5>${escapeHtml(titulo)}</h5>
          ${items.length
            ? items.slice(0, 12).map((x) => `
              <button type="button"
                class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x.label) ? ' is-active' : ''}"
                data-ld-filter-dim="${escapeHtml(dim)}"
                data-ld-filter-value="${escapeHtml(x.label)}"
                title="Filtrar por ${escapeHtml(x.label)}">
                <span class="lbl">${escapeHtml(x.label)}</span>
                <span class="val">${x.value}</span>
              </button>`).join('')
            : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
        </div>`;

      const compras = rows.filter((r) => r.conCompra).length;
      const citas = rows.filter((r) => r.cita).length;
      const contactados = rows.filter((r) => r.contactado).length;

      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Leads</span><span class="val">${rows.length}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Contactados</span><span class="val">${contactados}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Citas</span><span class="val">${citas}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Compras</span><span class="val">${compras}</span></div>
          <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
        </div>
        ${block('Por canal', 'canal', countByField(rows, (r) => r.canal || 'Sin canal'))}
        ${block('Por ejecutivo', 'ejecutivo', countByField(rows, (r) => r.ejecutivo || 'Sin ejecutivo'))}
        ${block('Por sucursal', 'sucursal', countByField(rows, (r) => r.sucursal || 'Sin sucursal'))}
        ${block('Por etapa', 'etapa', countByField(rows, (r) => (r.conCompra ? 'Compra' : (r.etapa === 'cita' ? 'Cita' : (r.etapa === 'contacto' ? 'Contacto' : 'Lead')))))}
        ${block('Auto de interés', 'interes', countByField(rows, (r) => r.autoInteres || 'Sin interés'))}
      `;
    }

    function renderList(term = '') {
      const q = String(term || '').trim().toLowerCase();
      const searched = !q
        ? sourceRows
        : sourceRows.filter((r) => [
          r.nombre, r.telefono, r.ejecutivo, r.canal, r.sucursal, r.vin,
          r.idCrm, r.autoInteres, r.resultado, r.campana,
        ].some((v) => String(v || '').toLowerCase().includes(q)));

      const filtered = searched.filter(matchesActiveFilter);
      lastExportRows = filtered;

      if (statusEl) statusEl.textContent = `${filtered.length} lead${filtered.length === 1 ? '' : 's'}`;
      if (metaEl) {
        metaEl.textContent = filtered.length !== sourceRows.length
          ? `${filtered.length} de ${sourceRows.length}`
          : `${sourceRows.length} registros`;
      }

      renderSummary(searched);
      updateFilterChip();

      if (!filtered.length) {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__empty">
            <span class="material-symbols-outlined">inbox</span>
            <p>${activeFilter || q ? 'Sin coincidencias con el filtro actual.' : 'No hay leads para este indicador.'}</p>
          </div>`;
        return;
      }

      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <h5>Detalle</h5>
          <span>${filtered.length}</span>
        </div>
        ${filtered.map((r) => `
          <div class="ops-orders-drawer__item" style="cursor:default">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(dash(r.nombre))}</strong>
              ${etapaBadge(r.etapa, r.conCompra)}
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.ejecutivo))} · ${escapeHtml(dash(r.canal))}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(formatDate(r.fechaEntrada))}</span>
              <span>${escapeHtml(dash(r.autoInteres))}</span>
              <span class="mono">${escapeHtml(dash(r.vin || r.idCrm))}</span>
            </div>
            <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
              <span>${escapeHtml(dash(r.sucursal))}</span>
              <span>${escapeHtml(dash(r.resultado || r.estatusCiclo))}</span>
              <span>${r.cita ? 'Cita SI' : 'Sin cita'}</span>
            </div>
          </div>`).join('')}`;
    }

    function close() {
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
      renderKpis();
      renderTable();
    }

    function open(kpiKey, card) {
      const meta = kpiMeta(kpiKey);
      const resolvedCard = card || document.querySelector(`[data-ld-kpi="${kpiKey}"]`);

      if (state.openKpi === kpiKey && panel.classList.contains('ops-orders-drawer--open')) {
        close();
        return;
      }

      currentMeta = {
        kpi: kpiKey,
        title: meta.title,
        hint: meta.hint,
        icon: meta.icon || 'diversity_3',
      };
      lastCard = resolvedCard;
      state.openKpi = kpiKey;
      activeFilter = null;

      if (titleEl) titleEl.textContent = currentMeta.title;
      if (logoEl) logoEl.textContent = currentMeta.icon;
      panel.setAttribute('aria-label', currentMeta.title);
      if (searchEl) {
        searchEl.value = '';
        searchEl.placeholder = 'Buscar cliente, ejecutivo, canal, VIN…';
      }

      sourceRows = rowsForKpi(kpiKey).slice();
      updateFilterChip();
      placeNearKpi(resolvedCard);
      setExpanded(true);
      renderList('');
      panel.classList.add('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-orders-drawer-open');
      renderKpis();
      renderTable();
      window.setTimeout(() => searchEl?.focus({ preventScroll: true }), 180);
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-ld-kpi-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));
    downloadBtn?.addEventListener('click', () => {
      if (!lastExportRows.length) {
        window.alert('No hay registros para descargar.');
        return;
      }
      downloadCsv(lastExportRows, currentMeta.title);
    });
    searchEl?.addEventListener('input', () => renderList(searchEl.value));
    filterChip?.addEventListener('click', clearFilter);
    summaryEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ld-filter-dim]');
      if (!btn || !summaryEl.contains(btn)) return;
      setFilter(btn.dataset.ldFilterDim, btn.dataset.ldFilterValue, btn.dataset.ldFilterValue);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('ops-orders-drawer--open')) close();
    });

    leadsDrawerUi = {
      open,
      close,
      panel,
      refresh() {
        if (!panel.classList.contains('ops-orders-drawer--open') || !currentMeta.kpi) return;
        sourceRows = rowsForKpi(currentMeta.kpi).slice();
        renderList(searchEl?.value || '');
      },
    };
    return leadsDrawerUi;
  }

  function closeKpiDetail() {
    if (leadsDrawerUi?.panel?.classList.contains('ops-orders-drawer--open')) {
      leadsDrawerUi.close();
      return;
    }
    state.openKpi = null;
    if (els.kpiDetail) els.kpiDetail.classList.add('hidden');
    renderKpis();
    renderTable();
  }

  function openKpiDetail(key, card) {
    ensureLeadsKpiDrawer().open(key, card);
    if (els.kpiDetail) els.kpiDetail.classList.add('hidden');
  }

  function updateSubtitle() {
    if (!els.subtitle) return;
    const fi = state.fechaInicio || '—';
    const ff = state.fechaFin || '—';
    const s = summary();
    els.subtitle.textContent = s.leads != null
      ? `Cohorte ${fi} → ${ff} · ${num(s.leads)} leads · conversión a compra ${pct(s.conversionCompraPct)}`
      : 'Seguimiento de conversión de oportunidades a ventas (VIN vinculado en CRM).';
  }

  function renderAll() {
    updateSubtitle();
    renderKpis();
    renderFunnel();
    renderCampanasConversion();
    renderGroups();
    renderTable();
    if (leadsDrawerUi?.panel?.classList.contains('ops-orders-drawer--open') && state.openKpi) {
      leadsDrawerUi.refresh();
    }
  }

  function bind() {
    els.kpiRoot = document.getElementById('ldKpiOperational');
    els.kpiDetail = document.getElementById('ldKpiDetail');
    els.detailTitle = document.getElementById('ldDetailTitle');
    els.detailResumen = document.getElementById('ldDetailResumen');
    els.btnCerrarDetail = document.getElementById('btnCerrarLdDetail');
    els.subtitle = document.getElementById('ldSubtitle');
    els.funnel = document.getElementById('ldFunnel');
    els.campanasConvBody = document.getElementById('ldCampanasConvBody');
    els.campanasConvFoot = document.getElementById('ldCampanasConvFoot');
    els.campanasConvResumen = document.getElementById('ldCampanasConvResumen');
    els.campanasConvNota = document.getElementById('ldCampanasConvNota');
    els.groupsBody = document.getElementById('ldGroupsBody');
    els.tableBody = document.getElementById('ldTableBody');
    els.search = document.getElementById('buscarLdPreview');
    els.searchMeta = document.getElementById('ldPreviewSearchMeta');
    els.groupTabs = document.getElementById('ldGroupTabs');

    els.btnCerrarDetail?.addEventListener('click', closeKpiDetail);
    els.kpiRoot?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ld-kpi]');
      if (!btn) return;
      openKpiDetail(btn.getAttribute('data-ld-kpi'), btn);
    });
    els.search?.addEventListener('input', () => {
      state.search = els.search.value || '';
      renderTable();
    });
    els.groupTabs?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ld-group]');
      if (!btn) return;
      state.groupView = btn.getAttribute('data-ld-group') || 'canal';
      els.groupTabs.querySelectorAll('[data-ld-group]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderGroups();
    });
  }

  function init() {
    bind();
  }

  async function load(fechaInicio, fechaFin) {
    state.fechaInicio = fechaInicio;
    state.fechaFin = fechaFin;
    state.search = '';
    if (els.search) els.search.value = '';
    closeKpiDetail();

    try {
      const res = await fetch(
        `/api/ventas/leads?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
        { credentials: 'same-origin' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      state.data = data;
    } catch (err) {
      console.warn('[Leads]', err);
      state.data = {
        summary: {},
        funnel: [],
        porCanal: [],
        porEjecutivo: [],
        porResultado: [],
        porSucursal: [],
        detalle: [],
        error: err.message,
      };
      if (els.subtitle) els.subtitle.textContent = err.message || 'No se pudieron cargar los leads.';
    }
    renderAll();
  }

  window.LeadsVentas = {
    init,
    load,
    getCampanasConversion() {
      return state.data?.campanasConversion || null;
    },
  };
})();
