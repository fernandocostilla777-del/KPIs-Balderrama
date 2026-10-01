/**
 * Contabilidad · Análisis financiero IEMC (F-1…F-7.1)
 * Bloques fusionados: venta · margen · gasto · F&I · resultado · estructura.
 * Clic → panel flotante con desglose del cálculo.
 */
(function initAnalisisFinanciero() {
  let afData = null;
  let activeBlockId = null;

  /** Agrupación visual: KPI principal + companions compatibles. */
  const AF_BLOCKS = [
    {
      id: 'venta',
      elementId: 'afBlockVenta',
      titulo: 'Venta económica',
      claves: ['F-1'],
      icon: 'target',
    },
    {
      id: 'margen',
      elementId: 'afBlockMargen',
      titulo: 'Margen del mix',
      claves: ['F-2', 'F-2.1'],
      icon: 'pie_chart',
    },
    {
      id: 'gasto',
      elementId: 'afBlockGasto',
      titulo: 'Gasto operativo',
      claves: ['F-3', 'F-3.1'],
      icon: 'account_balance_wallet',
    },
    {
      id: 'fi',
      elementId: 'afBlockFi',
      titulo: 'F&I y cobertura',
      claves: ['F-4', 'F-4.1', 'F-5'],
      icon: 'payments',
    },
    {
      id: 'resultado',
      elementId: 'afBlockResultado',
      titulo: 'Resultado operativo',
      claves: ['F-6'],
      icon: 'show_chart',
    },
    {
      id: 'estructura',
      elementId: 'afBlockEstructura',
      titulo: 'Carga estructural',
      claves: ['F-7', 'F-7.1'],
      icon: 'apartment',
    },
  ];

  const DETALLE_LABELS = {
    ventaNetaReal: 'Venta neta facturada',
    ventaAPl: 'Venta a PL lleno Σ(UR×PL)',
    ventaAPlSinIva: 'Venta a PL lleno (s/IVA)',
    ventaFacturada: 'Venta neta facturada (c/bono)',
    objetivoEconomico: 'Monto Objetivo de Venta (MOV)',
    unidadesObjetivo: 'Unidades objetivo',
    unidadesReales: 'Unidades reales',
    plPromedio: 'Precio lista promedio',
    fuenteObjetivo: 'Fuente del objetivo',
    lineasConMonto: 'Líneas con MOV',
    lineasSinPl: 'Líneas sin precio lista',
    topLineasMov: 'Top líneas del MOV',
    margenBrutoReal: 'Margen bruto real',
    margenBrutoObjetivo: 'Margen bruto objetivo (mix)',
    ubaReal: 'Utilidad bruta real (UBA)',
    ubaObjetivo: 'Utilidad bruta objetivo (mix)',
    efectoBonificacion: 'Efecto bonificación vs PL lleno',
    realizacionPrecioPct: 'Realización de precio vs PL',
    bonificacionDms: 'Bonificación DMS (acumulada)',
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
    mix_uo_pl: 'Mix UO × PL (PDF / captura)',
    mix_uo_pl_guia: 'Mix UO × PL lleno (guía Planes)',
    unidades_x_pl_promedio: 'Unidades objetivo × PL promedio',
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
    if (!kpi) return '—';
    if (kpi.displayIsMoney || kpi.unidad === 'MXN') return fmtMoney(kpi.valor);
    if (kpi.display != null && kpi.display !== '') return kpi.display;
    if (kpi.valor == null) return '—';
    if (kpi.unidad === '%') return `${kpi.valor}%`;
    return String(kpi.valor);
  }

  function formatMeta(kpi) {
    if (kpi.meta == null) return null;
    if (kpi.clave === 'F-1') return fmtMoney(kpi.meta);
    if (kpi.unidad === '%') return `${kpi.meta}%`;
    if (kpi.unidad === 'MXN' || kpi.displayIsMoney) return fmtMoney(kpi.meta);
    return String(kpi.meta);
  }

  function formatDetalleValue(key, value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) {
      if (!value.length) return '—';
      return `${value.length} ítem(s)`;
    }
    if (typeof value === 'string') {
      return FUENTE_LABELS[value] || value;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    const k = String(key).toLowerCase();
    if (k.includes('pct') || k.includes('margen') || k.includes('crecimiento') || k === 'realizacionpreciopct') {
      return `${value}%`;
    }
    if (
      k.includes('unidad')
      || k === 'unidades'
      || k === 'unidadesreales'
      || k === 'unidadesobjetivo'
      || k === 'unidadesplanpiso'
      || k === 'lineascommonto'
      || k === 'lineassinpl'
    ) {
      return String(Math.round(value));
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

  function kpiByClave(clave) {
    return (afData?.kpis || []).find((k) => k.clave === clave) || null;
  }

  function resolveBlock(blockDef) {
    const kpis = blockDef.claves.map(kpiByClave).filter(Boolean);
    if (!kpis.length) return null;
    const primary = kpis[0];
    const companions = kpis.slice(1);
    const rank = { rose: 3, amber: 2, slate: 1, blue: 1, green: 0 };
    const worstTone = kpis.reduce(
      (acc, k) => ((rank[k.tone] || 0) > (rank[acc] || 0) ? (k.tone || 'slate') : acc),
      primary.tone || 'slate'
    );
    const status = (() => {
      // El bloque sigue al KPI principal; companions sin meta no lo degradan a "Falta meta".
      if (primary.status === 'completo') {
        if (companions.some((k) => k.status === 'parcial' && k.valor != null)) return 'parcial';
        return 'completo';
      }
      if (primary.status === 'pendiente_meta') return 'pendiente_meta';
      return 'parcial';
    })();
    return {
      ...blockDef,
      primary,
      companions,
      kpis,
      tone: worstTone,
      status,
      clavesLabel: blockDef.claves.join(' · '),
    };
  }

  function buildBlocks() {
    return AF_BLOCKS.map(resolveBlock).filter(Boolean);
  }

  function companionShortLabel(kpi) {
    if (kpi.clave === 'F-2.1') return 'Brecha margen';
    if (kpi.clave === 'F-3.1') return 'Brecha gasto';
    if (kpi.clave === 'F-4.1') return 'PVR / unidad';
    if (kpi.clave === 'F-5') return 'Cobertura piso';
    if (kpi.clave === 'F-7.1') return 'Brecha estructura';
    return kpi.clave;
  }

  function renderBlockCard(block) {
    const isOpen = activeBlockId === block.id;
    const tone = block.tone || 'slate';
    const companionsHtml = block.companions.length
      ? `<ul class="af-kpi-block__companions">${block.companions.map((c) => `
          <li>
            <span class="af-kpi-block__comp-clave">${escHtml(c.clave)}</span>
            <span class="af-kpi-block__comp-label">${escHtml(companionShortLabel(c))}</span>
            <strong class="af-kpi-block__comp-value">${formatDisplay(c)}</strong>
            <span class="af-kpi__status af-kpi__status--${escHtml(c.status || 'parcial')} af-kpi-block__comp-status">${statusLabel(c.status)}</span>
          </li>`).join('')}</ul>`
      : '';

    // Host con id fuera del <button>: las alertas inteligentes no pueden ir anidadas en otro button.
    return `<div class="af-kpi-block-host" id="${escHtml(block.elementId)}">
      <button type="button"
        class="eeff-edo-kpi eeff-edo-kpi--${tone} eeff-edo-kpi--interactive af-kpi af-kpi-block${isOpen ? ' is-open is-selected' : ''}"
        data-af-block="${escHtml(block.id)}" aria-pressed="${isOpen}" title="Ver detalle del bloque">
        <div class="eeff-edo-kpi__head">
          <span class="eeff-edo-kpi__clave">${escHtml(block.clavesLabel)}</span>
          <span class="af-kpi__status af-kpi__status--${escHtml(block.status)}">${statusLabel(block.status)}</span>
        </div>
        <div class="af-kpi-block__eyebrow">${escHtml(block.titulo)}</div>
        <div class="eeff-edo-kpi__label">${escHtml(block.primary.nombre)}</div>
        <div class="eeff-edo-kpi__value">${formatDisplay(block.primary)}</div>
        <p class="eeff-edo-kpi__sub">${escHtml(block.primary.descripcion || '')}</p>
        ${companionsHtml}
        <span class="af-kpi__hint">Clic para detalle</span>
      </button>
    </div>`;
  }

  function buildDetailSections(kpi) {
    const sections = [];

    const calcRows = [];
    if (kpi.formula) calcRows.push({ label: 'Fórmula', value: kpi.formula, text: true });
    if (kpi.numerador != null) {
      calcRows.push({
        label: kpi.clave === 'F-1' ? 'Numerador Σ(UR × PL lleno)' : 'Numerador',
        value: fmtMoney(kpi.numerador),
      });
    }
    if (kpi.denominador != null) {
      calcRows.push({
        label: kpi.clave === 'F-1' ? 'Denominador Σ(UO × PL lleno) · MOV' : 'Denominador',
        value: fmtMoney(kpi.denominador),
      });
    }
    if (kpi.valor != null) {
      calcRows.push({
        label: 'Resultado',
        value: formatDisplay(kpi),
        highlight: true,
      });
    }
    if (calcRows.length) sections.push({ title: `Cálculo · ${kpi.clave}`, rows: calcRows });

    const metaLabel = formatMeta(kpi);
    if (metaLabel != null || kpi.status) {
      const metaRows = [];
      if (metaLabel != null) {
        metaRows.push({
          label: kpi.clave === 'F-1' ? 'Monto Objetivo de Venta (MOV)' : 'Meta / presupuesto',
          value: metaLabel,
        });
      }
      metaRows.push({ label: 'Estado del dato', value: statusLabel(kpi.status) });
      if (kpi.clave === 'F-1' && kpi.valor != null) {
        const gap = Math.round((Number(kpi.valor) - 100) * 10) / 10;
        metaRows.push({
          label: 'Brecha vs 100% (pp)',
          value: `${gap > 0 ? '+' : ''}${gap} pp`,
        });
      } else if (kpi.valor != null && kpi.meta != null && kpi.unidad === '%') {
        const gap = Math.round((Number(kpi.valor) - Number(kpi.meta)) * 10) / 10;
        metaRows.push({
          label: 'Brecha vs meta (pp)',
          value: `${gap > 0 ? '+' : ''}${gap} pp`,
        });
      } else if (kpi.valor != null && kpi.meta != null && kpi.unidad === 'MXN') {
        const gap = Number(kpi.valor) - Number(kpi.meta);
        metaRows.push({ label: 'Brecha vs meta', value: fmtMoney(gap) });
      }
      sections.push({ title: `Meta · ${kpi.clave}`, rows: metaRows });
    }

    const d = kpi.detalle || {};
    const topMov = Array.isArray(d.topLineasMov) ? d.topLineasMov : [];
    const detRows = Object.entries(d)
      .filter(([key, v]) => v != null && v !== '' && key !== 'topLineasMov')
      .map(([key, value]) => ({
        label: DETALLE_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        value: formatDetalleValue(key, value),
      }));
    if (detRows.length) sections.push({ title: `Componentes · ${kpi.clave}`, rows: detRows });

    if (topMov.length) {
      sections.push({
        title: 'Top líneas del MOV (UO × PL lleno)',
        rows: topMov.map((r) => ({
          label: `${r.linea || '—'} · UO ${Number(r.uo || 0)} / UR ${Number(r.ur || 0)}`,
          value: `Obj ${fmtMoney(r.ventaObjetivo)} · Real@PL ${fmtMoney(r.ventaAPlReal)} (PL ${fmtMoney(r.pl)})`,
          text: true,
        })),
      });
    }

    if (kpi.nota) {
      sections.push({
        title: `Nota · ${kpi.clave}`,
        rows: [{ label: 'Observación', value: kpi.nota, text: true }],
      });
    }

    return sections;
  }

  function buildBlockDetailSections(block) {
    const sections = [];
    sections.push({
      title: 'Bloque',
      rows: [
        { label: 'Grupo', value: block.titulo, text: true },
        { label: 'Indicadores', value: block.clavesLabel, text: true },
      ],
    });
    for (const kpi of block.kpis) {
      sections.push(...buildDetailSections(kpi));
    }
    const resumen = afData?.resumen;
    if (resumen) {
      sections.push({
        title: 'Contexto del periodo',
        rows: [
          { label: 'Venta a PL lleno Σ(UR×PL)', value: fmtMoney(resumen.ventaAPl ?? resumen.ventaNetaReal) },
          { label: 'Venta facturada (c/bono)', value: fmtMoney(resumen.ventaNetaReal) },
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
    activeBlockId = null;
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

  function renderDetail(block) {
    const panel = document.getElementById('afKpiFloat');
    const backdrop = document.getElementById('afKpiFloatBackdrop');
    if (!panel || !backdrop || !block) {
      closeDetail();
      return;
    }

    const accent = accentFromTone(block.tone);
    const sections = buildBlockDetailSections(block);
    const icon = block.icon || KPI_ICONS[block.primary.clave] || 'analytics';
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

    const companionSummary = block.companions.length
      ? block.companions.map((c) => `${c.clave} ${formatDisplay(c)}`).join(' · ')
      : '';

    panel.dataset.accent = accent;
    panel.innerHTML = `
      <div class="bg-kpi-float__head bg-kpi-float__head--${accent}">
        <div class="bg-kpi-float__head-main">
          <div class="bg-kpi-float__icon bg-kpi-float__icon--${accent}" aria-hidden="true">
            <span class="material-symbols-outlined">${icon}</span>
          </div>
          <div>
            <p class="bg-kpi-float__eyebrow">${escHtml(block.titulo)} · ${escHtml(block.clavesLabel)}</p>
            <h3 class="bg-kpi-float__title" id="afKpiFloatTitle">${escHtml(block.primary.nombre)}</h3>
            <p class="bg-kpi-float__value">${formatDisplay(block.primary)}</p>
            ${companionSummary ? `<p class="bg-kpi-float__hint">${escHtml(companionSummary)}</p>` : ''}
            <p class="bg-kpi-float__hint">${escHtml(block.primary.descripcion || '')}</p>
            <span class="bg-kpi-float__meta">${escHtml(periodo)} · ${statusLabel(block.status)}</span>
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

  function renderGrid() {
    const primary = document.getElementById('afKpiPrimary');
    const secondary = document.getElementById('afKpiSecondary');
    if (!primary || !afData?.kpis) return;
    const blocks = buildBlocks();
    primary.innerHTML = blocks.map(renderBlockCard).join('');
    primary.classList.add('af-kpi-row--blocks');
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
        Ventas nuevos · 6 bloques (F-1…F-7.1) · clic para desglose · fuentes: ${bits.join(' · ') || 'contabilidad / DMS'}`;
    }

    // Reenganchar alertas: innerHTML destruye los botones de KpiInsights.
    applyAfInsights();
  }

  function openBlock(blockId) {
    const block = buildBlocks().find((b) => b.id === blockId);
    if (!block) return;
    if (activeBlockId === blockId) {
      closeDetail();
      return;
    }
    activeBlockId = blockId;
    renderGrid();
    renderDetail(block);
  }

  function bindGridClicks() {
    document.getElementById('afOverview')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-af-block]');
      if (!btn) return;
      openBlock(btn.getAttribute('data-af-block'));
    });

    document.getElementById('afKpiFloatBackdrop')?.addEventListener('click', closeDetail);
    document.getElementById('afKpiFloat')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-af-close-detail]')) closeDetail();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeBlockId) closeDetail();
    });
  }

  function applyAfInsights() {
    if (!window.KpiInsights?.apply || !afData?.kpis?.length) return;
    const afPayload = {
      periodo: afData.periodo,
      resumen: afData.resumen,
      kpis: afData.kpis,
    };
    const base = window.__contaInsightBase;
    const run = () => {
      if (typeof window.applyContabilidadInsights === 'function' && base) {
        window.applyContabilidadInsights();
        return;
      }
      window.KpiInsights.apply('contabilidad', {
        fechaInicio: afData.periodo?.fechaInicio,
        fechaFin: afData.periodo?.fechaFin,
        ...(base || {}),
        analisisFinanciero: afPayload,
      });
    };
    // Esperar un frame: el DOM del grid ya debe existir (ids afBlock*).
    requestAnimationFrame(() => {
      run();
      // Segunda pasada por si Contabilidad reaplica y gana la carrera.
      setTimeout(run, 120);
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

  window.AnalisisFinanciero = {
    load,
    closeDetail,
    getData: () => afData,
  };
})();
