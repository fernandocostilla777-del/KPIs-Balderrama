let selectedDailyFecha = null;
let activeMainTab = 'balance';
let bgKpiState = { items: [], activeId: null, fmt: null };

function getMainTabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'eeff') return 'eeff';
  if (tab === 'analisis' || tab === 'analisis-financiero') return 'analisis';
  if (tab === 'catalogo') return 'balance'; // catálogo oculto de momento
  if (tab === 'balance') return 'balance';
  return 'balance';
}

function switchMainTab(tab) {
  // Catálogo de cuentas oculto temporalmente
  if (tab === 'catalogo') tab = 'balance';
  activeMainTab = tab;
  if (tab !== 'balance') closeBgKpiFloat();
  if (tab !== 'eeff') window.EeffSummary?.closeKpiFloat?.();
  document.querySelectorAll('.contabilidad-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('panelContabilidadCatalogo')?.classList.toggle('hidden', tab !== 'catalogo');
  document.getElementById('panelContabilidadBalance')?.classList.toggle('hidden', tab !== 'balance');
  document.getElementById('panelContabilidadEeff')?.classList.toggle('hidden', tab !== 'eeff');
  document.getElementById('panelContabilidadAnalisis')?.classList.toggle('hidden', tab !== 'analisis');
  const scopePill = document.getElementById('pillScope');
  if (scopePill) scopePill.style.display = (tab === 'eeff' || tab === 'analisis') ? 'none' : '';

  if (tab === 'eeff' && window.EeffSummary?.getComparativa2026DefaultRange) {
    const fi = document.getElementById('fechaInicio');
    const ff = document.getElementById('fechaFin');
    const in2026 = window.EeffSummary.isComparativaYearRange(fi?.value, ff?.value);
    if (!in2026 && fi && ff) {
      const range = window.EeffSummary.getComparativa2026DefaultRange();
      fi.value = range.fechaInicio;
      ff.value = range.fechaFin;
      setTimeout(() => document.getElementById('btnConsultar')?.click(), 0);
    }
  }

  if (tab === 'analisis') {
    const fi = document.getElementById('fechaInicio')?.value;
    const ff = document.getElementById('fechaFin')?.value;
    if (fi && ff) window.AnalisisFinanciero?.load?.(fi, ff);
  }

  const url = new URL(window.location.href);
  if (tab === 'eeff' || tab === 'balance' || tab === 'analisis') url.searchParams.set('tab', tab);
  else url.searchParams.delete('tab');
  window.history.replaceState({}, '', url.pathname + url.search);
}

function moneyClass(value) {
  const n = Number(value) || 0;
  if (n < 0) return 'cell-negative';
  if (n > 0) return 'cell-positive';
  return '';
}

function formatKpiAmount(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1_000_000) return Dashboard.fmt.currency(n);
  return Dashboard.fmt.money(n);
}

/** Importes completos (sin $313.0M) — Balance General */
function formatFullMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Dashboard.fmt.money(value);
}

function setSignedKpi(valueId, cardId, value, subId, subText, marginPct) {
  const el = document.getElementById(valueId);
  const card = cardId ? document.getElementById(cardId) : el?.closest('.kpi-card');
  const sub = subId ? document.getElementById(subId) : null;
  const n = Number(value) || 0;

  if (el) {
    el.textContent = formatKpiAmount(n);
    el.classList.remove('kpi-value--negative', 'kpi-value--positive');
    if (n < 0) el.classList.add('kpi-value--negative');
    else if (n > 0) el.classList.add('kpi-value--positive');
  }

  if (card) {
    card.classList.remove('kpi-card--loss', 'kpi-card--gain', 'kpi-card--green', 'kpi-card--violet', 'kpi-card--amber', 'kpi-card--slate');
    if (n < 0) card.classList.add('kpi-card--loss');
    else if (n > 0) card.classList.add('kpi-card--gain');
  }

  if (sub) {
    sub.textContent = subText;
    sub.classList.remove('kpi-subtitle--loss', 'kpi-subtitle--gain', 'kpi-subtitle--warn');
    if (marginPct != null && marginPct < 0) sub.classList.add('kpi-subtitle--loss');
    else if (marginPct != null && marginPct > 0) sub.classList.add('kpi-subtitle--gain');
  }
}

function setPlainKpi(valueId, value, suffix = '') {
  const el = document.getElementById(valueId);
  if (!el) return;
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) {
    el.textContent = '—';
    return;
  }
  el.textContent = suffix ? `${n}${suffix}` : formatKpiAmount(n);
}

function renderCatalogLines(tbodyId, lines, fmt) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin movimiento en el periodo.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    const cls = moneyClass(row.value);
    const indent = row.level ? ` style="padding-left:${row.level * 16}px"` : '';
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td${indent}>${row.label}</td>
      <td class="cell-money ${cls}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderResultadoTable(lines, fmt) {
  const body = document.getElementById('resultadoTable');
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin datos.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    if (row.suffix === '%') {
      return `
      <tr>
        <td>${row.label}</td>
        <td class="cell-num ${moneyClass(row.value)}"><strong>${row.value ?? '—'}%</strong></td>
      </tr>`;
    }
    const isMoney = row.group !== 'ratio' || row.key === 'puntoEquilibrio';
    const display = row.value == null && row.key === 'puntoEquilibrio'
      ? '—'
      : isMoney ? fmt.money(row.value) : row.value;
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td>${row.label}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${display}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderDepartmentExpenseTable(departments, fmt) {
  const body = document.getElementById('departmentExpenseTable');
  const foot = document.getElementById('departmentExpenseFoot');
  if (!body) return;
  if (!departments?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Sin departamentos para el alcance.</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  let total = 0;
  body.innerHTML = departments.map((row) => {
    total += Number(row.value || 0);
    return `
    <tr>
      <td>${row.label}</td>
      <td class="cell-num">${row.gpoCont || '—'}</td>
      <td class="cell-num">${row.accountCount ?? '—'}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>`;
  }).join('');
  if (foot) {
    foot.innerHTML = `
      <tr class="row-highlight">
        <td colspan="3"><strong>Total departamentos</strong></td>
        <td class="cell-money"><strong>${fmt.money(total)}</strong></td>
      </tr>`;
  }
}

function renderBalanceTable(balance, fmt) {
  const body = document.getElementById('balanceTable');
  if (!body) return;
  if (!balance?.available) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin balance para el periodo.</td></tr>';
    return;
  }
  const rows = (balance.sections || []).map((s) => [s.label, s.value]);
  if (balance.consolidated !== false) {
    rows.push(['Total activo', balance.totals.activoTotal]);
    rows.push(['Total pasivo', balance.totals.pasivoTotal]);
    rows.push(['Capital contable', balance.totals.capital]);
  }
  body.innerHTML = rows.map(([label, value]) => `
    <tr>
      <td>${label}</td>
      <td class="cell-money ${moneyClass(value)}"><strong>${fmt.money(value)}</strong></td>
    </tr>
  `).join('');
}

function sectionValue(bg, key) {
  return (bg?.sections || []).find((s) => s.key === key)?.value ?? null;
}

function formatRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function bgAccountsAsRows(accounts) {
  return (accounts || [])
    .filter((a) => Math.abs(Number(a.value || 0)) > 0.005)
    .map((a) => ({
      cuenta: a.cuenta,
      label: a.label,
      value: Number(a.value || 0),
    }));
}

