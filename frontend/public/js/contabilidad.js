let selectedDailyFecha = null;
let activeMainTab = 'catalogo';
let bgKpiState = { items: [], activeId: null, fmt: null };

function getMainTabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'eeff') return 'eeff';
  if (tab === 'balance') return 'balance';
  return 'catalogo';
}

function switchMainTab(tab) {
  activeMainTab = tab;
  document.querySelectorAll('.contabilidad-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('panelContabilidadCatalogo')?.classList.toggle('hidden', tab !== 'catalogo');
  document.getElementById('panelContabilidadBalance')?.classList.toggle('hidden', tab !== 'balance');
  document.getElementById('panelContabilidadEeff')?.classList.toggle('hidden', tab !== 'eeff');
  const scopePill = document.getElementById('pillScope');
  if (scopePill) scopePill.style.display = tab === 'eeff' ? 'none' : '';

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

  const url = new URL(window.location.href);
  if (tab === 'eeff' || tab === 'balance') url.searchParams.set('tab', tab);
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
      { label: 'Pasivo circulante', value: L.pasivoCirculante },
      { label: 'Capital de trabajo', value: L.capitalTrabajo },
      { label: 'Inventarios / WIP', value: L.inventariosYProceso },
      { label: 'Pagos anticipados', value: L.pagosAnticipados },
      { label: 'Activos rápidos', value: L.activosRapidos },
    ];
    const invRows = (L.desglose?.inventarios || []).map((a) => ({
      cuenta: a.cuenta, label: a.label, value: a.value,
    }));
    const antRows = (L.desglose?.pagosAnticipados || []).map((a) => ({
      cuenta: a.cuenta, label: a.label, value: a.value,
    }));
    const rapRows = (L.desglose?.rapidos || []).map((a) => ({
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
        hint: L.lectura?.razon || L.formula?.razonCirculante || 'AC ÷ PC',
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
        sub: 'Sin inventarios ni anticipados · clic',
        hint: L.lectura?.acida || L.formula?.pruebaAcida || 'Activos rápidos ÷ PC',
        hostId: 'kpiBgPruebaAcida',
        facts: [
          ...liqFacts,
          { label: 'Déficit / excedente ácido', value: L.deficitAcido },
        ],
        groups: [
          { title: 'Activos rápidos', rows: rapRows, total: L.activosRapidos },
          { title: 'Inventarios / WIP excluidos', rows: invRows, total: L.inventariosYProceso },
          { title: 'Pagos anticipados excluidos', rows: antRows, total: L.pagosAnticipados },
          { title: 'Pasivo circulante', rows: pasivoCp, total: L.pasivoCirculante },
        ],
      },
    );
  }

  return items;
}

