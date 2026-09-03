/**
 * Contabilidad · Análisis financiero IEMC (F-1…F-7.1)
 * Clic en KPI → panel flotante con desglose del cálculo.
 */
(function initAnalisisFinanciero() {
  let afData = null;
  let activeClave = null;

  const DETALLE_LABELS = {
    ventaNetaReal: 'Venta neta real',
    objetivoEconomico: 'Objetivo económico',
    unidadesReales: 'Unidades reales',
    fuenteObjetivo: 'Fuente del objetivo',
    margenBrutoReal: 'Margen bruto real',
    margenBrutoObjetivo: 'Margen bruto objetivo (mix)',
    ubaReal: 'Utilidad bruta real (UBA)',
    ubaObjetivo: 'Utilidad bruta objetivo (mix)',
    gastoOperativo: 'Gasto operativo',
    ventasAutos: 'Ventas autos nuevos',
    proxy: 'Base / proxy usado',
    gastoReal: 'Gasto real',
    gastoPresupuesto: 'Gasto presupuestado / meta',
    fuenteMeta: 'Fuente de la meta',
    ingresoFi: 'Ingresos F&I',
    ingresosTotales: 'Ingresos totales (base)',
    unidades: 'Unidades vendidas',
    metaPvr: 'Meta PVR F&I',
    planPiso: 'Intereses plan piso',
    planPisoPeriod: 'Periodo plan piso',
    unidadesPlanPiso: 'Unidades con plan piso',
    utilidadOperacion: 'Utilidad de operación',
    crecimientoEbitPct: 'Crecimiento EBIT / UOC',
    gastosAdministracion: 'Gastos de administración',
    utilidadBruta: 'Utilidad bruta',
    capacidadOperativa: 'Capacidad operativa (UB − gasto op.)',
    cargaReal: 'Carga estructural real',
    cargaPresupuesto: 'Carga estructural presupuestada',
  };

  const FUENTE_LABELS = {
    railway: 'Metas Railway',
    mix_uo_pl: 'Mix UO × PL (PDF)',
    meta_railway: 'Meta Railway',
    '0700_total': 'Cuenta 0700 total (proxy)',
    presupuesto_2026: 'Presupuesto 2026',
    utilidad_operacion_eeff: 'Utilidad de operación EEFF (proxy)',
  };

  const KPI_ICONS = {
    'F-1': 'target',
    'F-2': 'pie_chart',
    'F-2.1': 'trending_down',
    'F-3': 'account_balance_wallet',
    'F-3.1': 'difference',
    'F-4': 'payments',
    'F-4.1': 'person',
    'F-5': 'shield',
    'F-6': 'show_chart',
    'F-7': 'apartment',
    'F-7.1': 'compare_arrows',
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

  function formatDisplay(kpi) {
    if (kpi.displayIsMoney || kpi.unidad === 'MXN') return fmtMoney(kpi.valor);
    if (kpi.display != null && kpi.display !== '') return kpi.display;
    if (kpi.valor == null) return '—';
    if (kpi.unidad === '%') return `${kpi.valor}%`;
    return String(kpi.valor);
  }

  function formatMeta(kpi) {
    if (kpi.meta == null) return null;
    if (kpi.unidad === '%') return `${kpi.meta}%`;
    if (kpi.unidad === 'MXN' || kpi.displayIsMoney) return fmtMoney(kpi.meta);
    return String(kpi.meta);
  }

  function formatDetalleValue(key, value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'string') {
      return FUENTE_LABELS[value] || value;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    const k = String(key).toLowerCase();
    if (k.includes('pct') || k.includes('margen') || k.includes('crecimiento')) {
      return `${value}%`;
    }
    if (k.includes('unidad') || k === 'unidades' || k === 'unidadesreales' || k === 'unidadesplanpiso') {
      return new Intl.NumberFormat('es-MX').format(value);
    }
    if (k.includes('period') || k.includes('fuente') || k.includes('proxy')) {
      return String(value);
    }
    return fmtMoney(value);
  }

  function statusLabel(status) {
    if (status === 'completo') return 'Completo';
    if (status === 'pendiente_meta') return 'Falta meta';
    return 'Parcial';
  }

  function accentFromTone(tone) {
    if (tone === 'green' || tone === 'amber' || tone === 'rose' || tone === 'blue') return tone;
    return 'slate';
  }

  function renderKpiCard(kpi) {
    const tone = kpi.tone || 'slate';
    const isOpen = activeClave === kpi.clave;
    return `<button type="button" class="eeff-edo-kpi eeff-edo-kpi--${tone} eeff-edo-kpi--interactive af-kpi${isOpen ? ' is-open is-selected' : ''}"
      data-af-kpi="${escHtml(kpi.clave)}" aria-pressed="${isOpen}" title="Ver detalle del KPI">
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
    if (kpi.numerador != null) calcRows.push({ label: 'Numerador', value: fmtMoney(kpi.numerador) });
    if (kpi.denominador != null) calcRows.push({ label: 'Denominador', value: fmtMoney(kpi.denominador) });
    if (kpi.valor != null) {
      calcRows.push({
        label: 'Resultado',
        value: formatDisplay(kpi),
        highlight: true,
      });
    }
    if (calcRows.length) sections.push({ title: 'Cálculo', rows: calcRows });

    const metaLabel = formatMeta(kpi);
    if (metaLabel != null || kpi.status) {
      const metaRows = [];
      if (metaLabel != null) metaRows.push({ label: 'Meta / presupuesto', value: metaLabel });
      metaRows.push({ label: 'Estado del dato', value: statusLabel(kpi.status) });
      if (kpi.valor != null && kpi.meta != null && kpi.unidad === '%') {
        const gap = Math.round((Number(kpi.valor) - Number(kpi.meta)) * 10) / 10;
        metaRows.push({
          label: 'Brecha vs meta (pp)',
          value: `${gap > 0 ? '+' : ''}${gap} pp`,
        });
      } else if (kpi.valor != null && kpi.meta != null && kpi.unidad === 'MXN') {
        const gap = Number(kpi.valor) - Number(kpi.meta);
        metaRows.push({ label: 'Brecha vs meta', value: fmtMoney(gap) });
      }
      sections.push({ title: 'Meta y cobertura', rows: metaRows });
    }

    const d = kpi.detalle || {};
    const detRows = Object.entries(d)
      .filter(([, v]) => v != null && v !== '')
      .map(([key, value]) => ({
        label: DETALLE_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        value: formatDetalleValue(key, value),
      }));
    if (detRows.length) sections.push({ title: 'Componentes del KPI', rows: detRows });

    if (kpi.nota) {
      sections.push({
        title: 'Nota / lectura',
        rows: [{ label: 'Observación', value: kpi.nota, text: true }],
      });
    }

    const resumen = afData?.resumen;
    if (resumen) {
      sections.push({
        title: 'Contexto del periodo',
        rows: [
          { label: 'Venta neta real', value: fmtMoney(resumen.ventaNetaReal) },
          { label: 'Ingresos F&I', value: fmtMoney(resumen.ingresoFi) },
          { label: 'Unidades', value: String(resumen.unidades ?? '—') },
          { label: 'Plan piso', value: fmtMoney(resumen.planPiso) },
          { label: 'Utilidad de operación', value: fmtMoney(resumen.utilidadOperacion) },
        ],
      });
    }

    return sections;
  }

  function closeDetail() {
    activeClave = null;
    const panel = document.getElementById('afKpiFloat');
    const backdrop = document.getElementById('afKpiFloatBackdrop');
    const inline = document.getElementById('afKpiDetail');
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
    if (backdrop) {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    if (inline) {
      inline.classList.add('hidden');
      inline.innerHTML = '';
    }
    renderGrid();
  }

  function renderDetail(kpi) {
    const panel = document.getElementById('afKpiFloat');
    const backdrop = document.getElementById('afKpiFloatBackdrop');
    if (!panel || !backdrop || !kpi) {
      closeDetail();
      return;
    }

    const accent = accentFromTone(kpi.tone);
    const sections = buildDetailSections(kpi);
    const icon = KPI_ICONS[kpi.clave] || 'analytics';
    const periodo = afData?.periodo
      ? `${afData.periodo.fechaInicio} → ${afData.periodo.fechaFin}`
      : '';

    const bodyHtml = sections.map((section) => {
      const rows = section.rows.map((row) => {
        if (row.text) {
          return `<tr class="bg-kpi-float__text-row">
            <td>${escHtml(row.label)}</td>
            <td colspan="1">${escHtml(row.value)}</td>
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
            <p class="bg-kpi-float__eyebrow">Análisis financiero · ${escHtml(kpi.clave)}</p>
            <h3 class="bg-kpi-float__title" id="afKpiFloatTitle">${escHtml(kpi.nombre)}</h3>
            <p class="bg-kpi-float__value">${formatDisplay(kpi)}</p>
            <p class="bg-kpi-float__hint">${escHtml(kpi.descripcion || '')}</p>
            <span class="bg-kpi-float__meta">${escHtml(periodo)} · ${statusLabel(kpi.status)}</span>
          </div>
        </div>
        <button type="button" class="bg-kpi-float__close" data-af-close-detail aria-label="Cerrar">
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

  function sortKpis(kpis) {
    return [...(kpis || [])].sort((a, b) => {
      const parse = (clave) => {
        const m = String(clave || '').match(/^F-(\d+)(?:\.(\d+))?$/i);
        if (!m) return [999, 0];
        return [Number(m[1]), Number(m[2] || 0)];
      };
      const [am, asub] = parse(a.clave);
      const [bm, bsub] = parse(b.clave);
      return am - bm || asub - bsub;
    });
  }

  function renderGrid() {
    const primary = document.getElementById('afKpiPrimary');
    const secondary = document.getElementById('afKpiSecondary');
    if (!primary || !afData?.kpis) return;
    const kpis = sortKpis(afData.kpis);
    primary.innerHTML = kpis.map(renderKpiCard).join('');
    if (secondary) {
      secondary.innerHTML = '';
      secondary.classList.add('hidden');
    }

    const fuentes = afData.fuentes || {};
    const foot = document.getElementById('afFootnote');
    if (foot) {
      const bits = [];
      if (fuentes.iemc) bits.push('mix IEMC');
      if (fuentes.presupuesto2026) bits.push('presupuesto 2026');
      if (fuentes.railwayMetas) bits.push('metas Railway');
      if (fuentes.planPiso) bits.push('plan piso');
      foot.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">info</span>
        Ventas nuevos · F-1…F-7.1 · clic en KPI para desglose · fuentes: ${bits.join(' · ') || 'contabilidad / DMS'}`;
    }
  }

  function openKpi(clave) {
    const kpi = (afData?.kpis || []).find((k) => k.clave === clave);
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
    document.getElementById('afOverview')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-af-kpi]');
      if (!btn) return;
      openKpi(btn.getAttribute('data-af-kpi'));
    });

    document.getElementById('afKpiFloatBackdrop')?.addEventListener('click', closeDetail);
    document.getElementById('afKpiFloat')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-af-close-detail]')) closeDetail();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeClave) closeDetail();
    });
  }

  async function load(fechaInicio, fechaFin) {
    const loading = document.getElementById('afLoading');
    const empty = document.getElementById('afEmpty');
    loading?.classList.remove('hidden');
    empty?.classList.add('hidden');
    try {
      const qs = new URLSearchParams({ fechaInicio, fechaFin });
      afData = await Dashboard.api(`/contabilidad/analisis-financiero?${qs}`);
      closeDetail();
      renderGrid();
      const sub = document.getElementById('afPeriodLabel');
      if (sub) sub.textContent = `${fechaInicio} → ${fechaFin}`;
    } catch (err) {
      afData = null;
      closeDetail();
      const primary = document.getElementById('afKpiPrimary');
      if (primary) primary.innerHTML = '';
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = err.message || 'No se pudo cargar el análisis financiero.';
      }
    } finally {
      loading?.classList.add('hidden');
    }
  }

  bindGridClicks();

  window.AnalisisFinanciero = { load, closeDetail };
})();