function buildBgKpiItems(bg) {
  if (!bg?.available) return [];
  const by = bg.accountsBySection || {};
  const L = bg.liquidez || {};
  const sec = (key) => by[key] || [];
  const secLabel = (key) => (bg.sections || []).find((s) => s.key === key)?.label || key;

  const activoCirc = bgAccountsAsRows(sec('activoCirculante'));
  const activoFijo = bgAccountsAsRows(sec('activoFijo'));
  const activoDif = bgAccountsAsRows(sec('activoDiferido'));
  const pasivoCp = bgAccountsAsRows(sec('pasivoCortoPlazo'));
  const pasivoLp = bgAccountsAsRows(sec('pasivoLargoPlazo'));
  const capital = bgAccountsAsRows(sec('capital'));

  const items = [
    {
      id: 'activoCirculante',
      label: 'Activo circulante',
      value: sectionValue(bg, 'activoCirculante'),
      icon: 'account_balance_wallet',
      color: 'blue',
      sub: 'Caja, bancos, CxC, inventarios…',
      hint: 'Cuentas mayor de activo circulante · saldo Contpaq',
      groups: [{ title: secLabel('activoCirculante'), rows: activoCirc }],
    },
    {
      id: 'activoFijo',
      label: 'Activo fijo',
      value: sectionValue(bg, 'activoFijo'),
      icon: 'precision_manufacturing',
      color: 'slate',
      sub: 'Equipo neto de depreciaciones',
      hint: 'Activo fijo y depreciaciones acumuladas',
      groups: [{ title: secLabel('activoFijo'), rows: activoFijo }],
    },
    {
      id: 'activoDiferido',
      label: 'Activo diferido',
      value: sectionValue(bg, 'activoDiferido'),
      icon: 'pending',
      color: 'violet',
      sub: 'Inversiones y seguros anticipados',
      hint: 'Cuentas de activo diferido',
      groups: [{ title: secLabel('activoDiferido'), rows: activoDif }],
    },
    {
      id: 'activoTotal',
      label: 'Total activo',
      value: bg.totals?.activoTotal,
      icon: 'account_balance',
      color: 'blue',
      sub: 'Circulante + fijo + diferido',
      hint: 'Suma de las tres secciones de activo',
      groups: [
        { title: 'Activo circulante', rows: activoCirc, total: sectionValue(bg, 'activoCirculante') },
        { title: 'Activo fijo', rows: activoFijo, total: sectionValue(bg, 'activoFijo') },
        { title: 'Activo diferido', rows: activoDif, total: sectionValue(bg, 'activoDiferido') },
      ],
    },
    {
      id: 'pasivoCirculante',
      label: 'Pasivo circulante',
      value: sectionValue(bg, 'pasivoCortoPlazo'),
      icon: 'credit_card',
      color: 'amber',
      sub: 'Proveedores, plan piso, impuestos…',
      hint: 'Obligaciones de corto plazo',
      groups: [{ title: secLabel('pasivoCortoPlazo'), rows: pasivoCp }],
    },
    {
      id: 'pasivoLargo',
      label: 'Pasivo largo plazo',
      value: sectionValue(bg, 'pasivoLargoPlazo'),
      icon: 'event_upcoming',
      color: 'amber',
      sub: 'Provisiones',
      hint: 'Obligaciones de largo plazo',
      groups: [{ title: secLabel('pasivoLargoPlazo'), rows: pasivoLp }],
    },
    {
      id: 'pasivoTotal',
      label: 'Total pasivo',
      value: bg.totals?.pasivoTotal,
      icon: 'payments',
      color: 'slate',
      sub: 'Circulante + largo plazo',
      hint: 'Suma de pasivo circulante y largo plazo',
      groups: [
        { title: 'Pasivo circulante', rows: pasivoCp, total: sectionValue(bg, 'pasivoCortoPlazo') },
        { title: 'Pasivo largo plazo', rows: pasivoLp, total: sectionValue(bg, 'pasivoLargoPlazo') },
      ],
    },
    {
      id: 'capital',
      label: 'Capital contable',
      value: bg.totals?.capital,
      icon: 'savings',
      color: 'green',
      sub: '0360 · 0370 · 0385 · 0386 · Resultado',
      hint: 'Capital + resultado del ejercicio (PyG YTD)',
      groups: [{ title: 'Capital contable', rows: capital }],
    },
  ];

  if (L.disponible) {
    const liqFacts = [
      { label: 'Activo circulante', value: L.activoCirculante },
      { label: 'Pasivo a corto plazo', value: L.pasivoCirculante },
      { label: 'Capital de trabajo', value: L.capitalTrabajo },
      { label: 'Caja + Bancos + Equivalentes', value: L.efectivoYEquivalentes },
      { label: 'Cuentas por cobrar', value: L.cuentasPorCobrar },
      { label: 'Numerador prueba ácida', value: L.activosRapidos },
    ];
    const efRows = (L.desglose?.efectivo || []).map((a) => ({
      cuenta: a.cuenta, label: a.label, value: a.value,
    }));
    const cxcRows = (L.desglose?.cxc || []).map((a) => ({
      cuenta: a.cuenta, label: a.label, value: a.value,
    }));
    const rapRows = (L.desglose?.rapidos || [...efRows, ...cxcRows]).map((a) => ({
      cuenta: a.cuenta, label: a.label, value: a.value,
    }));

    items.push(
      {
        id: 'capitalTrabajo',
        label: 'Capital de trabajo',
        value: L.capitalTrabajo,
        display: formatFullMoney(L.capitalTrabajo),
        icon: 'account_balance_wallet',
        color: L.capitalTrabajo < 0 ? 'rose' : 'green',
        sub: L.margenSobreAcPct != null ? `${L.margenSobreAcPct}% del AC · clic para desglose` : 'AC − PC · clic',
        hint: L.formula?.capitalTrabajo || 'Activo circulante − Pasivo circulante',
        interpretacion: [
          Number(L.capitalTrabajo) >= 0
            ? 'Capital de trabajo positivo: el activo circulante cubre el plan piso, los proveedores de refacciones y los impuestos por pagar.'
            : 'Capital de trabajo negativo: el plan piso y los proveedores superan al activo circulante. La agencia está financiando la operación con vencimientos de corto plazo.',
          'Es el colchón con el que la agencia sostiene inventario de unidades y refacciones, cartera de garantías y la nómina del taller.',
          L.margenSobreAcPct != null ? `Representa ${L.margenSobreAcPct}% del activo circulante.` : null,
        ].filter(Boolean).join(' '),
        hostId: 'kpiBgCapitalTrabajo',
        facts: liqFacts,
        groups: [
          { title: 'Activo circulante (detalle)', rows: activoCirc, total: L.activoCirculante },
          { title: 'Pasivo circulante (detalle)', rows: pasivoCp, total: L.pasivoCirculante },
        ],
      },
      {
        id: 'razonCirculante',
        label: 'Razón circulante',
        value: L.razonCirculante,
        display: formatRatio(L.razonCirculante),
        icon: 'water_drop',
        color: liquidezToneClass(L.interpretacion?.tone),
        sub: `${L.interpretacion?.label || 'AC ÷ PC'} · clic`,
        hint: L.formula?.razonCirculante || 'Activo circulante ÷ Pasivo circulante',
        interpretacion: [
          L.interpretacion?.summary || L.lectura?.razon,
          'Mide cuántas veces el activo circulante cubre las obligaciones de corto plazo, que en una agencia son principalmente el plan piso de unidades nuevas y seminuevas.',
          'Referencia de agencia: menos de 1.10 insuficiente, 1.10 a 1.30 ajustada, 1.30 a 1.60 sana, arriba de 1.60 holgada. Es un rango más bajo que el de una empresa comercial porque el plan piso infla el pasivo circulante.',
        ].filter(Boolean).join(' '),
        hostId: 'kpiBgRazonCirculante',
        facts: liqFacts,
        groups: [
          { title: 'Activo circulante', rows: activoCirc, total: L.activoCirculante },
          { title: 'Pasivo circulante', rows: pasivoCp, total: L.pasivoCirculante },
        ],
      },
      {
        id: 'pruebaAcida',
        label: 'Prueba ácida',
        value: L.pruebaAcida,
        display: formatRatio(L.pruebaAcida),
        icon: 'science',
        color: liquidezToneClass(L.acidTone),
        sub: '(Caja+Bancos+Equiv.+CxC) ÷ PC · clic',
        hint: L.formula?.pruebaAcida || '(Caja + Bancos + Equivalentes + CxC) ÷ Pasivo a corto plazo',
        interpretacion: [
          L.lectura?.acida,
          'Mide con qué cubre la agencia su pasivo de corto plazo sin vender una sola unidad: caja, bancos, contratos en tránsito y cuentas por cobrar de garantías y aseguradoras.',
          'Referencia de agencia: 0.70 o más es sano, 0.50 a 0.69 ajustada, menos de 0.50 alerta. No se pide 1.00 como en otros giros porque el inventario de piso es, por diseño, el activo más grande y está financiado con plan piso.',
        ].filter(Boolean).join(' '),
        hostId: 'kpiBgPruebaAcida',
        facts: [
          ...liqFacts,
          { label: 'Déficit / excedente ácido', value: L.deficitAcido },
        ],
        groups: [
          { title: 'Caja + Bancos + Equivalentes', rows: efRows, total: L.efectivoYEquivalentes },
          { title: 'Cuentas por cobrar', rows: cxcRows, total: L.cuentasPorCobrar },
          { title: 'Numerador (efectivo + CxC)', rows: rapRows, total: L.activosRapidos },
          { title: 'Pasivo a corto plazo', rows: pasivoCp, total: L.pasivoCirculante },
        ],
      },
    );
  }

  const E = bg.estructura || {};
  const D = bg.dso || {};
  const CE = bg.cicloEfectivo || {};
  const DRI = bg.dri || {};
  const DPO = bg.dpo || {};
  const C = bg.coberturaCt || {};
  const V = bg.vitales || {};
  const udm = bg.ebitMetrics?.udm || {};
  if (E.disponible) {
    const estFacts = [
      { label: 'Activo total', value: E.activoTotal },
      { label: 'Pasivo total', value: E.pasivoTotal },
      { label: 'Pasivo corto plazo', value: E.pasivoCorto },
      { label: 'Pasivo largo plazo', value: E.pasivoLargo },
      { label: 'Capital contable', value: E.capital },
    ];
    items.push(
      {
        id: 'endeudamiento',
        label: 'Endeudamiento',
        value: E.endeudamientoPct,
        display: E.endeudamientoPct != null ? `${E.endeudamientoPct}%` : '—',
        icon: 'percent',
        color: liquidezToneClass(E.endeudamientoTone || evalEndeudamientoStatus(E.endeudamientoPct).tone),
        sub: `${E.endeudamientoLabel || '% activo con deuda'} · agencia 60–80% · clic`,
        hint: E.formula?.endeudamiento || 'Pasivo total ÷ Activo total × 100',
        interpretacion: [
          E.endeudamientoSummary,
          'Mide qué parte del activo está financiada con deuda. En una agencia de autos nuevos el plan piso es la fuente natural de financiamiento del inventario, así que un endeudamiento alto es parte del modelo y no una señal de riesgo por sí solo.',
          'Referencia de agencia: 60% a 80% es lo normal. Por debajo de 60% se está usando capital propio donde el plan piso sale más barato; arriba de 80% conviene revisar capitalización, y arriba de 88% es alerta.',
        ].filter(Boolean).join(' '),
        facts: estFacts,
        groups: [
          { title: 'Pasivo circulante', rows: pasivoCp, total: E.pasivoCorto },
          { title: 'Pasivo largo plazo', rows: pasivoLp, total: E.pasivoLargo },
          { title: 'Capital contable', rows: capital, total: E.capital },
        ],
      },
      {
        id: 'autonomia',
        label: 'Ratio de autonomía',
        value: E.autonomiaPct,
        display: E.autonomiaPct != null ? `${E.autonomiaPct}%` : '—',
        icon: 'diversity_3',
        color: liquidezToneClass(E.autonomiaTone || evalAutonomiaStatus(E.autonomiaPct).tone),
        sub: `${E.autonomiaLabel || '% activo con capital'} · agencia 20–40% · clic`,
        hint: E.formula?.autonomia || 'Capital contable ÷ Activo total × 100',
        interpretacion: [
          E.autonomiaSummary,
          'Es el complemento del endeudamiento: qué parte del activo sostiene el capital de los accionistas y no el plan piso ni los proveedores.',
          'Referencia de agencia: 20% a 40%. Por debajo de 20% la agencia opera con muy poco capital propio y cualquier caída de margen pega directo al patrimonio; por encima de 40% hay capital que podría trabajar mejor apoyándose en plan piso.',
        ].filter(Boolean).join(' '),
        facts: estFacts,
        groups: [
          { title: 'Capital contable', rows: capital, total: E.capital },
          { title: 'Activo total', rows: [...activoCirc, ...activoFijo, ...activoDif], total: E.activoTotal },
        ],
      },
      {
        id: 'apalancamiento',
        label: 'Apalancamiento',
        value: E.apalancamiento,
        display: E.apalancamientoDisplay
          || (E.apalancamiento != null ? `${formatRatio(E.apalancamiento)}×` : '—'),
        icon: 'balance',
        color: liquidezToneClass(E.apalancamientoTone || evalApalancamientoStatus(E.apalancamiento).tone),
        sub: `${E.apalancamientoLabel || 'Deuda neta ÷ EBITDA UDM'} · clic`,
        hint: E.formula?.apalancamiento || 'Deuda neta ÷ EBITDA UDM',
        interpretacion: [
          E.apalancamientoSummary,
          'Deuda neta = Pasivo total − (Caja + Bancos + Equivalentes a efectivo), e incluye el plan piso de unidades nuevas y seminuevas.',
          'Mide cuántos años de EBITDA se necesitarían para liquidar esa deuda neta.',
          'Referencia de agencia: hasta 3.00× se considera manejable porque el plan piso es autoliquidable con la venta de las unidades; de 3.01× a 4.50× atención, y arriba de 4.50× la carga es alta incluso para el giro. Con EBITDA negativo el ratio no es medible y se marca en alerta.',
          udm.fechaInicio ? `Ventana UDM considerada: ${udm.fechaInicio} a ${udm.fechaFin}.` : null,
        ].filter(Boolean).join(' '),
        facts: [
          { label: 'Pasivo total', value: E.pasivoTotal },
          { label: 'Caja + Bancos + Equivalentes', value: E.efectivoYEquivalentes },
          { label: 'Deuda neta', value: E.deudaNeta },
          { label: 'EBITDA UDM', value: E.ebitdaUdm ?? udm.ebitda },
        ],
        groups: [
          { title: 'Pasivo total', rows: [...pasivoCp, ...pasivoLp], total: E.pasivoTotal },
          {
            title: 'Caja + Bancos + Equivalentes',
            rows: (L.desglose?.efectivo || []).map((a) => ({
              cuenta: a.cuenta, label: a.label, value: a.value,
            })),
            total: E.efectivoYEquivalentes,
          },
          {
            title: udm.fechaInicio
              ? `EBITDA UDM · ${udm.fechaInicio} a ${udm.fechaFin}`
              : 'EBITDA UDM',
            rows: [
              { cuenta: '', label: 'EBIT (utilidad de operación UDM)', value: udm.ebit },
              { cuenta: '', label: 'Depreciación y amortización UDM', value: udm.depreciacionPeriodo },
            ].filter((r) => Number.isFinite(Number(r.value))),
            total: E.ebitdaUdm ?? udm.ebitda,
          },
        ],
      },
      {
        id: 'calidadDeuda',
        label: 'Calidad de la deuda',
        value: E.calidadDeuda?.cortoPct,
        display: E.calidadDeuda?.cortoPct != null ? `${E.calidadDeuda.cortoPct}%` : '—',
        icon: 'schedule',
        color: liquidezToneClass(E.calidadDeuda?.tone),
        sub: `${E.calidadDeuda?.label || '% pasivo corto'} · clic`,
        hint: E.formula?.calidadDeuda || 'Pasivo corto ÷ Pasivo total × 100',
        interpretacion: [
          E.calidadDeuda?.summary,
          'Mide qué tan urgente es pagar: qué parte del pasivo vence en el corto plazo, no cuánta deuda hay en total.',
          E.calidadDeuda?.largoPct != null
            ? `Composición: ${E.calidadDeuda.cortoPct}% corto / ${E.calidadDeuda.largoPct}% largo.`
            : null,
          'Referencia de agencia: hasta 85% en corto plazo es normal, porque el plan piso y los proveedores de refacciones vencen a corto y se liquidan con la venta de unidades y las órdenes de taller. De 85% a 93% conviene migrar a largo plazo el pasivo que no es plan piso; arriba de 93% la agencia carece de deuda estructural y cualquier tropiezo de flujo se vuelve presión inmediata.',
        ].filter(Boolean).join(' '),
        facts: estFacts,
        groups: [
          { title: 'Pasivo corto plazo', rows: pasivoCp, total: E.pasivoCorto },
          { title: 'Pasivo largo plazo', rows: pasivoLp, total: E.pasivoLargo },
        ],
      },
    );
  }

  if (D.disponible || D.dsoDias != null) {
    const cxcRowsDso = (L.desglose?.cxc || []).map((a) => ({
      cuenta: a.cuenta, label: a.label, value: a.value,
    }));
    items.push({
      id: 'dso',
      label: 'Días de Cuentas por Cobrar',
      value: D.dsoDias,
      display: D.dsoDias != null ? `${D.dsoDias} d` : '—',
      icon: 'timelapse',
      color: liquidezToneClass(D.tone),
      sub: `${D.label || 'Recuperación de cartera'} · clic`,
      hint: D.formula || '(CxC sin IVA ÷ Ventas del periodo) × días del periodo',
      interpretacion: [
        D.summary,
        'Fórmula: (CxC sin IVA ÷ Ventas del periodo) × días del periodo. CxC sin IVA = CxC ÷ 1.16.',
        'Mide cuántos días tarda la agencia en cobrar lo que ya facturó: contratos en tránsito con financiadoras, reclamaciones de garantía a fábrica, cuentas con aseguradoras y flotillas.',
        'Referencia de agencia: 20 días o menos. Los contratos con financiadoras deben liquidarse en días una vez completo el expediente; de 21 a 35 días hay expedientes atorados, y arriba de 35 días la cartera está deteniendo caja que debería estar pagando plan piso.',
      ].filter(Boolean).join(' '),
      facts: [
        { label: 'CxC (con IVA)', value: D.cuentasPorCobrar },
        { label: 'CxC sin IVA (÷ 1.16)', value: D.cuentasPorCobrarSinIva },
        { label: 'Ventas del periodo', value: D.ventas },
      ],
      groups: [{
        title: 'Cuentas por cobrar',
        rows: cxcRowsDso,
        total: D.cuentasPorCobrar,
      }],
    });
  }

  if (CE.disponible || CE.cicloDias != null) {
    const fmtDias = (n) => (n != null && Number.isFinite(Number(n)) ? `${n} días` : '—');
    items.push({
      id: 'cicloEfectivo',
      label: 'Ciclo de efectivo',
      value: CE.cicloDias,
      display: CE.cicloDias != null ? `${CE.cicloDias} d` : '—',
      icon: 'sync',
      color: liquidezToneClass(CE.tone),
      sub: `${CE.label || 'DRI + DRC − DRP'} · clic`,
      hint: CE.formula || 'DRI + DRC − DRP',
      interpretacion: [
        CE.summary,
        'Fórmula: días de rotación de inventario + días de cuentas por cobrar − días de pago a proveedores.',
        'Mide cuántos días pasa el dinero comprometido en la operación desde que se recibe la unidad o la refacción hasta que el cliente paga.',
        'Referencia de agencia: 50 días o menos, que resulta de unos 60 días de piso más el cobro, menos el plazo de proveedores. De 51 a 70 días presiona la caja, y arriba de 70 la unidad se está pagando mucho antes de venderse. Nota: el plan piso no entra en los días de proveedores porque es deuda financiera, no crédito comercial.',
      ].filter(Boolean).join(' '),
      facts: [
        { label: 'DRI (inventario)', display: fmtDias(CE.driDias ?? DRI.driDias) },
        { label: 'DRC (cuentas por cobrar)', display: fmtDias(CE.dsoDias ?? D.dsoDias) },
        { label: 'DRP (pago a proveedores)', display: fmtDias(CE.dpoDias ?? DPO.dpoDias) },
        { label: 'Ciclo de efectivo', display: fmtDias(CE.cicloDias) },
        { label: 'Inventario', value: DRI.inventario },
        { label: 'CxC sin IVA', value: D.cuentasPorCobrarSinIva },
        { label: 'CxP proveedores', value: DPO.cxpProveedores },
        { label: 'Costo de ventas', value: DRI.costoVentas ?? DPO.costoVentas },
        { label: 'Ventas del periodo', value: D.ventas },
      ],
      groups: [
        {
          title: 'Inventario (DRI)',
          rows: (L.desglose?.inventarios || []).map((a) => ({
            cuenta: a.cuenta, label: a.label, value: a.value,
          })),
          total: DRI.inventario,
        },
        {
          title: 'Cuentas por cobrar (DRC)',
          rows: (L.desglose?.cxc || []).map((a) => ({
            cuenta: a.cuenta, label: a.label, value: a.value,
          })),
          total: D.cuentasPorCobrar,
        },
        {
          title: 'Proveedores 0300 (DRP)',
          rows: (by.pasivoCortoPlazo || [])
            .filter((a) => String(a.cuenta || '').startsWith('0300-'))
            .map((a) => ({ cuenta: a.cuenta, label: a.label, value: Math.abs(Number(a.value || 0)) })),
          total: DPO.cxpProveedores,
        },
      ],
    });
  }

  const coberturaCtKpi = C.disponible || C.cobertura != null || C.necesidadCiclo != null;
  if (coberturaCtKpi) {
    items.push({
      id: 'coberturaCt',
      label: 'Cobertura del capital de trabajo',
      value: C.cobertura,
      display: C.display || (C.cobertura != null ? `${formatRatio(C.cobertura)}×` : '—'),
      icon: 'shield',
      color: liquidezToneClass(C.tone),
      sub: `${C.label || 'CT ÷ necesidad del ciclo'} · clic`,
      hint: C.formula || 'Capital de trabajo ÷ (Inventario + CxC sin IVA − CxP − Plan piso)',
      interpretacion: [
        C.summary,
        'Mide cuántas veces el capital de trabajo cubre lo que la agencia realmente debe financiar con recursos propios: inventario más cartera, descontando lo que ya financian los proveedores y el plan piso de unidades nuevas y seminuevas.',
        'Referencia de agencia: 1.20× o más es holgado, de 1.00× a 1.19× cubre justo y por debajo de 1.00× la operación se está sosteniendo con pasivo de corto plazo.',
      ].filter(Boolean).join(' '),
      facts: [
        { label: 'Capital de trabajo (AC − PC)', value: C.capitalTrabajo },
        { label: 'Necesidad del ciclo (neta de plan piso)', value: C.necesidadCiclo },
        { label: 'Inventario', value: C.inventario },
        { label: 'CxC sin IVA', value: C.cuentasPorCobrarSinIva },
        { label: 'CxP proveedores', value: C.cxpProveedores },
        { label: 'Plan piso (0310 + 0311)', value: C.planPiso },
      ],
      groups: [
        {
          title: 'Inventario',
          rows: (L.desglose?.inventarios || []).map((a) => ({
            cuenta: a.cuenta, label: a.label, value: a.value,
          })),
          total: C.inventario,
        },
        {
          title: 'Cuentas por cobrar',
          rows: (L.desglose?.cxc || []).map((a) => ({
            cuenta: a.cuenta, label: a.label, value: a.value,
          })),
          total: D.cuentasPorCobrar,
        },
        {
          title: 'Proveedores 0300',
          rows: (by.pasivoCortoPlazo || [])
            .filter((a) => String(a.cuenta || '').startsWith('0300-'))
            .map((a) => ({ cuenta: a.cuenta, label: a.label, value: Math.abs(Number(a.value || 0)) })),
          total: C.cxpProveedores,
        },
        {
          title: 'Plan piso (financia el inventario de unidades)',
          rows: (by.pasivoCortoPlazo || [])
            .filter((a) => /^03(10|11)-/.test(String(a.cuenta || '')))
            .map((a) => ({ cuenta: a.cuenta, label: a.label, value: Math.abs(Number(a.value || 0)) })),
          total: C.planPiso,
        },
      ],
    });
  }

  const crecimientoUtilidad = V.crecimientoUtilidad || {};
  items.push({
    id: 'crecimientoUtilidad',
    label: 'Crecimiento de utilidad',
    value: crecimientoUtilidad.valorPct,
    display: crecimientoUtilidad.valorPct != null ? `${crecimientoUtilidad.valorPct}%` : '—',
    icon: 'trending_up',
    color: liquidezToneClass(crecimientoUtilidad.tone),
    sub: `${crecimientoUtilidad.label || 'Vs periodo comparable'} · clic`,
    hint: crecimientoUtilidad.formula,
    interpretacion: [
      crecimientoUtilidad.summary,
      'Compara la utilidad del periodo contra el mismo periodo del año anterior, que es la comparación válida en agencias por la estacionalidad de fin de año, buen fin y cambios de modelo.',
      'Referencia de agencia: 5% o más es crecimiento real por encima de la inflación; entre 0% y 5% se crece en pesos pero se pierde terreno; caídas mayores a 5% son alerta.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Utilidad actual', value: crecimientoUtilidad.utilidadActual },
      { label: 'Utilidad comparable', value: crecimientoUtilidad.utilidadAnterior },
    ],
    groups: crecimientoUtilidad.groups || [],
  });

  const crecimientoEbit = V.crecimientoEbit || {};
  items.push({
    id: 'crecimientoEbit',
    label: 'Crecimiento EBIT',
    value: crecimientoEbit.valorPct,
    display: crecimientoEbit.valorPct != null ? `${crecimientoEbit.valorPct}%` : '—',
    icon: 'show_chart',
    color: liquidezToneClass(crecimientoEbit.tone),
    sub: `${crecimientoEbit.label || 'UAFI comparable'} · clic`,
    hint: crecimientoEbit.formula,
    interpretacion: [
      crecimientoEbit.summary,
      'Mide el crecimiento de la utilidad operativa antes de intereses e impuestos. Es la lectura más limpia del desempeño de la agencia porque aísla el costo del plan piso y de la deuda bancaria.',
      'Referencia de agencia: 5% o más es crecimiento real; entre 0% y 5% se avanza por debajo de la inflación; caídas mayores a 5% son alerta. Si el EBIT cae mientras las ventas crecen, el problema está en gastos de la casa o en el mix de departamentos.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'EBIT actual', value: crecimientoEbit.ebitActual ?? crecimientoEbit.actual },
      { label: 'EBIT comparable', value: crecimientoEbit.ebitAnterior ?? crecimientoEbit.anterior },
    ],
    groups: crecimientoEbit.groups || [],
  });

  const crecimientoVentas = V.crecimientoVentas || {};
  items.push({
    id: 'crecimientoVentas',
    label: 'Crecimiento de ventas',
    value: crecimientoVentas.valorPct,
    display: crecimientoVentas.valorPct != null ? `${crecimientoVentas.valorPct}%` : '—',
    icon: 'payments',
    color: liquidezToneClass(crecimientoVentas.tone),
    sub: `${crecimientoVentas.label || 'Vs periodo comparable'} · clic`,
    hint: crecimientoVentas.formula,
    interpretacion: [
      crecimientoVentas.summary,
      'Compara las ventas netas del periodo contra el mismo periodo del año anterior, sumando autos nuevos, seminuevos, refacciones, taller y F&I.',
      'Referencia de agencia: 5% o más es crecimiento real; entre 0% y 5% se crece por debajo de la inflación y normalmente significa perder participación de mercado; caídas mayores a 5% son alerta y deben contrastarse con la asignación de fábrica y el mercado de la zona.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Ventas actuales', value: crecimientoVentas.actual },
      { label: 'Ventas comparables', value: crecimientoVentas.anterior },
    ],
    groups: crecimientoVentas.groups || [],
  });

  const crecimientoUtilidadBruta = V.crecimientoUtilidadBruta || {};
  items.push({
    id: 'crecimientoUtilidadBruta',
    label: 'Crecimiento utilidad bruta',
    value: crecimientoUtilidadBruta.valorPct,
    display: crecimientoUtilidadBruta.valorPct != null ? `${crecimientoUtilidadBruta.valorPct}%` : '—',
    icon: 'stacked_line_chart',
    color: liquidezToneClass(crecimientoUtilidadBruta.tone),
    sub: `${crecimientoUtilidadBruta.label || 'Vs periodo comparable'} · clic`,
    hint: crecimientoUtilidadBruta.formula,
    interpretacion: [
      crecimientoUtilidadBruta.summary,
      'Mide si la utilidad después del costo de ventas crece o se contrae contra el periodo comparable. Es el indicador que revela si la agencia está creciendo con margen o solo colocando unidades a precio castigado.',
      'Referencia de agencia: 5% o más es crecimiento real. Si las ventas suben pero la utilidad bruta no, se está sacrificando margen por unidad y hay que revisar descuentos, apoyos de fábrica y el peso de refacciones y taller en el mix.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Utilidad bruta actual', value: crecimientoUtilidadBruta.actual },
      { label: 'Utilidad bruta comparable', value: crecimientoUtilidadBruta.anterior },
    ],
    groups: crecimientoUtilidadBruta.groups || [],
  });

  const roe = V.roe || {};
  items.push({
    id: 'roe',
    label: 'ROE',
    value: roe.valorPct,
    display: roe.valorPct != null ? `${roe.valorPct}%` : '—',
    icon: 'account_balance',
    color: liquidezToneClass(roe.tone),
    sub: `${roe.label || 'Retorno sobre capital'} · clic`,
    hint: roe.formula,
    interpretacion: [
      roe.summary,
      'Mide cuánto retornó el capital de los accionistas durante el periodo. En agencias es el indicador que decide si conviene mantener la inversión en la franquicia frente a otras alternativas.',
      'Referencia de agencia: 15% a 25% anual es lo que se espera de una agencia bien administrada. Por debajo de 15% el patrimonio rinde poco, y en negativo se está consumiendo capital.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Utilidad del periodo', value: roe.utilidadPeriodo },
      { label: 'Capital contable', value: roe.capitalContable },
    ],
    groups: [
      ...(roe.groups || []),
      { title: 'Capital contable', rows: capital, total: roe.capitalContable ?? bg.totals?.capital },
    ],
  });

  const margenNeto = V.margenNeto || {};
  items.push({
    id: 'margenNeto',
    label: 'Margen neto',
    value: margenNeto.valorPct,
    display: margenNeto.valorPct != null ? `${margenNeto.valorPct}%` : '—',
    icon: 'percent',
    color: liquidezToneClass(margenNeto.tone),
    sub: `${margenNeto.label || 'Utilidad sobre ventas'} · clic`,
    hint: margenNeto.formula,
    interpretacion: [
      margenNeto.summary,
      'Es lo que queda de cada peso vendido después de costos, gastos de la casa, plan piso e impuestos.',
      'Referencia de agencia: 2% a 3% sobre ventas totales. Parece bajo comparado con otros giros, pero es lo normal en un negocio de alto volumen y ticket alto: una agencia gana por rotación de unidades y por la utilidad de taller, refacciones y F&I, no por el margen de cada auto nuevo.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Utilidad del periodo', value: margenNeto.utilidadPeriodo ?? margenNeto.numerador },
      { label: 'Ventas netas', value: margenNeto.ventasNetas ?? margenNeto.denominador },
    ],
    groups: margenNeto.groups || [],
  });

  const margenBruto = V.margenBruto || {};
  items.push({
    id: 'margenBruto',
    label: 'Margen bruto',
    value: margenBruto.valorPct,
    display: margenBruto.valorPct != null ? `${margenBruto.valorPct}%` : '—',
    icon: 'pie_chart',
    color: liquidezToneClass(margenBruto.tone),
    sub: `${margenBruto.label || 'Después de costo de ventas'} · clic`,
    hint: margenBruto.formula,
    interpretacion: [
      margenBruto.summary,
      'Indica qué parte de las ventas queda después del costo directo de las unidades, las refacciones y la mano de obra del taller.',
      'Referencia de agencia: 13% a 16% consolidado. La mezcla importa más que el número: autos nuevos aporta apenas 4% a 7%, seminuevos 8% a 11%, refacciones 25% a 40% y mano de obra de taller arriba de 65%. Un margen bruto bajo casi siempre significa que la agencia depende demasiado de autos nuevos y poco de postventa.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Utilidad bruta', value: margenBruto.utilidadBruta ?? margenBruto.numerador },
      { label: 'Ventas netas', value: margenBruto.ventasNetas ?? margenBruto.denominador },
    ],
    groups: margenBruto.groups || [],
  });

  const margenOperacion = V.margenOperacion || {};
  items.push({
    id: 'margenOperacion',
    label: 'Margen de operación',
    value: margenOperacion.valorPct,
    display: margenOperacion.valorPct != null ? `${margenOperacion.valorPct}%` : '—',
    icon: 'monitoring',
    color: liquidezToneClass(margenOperacion.tone),
    sub: `${margenOperacion.label || 'Después de gastos'} · clic`,
    hint: margenOperacion.formula,
    interpretacion: [
      margenOperacion.summary,
      'Mide qué queda de las ventas después del costo y de los gastos de la casa: nómina, publicidad, renta e instalaciones.',
      'Referencia de agencia: 2.5% a 4% sobre ventas. Por debajo de 2.5% los gastos fijos se están comiendo la utilidad que generan los departamentos, y la salida suele estar en absorción de postventa antes que en recortar gastos.',
    ].filter(Boolean).join(' '),
    facts: [
      { label: 'Utilidad de operación', value: margenOperacion.utilidadOperacion ?? margenOperacion.numerador },
      { label: 'Ventas netas', value: margenOperacion.ventasNetas ?? margenOperacion.denominador },
    ],
    groups: margenOperacion.groups || [],
  });

  const comp = bg.comparativoAnual || null;
  if (comp?.kpis) {
    items.forEach((item) => {
      const c = comp.kpis[item.id];
      if (!c || c.anterior == null || c.actual == null) return;
      item.comparativoAnual = {
        ...c,
        periodoActual: comp.periodoActual,
        periodoAnterior: comp.periodoAnterior,
      };
    });
  }

  return items;
}

