const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const fmt = {
  number(n) {
    return new Intl.NumberFormat('es-MX').format(Math.round(n || 0));
  },
  currency(n) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
  },
  money(n) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n || 0);
  },
  pct(n) {
    const sign = n > 0 ? '+' : '';
    return `${sign}${(n || 0).toFixed(1)}%`;
  },
  monthLabel(yr, mo) {
    return `${MONTHS[(mo || 1) - 1]} ${String(yr).slice(-2)}`;
  },
};

async function api(path) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (res.status === 401) {
    window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error('Sesión expirada');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || res.statusText);
  }
  return res.json();
}

function showLoading(show = true) {
  const el = document.getElementById('loading');
  if (el) el.classList.toggle('hidden', !show);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getYearParam() {
  const sel = document.getElementById('yearFilter');
  return sel?.value || '';
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCurrentQuarter(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

function getQuarterStart(year, quarter) {
  return new Date(year, (quarter - 1) * 3, 1);
}

function getQuarterEnd(year, quarter) {
  return new Date(year, quarter * 3, 0);
}

function getDatePresetRange(preset) {
  const now = new Date();
  const currentQuarter = getCurrentQuarter(now);
  const lastQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
  const lastQuarterYear = currentQuarter === 1 ? now.getFullYear() - 1 : now.getFullYear();

  const presets = {
    'mes-actual': [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)],
    'mes-anterior': [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)],
    'ultimos-30': (() => { const s = new Date(now); s.setDate(s.getDate() - 29); return [s, now]; })(),
    'acumulado-anio': [new Date(now.getFullYear(), 0, 1), now],
    'anio-actual': [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31)],
    'anio-anterior': [new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear() - 1, 11, 31)],
    'ultimo-trimestre': [getQuarterStart(lastQuarterYear, lastQuarter), getQuarterEnd(lastQuarterYear, lastQuarter)],
    'trimestre-actual': [getQuarterStart(now.getFullYear(), currentQuarter), now],
  };
  return presets[preset] || presets['mes-actual'];
}

function getDefaultDateRange() {
  const [start, end] = getDatePresetRange('mes-actual');
  return { fechaInicio: formatDateInput(start), fechaFin: formatDateInput(end) };
}

function getDateParamsFromUrl() {
  const params = new URLSearchParams(location.search);
  return {
    fechaInicio: params.get('fechaInicio') || '',
    fechaFin: params.get('fechaFin') || '',
  };
}

function syncDateParamsToUrl(fechaInicio, fechaFin) {
  const params = new URLSearchParams();
  if (fechaInicio) params.set('fechaInicio', fechaInicio);
  if (fechaFin) params.set('fechaFin', fechaFin);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function formatPeriodLabel(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return 'Seleccionar fechas';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  return fechaInicio === fechaFin ? fmt(fechaInicio) : `${fmt(fechaInicio)} – ${fmt(fechaFin)}`;
}

function setActivePresetChip(preset) {
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
    btn.classList.toggle('chip--active', btn.dataset.preset === preset);
  });
  const active = document.querySelector(`[data-preset="${preset}"]`);
  const lbl = document.getElementById('filterPresetLabel');
  if (lbl && active) lbl.textContent = active.textContent.trim();
}

function updateCompactScopeLabel() {
  const suc = document.getElementById('filtroSucursal');
  const area = document.getElementById('filtroArea');
  const el = document.getElementById('filterScopeLabel');
  if (!el) return;
  const parts = [];
  if (suc?.value && suc.value !== 'todos') {
    parts.push(suc.options[suc.selectedIndex]?.text || suc.value);
  }
  if (area?.value && area.value !== 'todos') {
    parts.push(area.options[area.selectedIndex]?.text || area.value);
  }
  el.textContent = parts.length ? parts.join(' · ') : 'Consolidado';
}