function closeBgKpiFloat() {
  bgKpiState.activeId = null;
  document.getElementById('bgKpiFloat')?.classList.add('hidden');
  const backdrop = document.getElementById('bgKpiFloatBackdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.querySelectorAll('#kpiBalanceGeneral .kpi-card--interactive.is-open, #bgLiquidezKpis .kpi-card--interactive.is-open')
    .forEach((el) => el.classList.remove('is-open'));
}

function openBgKpiFloat(kpiId) {
  const fmt = bgKpiState.fmt || Dashboard.fmt;
  const kpi = bgKpiState.items.find((i) => i.id === kpiId);
  const panel = document.getElementById('bgKpiFloat');
  const backdrop = document.getElementById('bgKpiFloatBackdrop');
  if (!kpi || !panel || !backdrop) return;

  bgKpiState.activeId = kpiId;
  document.querySelectorAll('#kpiBalanceGeneral .kpi-card--interactive, #bgLiquidezKpis .kpi-card--interactive')
    .forEach((el) => el.classList.toggle('is-open', el.dataset.bgKpi === kpiId));

  const display = kpi.display != null ? kpi.display : formatFullMoney(kpi.value);
  const factsHtml = (kpi.facts || []).length
    ? `<ul class="bg-kpi-float__facts">${kpi.facts.map((f) => `
        <li><strong>${escHtml(f.label)}</strong><span class="${moneyClass(f.value)}">${fmt.money(f.value || 0)}</span></li>
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
          <span class="bg-kpi-float__meta">${rowCount} cuenta${rowCount === 1 ? '' : 's'} relacionadas</span>
        </div>
      </div>
      <button type="button" class="bg-kpi-float__close" data-bg-kpi-close aria-label="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="bg-kpi-float__body">
      ${factsHtml}
      ${groupsHtml || '<div class="bg-kpi-float__group"><p class="section-subtitle">Sin desglose disponible.</p></div>'}
    </div>`;

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
}

function renderBgInteractiveKpis(containerId, itemIds, fmt) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const items = bgKpiState.items.filter((i) => itemIds.includes(i.id));
  if (!items.length) {
    el.innerHTML = containerId === 'bgLiquidezKpis' ? '' : '<p class="section-subtitle">Sin KPIs para el periodo.</p>';
    return;
  }

  el.innerHTML = items.map((k) => {
    const isOpen = bgKpiState.activeId === k.id;
    const display = k.display != null ? k.display : formatFullMoney(k.value);
    const idAttr = k.hostId ? ` id="${k.hostId}"` : '';
    return `
    <button type="button"${idAttr}
      class="kpi-card kpi-card--eeff kpi-card--interactive kpi-card--${k.color || 'blue'}${isOpen ? ' is-open' : ''}"
      data-bg-kpi="${k.id}"
      aria-expanded="${isOpen}"
      title="Clic para ver desglose relacionado">
      <div class="kpi-card-head">
        <span class="kpi-title">${escHtml(k.label)}</span>
        <span class="material-symbols-outlined kpi-icon">${k.icon || 'payments'}</span>
      </div>
      <div class="kpi-value money ${moneyClass(k.value)}">${display}</div>
      ${k.sub ? `<p class="kpi-subtitle">${escHtml(k.sub)}</p>` : ''}
      <span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">open_in_new</span>
    </button>`;
  }).join('');
}

function renderBalanceGeneralPanel(bg, fmt) {
  const meth = document.getElementById('balanceGeneralMethodology');
  if (meth) {
    meth.textContent = bg?.available
      ? `Saldo final al cierre de ${bg.labelCierre || bg.asOfCierre || bg.asOf || 'periodo'} · SQL CON_CTAS · Clic en un KPI para ver el desglose`
      : 'Sin datos de CON_CTAS (SQL) para el periodo seleccionado';
  }

  bgKpiState.fmt = fmt;
  bgKpiState.items = buildBgKpiItems(bg);
  if (bgKpiState.activeId && !bgKpiState.items.some((i) => i.id === bgKpiState.activeId)) {
    closeBgKpiFloat();
  }

  renderBgInteractiveKpis('kpiBalanceGeneral', [
    'activoCirculante', 'activoFijo', 'activoDiferido', 'activoTotal',
    'pasivoCirculante', 'pasivoLargo', 'pasivoTotal', 'capital',
  ], fmt);

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

  renderBgInteractiveKpis('bgLiquidezKpis', ['capitalTrabajo', 'razonCirculante', 'pruebaAcida'], fmt);
  renderLiquidezNote(bg?.liquidez, bg?.liquidez, fmt, 'bgLiquidezInterpretacion');

  if (bgKpiState.activeId) openBgKpiFloat(bgKpiState.activeId);
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
  const inv = L?.inventariosYProceso ?? ratios?.inventariosYProceso;
  const ant = L?.pagosAnticipados ?? ratios?.pagosAnticipados;
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
        <span class="liquidez-note__muted">(AC − inventarios/WIP − anticipados) ÷ PC</span></li>
      <li><strong>Inventarios y proceso:</strong> ${inv != null ? fmt.money(inv) : '—'}
        · <strong>Anticipados:</strong> ${ant != null ? fmt.money(ant) : '—'}</li>
      ${deficit != null && deficit < 0
        ? `<li class="liquidez-note__alert"><strong>Déficit rápido:</strong> ${fmt.money(deficit)} sin inventarios ni anticipados</li>`
        : ''}
    </ul>
    <p class="liquidez-note__hint">${escHtml(lectura.acida || '')}</p>
    <p class="liquidez-note__theory">La liquidez contable puede ser engañosa si gran parte del activo circulante está en inventarios lentos o cuentas por cobrar de difícil recuperación. Los impuestos pagados por anticipado se excluyen de la prueba ácida porque no son efectivo disponible.</p>
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

  el.innerHTML = [
    ratioCard('Margen bruto', summary.margenBrutoPct, 'Utilidad bruta / ventas'),
    ratioCard('Margen operación', summary.margenOperacionPct, 'Utilidad operación / ventas'),
    kpiCard('Capital de trabajo', capital != null ? fmt.money(capital) : '—', 'Activo circ. − pasivo CP', capital != null && capital < 0 ? 'rose' : 'green'),
    kpiCard('Razón circulante', formatRatio(razon), 'AC ÷ PC · margen de corto plazo', razonTone),
    kpiCard('Prueba ácida', formatRatio(acida), 'Sin inventarios ni anticipados', acidTone),
    kpiCard('Punto equilibrio', summary.puntoEquilibrio != null ? fmt.currency(summary.puntoEquilibrio) : '—', 'Gastos 0700 ÷ margen bruto %', 'violet'),
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
  if (s.puntoEquilibrio != null && s.margenBrutoPct > 0) {
    if (peEl) peEl.textContent = formatKpiAmount(s.puntoEquilibrio);
    setText('kpiPuntoEquilibrioSub', `Gastos ÷ ${s.margenBrutoPct}% margen bruto`);
    peCard?.classList.remove('kpi-card--loss');
  } else {
    if (peEl) peEl.textContent = '—';
    setText('kpiPuntoEquilibrioSub', s.margenBrutoPct <= 0 ? 'Margen bruto ≤ 0 — no calculable' : 'Sin datos');
    peCard?.classList.add('kpi-card--loss');
  }

  renderResultadoTable(catalog.resultLines, fmt);
  renderDepartmentExpenseTable(catalog.departmentExpenseLines, fmt);
  renderCatalogLines('ingresosCatalogTable', catalog.incomeLines, fmt);
  renderCatalogLines('costosCatalogTable', catalog.costLines, fmt);
  renderCatalogLines('gastosCatalogTable', catalog.expenseLines, fmt);
  renderBalanceTable(eeff.balance, fmt);
  renderRatios(eeff.ratios, { ...s, liquidez: s.liquidez || eeff.liquidez || data.balanceGeneral?.liquidez }, fmt);
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
        puntoEquilibrio: s.puntoEquilibrio,
        gastoDepartamento: s.gastoDepartamento,
      },
      liquidez: data.balanceGeneral?.liquidez || s.liquidez || eeff.liquidez || null,
    });
  }
}

async function onConsultContabilidad(fechaInicio, fechaFin) {
  const { setText } = Dashboard;
  await Promise.all([
    loadContabilidad(fechaInicio, fechaFin),
    window.EeffSummary?.load(fechaInicio, fechaFin) ?? Promise.resolve(),
  ]);
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