function closeBgKpiFloat() {
  destroyBgKpiChart();
  bgKpiState.activeId = null;
  document.getElementById('bgKpiFloat')?.classList.add('hidden');
  const backdrop = document.getElementById('bgKpiFloatBackdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.querySelectorAll('#panelContabilidadBalance [data-bg-kpi].is-open')
    .forEach((el) => el.classList.remove('is-open'));
}

const GROWTH_KPI_IDS = new Set(['crecimientoUtilidad', 'crecimientoEbit', 'crecimientoVentas', 'crecimientoUtilidadBruta']);
// Indicadores donde bajar es mejorar (ciclo largo, deuda concentrada a corto, apalancamiento).
const LOWER_IS_BETTER_KPIS = new Set(['cicloEfectivo', 'calidadDeuda', 'apalancamiento']);
// Indicadores de banda: ni subir ni bajar es bueno por sí mismo, depende del rango.
const BAND_KPIS = new Set(['endeudamiento', 'autonomia']);

let bgKpiChart = null;

function destroyBgKpiChart() {
  if (bgKpiChart) {
    try { bgKpiChart.destroy(); } catch { /* noop */ }
    bgKpiChart = null;
  }
}

/**
 * La gráfica aparece en los KPIs de crecimiento (siempre) y en cualquier
 * indicador fuera de rango, que es donde la comparación anual explica la desviación.
 */
function shouldShowYoyChart(kpi) {
  const c = kpi?.comparativoAnual;
  if (!c || c.actual == null || c.anterior == null) return false;
  if (Number(c.actual) === 0 && Number(c.anterior) === 0) return false;
  return GROWTH_KPI_IDS.has(kpi.id) || kpi.color === 'rose' || kpi.color === 'amber';
}

function formatComparativoValue(value, unidad, fmt) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (unidad === 'pct') return `${Math.round(n * 10) / 10}%`;
  if (unidad === 'dias') return `${Math.round(n * 10) / 10} días`;
  if (unidad === 'ratio') return `${n.toFixed(2)}×`;
  return fmt.money(n);
}

