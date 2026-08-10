(function () {
  'use strict';

  const { api, showLoading } = Dashboard;

  let state = {
    modelos: [],
    modeloId: '',
    versionKey: '',
    section: 'administracion',
    meta: null,
  };

  function money(n) {
    const v = Math.round(Number(n) || 0);
    if (!v) return '—';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v);
  }

  function pct(n) {
    const v = Number(n) || 0;
    if (!v) return '—';
    return `${v.toFixed(2)}%`;
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function setStatus(text, className = 'sidebar-status-line') {
    const el = document.getElementById('statusBadge');
    if (!el) return;
    el.textContent = text;
    el.className = className;
  }

  function versionKey(v) {
    return `${v.paquete}|${v.version}|${v.msrp}`;
  }

  function planIcon(tipoPago) {
    const t = String(tipoPago || '').toUpperCase();
    if (t.includes('LEASING')) return 'key';
    if (t.includes('CONTADO')) return 'payments';
    if (t.includes('GMF')) return 'account_balance';
    return 'sell';
  }

  function currentModelo() {
    return state.modelos.find((m) => m.modelo === state.modeloId) || null;
  }

  function currentVersion(modelo) {
    if (!modelo?.versions?.length) return null;
    return modelo.versions.find((v) => versionKey(v) === state.versionKey) || modelo.versions[0];
  }

  function renderTabs(modelo) {
    document.getElementById('lpVersionTabs').innerHTML = (modelo.versions || []).map((v) => {
      const key = versionKey(v);
      const active = key === state.versionKey;
      return `<button type="button" class="lp-version-tab${active ? ' is-active' : ''}" data-version-key="${esc(key)}" role="tab" aria-selected="${active}">
        ${esc(v.version)}
      </button>`;
    }).join('');
  }

  function renderSummary(version) {
    const s = version.summary || {};
    const cards = [
      {
        icon: 'price_check',
        label: 'Precio final desde',
        value: money(s.precioFinalDesde),
        tag: 'Mejor precio',
        tone: 'accent',
      },
      { icon: 'attach_money', label: 'Precio de Venta GMMX', value: money(s.msrp || version.msrp) },
      {
        icon: 'sell',
        label: 'Descuento máximo',
        value: money(s.descuentoMaximo),
        sub: s.descuentoPct ? pct(s.descuentoPct) : null,
      },
      {
        icon: 'percent',
        label: 'Tasa GMF',
        value: s.tasaGmfDesde || '—',
        sub: s.tasaGmfDesde ? 'Tasa especial' : null,
      },
      {
        icon: 'verified_user',
        label: 'Seguro gratis',
        value: s.seguroGratis || '—',
      },
      {
        icon: 'key',
        label: 'Leasing',
        value: s.leasingFactor
          ? `Desde ${s.leasingFactor}`
          : (s.leasingPrecioDesde ? money(s.leasingPrecioDesde) : '—'),
        sub: s.leasingFactor
          ? 'Factor leasing'
          : (s.leasingPrecioDesde
            ? (s.leasingBeneficio || 'Opción para empresa')
            : null),
      },
    ];
    document.getElementById('lpSummary').innerHTML = cards.map((c) => `
      <div class="lp-summary-card${c.tone === 'accent' ? ' lp-summary-card--accent' : ''}">
        <span class="material-symbols-outlined lp-summary-icon">${c.icon}</span>
        <div class="lp-summary-body">
          <div class="lp-summary-label">${esc(c.label)}</div>
          <div class="lp-summary-value">${esc(c.value)}</div>
          ${c.tag ? `<span class="lp-tag">${esc(c.tag)}</span>` : ''}
          ${c.sub ? `<div class="lp-summary-sub">${esc(c.sub)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  function renderSpecs(version) {
    document.getElementById('lpFichaTitle').textContent = `Ficha técnica ${version.version}`;
    const ficha = version.fichaTecnica || { secciones: [] };
    const fuente = ficha.fuente
      ? `<p class="lp-footnote" style="margin-top:10px">Fuente: <a href="${esc(ficha.fuente)}" target="_blank" rel="noopener noreferrer">${esc(ficha.excelModelo || 'Chevrolet México')}</a>${ficha.excelVersion ? ` · ${esc(ficha.excelVersion)}` : ''}</p>`
      : '';
    document.getElementById('lpSpecs').innerHTML = ((ficha.secciones || []).map((sec) => `
      <div class="lp-spec-block">
        <h4>${esc(sec.titulo)}</h4>
        <ul>
          ${(sec.items || []).map((it) => `
            <li>
              <span>${esc(it.label)}</span>
              <strong>${esc(it.value)}</strong>
            </li>`).join('')}
        </ul>
      </div>`).join('') || '<p class="lp-muted">Sin ficha técnica cargada para este modelo.</p>') + fuente;
  }

  function renderStock(version) {
    document.getElementById('lpStockTitle').textContent = `Existencia ${version.version}`;
    const disponibles = version.stockDisponible || 0;
    const apartadas = version.stockApartadas || 0;
    const colores = version.colores || [];
    document.getElementById('lpStock').innerHTML = `
      <div class="lp-stock-total">
        <div class="lp-stock-total-n">${disponibles}</div>
        <div>
          <div class="lp-stock-total-label">unidades disponibles</div>
          <div class="lp-stock-split">
            <span class="lp-pill lp-pill--ok">${disponibles} disponibles</span>
            ${apartadas > 0 ? `<span class="lp-pill lp-pill--muted">${apartadas} apartadas (no disponibles)</span>` : ''}
          </div>
        </div>
      </div>
      <div class="lp-colors-title">Colores disponibles</div>
      ${colores.length ? `
        <ul class="lp-colors lp-colors--rich">
          ${colores.map((c) => `
            <li>
              <span class="lp-swatch" style="background:${esc(c.hex)};border-color:${esc(c.border)}"></span>
              <div class="lp-color-meta">
                <strong>${esc(c.label)}</strong>
                <span class="lp-color-state lp-color-state--${esc(c.estadoTone || 'ok')}">${esc(c.estado || 'Disponible')}</span>
              </div>
              <span class="lp-color-n">${c.disponibles ?? c.unidades}</span>
            </li>`).join('')}
        </ul>` : '<p class="lp-muted">Sin unidades disponibles para esta versión.</p>'}`;
  }

  function renderPromos(version) {
    document.getElementById('lpPromoTitle').textContent = `Promociones aplicables para ${version.version}`;
    const isTac = state.section === 'bono-toma-cuenta';
    document.getElementById('lpPromos').innerHTML = (version.planes || []).map((p) => {
      const chips = [];
      if (p.descuentoMostrador > 0) chips.push(`Descuento ${money(p.descuentoMostrador)}`);
      if (isTac && p.bonificacion > 0) chips.push(`Bonif. ${money(p.bonificacion)}`);
      if (p.tasaFactor && p.tasaFactor !== '—') {
        chips.push(/enganche/i.test(p.tasaFactor) ? p.tasaFactor : `Tasa/Factor ${p.tasaFactor}`);
      }
      if (p.seguroGratis) chips.push(p.seguroGratis);
      return `
        <article class="lp-promo-card${p.recomendado ? ' is-recommended' : ''}">
          <div class="lp-promo-card-top">
            <span class="material-symbols-outlined">${planIcon(p.tipoPago)}</span>
            <div>
              <div class="lp-promo-card-name">
                ${esc(p.nombre || p.tipoPago)}
                ${p.recomendado ? '<span class="lp-tag">Recomendada</span>' : ''}
              </div>
              <div class="lp-promo-card-tipo">${esc(p.tipoPago)}</div>
            </div>
          </div>
          <div class="lp-promo-card-price">${money(p.precioFinal)}</div>
          <div class="lp-promo-card-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
          <div class="lp-promo-card-benefit">${esc(p.beneficio || '—')}</div>
        </article>`;
    }).join('') || '<p class="lp-muted">Sin planes para esta versión.</p>';
  }

  function renderCompare(version) {
    document.getElementById('lpCompareTitle').textContent = `Comparativo de promociones — ${version.version}`;
    document.getElementById('lpCompareBody').innerHTML = (version.planes || []).map((p) => `
      <tr class="${p.recomendado ? 'lp-row-recommended' : ''}">
        <td>
          <div class="lp-plan-cell">
            <span class="material-symbols-outlined">${planIcon(p.tipoPago)}</span>
            <div>
              <strong>${esc(p.nombre || p.tipoPago)}</strong>
              ${p.recomendado ? '<span class="lp-tag">Recomendada</span>' : ''}
            </div>
          </div>
        </td>
        <td class="num"><strong>${money(p.precioFinal)}</strong></td>
        <td class="num">${p.descuentoMostrador ? money(p.descuentoMostrador) : '—'}</td>
        <td class="num">${p.descuentoPct ? pct(p.descuentoPct) : '—'}</td>
        <td>${esc(p.tasaFactor || '—')}</td>
        <td>${esc(p.seguroGratis || '—')}</td>
        <td>${esc(p.beneficio || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty-row">Sin planes</td></tr>';

    const vig = state.meta?.vigencia || '';
    document.getElementById('lpFootNote').textContent = vig
      ? `Precios y promociones aplicables a partir del ${vig}. Sujeto a cambios sin previo aviso.`
      : 'Precios y promociones sujetos a cambios sin previo aviso.';
  }

  function renderBenchmark(modelo) {
    const section = document.getElementById('lpBenchmarkSection');
    const bm = modelo?.benchmarking;
    if (!section) return;
    if (!bm?.filas?.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    document.getElementById('lpBenchmarkTitle').textContent =
      `Benchmarking competitivo — ${modelo.modelo}`;
    const chip = document.getElementById('lpBenchmarkChip');
    if (chip) {
      chip.textContent = bm.segmento || `MX ${bm.anio || 2026}`;
      chip.hidden = false;
    }
    document.getElementById('lpBenchmarkCriterio').textContent = bm.criterio || '';
    document.getElementById('lpBenchmarkBody').innerHTML = bm.filas.map((row) => `
      <tr class="${row.esNuestro ? 'lp-row-ours' : ''}">
        <td>
          <div class="lp-bench-vehicle">
            ${row.esNuestro ? '<span class="lp-tag">Nuestro</span>' : ''}
            <strong>${esc(row.marca)}</strong>
            <span>${esc(row.modelo)}</span>
          </div>
        </td>
        <td class="num"><strong>${esc(row.precio)}</strong></td>
        <td>${esc(row.oferta)}</td>
        <td>${esc(row.tecnologia)}</td>
        <td>${esc(row.seguridad)}</td>
        <td>${esc(row.rendimiento)}</td>
      </tr>`).join('');
    const parts = [
      bm.actualizado ? `Actualizado ${bm.actualizado}` : null,
      'Precios de rivales: oferta pública México; verificar en piso.',
      bm.metodologia || null,
    ].filter(Boolean);
    document.getElementById('lpBenchmarkNote').textContent = parts.join(' · ');
  }

  function paint() {
    const modelo = currentModelo();
    const empty = document.getElementById('lpEmpty');
    const ficha = document.getElementById('lpFicha');

    if (!modelo?.versions?.length) {
      empty.classList.remove('hidden');
      ficha.classList.add('hidden');
      return;
    }

    if (!state.versionKey || !modelo.versions.some((v) => versionKey(v) === state.versionKey)) {
      state.versionKey = versionKey(modelo.versions[0]);
    }
    const version = currentVersion(modelo);
    empty.classList.add('hidden');
    ficha.classList.remove('hidden');

    document.getElementById('lpTitle').textContent = modelo.titulo || `Chevrolet ${modelo.modelo}`;
    document.getElementById('lpCarroceria').textContent = modelo.carroceria || version.carroceria || 'Chevrolet';
    document.getElementById('lpHeroVisual').dataset.modelo = modelo.modelo;
    const heroImg = document.getElementById('lpHeroImg');
    const heroIcon = document.getElementById('lpHeroIcon');
    const imgUrl = modelo.imagenUrl || modelo.imagen?.url || '';
    if (heroImg && heroIcon) {
      if (imgUrl) {
        heroImg.src = imgUrl;
        heroImg.alt = `Chevrolet ${modelo.modelo}`;
        heroImg.classList.remove('hidden');
        heroIcon.classList.add('hidden');
        document.getElementById('lpHeroVisual').classList.add('has-photo');
      } else {
        heroImg.removeAttribute('src');
        heroImg.alt = '';
        heroImg.classList.add('hidden');
        heroIcon.classList.remove('hidden');
        document.getElementById('lpHeroVisual').classList.remove('has-photo');
      }
    }

    renderTabs(modelo);
    renderSummary(version);
    renderSpecs(version);
    renderStock(version);
    renderPromos(version);
    renderCompare(version);
    renderBenchmark(modelo);
  }

  function fillModeloSelect(options, preferred) {
    const sel = document.getElementById('modeloSelect');
    const current = preferred || sel.value;
    sel.innerHTML = `<option value="">Seleccionar modelo…</option>${(options || []).map((m) =>
      `<option value="${esc(m.modelo)}">${esc(m.modelo)}${m.stockTotal != null ? ` · ${m.stockTotal} u.` : ''}</option>`).join('')}`;
    if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  async function load() {
    const section = document.getElementById('sectionSelect').value || 'administracion';
    const modeloSel = document.getElementById('modeloSelect').value || '';
    const soloConStock = document.getElementById('soloStockChk').checked ? '1' : '0';
    state.section = section;

    setStatus('Consultando...', 'sidebar-status-line status-loading');
    showLoading(true);

    try {
      const list = await api(`/lista-precios?${new URLSearchParams({
        vista: 'ficha',
        section,
        soloConStock,
      })}`);

      fillModeloSelect(list.modelos || [], modeloSel || list.modelos?.[0]?.modelo || '');
      const modelo = document.getElementById('modeloSelect').value || '';
      state.modeloId = modelo;
      state.meta = list.meta;

      document.getElementById('metaVigencia').textContent = [
        list.meta?.sectionLabel,
        list.meta?.vigencia ? `· Aplicables a partir del ${list.meta.vigencia}` : '',
      ].filter(Boolean).join(' ');

      if (!modelo) {
        state.modelos = [];
        paint();
        setStatus('Listo', 'sidebar-status-line');
        return;
      }

      const detail = await api(`/lista-precios?${new URLSearchParams({
        vista: 'ficha',
        section,
        modelo,
        soloConStock: '0',
      })}`);

      state.modelos = detail.modelos || [];
      state.meta = detail.meta || list.meta;
      state.modeloId = modelo;
      state.versionKey = '';
      paint();
      setStatus('Listo', 'sidebar-status-line');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Error', 'sidebar-status-line status-error');
      document.getElementById('lpEmpty').classList.remove('hidden');
      document.getElementById('lpEmpty').innerHTML = `
        <span class="material-symbols-outlined">error</span>
        <h3>No se pudo cargar</h3>
        <p>${esc(err.message || 'Error de consulta')}</p>`;
      document.getElementById('lpFicha').classList.add('hidden');
    } finally {
      showLoading(false);
    }
  }

  document.getElementById('btnConsultar')?.addEventListener('click', load);
  document.getElementById('sectionSelect')?.addEventListener('change', () => {
    document.getElementById('modeloSelect').value = '';
    state.versionKey = '';
    load();
  });
  document.getElementById('modeloSelect')?.addEventListener('change', load);
  document.getElementById('soloStockChk')?.addEventListener('change', () => {
    document.getElementById('modeloSelect').value = '';
    load();
  });
  document.getElementById('lpVersionTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-version-key]');
    if (!btn) return;
    state.versionKey = btn.getAttribute('data-version-key');
    paint();
  });
  load();
})();
