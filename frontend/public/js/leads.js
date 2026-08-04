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
    cacheKey: null,
    inflightKey: null,
    inflightPromise: null,
  };

  const els = {};
  let leadsDrawerUi = null;
  let prospectFloat = null;
  let prospectFloatSection = 'identidad';
  let selectedProspect = null;

  const PROSPECT_MENU = [
    { id: 'identidad', label: 'Identidad', icon: 'badge' },
    { id: 'embudo', label: 'Embudo', icon: 'filter_alt' },
    { id: 'campana', label: 'Campaña', icon: 'campaign' },
    { id: 'comercial', label: 'Comercial', icon: 'handshake' },
  ];

  function findProspectById(idCrm) {
    const id = String(idCrm || '').trim();
    if (!id) return null;
    const fromDetalle = detalle().find((r) => String(r.idCrm || '').trim() === id);
    if (fromDetalle) return fromDetalle;
    const fromCaducar = (state.data?.campanasCaducarAlertas || []).find((r) => String(r.idCrm || '').trim() === id);
    if (!fromCaducar) return null;
    return {
      idCrm: fromCaducar.idCrm,
      idOportunidad: fromCaducar.idOportunidad,
      nombre: fromCaducar.nombre,
      telefono: fromCaducar.telefono,
      ejecutivo: fromCaducar.ejecutivo,
      fuerzaVentas: fromCaducar.fuerzaVentas,
      campana: fromCaducar.campana,
      fechaEntrada: fromCaducar.fechaEntrada,
      diasRestantes: fromCaducar.diasRestantes,
      diasVividos: fromCaducar.diasVividos,
      severidad: fromCaducar.severidad,
      etapa: 'lead',
      conCompra: false,
      contactado: false,
      cita: false,
      cotizado: false,
    };
  }

  function seguimiento360Url(prospect) {
    const id = String(prospect?.idCrm || '').trim();
    if (id) return `/seguimiento.html?id=${encodeURIComponent(id)}`;
    const q = String(prospect?.nombre || prospect?.telefono || '').trim();
    if (q) return `/seguimiento.html?q=${encodeURIComponent(q)}`;
    return '/seguimiento.html';
  }

  function ensureProspectFloat() {
    if (prospectFloat) return prospectFloat;
    const el = document.createElement('div');
    el.id = 'ldProspectFloat';
    el.className = 'toma-float ld-prospect-float hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Perfil del prospecto');
    el.innerHTML = `
      <div class="toma-float__header" data-ld-prospect-drag>
        <div class="toma-float__title-wrap">
          <span class="material-symbols-outlined">person_search</span>
          <div>
            <h3 class="toma-float__title" data-ld-prospect-title>Prospecto</h3>
            <p class="toma-float__subtitle" data-ld-prospect-sub></p>
          </div>
        </div>
        <button type="button" class="toma-float__icon-btn" data-ld-prospect-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <nav class="ld-prospect-menu" data-ld-prospect-menu aria-label="Menú del prospecto"></nav>
      <div class="toma-float__body custom-scrollbar" data-ld-prospect-body></div>
      <div class="toma-float__footer ld-prospect-footer" data-ld-prospect-footer></div>
    `;
    document.body.appendChild(el);

    el.querySelector('[data-ld-prospect-close]')?.addEventListener('click', closeProspectFloat);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.classList.contains('hidden')) closeProspectFloat();
    });

    el.querySelector('[data-ld-prospect-menu]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ld-prospect-section]');
      if (!btn || !selectedProspect) return;
      prospectFloatSection = btn.getAttribute('data-ld-prospect-section') || 'identidad';
      renderProspectFloatContent(selectedProspect);
    });

    const dragHandle = el.querySelector('[data-ld-prospect-drag]');
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    dragHandle?.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.setPointerCapture?.(e.pointerId);
    });
    dragHandle?.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, e.clientX - offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, e.clientY - offsetY));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });
    const endDrag = () => { dragging = false; };
    dragHandle?.addEventListener('pointerup', endDrag);
    dragHandle?.addEventListener('pointercancel', endDrag);

    prospectFloat = el;
    return el;
  }

  function closeProspectFloat() {
    selectedProspect = null;
    if (!prospectFloat) return;
    prospectFloat.classList.add('hidden');
  }

  function prospectRows(pairs) {
    return pairs.map(([label, value]) => `
      <div class="toma-float__row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value == null || value === '' ? '—' : String(value))}</dd>
      </div>`).join('');
  }

  function renderProspectFloatContent(prospect) {
    const el = ensureProspectFloat();
    const menu = el.querySelector('[data-ld-prospect-menu]');
    const body = el.querySelector('[data-ld-prospect-body]');
    const footer = el.querySelector('[data-ld-prospect-footer]');
    if (!menu || !body || !footer) return;

    menu.innerHTML = PROSPECT_MENU.map((item) => `
      <button type="button"
        class="ld-prospect-menu__btn${prospectFloatSection === item.id ? ' is-active' : ''}"
        data-ld-prospect-section="${item.id}">
        <span class="material-symbols-outlined" aria-hidden="true">${item.icon}</span>
        ${escapeHtml(item.label)}
      </button>`).join('');

    let content = '';
    if (prospectFloatSection === 'embudo') {
      content = `
        <section class="toma-float__section">
          <h4>Estado en embudo</h4>
          <dl class="toma-float__grid">
            ${prospectRows([
              ['Etapa', prospect.conCompra ? 'Compra' : (prospect.etapa === 'cita' ? 'Cita' : (prospect.etapa === 'contacto' ? 'Contacto' : 'Lead'))],
              ['Contactado', prospect.contactado ? 'Sí' : 'No'],
              ['Cita programada', prospect.cita ? 'Sí' : 'No'],
              ['Fecha cita', formatDate(prospect.fechaCita)],
              ['Cotizado', prospect.cotizado ? 'Sí' : 'No'],
              ['Compra (VIN)', prospect.conCompra ? 'Sí' : 'No'],
              ['VIN', prospect.vin],
              ['Fecha factura', formatDate(prospect.fechaFactura)],
            ])}
          </dl>
        </section>`;
    } else if (prospectFloatSection === 'campana') {
      content = `
        <section class="toma-float__section">
          <h4>Campaña / origen</h4>
          <dl class="toma-float__grid">
            ${prospectRows([
              ['Campaña', prospect.campana],
              ['Canal', prospect.canal],
              ['Tipo', prospect.tipo],
              ['Entrada', formatDate(prospect.fechaEntrada)],
              ['Días vividos', prospect.diasVividos != null ? String(prospect.diasVividos) : null],
              ['Días restantes (vida 90)', prospect.diasRestantes != null ? String(prospect.diasRestantes) : null],
              ['Severidad caducidad', prospect.severidad],
            ])}
          </dl>
        </section>`;
    } else if (prospectFloatSection === 'comercial') {
      content = `
        <section class="toma-float__section">
          <h4>Asignación comercial</h4>
          <dl class="toma-float__grid">
            ${prospectRows([
              ['Ejecutivo', prospect.ejecutivo],
              ['Fuerza de ventas', prospect.fuerzaVentas],
              ['Sucursal', prospect.sucursal],
              ['Auto de interés', prospect.autoInteres],
              ['Resultado', prospect.resultado || prospect.estatusCiclo],
              ['Estatus compra', prospect.estatusCompra],
            ])}
          </dl>
        </section>`;
    } else {
      content = `
        <section class="toma-float__section">
          <h4>Identidad del prospecto</h4>
          <dl class="toma-float__grid">
            ${prospectRows([
              ['Nombre', prospect.nombre],
              ['Teléfono', prospect.telefono],
              ['ID CRM', prospect.idCrm],
              ['ID oportunidad', prospect.idOportunidad],
              ['Entrada', formatDate(prospect.fechaEntrada)],
              ['Etapa', prospect.conCompra ? 'Compra' : (prospect.etapa || 'lead')],
            ])}
          </dl>
        </section>`;
    }

    body.innerHTML = content;

    const hasCrm = Boolean(String(prospect.idCrm || '').trim());
    footer.innerHTML = `
      <a class="btn-glass btn-primary ld-prospect-360-btn" href="${escapeHtml(seguimiento360Url(prospect))}" target="_blank" rel="noopener">
        <span class="material-symbols-outlined" aria-hidden="true">person_search</span>
        ${hasCrm ? 'Abrir Seguimiento 360' : 'Buscar en Seguimiento 360'}
      </a>
      ${!hasCrm ? '<p class="section-subtitle" style="margin:6px 0 0">Sin ID CRM: se abrirá la búsqueda por nombre/teléfono.</p>' : ''}
    `;
  }

  function openProspectFloat(prospect) {
    if (!prospect) return;
    selectedProspect = prospect;
    prospectFloatSection = 'identidad';
    const el = ensureProspectFloat();
    el.querySelector('[data-ld-prospect-title]').textContent = prospect.nombre || 'Prospecto';
    el.querySelector('[data-ld-prospect-sub]').textContent = [
      prospect.idCrm ? `CRM ${prospect.idCrm}` : null,
      prospect.ejecutivo || null,
      prospect.campana || prospect.canal || null,
    ].filter(Boolean).join(' · ');
    renderProspectFloatContent(prospect);
    if (!el.style.left && !el.style.top) {
      el.style.left = 'auto';
      el.style.right = '24px';
      el.style.top = '88px';
      el.style.bottom = 'auto';
    }
    el.classList.remove('hidden');
  }

  function openProspectById(idCrm) {
    const prospect = findProspectById(idCrm);
    if (prospect) openProspectFloat(prospect);
  }

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

  function monthBoundsFromIso(iso) {
    const d = String(iso || '').slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const start = new Date(y, mo, 1);
    const end = new Date(y, mo + 1, 0);
    const fmt = (dt) => {
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };
    return { fechaInicio: fmt(start), fechaFin: fmt(end), label: `${m[1]}-${m[2]}` };
  }

  function applyDashboardDates(fechaInicio, fechaFin) {
    const fi = document.getElementById('fechaInicio');
    const ff = document.getElementById('fechaFin');
    if (!fi || !ff) return false;
    fi.value = fechaInicio;
    ff.value = fechaFin;
    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.classList.remove('active', 'chip--active');
    });
    const lbl = document.getElementById('filterPresetLabel');
    if (lbl) lbl.textContent = 'Personalizado';
    window.Dashboard?.updateCompactFilterLabels?.();
    const btn = document.getElementById('btnConsultar');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  function renderPeriodoVacio() {
    const box = els.periodoVacio || document.getElementById('ldPeriodoVacio');
    if (!box) return;

    const s = summary();
    const cob = state.data?.cobertura || null;
    const empty = !state.data?.error && Number(s.leads || 0) === 0;
    const hasDb = Number(cob?.totalLeads || 0) > 0;
    const maxF = cob?.maxFechaEntrada || null;
    const suggested = maxF ? monthBoundsFromIso(maxF) : null;

    if (!empty || !hasDb) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const fi = state.fechaInicio || '—';
    const ff = state.fechaFin || '—';
    const maxLabel = maxF || '—';
    const suggestBtn = suggested
      ? `<button type="button" class="btn-glass btn-primary" data-ld-suggest-period
           data-fi="${escapeHtml(suggested.fechaInicio)}"
           data-ff="${escapeHtml(suggested.fechaFin)}">
           Ver ${escapeHtml(suggested.label)}
         </button>`
      : '';

    box.classList.remove('hidden');
    box.innerHTML = `
      <p class="ld-periodo-vacio__title">Sin leads en el periodo seleccionado</p>
      <p class="ld-periodo-vacio__text">
        Cohorte ${escapeHtml(fi)} → ${escapeHtml(ff)} no tiene oportunidades con fecha de entrada.
        La base CRM local llega hasta <strong>${escapeHtml(maxLabel)}</strong>
        (${num(cob.totalLeads)} leads sin duplicados).
        El filtro por defecto del mes en curso puede quedar vacío si el sheet aún no trae ese mes.
      </p>
      <div class="ld-periodo-vacio__actions">${suggestBtn}</div>
    `;
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
    const leads = Number(summary().leads || 0);
    if (!steps.length || leads === 0) {
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

  function renderCampanasCaducar() {
    const body = els.caducarBody || document.getElementById('ldCampanasCaducarBody');
    const meta = els.caducarMeta || document.getElementById('ldCampanasCaducarMeta');
    if (!body) return;

    const rows = state.data?.campanasCaducarAlertas || [];
    const resumen = state.data?.campanasCaducarResumen || null;
    const vida = Number(resumen?.vidaDias || 90);
    const umbral = Number(resumen?.umbralDias || 14);

    if (meta) {
      if (resumen) {
        const shown = Number(resumen.mostrados || rows.length || 0);
        const total = Number(resumen.total || shown);
        meta.textContent = `Periodo · ${num(total)} perfiles · mostrando ${num(shown)} · ${num(resumen.criticos)} críticos · umbral ${umbral}d de ${vida}d`;
      } else {
        meta.textContent = 'Campañas documentadas del periodo · vida del lead por vencer';
      }
    }

    if (!rows.length) {
      body.innerHTML = `<p class="section-subtitle" style="margin:0">Sin perfiles de campañas documentadas por caducar (≤${umbral} días restantes).</p>`;
      return;
    }

    body.innerHTML = rows.map((r) => {
      const sev = r.severidad === 'critical' ? 'critical' : (r.severidad === 'warning' ? 'warning' : 'info');
      const sevLabel = sev === 'critical' ? 'Crítico' : (sev === 'warning' ? 'Urgente' : 'Próximo');
      const badgeCls = sev === 'info' ? 'info' : 'warn';
      const id = String(r.idCrm || '').trim();
      return `
        <article class="ld-caducar-item ld-caducar-item--${sev}${id ? ' ld-caducar-item--clickable' : ''}"
          ${id ? `data-ld-prospect-id="${escapeHtml(id)}" role="button" tabindex="0" title="Ver perfil del prospecto"` : ''}>
          <div class="ld-caducar-item__top">
            <strong class="ld-caducar-item__name">${escapeHtml(r.nombre)}</strong>
            <span class="ld-caducar-item__days">${num(r.diasRestantes)}d</span>
          </div>
          <p class="ld-caducar-item__campana">${escapeHtml(r.campana)}</p>
          <div class="ld-caducar-item__meta">
            <span class="ld-badge ld-badge--${badgeCls}">${sevLabel}</span>
            <span>${escapeHtml(formatDate(r.fechaEntrada))}</span>
            <span>${escapeHtml(r.ejecutivo || 'Sin ejecutivo')}</span>
          </div>
        </article>`;
    }).join('');
  }

  function groupRows() {
    const key = state.groupView;
    if (key === 'ejecutivo') return state.data?.porEjecutivo || [];
    if (key === 'resultado') return state.data?.porResultado || [];
    if (key === 'sucursal') return state.data?.porSucursal || [];
    return state.data?.porCanal || [];
  }

  function renderFuerzaVentas() {
    if (!els.fuerzaBody) return;
    const block = state.data?.porFuerzaVentas || null;
    const tot = block?.totales || null;
    const periodLeads = Number(summary().leads || 0);
    const rows = periodLeads === 0
      ? []
      : (block?.filas || []).filter((r) => Number(r.leads || 0) > 0 || Number(r.compras || 0) > 0);

    if (els.fuerzaResumen) {
      if (tot && rows.length) {
        els.fuerzaResumen.textContent =
          `${rows.length} fuerzas · ${num(tot.leads)} oportunidades · conv. ${pct(tot.conversionPct)}`;
      } else {
        els.fuerzaResumen.textContent = periodLeads === 0
          ? 'Sin oportunidades en el periodo seleccionado'
          : 'Oportunidades / leads asignados por fuerza de ventas';
      }
    }

    if (!rows.length) {
      els.fuerzaBody.innerHTML = periodLeads === 0
        ? '<tr class="empty-row"><td colspan="7">Sin leads en este periodo. Elija un rango con cobertura CRM.</td></tr>'
        : '<tr class="empty-row"><td colspan="7">Sin datos de fuerza de ventas en el periodo.</td></tr>';
      if (els.fuerzaFoot) els.fuerzaFoot.innerHTML = '';
      return;
    }

    els.fuerzaBody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${escapeHtml(r.grupo)}</strong></td>
        <td class="cell-num">${num(r.leads)}</td>
        <td class="cell-num">${pct(r.participacionPct)}</td>
        <td class="cell-num">${num(r.contactados)}</td>
        <td class="cell-num">${num(r.citas)}</td>
        <td class="cell-num">${num(r.compras)}</td>
        <td class="cell-num">${pct(r.conversionPct)}</td>
      </tr>
    `).join('');

    if (els.fuerzaFoot && tot) {
      els.fuerzaFoot.innerHTML = `
        <tr>
          <th>Total</th>
          <th class="cell-num">${num(tot.leads)}</th>
          <th class="cell-num">100%</th>
          <th class="cell-num">${num(tot.contactados)}</th>
          <th class="cell-num">${num(tot.citas)}</th>
          <th class="cell-num">${num(tot.compras)}</th>
          <th class="cell-num">${pct(tot.conversionPct)}</th>
        </tr>`;
    }
  }

  function renderGroups() {
    if (!els.groupsBody) return;
    const periodLeads = Number(summary().leads || 0);
    const rows = periodLeads === 0 ? [] : groupRows();
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
      : `<tr class="empty-row"><td colspan="7">${
        periodLeads === 0
          ? 'Sin leads en este periodo. Elija un rango con cobertura CRM.'
          : 'Sin agrupaciones en el periodo.'
      }</td></tr>`;
  }

  function renderCampanasConversion() {
    if (!els.campanasConvBody) return;
    const allRows = state.data?.campanasConversion || [];
    const tot = state.data?.campanasConversionTotales || null;
    const regla = state.data?.campanasConversionRegla || null;
    const vida = Number(regla?.vidaDias || tot?.vidaDias || 90);
    const periodLeads = Number(summary().leads || 0);
    const rows = periodLeads === 0 ? [] : allRows.filter((r) => Number(r.total || 0) > 0);

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
        els.campanasConvResumen.textContent = periodLeads === 0
          ? 'Sin campañas en el periodo seleccionado'
          : `Campañas reactivas monitoreadas · vendidos solo dentro de ${vida} días de vida del lead`;
      }
    }

    if (!rows.length) {
      els.campanasConvBody.innerHTML = periodLeads === 0
        ? '<tr class="empty-row"><td colspan="5">Sin leads en este periodo. Elija un rango con cobertura CRM.</td></tr>'
        : '<tr class="empty-row"><td colspan="5">Sin campañas de conversión en el periodo.</td></tr>';
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
      ? rows.map((r, idx) => {
        const id = String(r.idCrm || '').trim();
        const key = id || `idx-${idx}`;
        return `
        <tr class="ld-prospect-row" data-ld-prospect-key="${escapeHtml(key)}" ${id ? `data-ld-prospect-id="${escapeHtml(id)}"` : ''} title="Ver perfil del prospecto" tabindex="0" role="button">
          <td>${escapeHtml(formatDate(r.fechaEntrada))}</td>
          <td><strong>${escapeHtml(dash(r.nombre))}</strong></td>
          <td>${escapeHtml(dash(r.ejecutivo))}</td>
          <td>${escapeHtml(dash(r.canal))}</td>
          <td>${escapeHtml(dash(r.autoInteres))}</td>
          <td>${etapaBadge(r.etapa, r.conCompra)}</td>
          <td class="mono">${escapeHtml(dash(r.vin))}</td>
          <td>${escapeHtml(dash(r.resultado || r.estatusCiclo))}</td>
          <td class="mono">${escapeHtml(dash(r.idCrm))}</td>
        </tr>`;
      }).join('')
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
        ${filtered.map((r, idx) => {
          const id = String(r.idCrm || '').trim();
          return `
          <button type="button" class="ops-orders-drawer__item ops-orders-drawer__item--clickable" data-ld-prospect-open="${idx}" ${id ? `data-ld-prospect-id="${escapeHtml(id)}"` : ''} title="Ver perfil del prospecto">
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
            <p class="ops-orders-drawer__open-hint">Clic para ver perfil · Seguimiento 360</p>
          </button>`;
        }).join('')}`;

      bodyEl.querySelectorAll('[data-ld-prospect-open]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.getAttribute('data-ld-prospect-open'));
          const row = filtered[idx];
          if (row) openProspectFloat(row);
        });
      });
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

  function wireProspectSelection() {
    const openFromEvent = (e) => {
      const target = e.target.closest('[data-ld-prospect-id], [data-ld-prospect-key]');
      if (!target) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      if (e.type === 'keydown') e.preventDefault();
      const id = target.getAttribute('data-ld-prospect-id');
      if (id) {
        openProspectById(id);
        return;
      }
      const key = target.getAttribute('data-ld-prospect-key');
      if (key?.startsWith('idx-')) {
        const idx = Number(key.slice(4));
        const row = filteredDetalle()[idx];
        if (row) openProspectFloat(row);
      }
    };

    els.tableBody?.addEventListener('click', openFromEvent);
    els.tableBody?.addEventListener('keydown', openFromEvent);
    els.caducarBody?.addEventListener('click', openFromEvent);
    els.caducarBody?.addEventListener('keydown', openFromEvent);
  }

  function updateSubtitle() {
    if (!els.subtitle) return;
    const fi = state.fechaInicio || '—';
    const ff = state.fechaFin || '—';
    const s = summary();
    els.subtitle.textContent = s.leads != null
      ? `Cohorte ${fi} → ${ff} · ${num(s.leads)} leads (sin duplicados) · conversión a compra ${pct(s.conversionCompraPct)}`
      : 'Seguimiento de conversión de oportunidades a ventas (VIN vinculado en CRM · sin duplicados de columna AD).';
  }

  function renderAll() {
    updateSubtitle();
    renderPeriodoVacio();
    renderKpis();
    renderFunnel();
    renderCampanasCaducar();
    renderCampanasConversion();
    renderFuerzaVentas();
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
    els.periodoVacio = document.getElementById('ldPeriodoVacio');
    els.funnel = document.getElementById('ldFunnel');
    els.caducarBody = document.getElementById('ldCampanasCaducarBody');
    els.caducarMeta = document.getElementById('ldCampanasCaducarMeta');
    els.campanasConvBody = document.getElementById('ldCampanasConvBody');
    els.campanasConvFoot = document.getElementById('ldCampanasConvFoot');
    els.campanasConvResumen = document.getElementById('ldCampanasConvResumen');
    els.campanasConvNota = document.getElementById('ldCampanasConvNota');
    els.fuerzaBody = document.getElementById('ldFuerzaBody');
    els.fuerzaFoot = document.getElementById('ldFuerzaFoot');
    els.fuerzaResumen = document.getElementById('ldFuerzaResumen');
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
    els.periodoVacio?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ld-suggest-period]');
      if (!btn) return;
      const fi = btn.getAttribute('data-fi');
      const ff = btn.getAttribute('data-ff');
      if (!fi || !ff) return;
      if (!applyDashboardDates(fi, ff)) {
        load(fi, ff);
      }
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
    wireProspectSelection();
  }

  function init() {
    bind();
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    const force = Boolean(opts.force);
    const key = `${fechaInicio}|${fechaFin}`;
    state.fechaInicio = fechaInicio;
    state.fechaFin = fechaFin;
    state.search = '';
    if (els.search) els.search.value = '';
    closeProspectFloat();
    closeKpiDetail();

    // Reutilizar datos del mismo periodo (cambio rápido entre secciones).
    if (!force && state.cacheKey === key && state.data && !state.data.error) {
      renderAll();
      return state.data;
    }
    if (!force && state.inflightKey === key && state.inflightPromise) {
      await state.inflightPromise;
      renderAll();
      return state.data;
    }

    state.inflightKey = key;
    state.inflightPromise = (async () => {
      try {
        const res = await fetch(
          `/api/ventas/leads?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
          { credentials: 'same-origin' },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        state.data = data;
        state.cacheKey = key;
      } catch (err) {
        console.warn('[Leads]', err);
        state.cacheKey = null;
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
      } finally {
        if (state.inflightKey === key) {
          state.inflightKey = null;
          state.inflightPromise = null;
        }
      }
      return state.data;
    })();

    await state.inflightPromise;
    renderAll();
    return state.data;
  }

  function hasCache(fechaInicio, fechaFin) {
    return state.cacheKey === `${fechaInicio}|${fechaFin}` && state.data && !state.data.error;
  }

  window.LeadsVentas = {
    init,
    load,
    hasCache,
    getCampanasConversion() {
      return state.data?.campanasConversion || null;
    },
  };
})();