/** Devuelve el texto del cambio y si ese movimiento es bueno, malo o neutro. */
function describeComparativoDelta(kpiId, comp) {
  const actual = Number(comp.actual);
  const anterior = Number(comp.anterior);
  if (!Number.isFinite(actual) || !Number.isFinite(anterior)) return null;
  const diff = actual - anterior;
  const sign = diff > 0 ? '+' : '';
  const round1 = (n) => Math.round(n * 10) / 10;

  let texto;
  if (comp.unidad === 'pct') {
    texto = `${sign}${round1(diff)} pp`;
  } else if (comp.unidad === 'dias') {
    texto = `${sign}${round1(diff)} días`;
  } else if (comp.unidad === 'ratio') {
    texto = `${sign}${diff.toFixed(2)}×`;
  } else {
    texto = Dashboard.fmt.money(diff);
    if (diff > 0) texto = `+${texto}`;
  }

  const pctChange = Math.abs(anterior) > 0.0001
    ? round1((diff / Math.abs(anterior)) * 100)
    : null;
  if (pctChange != null && comp.unidad !== 'pct') {
    texto += ` (${pctChange > 0 ? '+' : ''}${pctChange}%)`;
  }

  let tono = 'neutral';
  if (Math.abs(diff) > 0.0001 && !BAND_KPIS.has(kpiId)) {
    const mejora = LOWER_IS_BETTER_KPIS.has(kpiId) ? diff < 0 : diff > 0;
    tono = mejora ? 'mejora' : 'deterioro';
  }
  return { texto, tono };
}

function renderBgKpiComparativo(kpi, fmt) {
  const c = kpi.comparativoAnual;
  const delta = describeComparativoDelta(kpi.id, c);
  const valorAnterior = formatComparativoValue(c.anterior, c.unidad, fmt);
  const valorActual = formatComparativoValue(c.actual, c.unidad, fmt);
  const deltaHtml = delta
    ? `<span class="bg-kpi-yoy__delta bg-kpi-yoy__delta--${delta.tono}">${escHtml(delta.texto)}</span>`
    : '';
  return `
    <div class="bg-kpi-yoy">
      <div class="bg-kpi-yoy__head">
        <p class="bg-kpi-float__section">${escHtml(c.etiqueta || kpi.label)} · mismo periodo del año anterior</p>
        ${deltaHtml}
      </div>
      <div class="bg-kpi-yoy__canvas"><canvas id="bgKpiYoyChart" height="120"></canvas></div>
      <ul class="bg-kpi-yoy__legend">
        <li><span class="bg-kpi-yoy__swatch bg-kpi-yoy__swatch--prev"></span>${escHtml(c.periodoAnterior || 'Año anterior')}<strong>${escHtml(valorAnterior)}</strong></li>
        <li><span class="bg-kpi-yoy__swatch bg-kpi-yoy__swatch--${kpi.color || 'slate'}"></span>${escHtml(c.periodoActual || 'Periodo actual')}<strong>${escHtml(valorActual)}</strong></li>
      </ul>
    </div>`;
}

const YOY_BAR_COLORS = {
  rose: '#be123c',
  amber: '#b45309',
  green: '#047857',
  blue: '#2d5bff',
  slate: '#64748b',
};

function mountBgKpiChart(kpi, fmt) {
  const canvas = document.getElementById('bgKpiYoyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const c = kpi.comparativoAnual;
  const actualColor = YOY_BAR_COLORS[kpi.color] || YOY_BAR_COLORS.slate;
  bgKpiChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: [c.periodoAnterior || 'Año anterior', c.periodoActual || 'Actual'],
      datasets: [{
        data: [Number(c.anterior), Number(c.actual)],
        backgroundColor: ['#cbd5e1', actualColor],
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.62,
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
          callbacks: {
            label: (ctx) => formatComparativoValue(ctx.raw, c.unidad, fmt),
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.18)', drawTicks: false },
          ticks: {
            color: '#94a3b8',
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: (v) => (c.unidad === 'money' ? formatCompactMoney(v) : formatComparativoValue(v, c.unidad, fmt)),
          },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#475569', font: { size: 11, weight: '700' } },
        },
      },
    },
  });
}

