/**
 * Sección Leads en Ventas — seguimiento de conversión oportunidad → venta.
 * Cohorte por fecha_entrada; compra = VIN en ciclo CRM del mismo ID CRM.
 * KPIs dinámicos: drawer con filtros + listado (mismo patrón que Ventas/Inventario).
 */
(function () {
  let state = {
    data: null,
    prospeccion: null,
    fechaInicio: null,
    fechaFin: null,
    search: '',
    openKpi: null,
    groupView: 'canal',
    cacheKey: null,
    inflightKey: null,
    inflightPromise: null,
    /** Detalle completo por KPI (servidor), independiente del preview truncado. */
    kpiDetalleCache: {},
    kpiDetalleMeta: {},
    supervivencia: null,
    /** Pestaña visible dentro de Tiempo a compra. */
    superTab: 'hitos',
  };
  let superChart = null;

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
    if (fromCaducar) {
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
    const fromAlerta = (state.data?.alertasConversionCompras?.items || []).find((r) => String(r.idCrm || '').trim() === id);
    if (!fromAlerta) return null;
    return {
      idCrm: fromAlerta.idCrm,
      nombre: fromAlerta.nombreLead,
      ejecutivo: fromAlerta.ejecutivo,
      campana: fromAlerta.campana,
      fechaEntrada: fromAlerta.fechaEntrada,
      fechaCompra: fromAlerta.fechaCompra,
      vin: fromAlerta.vin,
      severidad: fromAlerta.severidad,
      etapa: 'compra',
      conCompra: true,
      contactado: true,
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
        title: 'Leads únicos',
        hint: `${num(s.leadsUnicos ?? s.leads)} únicos · ${num(s.leadsDuplicados)} duplicados · ${num(s.leadsTotales || ((s.leadsUnicos ?? s.leads) + (s.leadsDuplicados || 0)))} totales · ${num(s.oportunidades)} IDs CRM`,
        icon: 'diversity_3',
        filter: () => true,
      },
      leadsUnicos: {
        title: 'Leads únicos',
        hint: `${num(s.leadsUnicos ?? s.leads)} sin Resultado=DUPLICADO (col. AB) · base del embudo`,
        icon: 'person',
        filter: () => true,
      },
      leadsDuplicados: {
        title: 'Duplicados',
        hint: `${num(s.leadsDuplicados)} marcados como DUPLICADO · ${pct(s.pctDuplicados)} del bruto · no entran al embudo`,
        icon: 'content_copy',
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
        title: 'Compras',
        hint: `${num(s.compras)} con VIN ≤90d desde fecha_entrada · conversión ${pct(s.conversionCompraPct)} (cuenta en el mes de origen)`,
        icon: 'sell',
        filter: (r) => Boolean(r.conCompra),
      },
      seguimientoSinCompra: {
        title: 'En seguimiento',
        hint: `${num(s.seguimientoSinCompra)} vivos ≤${num(s.seguimientoVidaDias || 90)}d · seguimiento / prueba de manejo / solicitud de crédito · sin compra`,
        icon: 'track_changes',
        filter: (r) => !r.conCompra && (
          /SEGUIMIENTO/i.test(String(r.resultado || ''))
          || Boolean(r.conPruebaManejo)
          || Boolean(r.conSolicitud)
        ),
      },
      sinCompra: {
        title: 'Sin compra',
        hint: `${num(s.sinCompra)} oportunidades perdidas / descartadas / desistidas de la cohorte`,
        icon: 'hourglass_empty',
        filter: (r) => /DESCART|DESIST|PERDIDO|NO CONTESTA|NO EXISTE|EQUIVOCADO|FUERA AREA|NO PIDIO|CUELGA/i.test(String(r.resultado || '')),
      },
      aunPuedenConvertir: {
        title: 'Aún pueden convertir',
        hint: `${num(s.aunPuedenConvertir)} del periodo, al ${formatDate(s.vidaRefFecha)} · les quedan ${num(s.vidaDias || 90)} días o menos y no hay compra que cuente`,
        icon: 'schedule',
        filter: (r) => !r.conCompra && (diasRestantesLead(r.fechaEntrada) ?? -1) >= 0,
      },
      yaNoCuentan: {
        title: 'Ya no cuentan',
        hint: `${num(s.yaNoCuentan)} del periodo pasaron ${num(s.vidaDias || 90)} días sin compra dentro de ese plazo`,
        icon: 'event_busy',
        filter: (r) => !r.conCompra && (diasRestantesLead(r.fechaEntrada) ?? 0) < 0,
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

  const VIDA_LEAD_DIAS = 90;

  function diasVividosLead(fechaEntrada) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaEntrada || ''));
    if (!m) return null;
    const entrada = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const ahora = new Date();
    const hoy = Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    return Math.round((hoy - entrada) / 86400000);
  }

  function diasRestantesLead(fechaEntrada) {
    const vividos = diasVividosLead(fechaEntrada);
    if (vividos == null) return null;
    return VIDA_LEAD_DIAS - vividos;
  }

  function ordenarPorVida(rows, kpiKey) {
    if (kpiKey !== 'aunPuedenConvertir') return rows;
    return rows.slice().sort((a, b) => String(a.fechaEntrada || '').localeCompare(String(b.fechaEntrada || '')));
  }

  function vidaBadge(fechaEntrada) {
    if (state.openKpi === 'aunPuedenConvertir') {
      const d = diasRestantesLead(fechaEntrada);
      if (d == null) return '';
      const cls = d <= 14 ? 'ld-badge--warn' : 'ld-badge--ok';
      return `<span class="ld-badge ${cls}">${num(d)} d</span>`;
    }
    if (state.openKpi === 'yaNoCuentan') {
      return '<span class="ld-badge">ya no cuenta</span>';
    }
    return '';
  }

  function rowsForKpi(key) {
    const meta = kpiMeta(key);
    const cached = state.kpiDetalleCache?.[key];
    if (Array.isArray(cached) && cached.length) return ordenarPorVida(cached, key);
    const embedded = state.data?.detallePorKpi?.[key];
    if (Array.isArray(embedded)) return ordenarPorVida(embedded, key);
    let rows = detalle().filter(meta.filter);
    if (meta.highlight === 'compras') rows = rows.filter((r) => r.conCompra);
    return ordenarPorVida(rows, key);
  }

  async function fetchKpiDetalle(kpiKey) {
    const fi = state.fechaInicio;
    const ff = state.fechaFin;
    if (!fi || !ff || !kpiKey) return [];

    // 1) Payload embebido del dashboard (compras/citas/cotizados ya vienen completos)
    const embedded = state.data?.detallePorKpi?.[kpiKey];
    if (Array.isArray(embedded)) {
      state.kpiDetalleCache[kpiKey] = embedded;
      state.kpiDetalleMeta[kpiKey] = {
        total: embedded.length,
        returned: embedded.length,
        limited: false,
      };
      return embedded;
    }

    if (Object.prototype.hasOwnProperty.call(state.kpiDetalleCache, kpiKey)) {
      return state.kpiDetalleCache[kpiKey];
    }

    const qs = new URLSearchParams({
      fechaInicio: fi,
      fechaFin: ff,
      kpi: kpiKey,
      limit: '10000',
    });

    // 2) /detalle  3) /leads?kpi=  (misma forma de respuesta)
    const urls = [
      `/api/ventas/leads/detalle?${qs}`,
      `/api/ventas/leads?${qs}`,
    ];
    let lastErr = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          lastErr = new Error(data.error || res.statusText || `HTTP ${res.status}`);
          continue;
        }

        // Dashboard completo (servidor viejo que ignora ?kpi=)
        if (data.summary && Array.isArray(data.detallePorKpi?.[kpiKey])) {
          const fromDash = data.detallePorKpi[kpiKey];
          state.kpiDetalleCache[kpiKey] = fromDash;
          state.kpiDetalleMeta[kpiKey] = {
            total: fromDash.length,
            returned: fromDash.length,
            limited: false,
          };
          return fromDash;
        }
        if (data.summary && !data.filtros?.kpi) {
          lastErr = new Error('El servidor devolvió el dashboard, no el detalle del KPI');
          continue;
        }

        const rows = ordenarPorVida(Array.isArray(data.detalle) ? data.detalle : [], kpiKey);
        state.kpiDetalleCache[kpiKey] = rows;
        state.kpiDetalleMeta[kpiKey] = {
          total: Number(data.total != null ? data.total : rows.length),
          returned: Number(data.returned != null ? data.returned : rows.length),
          limited: Boolean(data.limited),
        };
        return rows;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('No se pudo cargar el detalle del KPI');
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

  function renderProspeccion() {
    const grid = document.getElementById('ldPproGrid');
    const body = document.getElementById('ldPproEjecutivos');
    const nota = document.getElementById('ldPproNota');
    const pack = state.prospeccion;
    if (!grid || !body) return;
    if (pack?.loading) {
      grid.innerHTML = '<p class="section-subtitle">Calculando el proceso de prospección y la cartera activa…</p>';
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Calculando…</td></tr>';
      return;
    }
    if (!pack || pack.error) {
      grid.innerHTML = `<p class="section-subtitle">${escapeHtml(pack?.error || 'Sin indicadores de prospección.')}</p>`;
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Sin cartera.</td></tr>';
      body.closest('.table-scroll')?.classList.add('hidden');
      return;
    }
    const todos = pack.indicadores || [];
    const repetidos = new Set(['P-PRO-4']);
    const cards = todos.filter((item) => item.disponible && item.valor != null && !repetidos.has(item.id));
    if (nota) {
      nota.textContent = pack.cartera?.ultimoEstatus
        ? `Cómo se atiende al lead: intento de contacto, citas y cartera (último movimiento de cartera: ${formatDate(pack.cartera.ultimoEstatus)})`
        : 'Cómo se atiende al lead: intento de contacto, citas y cartera';
    }
    // P-PRO-1A cuenta cualquier resultado capturado (incluye "no contesta"); con el nombre del
    // catálogo parecía contradecir a Contactados del bloque 1, que solo cuenta contacto = SI.
    const NOMBRE_PANTALLA = { 'P-PRO-1A': 'Con intento de contacto' };
    const SUFIJO_NUMS = { 'P-PRO-1A': ' con resultado capturado' };
    grid.innerHTML = cards.map((item) => {
      const value = pct(item.valor);
      // Azul en todos: la meta se lee en el texto ("meta 60 % ✓"), sin un tercer color.
      const cumple = item.meta != null && item.valor >= item.meta;
      const tone = cumple ? 'cumple' : 'blue';
      const nums = item.numerador != null && item.denominador != null
        ? `${num(item.numerador)} de ${num(item.denominador)}${SUFIJO_NUMS[item.id] || ''}`
        : (item.denominador != null ? `Universo ${num(item.denominador)}` : '');
      const meta = item.meta != null ? `meta ${pct(item.meta)}${cumple ? ' ✓' : ''}` : '';
      return `
        <article class="ld-ppro ld-ppro--${tone}" title="${escapeHtml([item.componente || item.nombre, item.detalle].filter(Boolean).join(': '))}">
          <span class="ld-ppro__nombre">${escapeHtml(NOMBRE_PANTALLA[item.id] || item.componente || item.nombre)}</span>
          <strong class="ld-ppro__valor">${value}</strong>
          <span class="ld-ppro__sub">${escapeHtml([nums, meta].filter(Boolean).join(' · '))}</span>
        </article>`;
    }).join('');
    const rows = pack.cartera?.porEjecutivo || [];
    // Sin cartera en el CRM la tabla no aporta: se oculta en vez de mostrarla vacía.
    const tablaWrap = body.closest('.table-scroll');
    if (tablaWrap) tablaWrap.classList.toggle('hidden', !rows.length);
    body.innerHTML = rows.length
      ? rows.map((row) => {
        const q = new URLSearchParams({ vendedor: row.ejecutivo });
        if (state.fechaFin) q.set('fechaFin', state.fechaFin);
        return `
          <tr>
            <td>${escapeHtml(row.ejecutivo)}</td>
            <td class="cell-num">${num(row.cartera)}</td>
            <td class="cell-num">${num(row.vigentes)}</td>
            <td class="cell-num">${row.coberturaPct == null ? '—' : pct(row.coberturaPct)}</td>
            <td><a href="/seguimiento.html?${q.toString()}">Expediente del ejecutivo</a></td>
          </tr>`;
      }).join('')
      : '<tr class="empty-row"><td colspan="5">Sin cartera activa en el CRM.</td></tr>';
  }

  function pctDe(a, b) {
    const x = Number(a || 0);
    const y = Number(b || 0);
    return y > 0 ? (x / y) * 100 : null;
  }

  /**
   * Embudo del periodo en una sola fila: cada paso muestra cuántos llegan y qué % pasó
   * desde el paso anterior. Duplicados, cartera viva y perdidos van aparte porque no
   * son pasos del embudo (los duplicados no entran; la cartera viva usa otra ventana).
   */
  /**
   * Con el periodo todavía abierto (o recién cerrado) la conversión sale baja porque muchas
   * compras llegan semanas después de la entrada. Se avisa con el día en que ocurre la mitad
   * de las compras, que sale del bloque Tiempo a compra.
   */
  function notaPeriodoAbierto() {
    const t50 = Number(state.supervivencia?.tiempo?.t50);
    if (!state.fechaFin || !Number.isFinite(t50) || t50 <= 0) return '';
    const hoy = new Date();
    const fin = new Date(`${String(state.fechaFin).slice(0, 10)}T23:59:59`);
    const diasDesdeFin = Math.floor((hoy - fin) / 86400000);
    if (diasDesdeFin > t50) return '';
    return `<p class="ld-resultado__aviso">Periodo reciente: la mitad de las compras llega después del día ${num(t50)} desde la entrada, así que esta conversión todavía va a subir.</p>`;
  }

  function renderKpis() {
    if (!els.kpiRoot) return;
    const s = summary();
    const leads = Number(s.leadsUnicos ?? s.leads ?? 0);
    const pasos = [
      { key: 'leadsUnicos', label: 'Leads', value: leads, prev: null },
      { key: 'contactados', label: 'Contactados', value: s.contactados, prev: leads, de: 'de los leads' },
      { key: 'citas', label: 'Citas', value: s.citas, prev: s.contactados, de: 'de contactados' },
      { key: 'cotizados', label: 'Cotizados', value: s.cotizados, prev: s.citas, de: 'de las citas' },
      { key: 'compras', label: 'Compras', value: s.compras, prev: s.cotizados, de: 'de cotizados' },
    ];
    const max = Math.max(leads, 1);
    const paso = (p) => {
      const ratio = p.prev == null ? null : pctDe(p.value, p.prev);
      const width = Math.max(4, (Number(p.value || 0) / max) * 100);
      const active = state.openKpi === p.key ? ' is-active' : '';
      return `
        <button type="button" class="ld-embudo__paso${active}" data-ld-kpi="${p.key}" title="Ver los leads de este paso">
          <span class="ld-embudo__label">${escapeHtml(p.label)}</span>
          <strong class="ld-embudo__valor">${num(p.value)}</strong>
          <span class="ld-embudo__barra" aria-hidden="true"><span style="width:${width}%"></span></span>
          <span class="ld-embudo__tasa">${ratio == null ? `${pct(100)} del periodo` : `${pct(ratio)} ${p.de}`}</span>
        </button>`;
    };
    const vida = num(s.seguimientoVidaDias || 90);
    const ventana = s.seguimientoVentanaDesde && s.seguimientoVentanaHasta
      ? `${formatDate(s.seguimientoVentanaDesde)} – ${formatDate(s.seguimientoVentanaHasta)}`
      : `últimos ${vida} días`;
    const registros = num(s.leadsTotales || (leads + Number(s.leadsDuplicados || 0)));
    const chip = (key, label, value, sub) => {
      const active = state.openKpi === key ? ' is-active' : '';
      return `<button type="button" class="ld-chip${active}" data-ld-kpi="${key}" title="Ver estos leads">
          <strong>${value}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(sub)}</small>
        </button>`;
    };
    els.kpiRoot.innerHTML = `
      <div class="section-panel dashboard-section ld-resultado">
        <div class="ld-resultado__titular">
          <span class="ld-resultado__kicker">Conversión a compra</span>
          <strong class="ld-resultado__pct">${pct(s.conversionCompraPct)}</strong>
          <p class="ld-resultado__frase"><strong>${num(s.compras)}</strong> compras de <strong>${num(leads)}</strong> leads del periodo</p>
          <p class="ld-resultado__nota">Cita → compra ${pct(s.conversionCitaACompraPct)} · ${num(s.leadsDuplicados)} duplicados fuera (${registros} registros)</p>
          ${notaPeriodoAbierto()}
        </div>
        <div class="ld-resultado__embudo">
          <div class="ld-embudo">${pasos.map(paso).join('')}</div>
          <div class="ld-chips">
            ${chip('seguimientoSinCompra', 'en seguimiento', num(s.seguimientoSinCompra), `vivos sin compra · entraron del ${ventana}`)}
            ${chip('sinCompra', 'perdidos', num(s.sinCompra), `${pct(pctDe(s.sinCompra, leads))} de los leads del periodo`)}
          </div>
          <div class="ld-vida">
            <p class="ld-vida__nota">Vida de 90 días, al ${escapeHtml(formatDate(s.vidaRefFecha || new Date().toISOString().slice(0, 10)))}. Del periodo, quién todavía puede comprar y quién ya no entra al One Pager.</p>
            <div class="ld-chips">
              <button type="button" class="ld-chip ld-chip--abierta${state.openKpi === 'aunPuedenConvertir' ? ' is-active' : ''}" data-ld-kpi="aunPuedenConvertir" title="Ver los leads que todavía pueden convertir">
                <strong>${num(s.aunPuedenConvertir)}</strong><span>aún pueden convertir</span><small>les quedan 90 días o menos</small>
              </button>
              <button type="button" class="ld-chip ld-chip--cerrada${state.openKpi === 'yaNoCuentan' ? ' is-active' : ''}" data-ld-kpi="yaNoCuentan" title="Ver los leads que ya no cuentan como conversión">
                <strong>${num(s.yaNoCuentan)}</strong><span>ya no cuentan</span><small>pasaron 90 días sin compra</small>
              </button>
            </div>
          </div>
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

  function fuenteLabel(raw) {
    const c = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    const t = String(raw || '').trim();
    if (!t || t === '(sin dato)') return 'Sin fuente';
    const ACENTOS = { TELEFONO: 'Teléfono', LLAMADA: 'Llamada', REDES: 'Redes', VISITAAPISO: 'Visita a piso' };
    if (ACENTOS[c]) return ACENTOS[c];
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  const RESULTADO_ACENTOS = { DESISTIO: 'Desistió', 'NO CONTESTO': 'No contestó', CANCELO: 'Canceló' };
  function resultadoLabel(r) {
    const t = String(r?.resultado || '').trim().toUpperCase();
    if (!t) return 'Sin resultado';
    return RESULTADO_ACENTOS[t] || (t.charAt(0) + t.slice(1).toLowerCase());
  }

  function groupRows() {
    const key = state.groupView;
    if (key === 'fuente') {
      return (state.data?.porFuente || []).map((r) => ({ ...r, grupo: fuenteLabel(r.grupo) }))
        .sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0));
    }
    if (key === 'fuerza') {
      return (state.data?.porFuerzaVentas?.filas || []).filter((r) => Number(r.leads || 0) > 0 || Number(r.compras || 0) > 0);
    }
    if (key === 'vehiculo') {
      return (state.data?.conversionPorVehiculo || [])
        .filter((r) => Number(r.total || 0) > 0)
        .map((r) => ({ grupo: r.vehiculo, leads: r.total, compras: r.convertidos, conversionPct: r.conversionPct }));
    }
    if (key === 'ejecutivo') return state.data?.porEjecutivo || [];
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
          `${rows.length} fuerzas de ventas · ${num(tot.leads)} oportunidades · conv. ${pct(tot.conversionPct)}`;
      } else {
        els.fuerzaResumen.textContent = periodLeads === 0
          ? 'Sin oportunidades en el periodo seleccionado'
          : 'Leads del periodo por fuerza de ventas (columna O de la hoja STREGA)';
      }
    }

    if (!rows.length) {
      els.fuerzaBody.innerHTML = periodLeads === 0
        ? '<tr class="empty-row"><td colspan="7">Sin leads en este periodo. Elija un rango con cobertura CRM.</td></tr>'
        : '<tr class="empty-row"><td colspan="7">Sin leads con fuerza de ventas en el periodo.</td></tr>';
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

  const GROUP_META = {
    fuente: 'Por fuente del lead (columna tipo de la hoja STREGA).',
    canal: 'Por canal de origen del lead.',
    fuerza: 'Por fuerza de ventas: Matriz piso, Foráneo digital, Cholula, Zacatelco, Seminuevos, Flotillas y SuAuto (solo las que traen leads).',
    ejecutivo: 'Por ejecutivo asignado.',
    vehiculo: 'Por vehículo de interés (este corte solo trae leads y compras).',
    sucursal: 'Por sucursal.',
  };

  function renderOrigen() {
    const el = document.getElementById('ldOrigen');
    if (!el) return;
    const periodLeads = Number(summary().leads || 0);
    const rows = (state.data?.porFuente || []).filter((r) => Number(r.leads || 0) > 0)
      .map((r) => ({ ...r, grupo: fuenteLabel(r.grupo) }))
      .sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0));
    if (!periodLeads || !rows.length) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const total = rows.reduce((acc, r) => acc + Number(r.leads || 0), 0);
    const tonos = ['#1e3fd8', '#2d5bff', '#6b8cff', '#a3b6ff', '#cdd8ff', '#e8edff'];
    el.innerHTML = `
      <div class="ld-origen__barra" role="img" aria-label="Leads por fuente">
        ${rows.map((r, i) => `<span style="width:${pctDe(r.leads, total)}%;background:${tonos[i % tonos.length]}" title="${escapeHtml(r.grupo)}: ${num(r.leads)}"></span>`).join('')}
      </div>
      <ul class="ld-origen__lista">
        ${rows.map((r, i) => `
          <li>
            <span class="ld-origen__punto" style="background:${tonos[i % tonos.length]}"></span>
            <span class="ld-origen__nombre">${escapeHtml(r.grupo)}</span>
            <strong>${num(r.leads)}</strong>
            <span class="ld-origen__pct">${pct(pctDe(r.leads, total))}</span>
            <span class="ld-origen__conv">${num(r.compras)} ${Number(r.compras) === 1 ? "compra" : "compras"} · ${pct(r.conversionPct)} conv.</span>
          </li>`).join('')}
      </ul>`;
  }

  function syncGroupTabs() {
    if (!els.groupTabs) return;
    els.groupTabs.querySelectorAll('[data-ld-group]').forEach((b) => {
      const on = b.getAttribute('data-ld-group') === state.groupView;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderGroups() {
    if (!els.groupsBody) return;
    syncGroupTabs();
    const periodLeads = Number(summary().leads || 0);
    const rows = periodLeads === 0 ? [] : groupRows();
    const meta = document.getElementById('ldGroupMeta');
    const groupMeta = state.groupView === 'fuerza' && document.documentElement.dataset.alcanceSucursal === 'cholula'
      ? 'Solo los leads de la fuerza de ventas de Cholula.'
      : (GROUP_META[state.groupView] || '');
    if (meta) meta.textContent = `${groupMeta} Suman los ${num(periodLeads)} leads del periodo.`;
    const foot = document.getElementById('ldGroupsFoot');
    const total = rows.reduce((acc, r) => acc + Number(r.leads || 0), 0);
    const cell = (v) => (v == null ? '<span class="cell-muted">—</span>' : num(v));
    els.groupsBody.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.grupo)}</td>
          <td class="cell-num">${num(r.leads)}</td>
          <td class="ld-col-mix"><span class="ld-mix"><span class="ld-mix__bar"><span style="width:${Math.max(2, pctDe(r.leads, total) || 0)}%"></span></span><span class="ld-mix__txt">${pct(pctDe(r.leads, total))}</span></span></td>
          <td class="cell-num">${cell(r.contactados)}</td>
          <td class="cell-num">${cell(r.citas)}</td>
          <td class="cell-num">${cell(r.cotizados)}</td>
          <td class="cell-num">${num(r.compras)}</td>
          <td class="cell-num">${pct(r.conversionPct)}</td>
        </tr>`).join('')
      : `<tr class="empty-row"><td colspan="8">${
        periodLeads === 0
          ? 'Sin leads en este periodo. Elija un rango con cobertura CRM.'
          : 'Sin agrupaciones en el periodo.'
      }</td></tr>`;
    if (foot) {
      const compras = rows.reduce((acc, r) => acc + Number(r.compras || 0), 0);
      // Total de una etapa solo si todas las filas la traen; si alguna viene sin dato, se deja vacío.
      const totEtapa = (k) => (rows.every((r) => r[k] != null)
        ? num(rows.reduce((acc, r) => acc + Number(r[k] || 0), 0))
        : '');
      foot.innerHTML = rows.length
        ? `<tr><th>Total</th><th class="cell-num">${num(total)}</th><th class="ld-col-mix">100%</th><th class="cell-num">${totEtapa('contactados')}</th><th class="cell-num">${totEtapa('citas')}</th><th class="cell-num">${totEtapa('cotizados')}</th><th class="cell-num">${num(compras)}</th><th class="cell-num">${pct(pctDe(compras, total))}</th></tr>`
        : '';
    }
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

  // Conv. 180 d: referencia de cuánto convierte el lead después de su vida útil (90 d).
  // Si parte de los leads aún no cumple 180 días, la cifra puede subir: se marca con «*».
  function conv180Celda(r) {
    if (r?.conversion180Pct == null) return '—';
    const maduros = Number(r.pctMaduros180 ?? 100);
    if (maduros >= 100) return pct(r.conversion180Pct);
    const titulo = `${pct(100 - maduros)} de los leads aún no cumple 180 días; la cifra puede subir`;
    return `${pct(r.conversion180Pct)}<span class="ld-parcial" title="${escapeHtml(titulo)}">*</span>`;
  }

  function renderCampanaTipoTable(bodyEl, footEl, rows, tot) {
    if (!bodyEl) return;
    const periodLeads = Number(summary().leads || 0);
    const visible = (rows || []).filter((r) => Number(r.total || 0) > 0);
    if (!visible.length) {
      bodyEl.innerHTML = `<tr class="empty-row"><td colspan="5">${
        periodLeads === 0 ? 'Sin campañas en el año de la planta (octubre a septiembre).' : 'Sin campañas con volumen en el año de la planta.'
      }</td></tr>`;
      if (footEl) footEl.innerHTML = '';
      return;
    }
    bodyEl.innerHTML = visible.map((r) => `
      <tr>
        <td><strong>${escapeHtml(r.campana)}</strong></td>
        <td class="cell-num">${num(r.total)}</td>
        <td class="cell-num">${num(r.vendidos)}</td>
        <td class="cell-num">${pct(r.conversionPct)}</td>
        <td class="cell-num ld-ref">${conv180Celda(r)}</td>
      </tr>
    `).join('');
    if (footEl && tot) {
      footEl.innerHTML = `
        <tr>
          <th>Total</th>
          <th class="cell-num">${num(tot.total)}</th>
          <th class="cell-num">${num(tot.vendidos)}</th>
          <th class="cell-num">${pct(tot.conversionPct)}</th>
          <th class="cell-num ld-ref">${conv180Celda(tot)}</th>
        </tr>`;
    }
  }

  let convMesChart = null;

  const MES_LABELS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function mesAunPuedeConvertir(mesKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(mesKey || ''));
    if (!m) return false;
    const cierreMes = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
    const vida = new Date(cierreMes.getTime() + 90 * 24 * 60 * 60 * 1000);
    return vida.toISOString().slice(0, 10) >= new Date().toISOString().slice(0, 10);
  }

  function mesLabelCorto(mesKey) {
    const m = String(mesKey || '');
    const mm = Number(m.slice(5, 7));
    if (mm >= 1 && mm <= 12) return MES_LABELS_ES[mm - 1];
    return m || '—';
  }

  function destroyConvMesChart() {
    if (convMesChart) {
      try { convMesChart.destroy(); } catch { /* ignore */ }
      convMesChart = null;
    }
  }

  function renderConvMesChart(rows) {
    const canvas = els.convMesChart || document.getElementById('ldConvMesChart');
    if (!canvas) return;
    destroyConvMesChart();
    if (typeof Chart === 'undefined') return;

    const labels = rows.map((r) => mesLabelCorto(r.mes));
    const leads = rows.map((r) => Number(r.total || 0));
    const convertidos = rows.map((r) => Number(r.convertidos || 0));
    const convPct = rows.map((r) => Number(r.conversionPct || 0));

    // Un solo eje: con pocas compras al mes, una línea de % en un segundo eje sube y baja
    // de 0 a 20 % y parece una tendencia que no existe.
    convMesChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Leads de campañas reactivas',
            data: leads,
            backgroundColor: 'rgba(107, 140, 255, 0.35)',
            borderColor: '#6b8cff',
            borderWidth: 1,
            borderRadius: 5,
            maxBarThickness: 28,
          },
          {
            label: 'Compras',
            data: convertidos,
            backgroundColor: '#1e3fd8',
            borderRadius: 5,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = Number(ctx.parsed.y);
                return `${ctx.dataset.label}: ${Number.isFinite(v) ? v.toLocaleString('es-MX') : '—'}`;
              },
              afterBody(items) {
                const i = items?.[0]?.dataIndex;
                return i == null ? '' : `Conversión: ${convPct[i].toFixed(1)} %`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, font: { size: 11 } },
            grid: { color: 'rgba(148, 163, 184, 0.25)' },
          },
        },
      },
    });
  }

  function renderOnePagerKpis(rootEl, tot, label) {
    if (!rootEl) return;
    const t = tot || { total: 0, vendidos: 0, conversionPct: 0 };
    rootEl.innerHTML = `
      ${kpiCard(`op-${label}-leads`, 'Total leads', num(t.total), label, 'blue', 'campaign')}
      ${kpiCard(`op-${label}-conv`, 'Convertidos', num(t.vendidos), 'compra ≤90d desde entrada', 'green', 'sell')}
      ${kpiCard(`op-${label}-pct`, '% Conversión', pct(t.conversionPct), 'convertidos / leads', 'violet', 'percent')}
    `;
  }

  function renderOnePagerLeads() {
    const reactivas = state.data?.campanasReactivas || (state.data?.campanasConversion || []).filter((r) => (r.tipo || 'reactiva') === 'reactiva');
    const proactivas = state.data?.campanasProactivas || (state.data?.campanasConversion || []).filter((r) => r.tipo === 'proactiva');
    const totR = state.data?.campanasReactivasTotales || null;
    const totP = state.data?.campanasProactivasTotales || null;
    const porMes = state.data?.conversionPorMes || [];
    const porVeh = state.data?.conversionPorVehiculo || [];
    const periodLeads = Number(summary().leads || 0);

    // Sin leads proactivos la tabla de proactivas quedaría vacía: se oculta y la de
    // reactivas ocupa el ancho completo.
    const hayProactivas = Number(totP?.total || 0) > 0;
    document.getElementById('ldProactivaSection')?.classList.toggle('hidden', !hayProactivas);
    document.getElementById('ldCampGrid')?.classList.toggle('ld-leads-pair-grid--una', !hayProactivas);
    renderCampanaTipoTable(els.reactivaCampBody, els.reactivaCampFoot, reactivas, totR);
    renderCampanaTipoTable(els.proactivaCampBody, els.proactivaCampFoot, proactivas, totP);

    const ventana = state.data?.conversionPorMesMeta || {};
    const etiqueta = ventana.etiqueta || 'octubre a septiembre';
    if (els.onePagerResumen) {
      const nCamp = reactivas.filter((r) => Number(r.total || 0) > 0).length + proactivas.filter((r) => Number(r.total || 0) > 0).length;
      els.onePagerResumen.textContent = nCamp
        ? `${num(nCamp)} campañas en ${etiqueta} · compra dentro de 90 días desde la entrada · 180 d solo como referencia · no sigue el mes consultado`
        : `Sin campañas en ${etiqueta}`;
    }

    if (els.convMesBody) {
      const meta = els.convMesMeta || document.getElementById('ldConvMesMeta');
      if (meta) meta.textContent = `Reactivas y proactivas · ${etiqueta} · un mes sigue abierto 90 días después de cerrar, así que los últimos meses aún pueden sumar compras`;
      const chipAnio = document.getElementById('ldVentanaAnio');
      if (chipAnio) chipAnio.textContent = etiqueta;

      // Meses que aún no empiezan: fuera de la tabla y sin punto en la gráfica (no son 0 %).
      const mesHoy = new Date().toISOString().slice(0, 7);
      const rows = porMes.filter((r) => String(r.mes || '') <= mesHoy);
      els.convMesBody.innerHTML = rows.length
        ? rows.map((r) => `
          <tr>
            <td><strong>${escapeHtml(mesLabelCorto(r.mes))} ${escapeHtml(String(r.mes || '').slice(0, 4))}</strong>${mesAunPuedeConvertir(r.mes) ? ' <span class="cell-muted">puede subir</span>' : ''}</td>
            <td class="cell-num">${num(r.total)}</td>
            <td class="cell-num">${num(r.convertidos)}</td>
            <td class="cell-num">${pct(r.conversionPct)}</td>
            <td class="cell-num">${num(r.proactivas)}</td>
            <td class="cell-num">${num(r.proactivasConvertidos)}</td>
            <td class="cell-num">${pct(r.proactivasPct)}</td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="7">Sin datos mensuales.</td></tr>`;
      renderConvMesChart(rows);
    } else {
      destroyConvMesChart();
    }

    if (els.convVehiculoBody) {
      const rows = periodLeads === 0 ? [] : porVeh.filter((r) => Number(r.total || 0) > 0).slice(0, 25);
      els.convVehiculoBody.innerHTML = rows.length
        ? rows.map((r) => `
          <tr>
            <td><strong>${escapeHtml(r.vehiculo)}</strong></td>
            <td class="cell-num">${num(r.total)}</td>
            <td class="cell-num">${num(r.convertidos)}</td>
            <td class="cell-num">${pct(r.conversionPct)}</td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="4">${periodLeads === 0 ? 'Sin leads en este periodo.' : 'Sin datos por vehículo.'}</td></tr>`;
    }
  }

  function renderAlertasConversion() {
    const body = els.alertasConvBody || document.getElementById('ldAlertasConversionBody');
    const meta = els.alertasConvMeta || document.getElementById('ldAlertasConversionMeta');
    if (!body) return;

    const block = state.data?.alertasConversionCompras || null;
    const items = block?.items || [];
    const periodLeads = Number(summary().leads || 0);

    if (meta) {
      if (block && periodLeads > 0) {
        const crit = items.filter((r) => r.severidad === 'critical').length;
        meta.textContent = `${num(block.total)} alertas · mostrando ${num(block.mostrados)}${crit ? ` · ${num(crit)} críticas` : ''}`;
      } else {
        meta.textContent = '';
      }
    }

    if (!periodLeads || !items.length) {
      body.innerHTML = `<p class="section-subtitle" style="margin:0">${
        periodLeads === 0 ? 'Consulte un periodo.' : 'Sin alertas de conversión.'
      }</p>`;
      return;
    }

    body.innerHTML = items.map((r) => {
      const sev = r.severidad === 'critical' ? 'critical' : 'warning';
      const sevLabel = sev === 'critical' ? 'Crítico' : 'Alerta';
      const id = String(r.idCrm || '').trim();
      return `
        <article class="ld-caducar-item ld-caducar-item--${sev}${id ? ' ld-caducar-item--clickable' : ''}"
          ${id ? `data-ld-prospect-id="${escapeHtml(id)}" role="button" tabindex="0" title="Ver perfil del prospecto"` : ''}>
          <div class="ld-caducar-item__top">
            <strong class="ld-caducar-item__name">${escapeHtml(r.nombreLead || '—')}</strong>
            <span class="ld-caducar-item__days">${escapeHtml(formatDate(r.fechaCompra))}</span>
          </div>
          <p class="ld-caducar-item__campana">${escapeHtml(r.nombreCompra || '—')}</p>
          <div class="ld-caducar-item__meta">
            <span class="ld-badge ld-badge--warn">${sevLabel}</span>
            <span>${escapeHtml(r.campana || 'Sin campaña')}</span>
            <span>${escapeHtml(r.vin || '—')}</span>
            <span>ID ${escapeHtml(id || '—')}</span>
          </div>
        </article>`;
    }).join('');
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
          <td>${etapaBadge(r.etapa, r.conCompra)}${vidaBadge(r.fechaEntrada)}</td>
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
      'Interes', 'Etapa', 'Dias_restantes', 'VIN', 'Resultado', 'ID_CRM', 'Cita', 'Contactado', 'Compra',
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
      diasRestantesLead(r.fechaEntrada) ?? '',
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
      if (dim === 'resultado') return resultadoLabel(r) === value;
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

      // Los motivos (desistió, descartado, no existe…) van primero al abrir "perdidos".
      const porResultado = countByField(rows, resultadoLabel);
      const esPerdidos = currentMeta.kpi === 'sinCompra';
      const bloqueResultado = block(esPerdidos ? 'Motivo de pérdida' : 'Por resultado', 'resultado', porResultado);

      summaryEl.innerHTML = `
        ${esPerdidos ? bloqueResultado : ''}
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
        ${esPerdidos ? '' : bloqueResultado}
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

      if (statusEl) {
        const km = state.kpiDetalleMeta?.[currentMeta.kpi] || {};
        const base = `${filtered.length} lead${filtered.length === 1 ? '' : 's'}`;
        statusEl.textContent = km.limited
          ? `${base} (muestra de ${km.returned}/${km.total})`
          : (km.total != null && km.total !== filtered.length && !q && !activeFilter
            ? `${base} · total KPI ${km.total}`
            : base);
      }
      if (metaEl) {
        const km = state.kpiDetalleMeta?.[currentMeta.kpi] || {};
        if (filtered.length !== sourceRows.length) {
          metaEl.textContent = `${filtered.length} de ${sourceRows.length}`;
        } else if (km.total != null) {
          metaEl.textContent = km.limited
            ? `${sourceRows.length} de ${km.total} (límite)`
            : `${km.total} registros`;
        } else {
          metaEl.textContent = `${sourceRows.length} registros`;
        }
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
              ${vidaBadge(r.fechaEntrada)}
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

    async function open(kpiKey, card) {
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
      if (statusEl) statusEl.textContent = 'Cargando…';
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__empty">
            <span class="material-symbols-outlined">progress_activity</span>
            <p>Cargando detalle del KPI…</p>
          </div>`;
      }

      placeNearKpi(resolvedCard);
      setExpanded(true);
      panel.classList.add('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-orders-drawer-open');
      renderKpis();

      try {
        sourceRows = (await fetchKpiDetalle(kpiKey)).slice();
      } catch (err) {
        console.warn('[Leads KPI detalle]', err);
        sourceRows = rowsForKpi(kpiKey).slice();
        if (metaEl) metaEl.textContent = err.message || 'Detalle parcial (preview)';
      }

      updateFilterChip();
      renderList('');
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
        const key = currentMeta.kpi;
        if (Array.isArray(state.kpiDetalleCache[key])) {
          sourceRows = state.kpiDetalleCache[key].slice();
          renderList(searchEl?.value || '');
          return;
        }
        fetchKpiDetalle(key)
          .then((rows) => {
            if (state.openKpi !== key) return;
            sourceRows = rows.slice();
            renderList(searchEl?.value || '');
          })
          .catch(() => {
            sourceRows = rowsForKpi(key).slice();
            renderList(searchEl?.value || '');
          });
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
    els.alertasConvBody?.addEventListener('click', openFromEvent);
    els.alertasConvBody?.addEventListener('keydown', openFromEvent);
  }

  function updateSubtitle() {
    if (!els.subtitle) return;
    const fi = state.fechaInicio || '—';
    const ff = state.fechaFin || '—';
    const s = summary();
    void s;
    els.subtitle.textContent = `Leads que entraron del ${formatDate(fi)} al ${formatDate(ff)}: cuántos llegaron a compra y dónde se quedan. Un lead cuenta como compra si su VIN se factura dentro de 90 días.`;
  }

  function renderAlertasJuntas() {
    const grid = document.getElementById('ldAlertasGrid');
    const vacio = document.getElementById('ldAlertasVacio');
    if (!grid || !vacio) return;
    const periodLeads = Number(summary().leads || 0);
    const nConv = (state.data?.alertasConversionCompras?.items || []).length;
    const nCad = (state.data?.campanasCaducarAlertas || []).length;
    const sinAlertas = periodLeads > 0 && !nConv && !nCad;
    grid.classList.toggle('hidden', sinAlertas);
    vacio.classList.toggle('hidden', !sinAlertas);
    if (sinAlertas) {
      const umbral = num(state.data?.campanasCaducarResumen?.umbralDias || 14);
      vacio.textContent = `Sin alertas: ninguna compra con nombre distinto al del lead y ningún lead por vencer en los próximos ${umbral} días.`;
    }
  }

  const SUPER_COLORES = ['#1e3fd8', '#0f9d76', '#e08a00', '#8b5cf6', '#dc4c64', '#64748b'];

  function destruirSuperChart() {
    if (superChart) {
      try { superChart.destroy(); } catch { /* ignore */ }
      superChart = null;
    }
  }

  function renderSuperChart(curvas) {
    const canvas = document.getElementById('ldSuperChart');
    if (!canvas || typeof Chart === 'undefined') return;
    destruirSuperChart();
    superChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          ...(state.supervivencia?.curvaGeneral?.length ? [{
            label: 'Todas',
            data: state.supervivencia.curvaGeneral.map((p) => ({ x: p.dia, y: Math.round(p.f * 1000) / 10 })),
            borderColor: '#94a3b8',
            backgroundColor: '#94a3b8',
            borderDash: [6, 4],
            stepped: true,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0,
          }] : []),
          ...(curvas || []).map((c, i) => ({
          label: c.grupo,
          data: (c.puntos || []).map((p) => ({ x: p.dia, y: Math.round(p.f * 1000) / 10 })),
          borderColor: SUPER_COLORES[i % SUPER_COLORES.length],
          backgroundColor: SUPER_COLORES[i % SUPER_COLORES.length],
          stepped: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0,
        })),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        layout: { padding: { right: 100 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y} % al día ${c.parsed.x}` } },
        },
        scales: {
          x: { type: 'linear', min: 0, max: 180, title: { display: true, text: 'Días desde que entró' }, ticks: { font: { size: 11 } } },
          y: { min: 0, title: { display: true, text: '% que ya compró' }, ticks: { font: { size: 11 } } },
        },
      },
      plugins: [{
        // Nombre al final de cada línea (sin leyenda aparte); se separan si quedan encimados.
        id: 'etiquetaFinal',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const { right } = chart.chartArea;
          const items = chart.data.datasets.map((ds, i) => {
            const meta = chart.getDatasetMeta(i);
            const last = meta.data[meta.data.length - 1];
            return last ? { y: last.y, x: last.x, texto: ds.label, color: ds.borderColor } : null;
          }).filter(Boolean).sort((p, q) => p.y - q.y);
          for (let i = 1; i < items.length; i += 1) {
            if (items[i].y - items[i - 1].y < 13) items[i].y = items[i - 1].y + 13;
          }
          ctx.save();
          ctx.font = '600 11px Inter, system-ui, sans-serif';
          ctx.textBaseline = 'middle';
          // Texto en gris oscuro (los azules claros no se leen sobre blanco) con su marca de color.
          items.forEach((it) => {
            const x0 = Math.min(it.x, right) + 5;
            ctx.strokeStyle = it.color;
            ctx.lineWidth = 3;
            ctx.setLineDash(it.texto === 'Todas' ? [3, 2] : []);
            ctx.beginPath();
            ctx.moveTo(x0, it.y);
            ctx.lineTo(x0 + 10, it.y);
            ctx.stroke();
            ctx.fillStyle = '#334155';
            ctx.fillText(it.texto, x0 + 14, it.y);
          });
          ctx.restore();
        },
      }, {
        id: 'dia90',
        afterDraw(chart) {
          const x = chart.scales.x.getPixelForValue(90);
          const { top, bottom } = chart.chartArea;
          const ctx = chart.ctx;
          ctx.save();
          ctx.strokeStyle = '#6b7785';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.restore();
        },
      }],
    });
  }

  function etiquetaSuper(v) {
    let t = String(v || '');
    if (t && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
    return t
      .replace(/\bcredito\b/gi, (m) => (m[0] === 'C' ? 'Crédito' : 'crédito'))
      .replace(/\bmas\b/gi, (m) => (m[0] === 'M' ? 'Más' : 'más'))
      .replace(/\bdia\b/gi, (m) => (m[0] === 'D' ? 'Día' : 'día'));
  }

  /**
   * Después de cada hito: el reloj arranca el día de la cita, la prueba o la solicitud.
   * La primera fila es la referencia (lead frío al día 14).
   */
  function renderSuperHitos(hitos) {
    const filas = hitos?.filas || [];
    if (!filas.length) return '';
    const H = hitos.horizonteDias || 90;
    const maxPct = Math.max(1, ...filas.map((f) => Number(f.pct) || 0));
    const nombreTabla = { prueba: 'pruebas de manejo', solicitud: 'solicitudes de crédito' };
    const cuerpo = filas.map((f) => {
      const ref = f.clave === 'referencia';
      if (f.sinDatos) {
        return `<tr class="ld-hito--vacio"><td>${escapeHtml(f.etiqueta)}</td><td colspan="4">Sin tabla de ${escapeHtml(nombreTabla[f.clave] || 'este hito')} cargada</td></tr>`;
      }
      const flag = !ref && f.pctMismoDia != null && f.pctMismoDia >= 30
        ? `<small class="ld-hito__flag" title="Puede ser registro del mismo trámite de compra">${num(f.pctMismoDia)} % de sus compras, el mismo día${f.pctProspectivo != null ? ` · sin ellas: ${pct(f.pctProspectivo)}` : ''}</small>`
        : '';
      const pctCell = f.suficiente
        ? `<span class="ld-hito__bar" title="Intervalo 95 %: ${f.ic95 ? f.ic95.join('–') : '—'} %"><i style="width:${Math.max(2, (Number(f.pct) / maxPct) * 100)}%"></i></span><strong>${pct(f.pct)}</strong>`
        : `<span class="cell-muted">Menos de 20 leads</span>`;
      return `<tr class="${ref ? 'ld-hito--ref' : ''}">
        <td>${escapeHtml(f.etiqueta)}${flag}</td>
        <td class="cell-num" data-label="Leads">${num(f.leads)}</td>
        <td class="cell-num" data-label="Llegan al hito, día">${f.diasAlHito == null ? '—' : num(f.diasAlHito)}</td>
        <td class="ld-hito__pct" data-label="Compran en ${num(H)} días">${pctCell}</td>
        <td class="cell-num" data-label="Mitad de las compras, días después">${f.diaMitad == null ? '—' : num(f.diaMitad)}</td>
      </tr>`;
    }).join('');

    const cob = hitos.cobertura || {};
    const notas = [];
    const cruce = (c, nombre) => {
      if (!c?.disponible || !c.registros) return;
      if (c.conLead / c.registros < 0.8) {
        notas.push(`${nombre}: ${num(c.conLead)} de ${num(c.registros)} registros del año cruzan con un lead por ID CRM; el resto no entra`);
      }
    };
    cruce(cob.pruebas, 'Pruebas de manejo');
    cruce(cob.solicitudes, 'Solicitudes de crédito');
    if (cob.citas?.sinFecha) notas.push(`${num(cob.citas.sinFecha)} citas asistidas sin fecha de cita no entran`);

    return `
      <div class="ld-hitos">
        <p class="ld-super-cap">Qué tanto compran los leads después de cada paso, contando desde el día del hito.</p>
        <div class="table-scroll">
          <table class="data-table ld-hitos__tabla">
            <thead><tr>
              <th>Hito</th>
              <th class="cell-num">Leads</th>
              <th class="cell-num">Llegan al hito<small>días desde la entrada</small></th>
              <th>Compran en ${num(H)} días</th>
              <th class="cell-num">Mitad de las compras<small>días después del hito</small></th>
            </tr></thead>
            <tbody>${cuerpo}</tbody>
          </table>
        </div>
        ${notas.length ? `<p class="ld-super-nota">${notas.map((n) => escapeHtml(n)).join(' · ')}</p>` : ''}
        <details class="ld-como">
          <summary>¿Cómo se calcula?</summary>
          <p>El reloj arranca el día de la cita asistida, la primera prueba de manejo o la primera solicitud de crédito. Cuenta la compra (factura) en los ${num(H)} días siguientes; los hitos recientes que aún no cumplen ${num(H)} días se ajustan con Kaplan–Meier en lugar de contar como "no compró". Quien ya había comprado antes del hito no entra. La fila gris es la referencia: leads que al día 14 seguían sin comprar y sin cita, prueba ni solicitud. Un mismo lead puede estar en varias filas (cita, luego prueba, luego solicitud): las filas no se suman y no miden el efecto aislado de cada paso; quien llega a un hito ya venía con más intención.</p>
        </details>
      </div>`;
  }

  function renderSuperFactores(factores, destacados = {}) {
    const lista = factores || [];
    if (!lista.length) return '';
    const vals = lista.flatMap((f) => [f.cocienteTiempo, ...(f.ic95 || [])]).filter((n) => n > 0);
    const lo = Math.log(Math.max(0.05, Math.min(0.35, ...vals)));
    const hi = Math.log(Math.min(20, Math.max(2.8, ...vals)));
    const clamp = (v) => Math.min(Math.max(v, Math.exp(lo)), Math.exp(hi));
    const pos = (v) => `${((Math.log(clamp(v)) - lo) / (hi - lo)) * 100}%`;
    const fila = (f) => {
          const conTiempo = f.cocienteTiempo != null && f.cocienteTiempo > 0;
          const frena = conTiempo && f.cocienteTiempo > 1;
          const clave = `${f.factor}|${f.nivel}`;
          const topCompra = destacados?.compra === clave;
          const topRapidez = destacados?.rapidez === clave;
          const cls = `${frena ? 'is-frena' : ''}${f.concluyente ? '' : ' is-tenue'}${topRapidez ? ' is-top-rapidez' : ''}`;
          const ic = f.ic95 || (conTiempo ? [f.cocienteTiempo, f.cocienteTiempo] : null);
          const pc = f.probCompra || {};
          const dm = f.diaMitad || {};
          const compraCls = `${f.concluyenteCompra ? (pc.nivel >= pc.base ? 'is-mas' : 'is-menos') : 'is-tenue'}${topCompra ? ' is-top' : ''}`;
          const tituloCompra = f.razonCompra == null
            ? 'Sin compras para comparar'
            : `${f.razonCompra} veces la base (intervalo 95 %: ${(f.ic95Compra || []).join('–')})`;
          const track = conTiempo
            ? `<span class="ld-super-factor__track" title="Cociente de días ${f.cocienteTiempo} (intervalo 95 %: ${ic ? ic.join('–') : '—'})">
              <i class="ld-super-factor__one" style="left:${pos(1)}"></i>
              ${ic ? `<i class="ld-super-factor__bar" style="left:${pos(Math.min(ic[0], ic[1]))};width:calc(${pos(Math.max(ic[0], ic[1]))} - ${pos(Math.min(ic[0], ic[1]))})"></i>` : ''}
              <i class="ld-super-factor__dot" style="left:${pos(f.cocienteTiempo)}"></i>
            </span>`
            : `<span class="ld-super-factor__track ld-super-factor__track--vacio">Menos de 10 compras: no alcanza para medir rapidez</span>`;
          return `<div class="ld-super-factor ${cls}">
            <span class="ld-super-factor__name">${escapeHtml(etiquetaSuper(f.nivel))}<small>vs ${escapeHtml(etiquetaSuper(f.base))} · ${num(f.compras)} compras</small></span>
            <span class="ld-super-compra ${compraCls}" title="${escapeHtml(tituloCompra)}">
              <strong>${pc.nivel == null ? '—' : `${pc.nivel} %`}</strong> vs ${pc.base == null ? '—' : `${pc.base} %`}
            </span>
            ${track}
            <span class="ld-super-factor__dia">${conTiempo && dm.nivel != null ? `<strong>Día ${num(dm.nivel)}</strong> vs ${num(dm.base)}` : '—'}</span>
          </div>`;
    };
    const claros = lista.filter((f) => f.concluyente || f.concluyenteCompra);
    const tenues = lista.filter((f) => !(f.concluyente || f.concluyenteCompra));
    const cabeza = `<div class="ld-super-factor ld-super-factor--head">
          <span>Al entrar el lead…</span><span>Compran en 180 días</span><span>Entre los que compran, ¿más rápido?</span><span>Mitad de las compras</span>
        </div>`;
    return `
      <div class="ld-super-factores">
        <p class="ld-super-cap">Características que se conocen cuando entra el lead, cada una contra su base. El borde azul marca la de más efecto.</p>
        ${claros.length ? cabeza + claros.map(fila).join('') : '<p class="ld-super-nota">Ninguna característica marca una diferencia clara con el volumen actual.</p>'}
        ${tenues.length ? `<details class="ld-como">
          <summary>Ver ${num(tenues.length)} sin diferencia clara</summary>
          ${claros.length ? '' : cabeza}${tenues.map(fila).join('')}
        </details>` : ''}
        <details class="ld-como">
          <summary>¿Cómo se calcula?</summary>
          <p>"Compran en 180 días" sale de las curvas de Kaplan–Meier de cada grupo. "Mitad de las compras" es el día en que el grupo ya juntó la mitad de sus compras; el punto a la izquierda de la línea vertical significa que compran más rápido que la base. La barra es el intervalo de 95 %: si cruza la línea, la diferencia no es clara y la fila se ve tenue.</p>
        </details>
      </div>`;
  }

  const SUPER_TABS = [
    { k: 'hitos', t: 'Después de cada hito' },
    { k: 'curva', t: 'Curva por fuente' },
    { k: 'factores', t: 'Al entrar' },
  ];

  function mostrarSuperTab(root, tab) {
    state.superTab = tab;
    root.querySelectorAll('[data-ld-super-tab]').forEach((b) => {
      const on = b.getAttribute('data-ld-super-tab') === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    root.querySelectorAll('[data-ld-super-panel]').forEach((p) => {
      p.hidden = p.getAttribute('data-ld-super-panel') !== tab;
    });
    // Chart.js necesita el lienzo visible para medirlo.
    if (tab === 'curva' && (state.supervivencia?.curvas || []).length) renderSuperChart(state.supervivencia.curvas);
    else destruirSuperChart();
  }

  function renderSupervivencia() {
    const root = document.getElementById('ldSuperBody');
    const nota = document.getElementById('ldSuperNota');
    if (!root) return;
    const data = state.supervivencia;
    if (!data || data.loading) {
      destruirSuperChart();
      root.innerHTML = '<p class="section-subtitle" style="margin:0">Calculando con los últimos 12 meses…</p>';
      return;
    }
    if (data.error) {
      destruirSuperChart();
      root.innerHTML = `<p class="section-subtitle" style="margin:0">${escapeHtml(data.error)}</p>`;
      return;
    }
    const t = data.tiempo || {};
    const m = data.muestra || {};
    const v = data.ventana || {};
    if (nota) {
      nota.textContent = v.desde
        ? `Del ${formatDate(v.desde)} al ${formatDate(v.hasta)} · ${num(m.leads)} leads · ${num(m.compras)} compras`
        : `${num(m.leads)} leads · ${num(m.compras)} compras`;
    }
    const curvas = data.curvas || [];
    const disponibles = {
      hitos: (data.hitos?.filas || []).some((f) => f.leads > 0),
      curva: curvas.length > 0,
      factores: (data.factores || []).length > 0,
    };
    let tab = state.superTab;
    if (!disponibles[tab]) tab = SUPER_TABS.find((x) => disponibles[x.k])?.k || 'curva';
    const avisos = (data.avisos || []).length
      ? `<p class="ld-super-nota">${data.avisos.map((a) => escapeHtml(a)).join(' · ')}</p>`
      : '';

    root.innerHTML = `
      <div class="ld-super-kpis">
        <div class="ld-super-kpi"><strong>${t.t50 == null ? '—' : `Día ${num(t.t50)}`}</strong><span>Ya ocurrió la mitad de las compras</span></div>
        <div class="ld-super-kpi"><strong>${t.t80 == null ? '—' : `Día ${num(t.t80)}`}</strong><span>Ya ocurrieron 8 de cada 10 compras</span></div>
        <div class="ld-super-kpi"><strong>${t.pctDespues90 == null ? '—' : `${pct(t.pctDespues90)}`}</strong><span>De las compras llegan después del día 90 y quedan fuera de la conversión de arriba</span></div>
      </div>
      <nav class="eeff-tabs ld-super-tabs" role="tablist" aria-label="Detalle de tiempo a compra">
        ${SUPER_TABS.filter((x) => disponibles[x.k]).map((x) => `<button type="button" role="tab" class="eeff-tab" data-ld-super-tab="${x.k}">${x.t}</button>`).join('')}
      </nav>
      <div data-ld-super-panel="hitos">${renderSuperHitos(data.hitos)}</div>
      <div data-ld-super-panel="curva">
        <p class="ld-super-cap">% de los leads de cada fuente que ya compró, según los días desde que entró. Línea punteada vertical: día 90.</p>
        <div class="ld-super-chart"><canvas id="ldSuperChart" aria-label="Compra acumulada por fuente"></canvas></div>
      </div>
      <div data-ld-super-panel="factores">${renderSuperFactores(data.factores, data.destacados)}${avisos}</div>
    `;
    root.onclick = (e) => {
      const b = e.target.closest('[data-ld-super-tab]');
      if (b) mostrarSuperTab(root, b.getAttribute('data-ld-super-tab'));
    };
    mostrarSuperTab(root, tab);
  }

  function renderAll() {
    updateSubtitle();
    renderPeriodoVacio();
    renderProspeccion();
    renderKpis();
    renderCampanasCaducar();
    renderAlertasConversion();
    renderAlertasJuntas();
    renderFuerzaVentas();
    renderOrigen();
    renderGroups();
    renderOnePagerLeads();
    renderSupervivencia();
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
    els.caducarBody = document.getElementById('ldCampanasCaducarBody');
    els.caducarMeta = document.getElementById('ldCampanasCaducarMeta');
    els.alertasConv = document.getElementById('ldAlertasConversion');
    els.alertasConvMeta = document.getElementById('ldAlertasConversionMeta');
    els.alertasConvBody = document.getElementById('ldAlertasConversionBody');
    els.fuerzaBody = document.getElementById('ldFuerzaBody');
    els.fuerzaFoot = document.getElementById('ldFuerzaFoot');
    els.fuerzaResumen = document.getElementById('ldFuerzaResumen');
    els.kpiReactivas = document.getElementById('ldKpiReactivas');
    els.kpiProactivas = document.getElementById('ldKpiProactivas');
    els.reactivaCampBody = document.getElementById('ldReactivaCampBody');
    els.reactivaCampFoot = document.getElementById('ldReactivaCampFoot');
    els.proactivaCampBody = document.getElementById('ldProactivaCampBody');
    els.proactivaCampFoot = document.getElementById('ldProactivaCampFoot');
    els.convMesBody = document.getElementById('ldConvMesBody');
    els.convMesMeta = document.getElementById('ldConvMesMeta');
    els.convMesChart = document.getElementById('ldConvMesChart');
    els.convVehiculoBody = document.getElementById('ldConvVehiculoBody');
    els.onePagerResumen = document.getElementById('ldOnePagerResumen');
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
    state.kpiDetalleCache = {};
    state.kpiDetalleMeta = {};
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
        const qs = `fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`;
        const res = await fetch(`/api/ventas/leads?${qs}`, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        state.data = data;
        state.prospeccion = { loading: true };
        state.supervivencia = { loading: true };
        state.cacheKey = key;
        renderAll();
        const [proRes, supRes] = await Promise.all([
          fetch(`/api/ventas/leads/prospeccion?${qs}`, { credentials: 'same-origin' }),
          fetch(`/api/ventas/leads/supervivencia?fechaFin=${encodeURIComponent(fechaFin)}`, { credentials: 'same-origin' }),
        ]);
        const pro = await proRes.json().catch(() => ({}));
        const sup = await supRes.json().catch(() => ({}));
        if (state.cacheKey === key) {
          state.prospeccion = proRes.ok ? pro : { error: pro.error || 'No se pudo calcular el proceso de prospección.' };
          state.supervivencia = supRes.ok ? sup : { error: sup.error || 'No se pudo calcular el tiempo a compra.' };
          renderProspeccion();
          renderSupervivencia();
          renderKpis();
        }
      } catch (err) {
        console.warn('[Leads]', err);
        state.cacheKey = null;
        state.prospeccion = { error: err.message };
        state.supervivencia = { error: err.message };
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