function updateCompactFilterLabels() {
  const fi = document.getElementById('fechaInicio')?.value;
  const ff = document.getElementById('fechaFin')?.value;
  const periodEl = document.getElementById('filterPeriodLabel');
  if (periodEl) periodEl.textContent = formatPeriodLabel(fi, ff);

  const legacyPeriod = document.getElementById('filterPeriodLabelLegacy');
  if (legacyPeriod) legacyPeriod.textContent = formatPeriodLabel(fi, ff);

  updateCompactScopeLabel();

  let opsCount = 0;
  document.querySelectorAll('.filter-grid-ops select, .filter-grid-ops-advanced input').forEach((el) => {
    if (el.type === 'checkbox') {
      if (el.checked) opsCount += 1;
    } else if (el.tagName === 'SELECT') {
      if (el.value) opsCount += 1;
    } else if (String(el.value ?? '').trim()) {
      opsCount += 1;
    }
  });
  const opsLbl = document.getElementById('filterOpsLabel');
  if (opsLbl) opsLbl.textContent = opsCount ? `${opsCount} activo${opsCount === 1 ? '' : 's'}` : 'Todos';
}

function initCompactFilters() {
  const pills = document.querySelectorAll('.filter-pill[aria-controls]');
  if (!pills.length) return null;

  function closeAll() {
    pills.forEach((pill) => {
      pill.setAttribute('aria-expanded', 'false');
      pill.classList.remove('is-open');
      const drawer = document.getElementById(pill.getAttribute('aria-controls'));
      drawer?.classList.add('hidden');
    });
  }

  pills.forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const drawerId = pill.getAttribute('aria-controls');
      const drawer = drawerId ? document.getElementById(drawerId) : null;
      const isOpen = pill.getAttribute('aria-expanded') === 'true';
      closeAll();
      if (!isOpen && drawer) {
        pill.setAttribute('aria-expanded', 'true');
        pill.classList.add('is-open');
        drawer.classList.remove('hidden');
      }
    });
  });

  document.addEventListener('click', closeAll);
  document.querySelectorAll('.filter-drawer').forEach((drawer) => {
    drawer.addEventListener('click', (e) => e.stopPropagation());
  });

  ['fechaInicio', 'fechaFin', 'filtroSucursal', 'filtroArea'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', updateCompactFilterLabels);
  });

  document.querySelectorAll('.filter-grid-ops select, .filter-grid-ops-advanced input').forEach((el) => {
    const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, updateCompactFilterLabels);
  });

  updateCompactFilterLabels();
  return { closeAll, updateLabels: updateCompactFilterLabels };
}

function initDateFilter({ onConsult, statusId = 'statusBadge' } = {}) {
  const fechaInicio = document.getElementById('fechaInicio');
  const fechaFin = document.getElementById('fechaFin');
  const btnConsultar = document.getElementById('btnConsultar');
  const statusEl = statusId ? document.getElementById(statusId) : null;
  if (!fechaInicio || !fechaFin) return;

  const fromUrl = getDateParamsFromUrl();
  if (fromUrl.fechaInicio && fromUrl.fechaFin) {
    fechaInicio.value = fromUrl.fechaInicio;
    fechaFin.value = fromUrl.fechaFin;
  } else {
    const defaults = getDefaultDateRange();
    fechaInicio.value = defaults.fechaInicio;
    fechaFin.value = defaults.fechaFin;
  }

  function setStatus(text, type = 'ready') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'top-bar-meta';
    if (type === 'loading') statusEl.classList.add('status-loading');
    else if (type === 'error') statusEl.classList.add('status-error');
  }

  const compact = initCompactFilters();

  async function consultar() {
    const fi = fechaInicio.value;
    const ff = fechaFin.value;
    if (!fi || !ff) {
      setStatus('Seleccione ambas fechas', 'error');
      return;
    }
    setStatus('Consultando...', 'loading');
    if (btnConsultar) btnConsultar.disabled = true;
    showLoading(true);
    try {
      syncDateParamsToUrl(fi, ff);
      await onConsult(fi, ff);
      setStatus(`Periodo: ${fi} — ${ff}`);
      compact?.updateLabels?.();
      compact?.closeAll?.();
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      if (btnConsultar) btnConsultar.disabled = false;
      showLoading(false);
    }
  }

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const [start, end] = getDatePresetRange(preset);
      fechaInicio.value = formatDateInput(start);
      fechaFin.value = formatDateInput(end);
      setActivePresetChip(preset);
      compact?.updateLabels?.();
      consultar();
    });
  });

  if (btnConsultar) btnConsultar.addEventListener('click', consultar);
  else {
    fechaInicio.addEventListener('change', consultar);
    fechaFin.addEventListener('change', consultar);
  }
  consultar();
}

