(() => {
  const money = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });
  };

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  let lastPayload = null;
  let lastDetalle = [];
  let cacheKey = null;
  let inflightKey = null;
  let inflightPromise = null;

  function dates() {
    return {
      fechaInicio: document.getElementById('fechaInicio')?.value || '',
      fechaFin: document.getElementById('fechaFin')?.value || '',
    };
  }

  function setStatus(msg) {
    const el = document.getElementById('comisionesSubtitle');
    if (el) el.textContent = msg;
  }

  function renderConceptos(rows) {
    const body = document.getElementById('comConceptoBody');
    if (!body) return;
    if (!rows?.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-row">Sin conceptos.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr>
        <td>${esc(r.concepto)}</td>
        <td class="cell-num">${money(r.monto)}</td>
        <td class="cell-num">${money(r.comisionAsesor)}</td>
        <td class="cell-num">${money(r.base)}</td>
        <td class="cell-num">${money(r.comisionFi)}</td>
      </tr>
    `).join('');
  }

  function renderDepositos(rows) {
    const body = document.getElementById('comDepositoBody');
    if (!body) return;
    if (!rows?.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-row">Sin depósitos.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr>
        <td>${esc(r.puesto)}</td>
        <td>${esc(r.sucursal)}</td>
        <td>${esc(r.nombre)}</td>
        <td class="cell-num">${r.contratos ?? '—'}${r.participacionPct != null ? ` (${r.participacionPct}%)` : ''}</td>
        <td class="cell-num">${money(r.totalDepositar)}</td>
      </tr>
    `).join('');
  }

  function renderDetalle(rows, q = '') {
    const body = document.getElementById('comDetalleBody');
    if (!body) return;
    const query = String(q || '').trim().toLowerCase();
    const filtered = !query
      ? rows
      : rows.filter((r) => [
        r.cliente, r.vin, r.fi, r.afi, r.asesor, r.contrato, r.unidad,
      ].some((x) => String(x || '').toLowerCase().includes(query)));

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty-row">Sin contratos en el filtro.</td></tr>';
      return;
    }
    body.innerHTML = filtered.slice(0, 300).map((r) => `
      <tr>
        <td>${esc(r.fecha || '—')}</td>
        <td>${esc(r.cliente || '—')}</td>
        <td>${esc(r.fi || '—')}</td>
        <td>${esc(r.afi || '—')}</td>
        <td>${esc(r.vin || '—')}</td>
        <td class="cell-num">${money(r.maf?.comisionFi)}</td>
        <td class="cell-num">${money(r.gap?.comisionFi)}</td>
        <td class="cell-num">${money(r.garantia?.comisionFi)}</td>
        <td class="cell-num">${money(r.totalFi)}</td>
      </tr>
    `).join('');
  }

  function render(data) {
    lastPayload = data;
    lastDetalle = data.detalle || [];
    const t = data.totales || {};
    document.getElementById('comKpiContratos').textContent = String(t.contratos ?? 0);
    document.getElementById('comKpiPool').textContent = money(t.totalFi);
    document.getElementById('comKpiAfi').textContent = money(t.poolAfi);
    document.getElementById('comKpiDepositar').textContent = money(t.totalDepositar);

    const notas = document.getElementById('comisionesNotas');
    if (notas) {
      notas.innerHTML = (data.notas || []).map((n) => `<div>• ${esc(n)}</div>`).join('');
    }

    renderConceptos(data.porConcepto || []);
    renderDepositos(data.depositos || []);
    renderDetalle(lastDetalle, document.getElementById('buscarComisiones')?.value || '');

    const btnExp = document.getElementById('btnExportComisiones');
    if (btnExp) btnExp.disabled = !lastDetalle.length;

    setStatus(`${data.label || 'Comisiones'} · ${data.periodo?.fechaInicio || ''} → ${data.periodo?.fechaFin || ''} · ${t.contratos || 0} contratos`);
  }

  function downloadCsv() {
    if (!lastPayload) return;
    const rows = [
      ['Puesto', 'Sucursal', 'Nombre', 'Contratos', 'Total depositar'],
      ...(lastPayload.depositos || []).map((d) => [
        d.puesto, d.sucursal, d.nombre, d.contratos, d.totalDepositar,
      ]),
      [],
      ['Fecha', 'Cliente', 'F&I', 'AFI', 'VIN', 'MAF F&I', 'GAP F&I', 'Gtia F&I', 'Total F&I'],
      ...lastDetalle.map((r) => [
        r.fecha, r.cliente, r.fi, r.afi, r.vin,
        r.maf?.comisionFi, r.gap?.comisionFi, r.garantia?.comisionFi, r.totalFi,
      ]),
    ];
    const csv = `\uFEFF${rows.map((r) => r.map((c) => {
      const s = c == null ? '' : String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const { fechaInicio, fechaFin } = dates();
    a.href = URL.createObjectURL(blob);
    a.download = `comisiones-fi_${fechaInicio}_${fechaFin}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    const force = Boolean(opts?.force);
    const tipo = document.getElementById('comisionTipo')?.value || 'fi';
    if (!fechaInicio || !fechaFin) {
      setStatus('Seleccione ambas fechas del periodo.');
      return;
    }
    const key = `${tipo}|${fechaInicio}|${fechaFin}`;
    if (!force && cacheKey === key && lastPayload) {
      render(lastPayload);
      return lastPayload;
    }
    if (!force && inflightKey === key && inflightPromise) {
      await inflightPromise;
      if (lastPayload) render(lastPayload);
      return lastPayload;
    }

    setStatus('Calculando comisiones…');
    inflightKey = key;
    inflightPromise = (async () => {
      try {
        const res = await fetch(
          `/api/ventas/comisiones?tipo=${encodeURIComponent(tipo)}&fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Error ${res.status}`);
        }
        const data = await res.json();
        cacheKey = key;
        render(data);
        return data;
      } finally {
        if (inflightKey === key) {
          inflightKey = null;
          inflightPromise = null;
        }
      }
    })();

    return inflightPromise;
  }

  function hasCache(fechaInicio, fechaFin) {
    const tipo = document.getElementById('comisionTipo')?.value || 'fi';
    return cacheKey === `${tipo}|${fechaInicio}|${fechaFin}` && Boolean(lastPayload);
  }

  function init() {
    document.getElementById('btnGenerarComisiones')?.addEventListener('click', () => {
      const { fechaInicio, fechaFin } = dates();
      cacheKey = null;
      load(fechaInicio, fechaFin).catch((err) => {
        setStatus(err.message || 'No se pudo generar');
        console.warn('[Comisiones]', err);
      });
    });
    document.getElementById('btnExportComisiones')?.addEventListener('click', downloadCsv);
    document.getElementById('buscarComisiones')?.addEventListener('input', (e) => {
      renderDetalle(lastDetalle, e.target.value);
    });
    document.getElementById('comisionTipo')?.addEventListener('change', () => {
      cacheKey = null;
    });
  }

  window.ComisionesVentas = { init, load, hasCache };
})();
