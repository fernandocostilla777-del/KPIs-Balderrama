/**
 * Sección Leads en Ventas — seguimiento de conversión oportunidad → venta.
 * Cohorte por fecha_entrada; compra = VIN en ciclo CRM del mismo ID CRM.
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

  function filteredDetalle() {
    const q = String(state.search || '').trim().toLowerCase();
    const rows = detalle();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.nombre, r.telefono, r.ejecutivo, r.canal, r.sucursal, r.vin,
        r.idCrm, r.idOportunidad, r.resultado, r.autoInteres, r.campana, r.estatusCiclo,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }

  function kpiCard(key, title, value, sub, cls, icon) {
    const active = state.openKpi === key ? ' is-active' : '';
    return `
      <button type="button" class="kpi-card kpi-card--${cls} kpi-card--interactive${active}" data-ld-kpi="${escapeHtml(key)}" aria-pressed="${state.openKpi === key ? 'true' : 'false'}">
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
        <div class="kpi-grid">
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
      const total = detalle().length;
      if (state.search) {
        els.searchMeta.classList.remove('hidden');
        els.searchMeta.textContent = `${rows.length} de ${total}`;
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
      : `<tr class="empty-row"><td colspan="9">${state.search ? 'Sin coincidencias.' : 'Consulte un periodo para ver leads.'}</td></tr>`;
  }

  function closeKpiDetail() {
    state.openKpi = null;
    if (els.kpiDetail) els.kpiDetail.classList.add('hidden');
    renderKpis();
  }

  function openKpiDetail(key) {
    if (!els.kpiDetail || !els.detailTitle || !els.detailResumen) return;
    if (state.openKpi === key) {
      closeKpiDetail();
      return;
    }
    state.openKpi = key;
    const s = summary();
    const map = {
      leads: { title: 'Leads / oportunidades', text: `${num(s.leads)} leads · ${num(s.oportunidades)} IDs CRM únicos · ${num(s.conEjecutivo)} con ejecutivo` },
      contactados: { title: 'Contactados', text: `${num(s.contactados)} contactados (${pct(s.conversionContactoPct)})` },
      citas: { title: 'Citas programadas', text: `${num(s.citas)} citas · ${num(s.citasAsistidas)} asistidas` },
      cotizados: { title: 'Cotizados', text: `${num(s.cotizados)} con cotización (${pct(s.conversionCotizacionPct)})` },
      compras: { title: 'Compras vinculadas', text: `${num(s.compras)} con VIN · conversión ${pct(s.conversionCompraPct)}. La compra puede ser posterior al periodo.` },
      sinCompra: { title: 'Sin compra', text: `${num(s.sinCompra)} leads de la cohorte aún sin VIN vinculado` },
      convCompra: { title: 'Lead → compra', text: `Conversión de cohorte: ${pct(s.conversionCompraPct)} (${num(s.compras)} / ${num(s.leads)})` },
      convCitaCompra: { title: 'Cita → compra', text: `${pct(s.conversionCitaACompraPct)} sobre leads con cita` },
      convContactoCompra: { title: 'Contacto → compra', text: `${pct(s.conversionContactoACompraPct)} sobre contactados` },
    };
    const info = map[key] || { title: 'Detalle', text: '' };
    els.detailTitle.textContent = info.title;
    els.detailResumen.textContent = info.text;
    els.kpiDetail.classList.remove('hidden');
    renderKpis();
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
    renderGroups();
    renderTable();
  }

  function bind() {
    els.kpiRoot = document.getElementById('ldKpiOperational');
    els.kpiDetail = document.getElementById('ldKpiDetail');
    els.detailTitle = document.getElementById('ldDetailTitle');
    els.detailResumen = document.getElementById('ldDetailResumen');
    els.btnCerrarDetail = document.getElementById('btnCerrarLdDetail');
    els.subtitle = document.getElementById('ldSubtitle');
    els.funnel = document.getElementById('ldFunnel');
    els.groupsBody = document.getElementById('ldGroupsBody');
    els.tableBody = document.getElementById('ldTableBody');
    els.search = document.getElementById('buscarLdPreview');
    els.searchMeta = document.getElementById('ldPreviewSearchMeta');
    els.groupTabs = document.getElementById('ldGroupTabs');

    els.btnCerrarDetail?.addEventListener('click', closeKpiDetail);
    els.kpiRoot?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ld-kpi]');
      if (!btn) return;
      openKpiDetail(btn.getAttribute('data-ld-kpi'));
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

  window.LeadsVentas = { init, load };
})();