function openBgKpiFloat(kpiId) {
  const fmt = bgKpiState.fmt || Dashboard.fmt;
  const kpi = bgKpiState.items.find((i) => i.id === kpiId);
  const panel = document.getElementById('bgKpiFloat');
  const backdrop = document.getElementById('bgKpiFloatBackdrop');
  if (!kpi || !panel || !backdrop) return;

  destroyBgKpiChart();
  bgKpiState.activeId = kpiId;
  document.querySelectorAll('#panelContabilidadBalance [data-bg-kpi]')
    .forEach((el) => el.classList.toggle('is-open', el.dataset.bgKpi === kpiId));

  const comparativoHtml = shouldShowYoyChart(kpi) ? renderBgKpiComparativo(kpi, fmt) : '';

  const display = kpi.display != null ? kpi.display : formatFullMoney(kpi.value);
  const factsHtml = (kpi.facts || []).length
    ? `<ul class="bg-kpi-float__facts">${kpi.facts.map((f) => `
        <li><strong>${escHtml(f.label)}</strong><span class="${f.display != null ? '' : moneyClass(f.value)}">${escHtml(f.display != null ? f.display : fmt.money(f.value || 0))}</span></li>
      `).join('')}</ul>`
    : '';

  const rowCount = (kpi.groups || []).reduce((n, g) => n + (g.rows?.length || 0), 0);
  const groupsHtml = (kpi.groups || []).map((g) => {
    const rows = g.rows || [];
    if (!rows.length && g.total == null) {
      return `<div class="bg-kpi-float__group"><p class="bg-kpi-float__section">${escHtml(g.title)}</p><p class="section-subtitle">Sin partidas con saldo.</p></div>`;
    }
    const sum = rows.reduce((a, r) => a + Number(r.value || 0), 0);
    const total = g.total != null ? Number(g.total) : sum;
    return `
      <div class="bg-kpi-float__group">
        <p class="bg-kpi-float__section">${escHtml(g.title)} · ${rows.length} partida${rows.length === 1 ? '' : 's'}</p>
        <table class="bg-kpi-float__table">
          <thead><tr><th>Cuenta</th><th>Concepto</th><th class="cell-money">Saldo</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="cell-mono">${escHtml(r.cuenta || '')}</td>
                <td>${escHtml(r.label)}</td>
                <td class="cell-money ${moneyClass(r.value)}"><strong>${fmt.money(r.value)}</strong></td>
              </tr>
            `).join('') || '<tr><td colspan="3">Sin detalle de cuentas.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><strong>Total</strong></td>
              <td class="cell-money"><strong>${fmt.money(total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="bg-kpi-float__head">
      <div class="bg-kpi-float__head-main">
        <div class="bg-kpi-float__icon" aria-hidden="true">
          <span class="material-symbols-outlined">${escHtml(kpi.icon || 'payments')}</span>
        </div>
        <div>
          <p class="bg-kpi-float__eyebrow">Balance General · desglose</p>
          <h3 class="bg-kpi-float__title" id="bgKpiFloatTitle">${escHtml(kpi.label)}</h3>
          <p class="bg-kpi-float__value ${moneyClass(kpi.value)}">${display}</p>
          <p class="bg-kpi-float__hint">${escHtml(kpi.hint || '')}</p>
          ${kpi.interpretacion ? `<p class="bg-kpi-float__interp"><strong>Interpretación:</strong> ${escHtml(kpi.interpretacion)}</p>` : ''}
          <span class="bg-kpi-float__meta">${rowCount} cuenta${rowCount === 1 ? '' : 's'} relacionadas</span>
        </div>
      </div>
      <button type="button" class="bg-kpi-float__close" data-bg-kpi-close aria-label="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="bg-kpi-float__body">
      ${factsHtml}
      ${comparativoHtml}
      ${groupsHtml || '<div class="bg-kpi-float__group"><p class="section-subtitle">Sin desglose disponible.</p></div>'}
    </div>`;

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');

  if (comparativoHtml) mountBgKpiChart(kpi, fmt);
}

function pctOf(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || Math.abs(t) < 0.005) return null;
  return Math.round((p / t) * 1000) / 10;
}

function formatCompactMoney(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return formatFullMoney(v);
}

function renderBgTrend(cmp, accentClass = '') {
  if (!cmp?.display) return '';
  const tone = cmp.tone === 'up' ? 'up' : cmp.tone === 'down' ? 'down' : 'flat';
  const icon = tone === 'up' ? 'trending_up' : tone === 'down' ? 'trending_down' : 'trending_flat';
  return `
    <p class="bg-kpi-trend bg-kpi-trend--${tone}${accentClass ? ` ${accentClass}` : ''}">
      <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
      <span>${escHtml(cmp.display)}</span>
    </p>`;
}

function renderBgHeroCard(item) {
  if (!item) return '';
  const isOpen = bgKpiState.activeId === item.id;
  const display = item.display != null ? item.display : formatFullMoney(item.value);
  return `
    <button type="button"
      class="bg-hero-card bg-hero-card--${item.color || 'blue'}${isOpen ? ' is-open' : ''}"
      data-bg-kpi="${item.id}"
      aria-expanded="${isOpen}">
      <div class="bg-hero-card__top">
        <span class="bg-hero-card__label">
          ${escHtml(item.label)}
          <span class="material-symbols-outlined bg-hero-card__info" aria-hidden="true">info</span>
        </span>
        <span class="material-symbols-outlined bg-hero-card__icon">${escHtml(item.icon || 'payments')}</span>
      </div>
      <div class="bg-hero-card__value">${display}</div>
      ${item.sub ? `<p class="bg-hero-card__sub">${escHtml(item.sub)}</p>` : ''}
      ${renderBgTrend(item.comparativo)}
    </button>`;
}

function renderBgCompCard(item, pct, pctScope = 'total') {
  if (!item) return '';
  const isOpen = bgKpiState.activeId === item.id;
  const display = formatFullMoney(item.value);
  const meta = pct != null ? `${pct}% del total ${pctScope}` : (item.sub || '');
  return `
    <button type="button"
      class="bg-comp-card bg-comp-card--${item.color || 'blue'}${isOpen ? ' is-open' : ''}"
      data-bg-kpi="${item.id}"
      aria-expanded="${isOpen}">
      <div class="bg-comp-card__head">
        <span class="material-symbols-outlined">${escHtml(item.icon || 'payments')}</span>
        <span>${escHtml(item.label)}</span>
      </div>
      <div class="bg-comp-card__value">${display}</div>
      <p class="bg-comp-card__meta">${escHtml(meta)}</p>
      ${renderBgTrend(item.comparativo)}
    </button>`;
}

function bgStatusBadge(tone, label) {
  const t = liquidezToneClass(tone);
  const icon = t === 'green' ? 'check_circle'
    : t === 'rose' ? 'warning'
      : t === 'amber' ? 'warning'
        : 'info';
  return `<span class="bg-status-footer bg-status-footer--${t}">
    <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
    ${escHtml(label || '—')}
  </span>`;
}

function renderBgIndicadorCard(cfg) {
  const isOpen = cfg.id && bgKpiState.activeId === cfg.id;
  const interactive = cfg.id
    ? `button type="button" data-bg-kpi="${cfg.id}" aria-expanded="${isOpen}"`
    : 'div';
  const close = cfg.id ? 'button' : 'div';
  return `
    <${interactive} class="bg-indicador-card bg-indicador-card--${cfg.tone || 'slate'}${isOpen ? ' is-open' : ''}">
      <div class="bg-indicador-card__body">
        <div class="bg-indicador-card__head">
          <span class="material-symbols-outlined bg-indicador-card__icon">${escHtml(cfg.icon || 'analytics')}</span>
          <span>${escHtml(cfg.label)}</span>
        </div>
        <div class="bg-indicador-card__value">${escHtml(cfg.display)}</div>
        ${cfg.ref ? `<p class="bg-indicador-card__ref">${escHtml(cfg.ref)}</p>` : ''}
      </div>
      ${bgStatusBadge(cfg.tone, cfg.badge)}
    </${close}>`;
}

// Referencias del sector automotriz: el plan piso dentro del pasivo circulante
// baja los umbrales de liquidez respecto de una empresa comercial común.
const REF_RAZON = 'Agencia: 1.10 – 1.60';
const REF_ACIDA = 'Agencia: ≥ 0.70';
const REF_ENDEUDAMIENTO = 'Agencia: 60–80% del activo';
const REF_AUTONOMIA = 'Agencia: 20–40% del activo';
const REF_APALANCAMIENTO = 'Deuda neta ÷ EBITDA UDM · agencia ≤ 3.00×';

function evalRazonStatus(razon) {
  const n = Number(razon);
  if (!Number.isFinite(n)) return { tone: 'slate', badge: 'Sin dato', ref: REF_RAZON };
  if (n < 1.1) return { tone: 'rose', badge: 'Insuficiente', ref: REF_RAZON };
  if (n < 1.3) return { tone: 'amber', badge: 'Ajustada', ref: REF_RAZON };
  if (n <= 1.6) return { tone: 'green', badge: 'En rango', ref: REF_RAZON };
  return { tone: 'green', badge: 'Holgada', ref: REF_RAZON };
}

function evalAcidaStatus(acida) {
  const n = Number(acida);
  if (!Number.isFinite(n)) return { tone: 'slate', badge: 'Sin dato', ref: REF_ACIDA };
  if (n >= 0.7) return { tone: 'green', badge: 'En rango', ref: REF_ACIDA };
  if (n >= 0.5) return { tone: 'amber', badge: 'Ajustada', ref: REF_ACIDA };
  return { tone: 'rose', badge: 'Fuera de rango', ref: REF_ACIDA };
}

function evalEndeudamientoStatus(pct) {
  return evalPctBand(pct, { min: 60, max: 80, hardLow: 50, hardHigh: 88, ref: REF_ENDEUDAMIENTO });
}

function evalAutonomiaStatus(pct) {
  return evalPctBand(pct, { min: 20, max: 40, hardLow: 12, ref: REF_AUTONOMIA });
}

function evalPctBand(pct, { min, max, hardLow = null, hardHigh = null, ref }) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return { tone: 'slate', badge: 'Sin dato', ref };
  if (n >= min && n <= max) return { tone: 'green', badge: 'En rango', ref };
  if (n < min) {
    const diff = Math.round((min - n) * 10) / 10;
    return {
      tone: hardLow != null && n < hardLow ? 'rose' : 'amber',
      badge: `${diff} pp bajo mínimo`,
      ref,
    };
  }
  const diff = Math.round((n - max) * 10) / 10;
  return {
    tone: hardHigh != null && n > hardHigh ? 'rose' : 'amber',
    badge: `${diff} pp sobre máximo`,
    ref,
  };
}

function evalApalancamientoStatus(ap) {
  const n = Number(ap);
  if (!Number.isFinite(n)) return { tone: 'slate', badge: 'Sin dato', ref: REF_APALANCAMIENTO };
  if (n <= 3) return { tone: 'green', badge: 'En rango', ref: REF_APALANCAMIENTO };
  if (n <= 4.5) return { tone: 'amber', badge: 'Atención', ref: REF_APALANCAMIENTO };
  return { tone: 'rose', badge: 'Fuera de rango', ref: REF_APALANCAMIENTO };
}

function renderBalanceGeneralPanel(bg, fmt) {
  const meth = document.getElementById('balanceGeneralMethodology');
  if (meth) {
    meth.textContent = bg?.available
      ? `Saldo final al cierre de ${bg.labelCierre || bg.asOfCierre || bg.asOf || 'periodo'} · Fuente: SQL_CON_CTAS`
      : 'Sin datos de CON_CTAS (SQL) para el periodo seleccionado';
  }
  const dateLabel = document.getElementById('bgBalanceDateLabel');
  if (dateLabel) {
    dateLabel.textContent = bg?.labelCierre || bg?.asOfCierre || bg?.asOf
      || document.getElementById('filterPeriodLabel')?.textContent
      || '—';
  }

  bgKpiState.fmt = fmt;
  bgKpiState.items = buildBgKpiItems(bg);
  if (bgKpiState.activeId && !bgKpiState.items.some((i) => i.id === bgKpiState.activeId)) {
    closeBgKpiFloat();
  }

  const byId = (id) => bgKpiState.items.find((i) => i.id === id);
  const L = bg?.liquidez || {};
  const E = bg?.estructura || {};
  const D = bg?.dso || {};
  const CE = bg?.cicloEfectivo || {};
  const C = bg?.coberturaCt || {};
  const V = bg?.vitales || {};
  const totals = bg?.totals || {};
  const cmp = bg?.comparativo || null;
  const activoTotal = totals.activoTotal;
  const pasivoTotal = totals.pasivoTotal;

  function withCmp(item, cmpKey, fromSections = false) {
    if (!item) return item;
    const source = fromSections ? cmp?.sections : cmp?.totals;
    item.comparativo = source?.[cmpKey] || null;
    return item;
  }

  const capitalTrabajo = byId('capitalTrabajo') || (L.disponible ? {
    id: 'capitalTrabajo',
    label: 'Capital de trabajo',
    value: L.capitalTrabajo,
    icon: 'account_balance_wallet',
    color: Number(L.capitalTrabajo) < 0 ? 'rose' : 'green',
    sub: L.margenSobreAcPct != null
      ? `${L.margenSobreAcPct}% del Activo Circulante`
      : 'Activo circ. − pasivo CP',
  } : null);
  if (capitalTrabajo) {
    capitalTrabajo.color = Number(capitalTrabajo.value) < 0 ? 'rose' : 'green';
    if (L.margenSobreAcPct != null) {
      capitalTrabajo.sub = `${L.margenSobreAcPct}% del Activo Circulante`;
    }
    withCmp(capitalTrabajo, 'capitalTrabajo', false);
  }

  const heroEl = document.getElementById('bgHeroKpis');
  if (heroEl) {
    if (!bg?.available) {
      heroEl.innerHTML = '<p class="section-subtitle">Sin datos de balance para el periodo.</p>';
    } else {
      const activoTotalItem = withCmp(byId('activoTotal'), 'activoTotal');
      if (activoTotalItem) activoTotalItem.sub = 'Circulante + Fijo + Diferido';
      const pasivoTotalItem = withCmp(byId('pasivoTotal'), 'pasivoTotal');
      if (pasivoTotalItem) {
        pasivoTotalItem.sub = 'Circulante + Largo plazo';
        pasivoTotalItem.color = 'violet';
      }
      const capitalItem = withCmp(byId('capital'), 'capital');
      if (capitalItem) capitalItem.color = 'green';
      heroEl.innerHTML = [
        renderBgHeroCard(activoTotalItem),
        renderBgHeroCard(pasivoTotalItem),
        renderBgHeroCard(capitalItem),
        renderBgHeroCard(capitalTrabajo),
      ].join('');
    }
  }

  const compActivo = document.getElementById('bgCompActivo');
  if (compActivo) {
    const ac = withCmp(byId('activoCirculante'), 'activoCirculante', true);
    if (ac) ac.color = 'blue';
    const af = withCmp(byId('activoFijo'), 'activoFijo', true);
    if (af) af.color = 'slate';
    const ad = withCmp(byId('activoDiferido'), 'activoDiferido', true);
    if (ad) ad.color = 'violet';
    compActivo.innerHTML = bg?.available ? [
      renderBgCompCard(ac, pctOf(sectionValue(bg, 'activoCirculante'), activoTotal), 'activo'),
      renderBgCompCard(af, pctOf(sectionValue(bg, 'activoFijo'), activoTotal), 'activo'),
      renderBgCompCard(ad, pctOf(sectionValue(bg, 'activoDiferido'), activoTotal), 'activo'),
    ].join('') : '';
  }

  const compPasivo = document.getElementById('bgCompPasivo');
  if (compPasivo) {
    const pasivoTotalItem = withCmp(byId('pasivoTotal'), 'pasivoTotal', true);
    if (pasivoTotalItem) pasivoTotalItem.color = 'slate';
    const pasivoCirc = withCmp(byId('pasivoCirculante'), 'pasivoCortoPlazo', true);
    if (pasivoCirc) pasivoCirc.color = 'amber';
    const pasivoLargo = withCmp(byId('pasivoLargo'), 'pasivoLargoPlazo', true);
    if (pasivoLargo) pasivoLargo.color = 'amber';
    compPasivo.innerHTML = bg?.available ? [
      renderBgCompCard(pasivoCirc, pctOf(sectionValue(bg, 'pasivoCortoPlazo'), pasivoTotal), 'pasivo'),
      renderBgCompCard(pasivoLargo, pctOf(sectionValue(bg, 'pasivoLargoPlazo'), pasivoTotal), 'pasivo'),
      renderBgCompCard(pasivoTotalItem, 100, 'pasivo'),
    ].join('') : '';
  }

  const indEl = document.getElementById('bgIndicadores');
  if (indEl) {
    const razon = L.razonCirculante;
    const acida = L.pruebaAcida;
    const stRazon = evalRazonStatus(razon);
    const stAcida = evalAcidaStatus(acida);
    const stEnd = evalEndeudamientoStatus(E.endeudamientoPct);
    const stAut = evalAutonomiaStatus(E.autonomiaPct);
    const stApa = {
      ...(E.apalancamientoTone
        ? { tone: E.apalancamientoTone, badge: E.apalancamientoLabel || '—', ref: REF_APALANCAMIENTO }
        : evalApalancamientoStatus(E.apalancamiento)),
    };
    const stCal = {
      tone: E.calidadDeuda?.tone || 'slate',
      badge: E.calidadDeuda?.label || 'Sin dato',
      ref: 'Agencia: ≤ 85% en corto plazo',
    };
    const stDso = {
      tone: D.tone || 'slate',
      badge: D.label || 'Sin dato',
      ref: D.valorControl || 'Agencia: ≤ 20 días',
    };
    const stCiclo = {
      tone: CE.tone || 'slate',
      badge: CE.label || 'Sin dato',
      ref: CE.valorControl || 'Agencia: ≤ 50 días',
    };
    const stCobertura = {
      tone: C.tone || 'slate',
      badge: C.label || 'Sin dato',
      ref: C.valorControl || 'Agencia: ≥ 1.20×',
    };
    const crecimientoUtilidad = V.crecimientoUtilidad || {};
    const crecimientoEbit = V.crecimientoEbit || {};
    const crecimientoVentas = V.crecimientoVentas || {};
    const crecimientoUtilidadBruta = V.crecimientoUtilidadBruta || {};
    const roe = V.roe || {};
    const margenNeto = V.margenNeto || {};
    const margenBruto = V.margenBruto || {};
    const margenOperacion = V.margenOperacion || {};
    const stCrecimientoUtilidad = {
      tone: crecimientoUtilidad.tone || 'slate',
      badge: crecimientoUtilidad.label || 'Sin dato',
      ref: 'Agencia: ≥ 5% vs mismo periodo anterior',
    };
    const stCrecimientoEbit = {
      tone: crecimientoEbit.tone || 'slate',
      badge: crecimientoEbit.label || 'Sin dato',
      ref: 'Agencia: ≥ 5% vs EBIT comparable',
    };
    const stCrecimientoVentas = {
      tone: crecimientoVentas.tone || 'slate',
      badge: crecimientoVentas.label || 'Sin dato',
      ref: 'Agencia: ≥ 5% vs ventas comparables',
    };
    const stCrecimientoUb = {
      tone: crecimientoUtilidadBruta.tone || 'slate',
      badge: crecimientoUtilidadBruta.label || 'Sin dato',
      ref: 'Agencia: ≥ 5% vs utilidad bruta comparable',
    };
    const stRoe = {
      tone: roe.tone || 'slate',
      badge: roe.label || 'Sin dato',
      ref: 'Agencia: 15% – 25% sobre capital',
    };
    const stMargenNeto = {
      tone: margenNeto.tone || 'slate',
      badge: margenNeto.label || 'Sin dato',
      ref: 'Agencia: 2% – 3% sobre ventas',
    };
    const stMargenBruto = {
      tone: margenBruto.tone || 'slate',
      badge: margenBruto.label || 'Sin dato',
      ref: 'Agencia: 13% – 16% consolidado',
    };
    const stMargenOp = {
      tone: margenOperacion.tone || 'slate',
      badge: margenOperacion.label || 'Sin dato',
      ref: 'Agencia: 2.5% – 4% sobre ventas',
    };

    const cards = {
      crecimientoUtilidad: renderBgIndicadorCard({
        id: 'crecimientoUtilidad',
        label: 'Crecimiento de utilidad',
        icon: 'trending_up',
        display: crecimientoUtilidad.valorPct != null ? `${crecimientoUtilidad.valorPct}%` : '—',
        ...stCrecimientoUtilidad,
      }),
      crecimientoEbit: renderBgIndicadorCard({
        id: 'crecimientoEbit',
        label: 'Crecimiento EBIT',
        icon: 'show_chart',
        display: crecimientoEbit.valorPct != null ? `${crecimientoEbit.valorPct}%` : '—',
        ...stCrecimientoEbit,
      }),
      crecimientoVentas: renderBgIndicadorCard({
        id: 'crecimientoVentas',
        label: 'Crecimiento de ventas',
        icon: 'payments',
        display: crecimientoVentas.valorPct != null ? `${crecimientoVentas.valorPct}%` : '—',
        ...stCrecimientoVentas,
      }),
      crecimientoUtilidadBruta: renderBgIndicadorCard({
        id: 'crecimientoUtilidadBruta',
        label: 'Crecimiento utilidad bruta',
        icon: 'stacked_line_chart',
        display: crecimientoUtilidadBruta.valorPct != null ? `${crecimientoUtilidadBruta.valorPct}%` : '—',
        ...stCrecimientoUb,
      }),
      razonCirculante: renderBgIndicadorCard({
        id: 'razonCirculante',
        label: 'Razón Circulante',
        icon: 'water_drop',
        display: formatRatio(razon) === '—' ? '—' : `${formatRatio(razon)}×`,
        ...stRazon,
      }),
      pruebaAcida: renderBgIndicadorCard({
        id: 'pruebaAcida',
        label: 'Prueba Ácida',
        icon: 'science',
        display: formatRatio(acida) === '—' ? '—' : `${formatRatio(acida)}×`,
        ...stAcida,
      }),
      endeudamiento: renderBgIndicadorCard({
        id: 'endeudamiento',
        label: 'Endeudamiento',
        icon: 'percent',
        display: E.endeudamientoPct != null ? `${E.endeudamientoPct}%` : '—',
        ...stEnd,
      }),
      autonomia: renderBgIndicadorCard({
        id: 'autonomia',
        label: 'Ratio de Autonomía',
        icon: 'diversity_3',
        display: E.autonomiaPct != null ? `${E.autonomiaPct}%` : '—',
        ...stAut,
      }),
      apalancamiento: renderBgIndicadorCard({
        id: 'apalancamiento',
        label: 'Apalancamiento',
        icon: 'balance',
        display: E.apalancamientoDisplay
          || (E.apalancamiento != null ? `${formatRatio(E.apalancamiento)}×` : '—'),
        ...stApa,
      }),
      calidadDeuda: renderBgIndicadorCard({
        id: 'calidadDeuda',
        label: 'Calidad de la Deuda',
        icon: 'schedule',
        display: E.calidadDeuda?.cortoPct != null ? `${E.calidadDeuda.cortoPct}%` : '—',
        ...stCal,
      }),
      dso: renderBgIndicadorCard({
        id: 'dso',
        label: 'Días de Cuentas por Cobrar',
        icon: 'timelapse',
        display: D.dsoDias != null ? `${D.dsoDias} días` : '—',
        ...stDso,
      }),
      cicloEfectivo: renderBgIndicadorCard({
        id: 'cicloEfectivo',
        label: 'Ciclo de efectivo',
        icon: 'sync',
        display: CE.cicloDias != null ? `${CE.cicloDias} días` : '—',
        ...stCiclo,
      }),
      coberturaCt: renderBgIndicadorCard({
        id: 'coberturaCt',
        label: 'Cobertura CT',
        icon: 'shield',
        display: C.display || (C.cobertura != null ? `${formatRatio(C.cobertura)}×` : '—'),
        ...stCobertura,
      }),
      roe: renderBgIndicadorCard({
        id: 'roe',
        label: 'ROE',
        icon: 'account_balance',
        display: roe.valorPct != null ? `${roe.valorPct}%` : '—',
        ...stRoe,
      }),
      margenNeto: renderBgIndicadorCard({
        id: 'margenNeto',
        label: 'Margen neto',
        icon: 'percent',
        display: margenNeto.valorPct != null ? `${margenNeto.valorPct}%` : '—',
        ...stMargenNeto,
      }),
      margenBruto: renderBgIndicadorCard({
        id: 'margenBruto',
        label: 'Margen bruto',
        icon: 'pie_chart',
        display: margenBruto.valorPct != null ? `${margenBruto.valorPct}%` : '—',
        ...stMargenBruto,
      }),
      margenOperacion: renderBgIndicadorCard({
        id: 'margenOperacion',
        label: 'Margen de operación',
        icon: 'monitoring',
        display: margenOperacion.valorPct != null ? `${margenOperacion.valorPct}%` : '—',
        ...stMargenOp,
      }),
    };
    const group = (id, title, subtitle, icon, keys) => `
      <section class="bg-indicadores-group bg-indicadores-group--${id}">
        <header class="bg-indicadores-group__head">
          <span class="material-symbols-outlined">${icon}</span>
          <div><h5>${title}</h5><p>${subtitle}</p></div>
        </header>
        <div class="bg-indicadores-grid">${keys.map((key) => cards[key]).join('')}</div>
      </section>`;

    indEl.innerHTML = [
      group('crecimiento', 'Crecimiento de utilidad', 'Evolución del resultado contra el periodo comparable', 'trending_up',
        ['crecimientoUtilidad', 'crecimientoEbit', 'crecimientoVentas', 'crecimientoUtilidadBruta']),
      group('liquidez', 'Liquidez', 'Capacidad de pago y cobertura del capital de trabajo', 'water_drop',
        ['razonCirculante', 'pruebaAcida', 'cicloEfectivo', 'coberturaCt']),
      group('endeudamiento', 'Endeudamiento', 'Estructura, autonomía y presión de la deuda', 'account_balance',
        ['endeudamiento', 'autonomia', 'apalancamiento', 'calidadDeuda']),
      group('rentabilidad', 'Rentabilidad', 'Retorno generado por el capital y por las ventas', 'monitoring',
        ['roe', 'margenNeto', 'margenBruto', 'margenOperacion']),
    ].join('');
  }

  renderBgAnalisisPanels(bg, fmt);

  const resumenBody = document.getElementById('bgResumenTable');
  if (resumenBody) {
    if (!bg?.available) {
      resumenBody.innerHTML = '<tr class="empty-row"><td colspan="2">Sin datos.</td></tr>';
    } else {
      const diff = bg.totals?.ecuacionDiferencia;
      resumenBody.innerHTML = [
        ['Total activo', bg.totals?.activoTotal],
        ['Total pasivo', bg.totals?.pasivoTotal],
        ['Capital contable', bg.totals?.capital],
        ['Pasivo + capital', bg.totals?.pasivoMasCapital],
        ['Diferencia ecuación (Activo − Pasivo − Capital)', diff],
      ].map(([label, value], idx) => `
        <tr${idx === 4 ? ' class="row-highlight"' : ''}>
          <td>${label}</td>
          <td class="cell-money ${moneyClass(value)}"><strong>${fmt.money(value || 0)}</strong></td>
        </tr>
      `).join('');
    }
  }

  if (bgKpiState.activeId) openBgKpiFloat(bgKpiState.activeId);
}

function renderBgAnalisisPanels(bg, fmt) {
  const liqEl = document.getElementById('bgAnalisisLiquidez');
  const estEl = document.getElementById('bgAnalisisEstructura');
  if (!liqEl || !estEl) return;

  const L = bg?.liquidez || null;
  const E = bg?.estructura || null;
  const D = bg?.dso || null;
  const CE = bg?.cicloEfectivo || null;

  if (!L?.disponible) {
    liqEl.classList.add('hidden');
    liqEl.innerHTML = '';
  } else {
    const tone = liquidezToneClass(L.interpretacion?.tone || L.acidTone);
    const title = (L.interpretacion?.label || 'Liquidez').toUpperCase();
    // Mockup: panel azul suave; el punto refleja el estado (p. ej. ámbar = moderada)
    liqEl.className = 'bg-analisis-card bg-analisis-card--liquidez bg-analisis-card--blue';
    liqEl.classList.remove('hidden');
    liqEl.innerHTML = `
      <div class="bg-analisis-card__head">
        <div class="bg-analisis-card__title-wrap">
          <span class="material-symbols-outlined">water_drop</span>
          <h4>LIQUIDEZ - ${escHtml(title)}</h4>
        </div>
        <span class="bg-analisis-dot bg-analisis-dot--${tone}" aria-hidden="true"></span>
      </div>
      <p class="bg-analisis-card__summary">${escHtml(L.interpretacion?.summary || L.lectura?.razon || '')}</p>
      <ul class="bg-analisis-facts">
        <li><span class="material-symbols-outlined">check_circle</span>
          Capital de trabajo ${Number(L.capitalTrabajo) >= 0 ? 'positivo' : 'negativo'}</li>
        <li><span class="material-symbols-outlined">speed</span>
          Razón ${formatRatio(L.razonCirculante)}× ${evalRazonStatus(L.razonCirculante).badge.toLowerCase()}</li>
        <li><span class="material-symbols-outlined">science</span>
          Prueba ácida ${formatRatio(L.pruebaAcida)}×</li>
        <li><span class="material-symbols-outlined">payments</span>
          (Caja + Bancos + Equiv. + CxC) ÷ Pasivo CP</li>
      </ul>
      <button type="button" class="bg-analisis-link" data-bg-kpi="razonCirculante">
        Ver análisis de liquidez completo
        <span class="material-symbols-outlined">chevron_right</span>
      </button>`;
  }

  if (!E?.disponible && D?.dsoDias == null && CE?.cicloDias == null) {
    estEl.classList.add('hidden');
    estEl.innerHTML = '';
  } else {
    const tone = liquidezToneClass(E?.calidadDeuda?.tone || D?.tone);
    const riskLabel = tone === 'rose' ? 'RIESGO ALTO'
      : tone === 'amber' ? 'ATENCIÓN'
        : tone === 'green' ? 'EQUILIBRADA'
          : 'ESTRUCTURA';
    const panelTone = tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : 'rose';
    estEl.className = `bg-analisis-card bg-analisis-card--estructura bg-analisis-card--${panelTone}`;
    estEl.classList.remove('hidden');
    estEl.innerHTML = `
      <div class="bg-analisis-card__head">
        <div class="bg-analisis-card__title-wrap">
          <span class="material-symbols-outlined">shield</span>
          <h4>ESTRUCTURA FINANCIERA - ${riskLabel}</h4>
        </div>
        <span class="bg-analisis-dot bg-analisis-dot--${tone}" aria-hidden="true"></span>
      </div>
      <p class="bg-analisis-card__summary">${escHtml(E?.calidadDeuda?.summary || D?.summary || '')}</p>
      <ul class="bg-analisis-facts">
        <li><span class="material-symbols-outlined">schedule</span>
          Pasivo de corto plazo ${E?.calidadDeuda?.cortoPct != null ? `${E.calidadDeuda.cortoPct}%` : '—'}</li>
        <li><span class="material-symbols-outlined">percent</span>
          Endeudamiento ${E?.endeudamientoPct != null ? `${E.endeudamientoPct}%` : '—'}
          ${E?.endeudamientoLabel ? ` · ${escHtml(E.endeudamientoLabel)}` : ''} (agencia 60–80%)</li>
        <li><span class="material-symbols-outlined">diversity_3</span>
          Autonomía ${E?.autonomiaPct != null ? `${E.autonomiaPct}%` : '—'}
          ${E?.autonomiaLabel ? ` · ${escHtml(E.autonomiaLabel)}` : ''} (agencia 20–40%)</li>
        <li><span class="material-symbols-outlined">timelapse</span>
          Días de Cuentas por Cobrar ${D?.dsoDias != null ? `${D.dsoDias} días` : '—'}</li>
        <li><span class="material-symbols-outlined">sync</span>
          Ciclo de efectivo ${CE?.cicloDias != null ? `${CE.cicloDias} días` : '—'}</li>
      </ul>
      <button type="button" class="bg-analisis-link" data-bg-kpi="calidadDeuda">
        Ver análisis financiero completo
        <span class="material-symbols-outlined">chevron_right</span>
      </button>`;
  }
}

function renderEstructuraNote() {
  /* Reemplazado por renderBgAnalisisPanels en el layout Balance */
}

function liquidezToneClass(tone) {
  if (tone === 'rose') return 'rose';
  if (tone === 'amber') return 'amber';
  if (tone === 'green') return 'green';
  if (tone === 'blue') return 'blue';
  return 'slate';
}

function renderLiquidezNote(liquidez, ratios, fmt, targetId = 'liquidezInterpretacion') {
  const note = document.getElementById(targetId);
  if (!note) return;
  const L = liquidez || null;
  const razon = L?.razonCirculante ?? ratios?.liquidezCorriente;
  if (razon == null && L?.pruebaAcida == null) {
    note.classList.add('hidden');
    note.innerHTML = '';
    return;
  }

  const interp = L?.interpretacion || ratios?.interpretacion || {};
  const lectura = L?.lectura || ratios?.lectura || {};
  const capital = L?.capitalTrabajo ?? ratios?.capitalTrabajo;
  const acida = L?.pruebaAcida ?? ratios?.pruebaAcida;
  const deficit = L?.deficitAcido ?? ratios?.deficitAcido;
  const margenPct = L?.margenSobreAcPct ?? ratios?.margenSobreAcPct;
  const tone = liquidezToneClass(interp.tone || L?.acidTone);

  note.classList.remove('hidden');
  note.innerHTML = `
    <div class="liquidez-note__badge liquidez-note__badge--${tone}">${escHtml(interp.label || 'Liquidez')}</div>
    <p class="liquidez-note__summary">${escHtml(interp.summary || lectura.razon || '')}</p>
    <ul class="liquidez-note__facts">
      <li><strong>Capital de trabajo:</strong> ${capital != null ? fmt.money(capital) : '—'}
        ${margenPct != null ? ` · ${margenPct}% del activo circulante` : ''}</li>
      <li><strong>Razón circulante:</strong> ${formatRatio(razon)}
        <span class="liquidez-note__muted">(AC ÷ PC)</span></li>
      <li><strong>Prueba ácida:</strong> ${formatRatio(acida)}
        <span class="liquidez-note__muted">(Caja + Bancos + Equiv. + CxC) ÷ Pasivo CP</span></li>
      <li><strong>Caja/Bancos/Equiv.:</strong> ${L?.efectivoYEquivalentes != null ? fmt.money(L.efectivoYEquivalentes) : '—'}
        · <strong>CxC:</strong> ${L?.cuentasPorCobrar != null ? fmt.money(L.cuentasPorCobrar) : '—'}</li>
      ${deficit != null && deficit < 0
        ? `<li class="liquidez-note__alert"><strong>Déficit ácido:</strong> ${fmt.money(deficit)} (efectivo+CxC vs pasivo CP)</li>`
        : ''}
    </ul>
    <p class="liquidez-note__hint">${escHtml(lectura.acida || '')}</p>
    <p class="liquidez-note__theory">La prueba ácida solo considera liquidez inmediata: caja, bancos, equivalentes a efectivo y cuentas por cobrar. Inventarios, trabajos en proceso, IVA por acreditar y pagos anticipados no forman parte del numerador.</p>
  `;
}

function renderRatios(ratios, summary, fmt) {
  const el = document.getElementById('ratiosEeff');
  if (!el) return;
  const L = summary?.liquidez || ratios || {};
  const razon = L.razonCirculante ?? ratios?.liquidezCorriente;
  const acida = L.pruebaAcida ?? ratios?.pruebaAcida;
  const capital = L.capitalTrabajo ?? ratios?.capitalTrabajo;
  const razonTone = liquidezToneClass(L.interpretacion?.tone);
  const acidTone = liquidezToneClass(L.acidTone);
  const ebitda = summary?.ebitda;
  const margenEbitda = summary?.margenEbitdaPct;
  const crecEbit = summary?.crecimientoEbitPct;
  const ebitdaTone = Number(ebitda) < 0 ? 'rose' : Number(margenEbitda) >= 5 ? 'green' : Number(margenEbitda) >= 0 ? 'amber' : 'slate';

  el.innerHTML = [
    ratioCard('Margen bruto', summary.margenBrutoPct, 'Utilidad bruta / ventas'),
    ratioCard('Margen operación', summary.margenOperacionPct, 'Utilidad operación / ventas'),
    kpiCard(
      'EBITDA (UAFIDA)',
      ebitda != null ? fmt.money(ebitda) : '—',
      margenEbitda != null
        ? `Margen ${margenEbitda}% · UO + depreciación`
        : 'Utilidad operación + depreciación del periodo',
      ebitdaTone,
    ),
    ratioCard('Margen EBITDA', margenEbitda, 'EBITDA / ventas'),
    ratioCard(
      'Crecimiento EBIT',
      crecEbit,
      crecEbit != null ? 'vs mismo periodo año anterior' : 'Sin base año anterior',
    ),
    kpiCard('Capital de trabajo', capital != null ? fmt.money(capital) : '—', 'Activo circ. − pasivo CP', capital != null && capital < 0 ? 'rose' : 'green'),
    kpiCard('Razón circulante', formatRatio(razon), 'AC ÷ PC · margen de corto plazo', razonTone),
    kpiCard('Prueba ácida', formatRatio(acida), '(Caja+Bancos+Equiv.+CxC) ÷ PC', acidTone),
  ].join('');

  renderLiquidezNote(summary?.liquidez || ratios, ratios, fmt);
}

function kpiCard(title, value, sub, cls, id) {
  const idAttr = id ? ` id="${id}"` : '';
  return `<div class="kpi-card kpi-card--${cls || 'blue'}"${idAttr}><span class="kpi-title">${title}</span><div class="kpi-value">${value}</div>${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}</div>`;
}

function ratioCard(title, pct, sub) {
  const n = Number(pct);
  const cls = Number.isFinite(n) ? (n < 0 ? 'loss' : n > 0 ? 'gain' : 'amber') : 'slate';
  return `<div class="kpi-card kpi-card--eeff kpi-card--${cls}"><span class="kpi-title">${title}</span><div class="kpi-value">${pct != null ? `${pct}%` : '—'}</div><p class="kpi-subtitle">${sub}</p></div>`;
}

function renderVtasmenTable(vtasmen, fmt) {
  const body = document.getElementById('vtasmenTable');
  const section = document.getElementById('sectionVtasmen');
  if (!body || !section) return;
  if (!vtasmen?.available || !vtasmen.resultLines?.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  body.innerHTML = vtasmen.resultLines.map((row) => `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td>${row.label}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>
  `).join('');
}

function formatDayLabel(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function escHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearDailyDetail() {
  selectedDailyFecha = null;
  const panel = document.getElementById('dailySalesDetail');
  if (panel) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }
}

function renderDailySalesTable(rows, fmt) {
  const body = document.getElementById('dailySalesTable');
  const foot = document.getElementById('dailySalesFoot');
  if (!body) return;
  clearDailyDetail();
  if (!rows?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Sin unidades en el periodo.</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  const totals = rows.reduce((a, r) => ({
    units: a.units + Number(r.units || 0),
    ventaSubtotal: a.ventaSubtotal + Number(r.ventaSubtotal || 0),
    costoNeto: a.costoNeto + Number(r.costoNeto || 0),
    utilidad: a.utilidad + Number(r.utilidad || 0),
  }), { units: 0, ventaSubtotal: 0, costoNeto: 0, utilidad: 0 });
  const margenTotal = totals.ventaSubtotal ? Math.round((totals.utilidad / totals.ventaSubtotal) * 1000) / 10 : 0;

  body.innerHTML = rows.map((row) => `
    <tr class="row-selectable" data-fecha="${row.fecha}" tabindex="0" role="button">
      <td>${formatDayLabel(row.fecha)}</td>
      <td class="cell-num">${fmt.number(row.units)}</td>
      <td class="cell-money">${fmt.money(row.ventaSubtotal)}</td>
      <td class="cell-money">${fmt.money(row.costoNeto)}</td>
      <td class="cell-money ${moneyClass(row.utilidad)}"><strong>${fmt.money(row.utilidad)}</strong></td>
      <td class="cell-num">${row.margenPct ?? 0}%</td>
    </tr>
  `).join('');

  if (foot) {
    foot.innerHTML = `
      <tr class="row-highlight">
        <td><strong>Total</strong></td>
        <td class="cell-num"><strong>${fmt.number(totals.units)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(totals.ventaSubtotal)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(totals.costoNeto)}</strong></td>
        <td class="cell-money ${moneyClass(totals.utilidad)}"><strong>${fmt.money(totals.utilidad)}</strong></td>
        <td class="cell-num"><strong>${margenTotal}%</strong></td>
      </tr>`;
  }

  body.querySelectorAll('tr.row-selectable').forEach((tr) => {
    tr.addEventListener('click', async () => {
      const fecha = tr.dataset.fecha;
      const panel = document.getElementById('dailySalesDetail');
      if (panel) {
        panel.classList.remove('hidden');
        panel.innerHTML = '<p>Cargando…</p>';
      }
      try {
        const data = await Dashboard.api(`/contabilidad/ventas-dia?fecha=${encodeURIComponent(fecha)}`);
        panel.innerHTML = `<div class="daily-detail-panel"><h4>${formatDayLabel(fecha)}</h4><p>${data.units?.length || 0} unidades</p></div>`;
      } catch (err) {
        panel.innerHTML = `<p>${escHtml(err.message)}</p>`;
      }
    });
  });
}

function getFiltrosContabilidad() {
  return {
    sucursal: document.getElementById('filtroSucursal')?.value || 'todos',
    area: document.getElementById('filtroArea')?.value || 'todos',
    includeFi: document.getElementById('filtroIncludeFi')?.checked !== false,
  };
}

function renderPeAgencyInsight(insight, hostId = 'peAgenciaInsight') {
  const el = document.getElementById(hostId);
  if (!el) return;
  if (!insight?.title) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  const badgeTone = insight.severity === 'critical'
    ? 'rose'
    : (insight.severity === 'warning' ? 'amber' : (insight.severity === 'info' ? 'green' : 'blue'));
  const facts = Array.isArray(insight.facts) ? insight.facts : [];
  const recs = Array.isArray(insight.recommendations) ? insight.recommendations : [];
  const criterio = Array.isArray(insight.criterio) ? insight.criterio : [];

  el.classList.remove('hidden');
  el.classList.toggle('pe-insight-note--critical', insight.severity === 'critical');
  el.classList.toggle('pe-insight-note--warning', insight.severity === 'warning');
  el.innerHTML = `
    <span class="liquidez-note__badge liquidez-note__badge--${badgeTone}">${escHtml(insight.badge || 'Alerta inteligente')}</span>
    <p class="liquidez-note__summary"><strong>${escHtml(insight.title)}</strong></p>
    <p class="liquidez-note__summary">${escHtml(insight.summary || '')}</p>
    ${facts.length ? `<ul class="liquidez-note__facts">${facts.map((f) => `<li><strong>${escHtml(f.label)}:</strong> ${escHtml(f.value)}</li>`).join('')}</ul>` : ''}
    <p class="liquidez-note__hint"><strong>Interpretación.</strong> ${escHtml(insight.analysis || '')}</p>
    ${criterio.length ? `<p class="liquidez-note__hint"><strong>Criterio de lectura</strong></p><ul class="liquidez-note__facts">${criterio.map((c) => `<li>${escHtml(c)}</li>`).join('')}</ul>` : ''}
    ${recs.length ? `<p class="liquidez-note__hint"><strong>Acciones sugeridas</strong></p><ul class="liquidez-note__facts">${recs.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ul>` : ''}
    ${insight.chatPrompt ? `<p class="liquidez-note__theory"><button type="button" class="btn-glass btn-primary pe-insight-chat-btn" data-pe-insight-chat>Más información en el asistente</button></p>` : ''}
  `;

  el.querySelector('[data-pe-insight-chat]')?.addEventListener('click', () => {
    if (window.AssistantBubble?.open) {
      window.AssistantBubble.open(insight.chatPrompt);
    }
  });
}

function renderPuntoEquilibrio(pe, fmt) {
  const { setText } = Dashboard;
  const cardsEl = document.getElementById('peSegmentCards');
  const tableEl = document.getElementById('peSegmentosTable');
  const agenciaEl = document.getElementById('peAgenciaTable');
  const badge = document.getElementById('peModeBadge');
  if (!pe?.available && !pe?.agencia) {
    if (cardsEl) cardsEl.innerHTML = '';
    if (tableEl) tableEl.innerHTML = '<tr class="empty-row"><td colspan="6">Sin datos de punto de equilibrio</td></tr>';
    if (agenciaEl) agenciaEl.innerHTML = '';
    renderPeAgencyInsight(null);
    if (badge) {
      badge.textContent = '—';
      badge.removeAttribute('data-mode');
    }
    return;
  }

  const temporal = pe.temporal || {};
  if (badge) {
    badge.textContent = temporal.label || temporal.mode || '—';
    badge.dataset.mode = temporal.mode || '';
  }
  setText('peTemporalLabel', temporal.purpose
    || 'PE = Gastos fijos ÷ Margen de contribución % · preliminar operativo');
  setText('peMethodologyNote', [
    pe.methodology?.formula,
    pe.methodology?.exclusiones,
    pe.methodology?.gastosFijos,
  ].filter(Boolean).join(' · '));

  const segmentos = pe.segmentos || [];
  const tone = (row) => (row.alcanzoEquilibrio ? 'pe-card-ok kpi-card--green' : 'pe-card-gap kpi-card--rose');

  if (cardsEl) {
    cardsEl.innerHTML = segmentos.map((row) => {
      const peVal = row.puntoEquilibrio != null ? formatFullMoney(row.puntoEquilibrio) : '—';
      const cob = row.coberturaPct ?? row.cumplimientoPct;
      const sub = cob != null
        ? `Cobertura ${cob}%${row.coberturaRatio != null ? ` (${row.coberturaRatio}×)` : ''} · MC ${row.margenContribucionPct ?? '—'}%`
        : `MC ${row.margenContribucionPct ?? '—'}%`;
      const mon = row.monitoreo;
      const monLine = mon
        ? `<p class="kpi-subtitle">Proy. ${formatFullMoney(mon.ventasProyectadas)} · avance ${mon.avanceEquilibrioPct ?? '—'}%</p>`
        : '';
      return `<div class="kpi-card kpi-card--eeff ${tone(row)}">
        <div class="kpi-card-head"><span class="kpi-title">${escHtml(row.label)}</span><span class="material-symbols-outlined kpi-icon">flag</span></div>
        <div class="kpi-value money">${peVal}</div>
        <p class="kpi-subtitle">${escHtml(sub)}</p>
        ${monLine}
      </div>`;
    }).join('');
  }

  if (tableEl) {
    tableEl.innerHTML = segmentos.map((row) => `<tr class="${row.id === 'agencia' ? 'row-total' : ''}">
      <td>${escHtml(row.label)}</td>
      <td class="cell-money">${formatFullMoney(row.ventas)}</td>
      <td class="cell-money">${row.margenContribucionPct != null ? `${row.margenContribucionPct}%` : '—'}</td>
      <td class="cell-money">${formatFullMoney(row.gastosFijos)}</td>
      <td class="cell-money">${row.puntoEquilibrio != null ? formatFullMoney(row.puntoEquilibrio) : '—'}</td>
      <td class="cell-num">${(row.coberturaPct ?? row.cumplimientoPct) != null ? `${row.coberturaPct ?? row.cumplimientoPct}%` : '—'}</td>
    </tr>`).join('') || '<tr class="empty-row"><td colspan="6">Sin segmentos</td></tr>';
  }

  const a = pe.agencia || pe.summary || {};
  setText('peAgenciaSubtitle', a.excludeNote || a.note || 'Cálculo consolidado del periodo');
  if (agenciaEl) {
    const rows = [
      ['Ventas del periodo', a.ventas],
      ['Costos variables directos', a.costosVariablesDirectos],
      ['Gastos variables adicionales', a.gastosVariablesAdicionales],
      ['Margen de contribución', a.margenContribucion],
      [`Margen de contribución %`, a.margenContribucionPct != null ? `${a.margenContribucionPct}%` : null, true],
      ['Gastos fijos operativos', a.gastosFijos],
      ['Punto de equilibrio', a.puntoEquilibrio],
      ['Ratio de cobertura', a.coberturaRatio != null ? `${a.coberturaRatio} veces` : null, true],
      ['Cobertura porcentual', (a.coberturaPct ?? a.cumplimientoPct) != null ? `${a.coberturaPct ?? a.cumplimientoPct}%` : null, true],
      ['Brecha para alcanzar el equilibrio', a.brechaEquilibrioPct != null ? `${a.brechaEquilibrioPct}%` : null, true],
      ['Ventas adicionales requeridas', a.ventasAdicionalesRequeridas],
      ['Faltante / (excedente)', a.faltante],
      ['Utilidad / (pérdida) operativa', a.utilidadOperativa],
    ];
    if (a.monitoreo) {
      rows.push(
        ['Ventas proyectadas al cierre', a.monitoreo.ventasProyectadas],
        ['Avance al equilibrio', a.monitoreo.avanceEquilibrioPct != null ? `${a.monitoreo.avanceEquilibrioPct}%` : null, true],
      );
    }
    agenciaEl.innerHTML = rows.map(([label, value, plain]) => {
      const display = value == null
        ? '—'
        : (plain ? escHtml(String(value)) : formatFullMoney(value));
      const hl = label.startsWith('Punto') || label.startsWith('Margen de contribución') && !label.includes('%');
      return `<tr class="${hl ? 'row-highlight' : ''}"><td>${escHtml(label)}</td><td class="cell-money">${display}</td></tr>`;
    }).join('');
  }

  renderPeAgencyInsight(pe.insight);
}

async function loadContabilidad(fechaInicio, fechaFin) {
  const { fmt, api, setText } = Dashboard;
  const { sucursal, area, includeFi } = getFiltrosContabilidad();
  const qs = new URLSearchParams({ fechaInicio, fechaFin, sucursal, area, includeFi: String(includeFi) });
  const data = await api(`/contabilidad?${qs.toString()}`);

  const catalog = data.catalogKpis || {};
  const s = catalog.summary || data.summary;
  const eeff = data.eeff || {};

  const scopeEl = document.getElementById('filterScopeLabel');
  if (scopeEl) scopeEl.textContent = catalog.filtros?.scopeLabel || data.filtros?.scopeLabel || 'Consolidado';

  const methodEl = document.getElementById('catalogMethodology');
  if (methodEl && catalog.methodology) {
    methodEl.textContent = `${catalog.methodology.ingresos} · ${catalog.methodology.costos} · ${catalog.methodology.gastos}`;
  }

  setPlainKpi('kpiVentasNetas', s.ventasTotales);
  setText('kpiVentasNetasSub', `Margen bruto ${s.margenBrutoPct ?? '—'}%`);

  setPlainKpi('kpiCostoVentas', s.costoVentas);
  setText('kpiCostoVentasSub', '0600 · cargos al cierre');

  setSignedKpi('kpiUtilidadBruta', 'kpiCardUtilidadBruta', s.utilidadBruta, 'kpiUtilidadBrutaSub', `Ventas − costos · ${s.margenBrutoPct ?? 0}% margen`);

  setPlainKpi('kpiGastoDepartamento', s.gastoDepartamento);
  setText('kpiGastoDepartamentoSub', catalog.filtros?.scopeLabel === 'Consolidado'
    ? 'Suma departamentos · catálogo Excel'
    : `Gasto · ${catalog.filtros?.scopeLabel || 'alcance'}`);

  setPlainKpi('kpiGastosOperacion', s.gastosOperacion);
  setText('kpiGastosOperacionSub', '0700 · total operación (punto equilibrio)');

  setSignedKpi(
    'kpiUtilidadOperacion',
    'kpiCardUtilidadOperacion',
    s.utilidadOperacion,
    'kpiUtilidadOperacionSub',
    `Utilidad bruta − gastos · ${s.margenOperacionPct ?? 0}% margen`,
    s.margenOperacionPct,
  );

  const peEl = document.getElementById('kpiPuntoEquilibrio');
  const peCard = document.getElementById('kpiCardPuntoEquilibrio');
  const peData = data.puntoEquilibrio;
  const peMain = peData?.summary || peData?.agencia || null;
  const peValue = peMain?.puntoEquilibrio ?? s.puntoEquilibrio;
  const peMargen = peMain?.margenContribucionPct ?? s.margenBrutoPct;
  if (peValue != null && peMargen > 0) {
    if (peEl) peEl.textContent = formatFullMoney(peValue);
    const cob = peMain?.coberturaPct ?? peMain?.cumplimientoPct;
    const cobTxt = cob != null
      ? ` · cobertura ${cob}%${peMain?.coberturaRatio != null ? ` (${peMain.coberturaRatio}×)` : ''}`
      : '';
    setText('kpiPuntoEquilibrioSub', `GF ÷ ${peMargen}% MC${cobTxt}`);
    peCard?.classList.toggle('kpi-card--loss', peMain?.alcanzoEquilibrio === false);
    peCard?.classList.toggle('kpi-card--gain', peMain?.alcanzoEquilibrio === true);
  } else {
    if (peEl) peEl.textContent = '—';
    setText('kpiPuntoEquilibrioSub', (peMargen != null && peMargen <= 0) ? 'Margen contribución ≤ 0 — no calculable' : 'Sin datos');
    peCard?.classList.add('kpi-card--loss');
    peCard?.classList.remove('kpi-card--gain');
  }

  renderPuntoEquilibrio(peData, fmt);

  renderResultadoTable(
    (catalog.resultLines || []).filter((r) => r.key !== 'puntoEquilibrio'),
    fmt,
  );
  renderDepartmentExpenseTable(catalog.departmentExpenseLines, fmt);
  renderCatalogLines('ingresosCatalogTable', catalog.incomeLines, fmt);
  renderCatalogLines('costosCatalogTable', catalog.costLines, fmt);
  renderCatalogLines('gastosCatalogTable', catalog.expenseLines, fmt);
  renderBalanceTable(eeff.balance, fmt);
  renderRatios(eeff.ratios, {
    ...s,
    liquidez: s.liquidez || eeff.liquidez || data.balanceGeneral?.liquidez,
    ebitda: data.summary?.ebitda ?? data.ebitMetrics?.ebitda ?? s.ebitda,
    margenEbitdaPct: data.summary?.margenEbitdaPct ?? data.ebitMetrics?.margenEbitdaPct ?? s.margenEbitdaPct,
    crecimientoEbitPct: data.summary?.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct ?? s.crecimientoEbitPct,
  }, fmt);
  renderBalanceGeneralPanel(data.balanceGeneral, fmt);
  renderVtasmenTable(data.ventasAutosNuevosEeff, fmt);
  renderDailySalesTable(data.dailyBreakdown || [], fmt);

  if (window.KpiInsights?.apply && s) {
    window.KpiInsights.apply('contabilidad', {
      fechaInicio,
      fechaFin,
      summary: {
        ventasTotales: s.ventasTotales,
        costoVentas: s.costoVentas,
        utilidadBruta: s.utilidadBruta,
        margenBrutoPct: s.margenBrutoPct,
        gastosOperacion: s.gastosOperacion,
        utilidadOperacion: s.utilidadOperacion,
        margenOperacionPct: s.margenOperacionPct,
        puntoEquilibrio: peMain?.puntoEquilibrio ?? s.puntoEquilibrio,
        gastoDepartamento: s.gastoDepartamento,
      },
      puntoEquilibrio: peData,
      liquidez: data.balanceGeneral?.liquidez || s.liquidez || eeff.liquidez || null,
    });
  }

  return data;
}

async function onConsultContabilidad(fechaInicio, fechaFin) {
  const { setText } = Dashboard;
  const tasks = [
    loadContabilidad(fechaInicio, fechaFin),
    window.EeffSummary?.load(fechaInicio, fechaFin) ?? Promise.resolve(),
  ];
  if (activeMainTab === 'analisis' || new URLSearchParams(window.location.search).get('tab') === 'analisis') {
    tasks.push(window.AnalisisFinanciero?.load?.(fechaInicio, fechaFin) ?? Promise.resolve());
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === results.length) {
    throw failed[0].reason || new Error('No se pudieron cargar los datos');
  }
  if (failed.length) {
    console.warn('[contabilidad] carga parcial:', failed.map((f) => f.reason?.message || f.reason));
  }
  setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
}

document.getElementById('contabilidadMainTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.contabilidad-tab');
  if (!tab) return;
  switchMainTab(tab.dataset.tab);
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-bg-kpi-close]') || e.target.closest('#bgKpiFloatBackdrop')) {
    closeBgKpiFloat();
    return;
  }
  const dateChip = e.target.closest('#bgBalanceDateChip');
  if (dateChip) {
    e.preventDefault();
    document.getElementById('pillPeriod')?.click();
    return;
  }
  const kpiBtn = e.target.closest('[data-bg-kpi]');
  if (!kpiBtn) return;
  if (e.target.closest('.kpi-insight-btn')) return;
  e.preventDefault();
  const id = kpiBtn.dataset.bgKpi;
  if (!id) return;
  if (bgKpiState.activeId === id) closeBgKpiFloat();
  else openBgKpiFloat(id);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBgKpiFloat();
});

switchMainTab(getMainTabFromUrl());

Dashboard.initDateFilter({
  onConsult: onConsultContabilidad,
  getInitialRange(fromUrl) {
    const onEeff = getMainTabFromUrl() === 'eeff';
    if (onEeff && window.EeffSummary?.getComparativa2026DefaultRange) {
      if (fromUrl.fechaInicio && fromUrl.fechaFin
        && window.EeffSummary.isComparativaYearRange(fromUrl.fechaInicio, fromUrl.fechaFin)) {
        return fromUrl;
      }
      return window.EeffSummary.getComparativa2026DefaultRange();
    }
    if (fromUrl.fechaInicio && fromUrl.fechaFin) return fromUrl;
    return Dashboard.getDefaultDateRange();
  },
});

['filtroSucursal', 'filtroArea', 'filtroIncludeFi'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => {
    if (activeMainTab !== 'catalogo') return;
    const fi = document.getElementById('fechaInicio')?.value;
    const ff = document.getElementById('fechaFin')?.value;
    if (fi && ff) loadContabilidad(fi, ff);
  });
});