function populateYearFilter(years, selected) {
  const sel = document.getElementById('yearFilter');
  if (!sel || !years?.length) return;
  sel.innerHTML = years.map((y) => `<option value="${y}"${y == selected ? ' selected' : ''}>${y}</option>`).join('');
  sel.classList.add('filter-select');
}

function statusBadge(status) {
  const map = {
    Running: 'badge-running',
    Operativo: 'badge-running',
    Maintenance: 'badge-maintenance',
    Mantenimiento: 'badge-maintenance',
    Alert: 'badge-alert',
    Alerta: 'badge-alert',
    'HIGH DEMAND': 'badge-high',
    'Alta demanda': 'badge-high',
    STABLE: 'badge-stable',
    Estable: 'badge-stable',
    'LOW STOCK': 'badge-low',
    'Stock bajo': 'badge-low',
    Healthy: 'badge-running',
    Saludable: 'badge-running',
    Reordering: 'badge-maintenance',
    Reordenar: 'badge-maintenance',
    Critical: 'badge-alert',
    Crítico: 'badge-alert',
  };
  const labels = {
    Running: 'Operativo',
    Maintenance: 'Mantenimiento',
    Alert: 'Alerta',
    'HIGH DEMAND': 'Alta demanda',
    STABLE: 'Estable',
    'LOW STOCK': 'Stock bajo',
    Healthy: 'Saludable',
    Reordering: 'Reordenar',
    Critical: 'Crítico',
  };
  const cls = map[status] || 'badge-stable';
  const label = labels[status] || status;
  return `<span class="badge-tipo ${cls}">${label}</span>`;
}

function dotColor(status) {
  if (['Alert', 'Alerta', 'Critical', 'Crítico'].includes(status)) return 'status-pill dot-error';
  if (['Maintenance', 'Mantenimiento', 'Reordering', 'Reordenar'].includes(status)) return 'status-pill dot-warn';
  return 'status-pill dot-ok';
}

const chartPalette = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b', '#14b8a6'];

const chartColors = {
  primary: '#2D5BFF',
  secondary: '#27AE60',
  tertiary: '#f59e0b',
  violet: '#9B51E0',
  rose: '#E056FD',
  slate: '#2C3E50',
  teal: '#14b8a6',
  error: '#ef4444',
};

function chartOptions(extra = {}) {
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#64748b',
          font: { family: 'Inter, Segoe UI, sans-serif', size: 12, weight: '600' },
          boxWidth: 12,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,0.95)',
        titleColor: '#1e293b',
        bodyColor: '#475569',
        borderColor: 'rgba(226,232,240,0.9)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 12,
      },
    },
    scales: {
      x: {
        ticks: { color: '#94a3b8', font: { size: 11 } },
        grid: { color: 'rgba(148,163,184,0.12)' },
        border: { display: false },
      },
      y: {
        ticks: { color: '#94a3b8', font: { size: 11 } },
        grid: { color: 'rgba(148,163,184,0.12)' },
        border: { display: false },
        beginAtZero: true,
      },
    },
  };

  const merged = { ...base, ...extra };
  if (extra.plugins) {
    merged.plugins = {
      ...base.plugins,
      ...extra.plugins,
      legend: {
        ...base.plugins.legend,
        ...(extra.plugins.legend || {}),
        labels: {
          ...base.plugins.legend.labels,
          ...(extra.plugins.legend?.labels || {}),
        },
      },
      tooltip: { ...base.plugins.tooltip, ...(extra.plugins.tooltip || {}) },
    };
  }
  if (extra.scales) {
    merged.scales = {
      x: { ...base.scales.x, ...(extra.scales.x || {}) },
      y: { ...base.scales.y, ...(extra.scales.y || {}) },
    };
  }
  return merged;
}

if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = 'rgba(148,163,184,0.12)';
  Chart.defaults.font.family = 'Inter, Segoe UI, sans-serif';
}

window.Dashboard = {
  fmt, api, showLoading, setText, getYearParam, populateYearFilter,
  statusBadge, dotColor, chartColors, chartPalette, chartOptions, MONTHS,
  formatDateInput, getDatePresetRange, getDefaultDateRange, getDateParamsFromUrl,
  syncDateParamsToUrl, initDateFilter, initCompactFilters, updateCompactFilterLabels,
  updateCompactScopeLabel, formatPeriodLabel, setActivePresetChip,
};
