(function () {
  const STATE = {
    byKpi: new Map(),
    activeId: null,
    popover: null,
    assigning: false,
    sending: false,
  };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function isAssignPanelOpen() {
    const panel = STATE.popover?.querySelector('[data-insight-assign-panel]');
    return Boolean(panel && !panel.classList.contains('hidden'));
  }

  function ensurePopover() {
    if (STATE.popover) return STATE.popover;
    const el = document.createElement('div');
    el.id = 'kpiInsightPopover';
    el.className = 'kpi-insight-popover hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Alerta inteligente');
    el.innerHTML = `
      <div class="kpi-insight-popover__head">
        <span class="kpi-insight-popover__badge" data-insight-badge>Alerta inteligente</span>
        <span class="kpi-semaforo" data-insight-semaforo hidden>
          <span class="kpi-semaforo__dot" data-semaforo-dot></span>
          <span data-semaforo-label></span>
        </span>
        <button type="button" class="kpi-insight-popover__close" data-insight-close aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <h3 class="kpi-insight-popover__title" data-insight-title></h3>
      <p class="kpi-insight-popover__summary" data-insight-summary></p>
      <div class="kpi-insight-popover__section" data-insight-interp-wrap hidden>
        <strong>Interpretación</strong>
        <p data-insight-interp></p>
      </div>
      <div class="kpi-insight-popover__section" data-insight-control-wrap hidden>
        <strong>Valor de control</strong>
        <p data-insight-control></p>
      </div>
      <div class="kpi-insight-popover__section">
        <strong>Análisis</strong>
        <p data-insight-analysis></p>
      </div>
      <div class="kpi-insight-popover__section">
        <strong>Recomendaciones</strong>
        <ul data-insight-recs></ul>
      </div>
      <div class="kpi-insight-popover__section" data-insight-audience-wrap hidden>
        <strong>Notificar a</strong>
        <p data-insight-audience></p>
      </div>
      <div class="kpi-insight-accion" data-insight-accion-wrap hidden>
        <div class="kpi-insight-accion__head">
          <span class="material-symbols-outlined">bolt</span>
          <strong data-insight-accion-label>Acción sugerida por el agente</strong>
        </div>
        <p data-insight-accion-short></p>
        <button type="button" class="btn-glass btn-primary" data-insight-accion>
          <span class="material-symbols-outlined">smart_toy</span>
          Pedir plan de acción al agente
        </button>
      </div>
      <div class="kpi-insight-popover__actions">
        <button type="button" class="btn-glass" data-insight-chat>
          <span class="material-symbols-outlined">forum</span>
          Más información en el asistente
        </button>
        <button type="button" class="btn-glass" data-insight-assign>
          <span class="material-symbols-outlined">assignment_ind</span>
          Asignar seguimiento
        </button>
      </div>
      <div class="kpi-insight-assign hidden" data-insight-assign-panel>
        <label class="kpi-insight-assign__label">Responsable
          <select data-insight-to>
            <option value="">Cargando usuarios…</option>
          </select>
        </label>
        <p class="kpi-insight-assign__hint" data-insight-assign-hint hidden></p>
        <label class="kpi-insight-assign__label">Nota de seguimiento
          <textarea data-insight-note rows="3" maxlength="2000" placeholder="Qué debe revisar o resolver el responsable…"></textarea>
        </label>
        <div class="kpi-insight-assign__actions">
          <button type="button" class="btn-glass" data-insight-assign-cancel>Cancelar</button>
          <button type="button" class="btn-glass btn-primary" data-insight-assign-send>Enviar</button>
        </div>
        <p class="kpi-insight-assign__status" data-insight-assign-status hidden></p>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('[data-insight-close]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
    });
    el.querySelector('[data-insight-chat]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insight = STATE.byKpi.get(STATE.activeId);
      closePopover();
      if (!insight?.chatPrompt) return;
      if (window.AssistantBubble?.open) {
        window.AssistantBubble.open(insight.chatPrompt);
      } else {
        window.alert('El asistente IA no está disponible en esta página.');
      }
    });
    el.querySelector('[data-insight-accion]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insight = STATE.byKpi.get(STATE.activeId);
      closePopover();
      const prompt = insight?.accionAgente?.prompt || insight?.chatPrompt;
      if (!prompt) return;
      if (window.AssistantBubble?.open) {
        window.AssistantBubble.open(prompt);
      } else {
        window.alert('El asistente IA no está disponible en esta página.');
      }
    });
    el.querySelector('[data-insight-assign]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAssignPanel(true);
    });
    el.querySelector('[data-insight-assign-cancel]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAssignPanel(false);
    });
    el.querySelector('[data-insight-assign-send]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendAssignFollowup();
    });
    el.querySelector('[data-insight-to]')?.addEventListener('change', () => {
      const select = el.querySelector('[data-insight-to]');
      const hint = el.querySelector('[data-insight-assign-hint]');
      if (!hint || !select) return;
      const opt = select.selectedOptions?.[0];
      if (!select.value) {
        hint.hidden = false;
        hint.textContent = 'Selecciona un responsable o deja el sugerido automáticamente.';
        return;
      }
      if (opt?.dataset?.suggested === '1') {
        hint.hidden = false;
        hint.textContent = 'Asignado automáticamente según la alerta. Puedes cambiarlo manualmente.';
      } else {
        hint.hidden = false;
        hint.textContent = 'Selección manual activa.';
      }
    });

    // Evitar que clics dentro del panel (select/textarea) cierren por bubbling raro
    el.querySelector('[data-insight-assign-panel]')?.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    el.querySelector('[data-insight-assign-panel]')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (!STATE.popover || STATE.popover.classList.contains('hidden')) return;
      if (STATE.popover.contains(e.target)) return;
      if (e.target.closest?.('.kpi-insight-btn')) return;
      // Mientras se asigna, no cerrar por clics externos (el <select> nativo dispara fuera del DOM)
      if (isAssignPanelOpen() || STATE.assigning || STATE.sending) return;
      closePopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isAssignPanelOpen()) toggleAssignPanel(false);
        else closePopover();
      }
    });

    STATE.popover = el;
    return el;
  }

  function moduleFromPath() {
    const p = window.location.pathname || '';
    if (p.includes('sales')) return 'ventas';
    if (p.includes('inventory')) return 'inventario';
    if (p.includes('forecast')) return 'forecast';
    if (p.includes('post-sales')) return 'postventa';
    if (p.includes('seguimiento')) return 'seguimiento';
    if (p.includes('contabilidad')) return 'contabilidad';
    return 'overview';
  }

  /** Perfiles del catálogo ABP / responsable → roles del dashboard. */
  const PROFILE_TO_ROLES = {
    'contador general': ['contabilidad'],
    contabilidad: ['contabilidad'],
    finanzas: ['contabilidad'],
    tesoreria: ['contabilidad'],
    tesorero: ['contabilidad'],
    'credito y cobranza': ['contabilidad'],
    'cuentas por pagar': ['contabilidad'],
    'gerente comercial ventas': ['gerencia_comercial'],
    'gerencia comercial': ['gerencia_comercial'],
    'gerencia ventas': ['gerencia_comercial'],
    'gerencia bdc': ['gerencia_comercial'],
    'gerente f&i': ['gerencia_comercial'],
    'gerente de mkt': ['marketing'],
    'gerencia marketing': ['marketing'],
    marketing: ['marketing'],
    mtk: ['marketing'],
    crm: ['gerencia_comercial', 'marketing'],
    bdc: ['gerencia_comercial', 'marketing'],
    'f&i': ['gerencia_comercial'],
    'experiencia cliente': ['gerencia_comercial'],
    director: ['direccion'],
    'gerente general': ['direccion'],
    'gerencia general': ['direccion'],
    administracion: ['administracion'],
    'data manager': ['administracion'],
    auditor: ['administracion', 'direccion'],
    inventarios: ['administracion', 'contabilidad'],
    'compras/inventarios': ['administracion'],
    'logistica de inventarios e intercambios': ['administracion'],
    'coordinador de entregas matriz': ['administracion', 'gerencia_comercial'],
    'gerencia r. h.': ['administracion'],
    'capital humano': ['administracion'],
    'gerentes de area': ['administracion', 'direccion'],
  };

  const MODULE_DEFAULT_ROLES = {
    inventario: ['gerencia_comercial', 'administracion'],
    ventas: ['gerencia_comercial', 'direccion'],
    postventa: ['administracion', 'contabilidad'],
    contabilidad: ['contabilidad', 'administracion'],
    forecast: ['gerencia_comercial', 'direccion'],
    seguimiento: ['gerencia_comercial', 'direccion'],
    overview: ['direccion', 'administracion'],
  };

  /** Overrides por insight: quién debe atender la alerta. */
  const INSIGHT_ASSIGN_ROLES = {
    'inv-sin-previas': ['gerencia_comercial', 'direccion'],
    'inv-entregas-sin-previas': ['gerencia_comercial', 'direccion'],
    'overview-sin-previas': ['gerencia_comercial', 'direccion'],
    'ventas-sin-timbrar': ['gerencia_comercial', 'direccion'],
    'inv-aging': ['gerencia_comercial', 'administracion'],
    'inv-plan-piso': ['contabilidad', 'administracion', 'direccion'],
    'inv-pv-traspasos': ['administracion', 'contabilidad'],
    'inv-pv-refacciones-valor': ['administracion', 'contabilidad'],
    'inv-pv-desbalance': ['administracion', 'contabilidad'],
  };

  function normKey(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rolesForProfile(label) {
    const key = normKey(label);
    if (PROFILE_TO_ROLES[key]) return PROFILE_TO_ROLES[key];
    for (const [profile, roles] of Object.entries(PROFILE_TO_ROLES)) {
      if (key.includes(profile) || profile.includes(key)) return roles;
    }
    return [];
  }

  /** Elige usuario sugerido a partir de responsable/audiencia del insight. */
  function suggestAssignee(users, insight) {
    const list = Array.isArray(users) ? users : [];
    if (!list.length) return null;

    const preferredRoles = [];
    const pushRoleList = (roles) => {
      (roles || []).forEach((r) => {
        if (r && !preferredRoles.includes(r)) preferredRoles.push(r);
      });
    };
    const pushProfile = (label) => pushRoleList(rolesForProfile(label));

    // 1) Override por tipo de alerta (sin previas → ventas)
    const byInsight = INSIGHT_ASSIGN_ROLES[String(insight?.id || '')];
    if (byInsight?.length) pushRoleList(byInsight);

    // 2) Responsable / audiencia del catálogo
    if (insight?.responsable) pushProfile(insight.responsable);
    (insight?.audiencia || []).forEach(pushProfile);

    // 3) Default del módulo
    if (!preferredRoles.length) {
      pushRoleList(MODULE_DEFAULT_ROLES[moduleFromPath()] || []);
    }

    for (const role of preferredRoles) {
      const hit = list.find((u) => String(u.role || '') === role);
      if (hit) {
        return {
          user: hit,
          reason: byInsight?.includes(role)
            ? `Alerta operativa → ${hit.roleLabel || hit.role}`
            : (insight?.responsable
              ? `Responsable catálogo: ${insight.responsable}`
              : (insight?.audiencia?.[0]
                ? `Audiencia: ${insight.audiencia[0]}`
                : `Rol sugerido: ${hit.roleLabel || hit.role}`)),
        };
      }
    }
    return {
      user: list[0],
      reason: 'Sugerido automático (primer usuario disponible)',
    };
  }

  async function loadDirectoryOptions(select, insight) {
    if (!select) return;
    const prev = select.value;
    select.disabled = true;
    const hint = ensurePopover().querySelector('[data-insight-assign-hint]');
    if (hint) {
      hint.hidden = true;
      hint.textContent = '';
    }
    try {
      const res = await fetch('/api/auth/directory', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        throw new Error('Sesión expirada');
      }
      if (!res.ok) throw new Error(data.error || res.statusText);
      const users = Array.isArray(data.users) ? data.users : [];
      if (!users.length) {
        select.innerHTML = '<option value="">No hay otros usuarios para asignar</option>';
        return;
      }

      const suggested = suggestAssignee(users, insight);
      const suggestedUsername = suggested?.user?.username || '';

      select.innerHTML = `<option value="">Seleccione responsable…</option>${users.map((u) => {
        const isSuggested = suggestedUsername && u.username === suggestedUsername;
        const mark = isSuggested ? ' ★ sugerido' : '';
        return `<option value="${esc(u.username)}"${isSuggested ? ' data-suggested="1"' : ''}>${esc(u.username)} · ${esc(u.roleLabel || u.role)}${mark}</option>`;
      }).join('')}`;

      // Prioridad: valor previo del usuario > sugerido automático
      if (prev && users.some((u) => u.username === prev)) {
        select.value = prev;
      } else if (suggestedUsername) {
        select.value = suggestedUsername;
      }

      if (hint && suggested?.user) {
        const selectedIsSuggested = select.value === suggestedUsername;
        hint.hidden = false;
        hint.textContent = selectedIsSuggested
          ? `Asignado automáticamente · ${suggested.reason}. Puedes cambiarlo manualmente.`
          : `${suggested.reason}. Selección manual activa.`;
      }
    } catch (err) {
      select.innerHTML = `<option value="">${esc(err.message || 'Error al cargar usuarios')}</option>`;
    } finally {
      select.disabled = false;
    }
  }

  function setAssignStatus(text, isError = false) {
    const pop = ensurePopover();
    const status = pop.querySelector('[data-insight-assign-status]');
    if (!status) return;
    status.hidden = !text;
    status.textContent = text || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function toggleAssignPanel(show) {
    const pop = ensurePopover();
    const panel = pop.querySelector('[data-insight-assign-panel]');
    if (!panel) return;
    STATE.assigning = Boolean(show);
    panel.classList.toggle('hidden', !show);
    setAssignStatus('');
    if (show) {
      const select = pop.querySelector('[data-insight-to]');
      const note = pop.querySelector('[data-insight-note]');
      const insight = STATE.byKpi.get(STATE.activeId);
      if (note && insight) {
        const base = `Seguimiento: ${insight.title || ''}\n${insight.summary || ''}`.trim();
        if (!note.value.trim()) note.value = base;
      }
      loadDirectoryOptions(select, insight);
      requestAnimationFrame(() => {
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        select?.focus();
      });
    }
  }

  async function sendAssignFollowup() {
    if (STATE.sending) return;
    const pop = ensurePopover();
    const insight = STATE.byKpi.get(STATE.activeId);
    const toUsername = String(pop.querySelector('[data-insight-to]')?.value || '').trim();
    const body = String(pop.querySelector('[data-insight-note]')?.value || '').trim();
    const sendBtn = pop.querySelector('[data-insight-assign-send]');

    if (!insight) {
      setAssignStatus('No hay alerta activa. Cierre y vuelva a abrir el semáforo.', true);
      return;
    }
    if (!toUsername) {
      setAssignStatus('Seleccione un responsable.', true);
      pop.querySelector('[data-insight-to]')?.focus();
      return;
    }
    const text = body || insight.summary || insight.title || 'Revisar alerta inteligente';
    if (!text.trim()) {
      setAssignStatus('La nota de seguimiento no puede estar vacía.', true);
      return;
    }

    STATE.sending = true;
    if (sendBtn) sendBtn.disabled = true;
    setAssignStatus('Enviando…');

    try {
      const res = await fetch('/api/auth/messages', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toUsername,
          type: 'followup',
          subject: `Seguimiento: ${insight.title || 'Alerta inteligente'}`,
          body: text,
          source: {
            kind: 'kpi_insight',
            module: moduleFromPath(),
            kpiId: insight.kpiId,
            severity: insight.severity,
            insightTitle: insight.title,
            insightSummary: insight.summary,
            href: `${window.location.pathname}${window.location.search || ''}`,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        throw new Error('Sesión expirada');
      }
      if (!res.ok) throw new Error(data.error || data.detail || res.statusText || 'No se pudo asignar');

      setAssignStatus(`Enviado a ${toUsername}.`);
      window.setTimeout(() => {
        STATE.sending = false;
        if (sendBtn) sendBtn.disabled = false;
        toggleAssignPanel(false);
        closePopover();
        if (typeof window.MessagesCenter?.openInbox === 'function') {
          /* El destinatario verá el followup en Mensajes; no forzamos abrir inbox del emisor */
        }
      }, 800);
    } catch (err) {
      STATE.sending = false;
      if (sendBtn) sendBtn.disabled = false;
      setAssignStatus(err.message || 'No se pudo asignar.', true);
    }
  }

  function closePopover() {
    const el = STATE.popover;
    if (!el) return;
    if (STATE.sending) return;
    el.querySelector('[data-insight-assign-panel]')?.classList.add('hidden');
    el.classList.add('hidden');
    STATE.activeId = null;
    STATE.assigning = false;
  }

  function positionPopover(anchor) {
    const pop = ensurePopover();
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 16);
    let top = rect.bottom + 8;
    let left = Math.min(rect.right - width, window.innerWidth - width - 8);
    left = Math.max(8, left);
    const maxH = Math.min(520, window.innerHeight - top - 12);
    if (maxH < 240) {
      top = Math.max(12, rect.top - Math.min(440, window.innerHeight * 0.65) - 8);
    }
    pop.style.width = `${width}px`;
    pop.style.maxHeight = `${Math.max(220, window.innerHeight - top - 12)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  }

  function openPopover(insight, anchor) {
    const pop = ensurePopover();
    STATE.activeId = insight.kpiId;
    STATE.assigning = false;
    pop.querySelector('[data-insight-assign-panel]')?.classList.add('hidden');
    setAssignStatus('');
    pop.querySelector('[data-insight-title]').textContent = insight.title || 'Alerta';
    pop.querySelector('[data-insight-summary]').textContent = insight.summary || '';
    pop.querySelector('[data-insight-analysis]').textContent = insight.analysis || '';

    const badge = pop.querySelector('[data-insight-badge]');
    if (badge) {
      badge.textContent = insight.catalogClave
        ? `Alerta · ${insight.catalogClave}`
        : 'Alerta inteligente';
    }

    const semaforoWrap = pop.querySelector('[data-insight-semaforo]');
    const semaforo = insight.semaforo || (insight.severity === 'critical' ? 'rojo' : insight.severity === 'warning' ? 'amarillo' : 'verde');
    if (semaforoWrap) {
      semaforoWrap.hidden = false;
      semaforoWrap.dataset.tone = semaforo;
      const label = pop.querySelector('[data-semaforo-label]');
      if (label) {
        label.textContent = insight.semaforoLabel || (
          semaforo === 'rojo' ? 'Riesgo alto' : semaforo === 'amarillo' ? 'Requiere ajuste' : 'En control'
        );
      }
    }

    const setOptional = (wrapSel, textSel, value) => {
      const wrap = pop.querySelector(wrapSel);
      const node = pop.querySelector(textSel);
      if (!wrap || !node) return;
      if (value) {
        wrap.hidden = false;
        node.textContent = value;
      } else {
        wrap.hidden = true;
        node.textContent = '';
      }
    };
    // Interpretación = definición del KPI; Análisis = situación actual. No mostrar si es el mismo texto.
    const interp = String(insight.interpretacion || '').trim();
    const analysis = String(insight.analysis || '').trim();
    const interpDistinct = interp && interp.toLowerCase() !== analysis.toLowerCase() ? interp : null;
    setOptional('[data-insight-interp-wrap]', '[data-insight-interp]', interpDistinct);
    setOptional('[data-insight-control-wrap]', '[data-insight-control]', insight.valorControl);
    setOptional(
      '[data-insight-audience-wrap]',
      '[data-insight-audience]',
      [
        insight.responsable ? `Responsable: ${insight.responsable}` : null,
        Array.isArray(insight.audiencia) && insight.audiencia.length
          ? `Notificar a: ${insight.audiencia.join(', ')}`
          : null,
      ].filter(Boolean).join(' · ') || null,
    );

    const accionWrap = pop.querySelector('[data-insight-accion-wrap]');
    if (accionWrap) {
      const accion = insight.accionAgente;
      if (accion?.prompt) {
        accionWrap.hidden = false;
        const label = pop.querySelector('[data-insight-accion-label]');
        const short = pop.querySelector('[data-insight-accion-short]');
        if (label) label.textContent = accion.label || 'Acción sugerida por el agente';
        if (short) short.textContent = accion.short || '';
      } else {
        accionWrap.hidden = true;
      }
    }

    const ul = pop.querySelector('[data-insight-recs]');
    const recs = Array.isArray(insight.recommendations) ? insight.recommendations : [];
    ul.innerHTML = recs.length
      ? recs.map((r) => `<li>${esc(r)}</li>`).join('')
      : '<li>Sin recomendaciones adicionales.</li>';
    pop.classList.toggle('is-critical', insight.severity === 'critical' || semaforo === 'rojo');
    pop.classList.toggle('is-warning', semaforo === 'amarillo');
    pop.classList.toggle('is-ok', semaforo === 'verde');
    pop.classList.remove('hidden');
    positionPopover(anchor);
  }

  function clearMarks({ preserveAssign = false } = {}) {
    document.querySelectorAll('.kpi-insight-btn').forEach((b) => b.remove());
    document.querySelectorAll('.kpi-card--has-insight').forEach((c) => {
      c.classList.remove(
        'kpi-card--has-insight',
        'kpi-card--insight-critical',
        'kpi-card--semaforo-rojo',
        'kpi-card--semaforo-amarillo',
        'kpi-card--semaforo-verde',
      );
    });
    if (preserveAssign && (isAssignPanelOpen() || STATE.sending)) {
      // Mantener el insight activo para no romper el envío en curso
      const keep = STATE.activeId ? STATE.byKpi.get(STATE.activeId) : null;
      STATE.byKpi.clear();
      if (keep?.kpiId) STATE.byKpi.set(keep.kpiId, keep);
      return;
    }
    STATE.byKpi.clear();
    closePopover();
  }

  function attachInsight(insight) {
    if (!insight?.kpiId) return;
    let host = document.getElementById(insight.kpiId);
    if (!host) return;

    const isAnchor = host.classList.contains('tomas-insight-anchor')
      || host.classList.contains('kpi-insight-anchor');
    const card = isAnchor
      ? host
      : (host.classList.contains('kpi-card') ? host : (host.closest('.kpi-card') || host));
    STATE.byKpi.set(insight.kpiId, insight);

    const semaforo = insight.semaforo
      || (insight.severity === 'critical' ? 'rojo' : insight.severity === 'warning' ? 'amarillo' : 'verde');

    if (!isAnchor) {
      card.classList.add('kpi-card--has-insight', `kpi-card--semaforo-${semaforo}`);
      if (semaforo === 'rojo' || insight.severity === 'critical') {
        card.classList.add('kpi-card--insight-critical');
      }
    } else if (semaforo === 'rojo' || insight.severity === 'critical') {
      host.classList.add('is-critical');
    }

    if (card.querySelector(`.kpi-insight-btn[data-kpi="${insight.kpiId}"]`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `kpi-insight-btn kpi-insight-btn--${semaforo}${semaforo === 'rojo' ? ' is-critical' : ''}`;
    btn.dataset.kpi = insight.kpiId;
    btn.dataset.semaforo = semaforo;
    btn.title = `${insight.semaforoLabel || 'Alerta inteligente'}: ${insight.title || ''}`;
    btn.setAttribute('aria-label', `Semáforo ${semaforo}: ${insight.title || ''}`);
    btn.innerHTML = '<span class="kpi-insight-dot" aria-hidden="true"></span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = STATE.byKpi.get(insight.kpiId);
      if (!current) return;
      if (STATE.activeId === insight.kpiId && !STATE.popover?.classList.contains('hidden')) {
        if (isAssignPanelOpen() || STATE.sending) return;
        closePopover();
        return;
      }
      openPopover(current, btn);
    });

    if (!isAnchor && getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }
    card.appendChild(btn);
  }

  async function applyInsights(module, context) {
    const preserveAssign = isAssignPanelOpen() || STATE.sending;
    clearMarks({ preserveAssign });
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module, ...context }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      const insights = data.insights || [];
      const rank = { critical: 3, warning: 2, info: 1, rojo: 3, amarillo: 2, verde: 1 };
      const best = new Map();
      for (const insight of insights) {
        const prev = best.get(insight.kpiId);
        const score = Math.max(rank[insight.severity] || 0, rank[insight.semaforo] || 0);
        const prevScore = prev
          ? Math.max(rank[prev.severity] || 0, rank[prev.semaforo] || 0)
          : 0;
        if (!prev || score > prevScore) {
          best.set(insight.kpiId, insight);
        }
      }
      best.forEach((insight) => attachInsight(insight));
      // Si el usuario estaba asignando, refrescar el insight activo con datos nuevos
      if (preserveAssign && STATE.activeId && best.has(STATE.activeId)) {
        STATE.byKpi.set(STATE.activeId, best.get(STATE.activeId));
      }
      return insights;
    } catch (err) {
      console.warn('[kpi-insights]', err.message);
      return [];
    }
  }

  window.KpiInsights = {
    apply: applyInsights,
    clear: clearMarks,
    close: closePopover,
  };
})();
