/**
 * Ventas · Análisis comercial CMI (C-1…C-12.1)
 * Clic en KPI → panel flotante con desglose.
 */
(function initAnalisisComercial() {
  let acData = null;
  let activeClave = null;

  const KPI_ICONS = {
    'C-1': 'local_shipping',
    'C-1.1': 'difference',
    'C-2': 'pie_chart',
    'C-2.1': 'account_tree',
    'C-3': 'hourglass_bottom',
    'C-4': 'public',
    'C-5': 'account_balance',
    'C-6': 'group',
    'C-6.1': 'schedule',
    'C-7': 'groups',
    'C-8': 'trending_down',
    'C-9': 'receipt_long',
    'C-10': 'swap_horiz',
    'C-10.1': 'percent',
    'C-11': 'extension',
    'C-11.1': 'payments',
    'C-12': 'sensors',
    'C-12.1': 'wifi_tethering',
  };

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Dashboard.fmt.money(value);
  }

  function fmtNum(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Dashboard.fmt.number(value);
  }

  function formatDisplay(kpi) {
    if (kpi.display != null && kpi.display !== '' && kpi.unidad !== 'MXN') return kpi.display;
    if (kpi.unidad === 'MXN') return fmtMoney(kpi.valor);
    if (kpi.valor == null) return '—';
    if (kpi.unidad === '%') return `${kpi.valor}%`;
    if (kpi.unidad === 'unidades') return fmtNum(kpi.valor);
    return String(kpi.valor);
  }

  function statusLabel(status) {
    if (status === 'completo') return 'Completo';
    if (status === 'pendiente_meta') return 'Falta meta';
    return 'Parcial';
  }

  function accentFromTone(tone) {
    if (tone === 'green' || tone === 'amber' || tone === 'rose' || tone === 'blue' || tone === 'violet') return tone;
    return 'slate';
  }

  function sortKpis(kpis) {
    return [...(kpis || [])].sort((a, b) => {
      const parse = (clave) => {
        const m = String(clave || '').match(/^C-(\d+)(?:\.(\d+))?$/i);
        if (!m) return [999, 0];
        return [Number(m[1]), Number(m[2] || 0)];
      };
      const [am, asub] = parse(a.clave);
      const [bm, bsub] = parse(b.clave);
      return am - bm || asub - bsub;
    });
  }

  function formatDetalleValue(key, value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) {
      if (!value.length) return '—';
      if (typeof value[0] === 'object') {
        return value.slice(0, 8).map((r) => {
          const linea = r.linea || r.parte || '—';
          const brecha = r.brecha != null ? ` brecha ${r.brecha}` : '';
          return `${linea}: ${r.real ?? '—'}/${r.meta ?? '—'}${brecha}`;
        }).join(' · ');
      }
      return value.slice(0, 12).join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    const k = String(key).toLowerCase();
    if (k.includes('pct') || k.includes('margen') || k.includes('penetracion')) return `${value}%`;
    if (k.includes('monto') || k.includes('piso') || k.includes('mxn')) return fmtMoney(value);
    if (k.includes('unidad') || k.includes('entrega') || k.includes('linea') || k.includes('asesor') || k.includes('contrato')) {
      return fmtNum(value);
    }
    return String(value);
  }

  function renderKpiCard(kpi) {
    const tone = kpi.tone || 'slate';
    const isOpen = activeClave === kpi.clave;
    const disabled = kpi.disponible === false && kpi.valor == null;
    return `<button type="button" class="eeff-edo-kpi eeff-edo-kpi--${tone} eeff-edo-kpi--interactive af-kpi${isOpen ? ' is-open is-selected' : ''}${disabled ? ' is-muted' : ''}"
      data-ac-kpi="${escHtml(kpi.clave)}" aria-pressed="${isOpen}" title="Ver detalle del KPI">
      <div class="eeff-edo-kpi__head">
        <span class="eeff-edo-kpi__clave">${escHtml(kpi.clave)}</span>
        <span class="af-kpi__status af-kpi__status--${escHtml(kpi.status || 'parcial')}">${statusLabel(kpi.status)}</span>
      </div>
      <div class="eeff-edo-kpi__label">${escHtml(kpi.nombre)}</div>
      <div class="eeff-edo-kpi__value">${formatDisplay(kpi)}</div>
      <p class="eeff-edo-kpi__sub">${escHtml(kpi.descripcion || '')}</p>
      <span class="af-kpi__hint">Clic para detalle</span>
    </button>`;
  }

  function buildDetailSections(kpi) {
    const sections = [];
    const calcRows = [];
    if (kpi.formula) calcRows.push({ label: 'Fórmula', value: kpi.formula, text: true });
    if (kpi.numerador != null) {
      calcRows.push({
        label: 'Numerador',
        value: kpi.unidad === '%' || kpi.unidad === 'unidades' ? fmtNum(kpi.numerador) : fmtMoney(kpi.numerador),
      });
    }
    if (kpi.denominador != null) {
      calcRows.push({
        label: 'Denominador',
        value: kpi.unidad === '%' || kpi.unidad === 'unidades' ? fmtNum(kpi.denominador) : fmtMoney(kpi.denominador),
      });
    }
    if (kpi.valor != null) calcRows.push({ label: 'Resultado', value: formatDisplay(kpi), highlight: true });
    if (calcRows.length) sections.push({ title: 'Cálculo', rows: calcRows });

    const metaRows = [];
    if (kpi.meta != null) {
      metaRows.push({
        label: 'Meta',
        value: kpi.unidad === '%' ? `${kpi.meta}%` : (kpi.unidad === 'MXN' ? fmtMoney(kpi.meta) : fmtNum(kpi.meta)),
      });
    }
    metaRows.push({ label: 'Estado del dato', value: statusLabel(kpi.status) });
    sections.push({ title: 'Meta y cobertura', rows: metaRows });

    const d = kpi.detalle || {};
    const detRows = Object.entries(d)
      .filter(([, v]) => v != null && v !== '')
      .map(([key, value]) => ({
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        value: formatDetalleValue(key, value),
        text: Array.isArray(value) || typeof value === 'object',
      }));
    if (detRows.length) sections.push({ title: 'Componentes', rows: detRows });

    if (kpi.nota) {
      sections.push({
        title: 'Nota / lectura',
        rows: [{ label: 'Observación', value: kpi.nota, text: true }],
      });
    }
    return sections;
  }

  function closeDetail() {
    activeClave = null;
    const panel = document.getElementById('acKpiFloat');
    const backdrop = document.getElementById('acKpiFloatBackdrop');
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
    if (backdrop) {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    renderGrid();
  }

  function renderDetail(kpi) {
    const panel = document.getElementById('acKpiFloat');
    const backdrop = document.getElementById('acKpiFloatBackdrop');
    if (!panel || !backdrop || !kpi) {
      closeDetail();
      return;
    }
    const accent = accentFromTone(kpi.tone);
    const sections = buildDetailSections(kpi);
    const icon = KPI_ICONS[kpi.clave] || 'analytics';
    const periodo = acData?.periodo
      ? `${acData.periodo.fechaInicio} → ${acData.periodo.fechaFin}`
      : '';

    const bodyHtml = sections.map((section) => {
      const rows = section.rows.map((row) => {
        if (row.text) {
          return `<tr class="bg-kpi-float__text-row">
            <td>${escHtml(row.label)}</td>
            <td>${escHtml(String(row.value))}</td>
          </tr>`;
        }
        return `<tr class="${row.highlight ? 'bg-kpi-float__highlight-row' : ''}">
          <td>${escHtml(row.label)}</td>
          <td class="cell-money"><strong>${escHtml(String(row.value))}</strong></td>
        </tr>`;
      }).join('');
      return `<div class="bg-kpi-float__group">
        <p class="bg-kpi-float__section">${escHtml(section.title)}</p>
        <table class="bg-kpi-float__table">
          <thead><tr><th>Concepto</th><th class="cell-money">Valor</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');

    panel.dataset.accent = accent;
    panel.innerHTML = `
      <div class="bg-kpi-float__head bg-kpi-float__head--${accent}">
        <div class="bg-kpi-float__head-main">
          <div class="bg-kpi-float__icon bg-kpi-float__icon--${accent}" aria-hidden="true">
            <span class="material-symbols-outlined">${icon}</span>
          </div>
          <div>
            <p class="bg-kpi-float__eyebrow">Análisis comercial · ${escHtml(kpi.clave)}</p>
            <h3 class="bg-kpi-float__title" id="acKpiFloatTitle">${escHtml(kpi.nombre)}</h3>
            <p class="bg-kpi-float__value">${formatDisplay(kpi)}</p>
            <p class="bg-kpi-float__hint">${escHtml(kpi.descripcion || '')}</p>
            <span class="bg-kpi-float__meta">${escHtml(periodo)} · ${statusLabel(kpi.status)}</span>
          </div>
        </div>
        <button type="button" class="bg-kpi-float__close" data-ac-close-detail aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="bg-kpi-float__body">
        ${bodyHtml || '<div class="bg-kpi-float__group"><p class="section-subtitle">Sin desglose disponible.</p></div>'}
      </div>`;

    panel.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function renderGrid() {
    const primary = document.getElementById('acKpiPrimary');
    if (!primary || !acData?.kpis) return;
    primary.innerHTML = sortKpis(acData.kpis).map(renderKpiCard).join('');
    const r = acData.resumen || {};
    const foot = document.getElementById('acFootnote');
    if (foot) {
      foot.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">info</span>
        Manual CMI v3 · C-1…C-12.1 · ${r.completos || 0} completos · ${r.parciales || 0} parciales ·
        ${(r.noDisponibles || 0)} sin fuente · clic en KPI para desglose`;
    }
  }

  function openKpi(clave) {
    const kpi = (acData?.kpis || []).find((k) => k.clave === clave);
    if (!kpi) return;
    if (activeClave === clave) {
      closeDetail();
      return;
    }
    activeClave = clave;
    renderGrid();
    renderDetail(kpi);
  }

  function bindGridClicks() {
    document.getElementById('acOverview')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ac-kpi]');
      if (!btn) return;
      openKpi(btn.getAttribute('data-ac-kpi'));
    });
    document.getElementById('acKpiFloatBackdrop')?.addEventListener('click', closeDetail);
    document.getElementById('acKpiFloat')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-ac-close-detail]')) closeDetail();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeClave) closeDetail();
    });
  }

  async function load(fechaInicio, fechaFin) {
    const loading = document.getElementById('acLoading');
    const empty = document.getElementById('acEmpty');
    loading?.classList.remove('hidden');
    empty?.classList.add('hidden');
    try {
      const qs = new URLSearchParams({ fechaInicio, fechaFin });
      acData = await Dashboard.api(`/ventas/analisis-comercial?${qs}`);
      closeDetail();
      renderGrid();
      const sub = document.getElementById('acPeriodLabel');
      if (sub) sub.textContent = `${fechaInicio} → ${fechaFin}`;
    } catch (err) {
      acData = null;
      closeDetail();
      const primary = document.getElementById('acKpiPrimary');
      if (primary) primary.innerHTML = '';
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = err.message || 'No se pudo cargar el análisis comercial.';
      }
    } finally {
      loading?.classList.add('hidden');
    }
  }

  bindGridClicks();
  window.AnalisisComercial = { load, closeDetail };
})();
