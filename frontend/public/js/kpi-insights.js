(function () {
  const STATE = {
    byKpi: new Map(),
    activeId: null,
    popover: null,
  };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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
        <span class="kpi-insight-popover__badge">Alerta inteligente</span>
        <button type="button" class="kpi-insight-popover__close" data-insight-close aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <h3 class="kpi-insight-popover__title" data-insight-title></h3>
      <p class="kpi-insight-popover__summary" data-insight-summary></p>
      <div class="kpi-insight-popover__section">
        <strong>Análisis</strong>
        <p data-insight-analysis></p>
      </div>
      <div class="kpi-insight-popover__section">
        <strong>Recomendaciones</strong>
        <ul data-insight-recs></ul>
      </div>
      <div class="kpi-insight-popover__actions">
        <button type="button" class="btn-glass btn-primary" data-insight-chat>
          <span class="material-symbols-outlined">smart_toy</span>
          Más información en el asistente
        </button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('[data-insight-close]')?.addEventListener('click', closePopover);
    el.querySelector('[data-insight-chat]')?.addEventListener('click', () => {
      const insight = STATE.byKpi.get(STATE.activeId);
      closePopover();
      if (!insight?.chatPrompt) return;
      if (window.AssistantBubble?.open) {
        window.AssistantBubble.open(insight.chatPrompt);
      } else {
        window.alert('El asistente IA no está disponible en esta página.');
      }
    });

    document.addEventListener('click', (e) => {
      if (!STATE.popover || STATE.popover.classList.contains('hidden')) return;
      if (STATE.popover.contains(e.target)) return;
      if (e.target.closest('.kpi-insight-btn')) return;
      closePopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePopover();
    });

    STATE.popover = el;
    return el;
  }

  function closePopover() {
    const el = STATE.popover;
    if (!el) return;
    el.classList.add('hidden');
    STATE.activeId = null;
  }

  function positionPopover(anchor) {
    const pop = ensurePopover();
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 16);
    let top = rect.bottom + 8;
    let left = Math.min(rect.right - width, window.innerWidth - width - 8);
    left = Math.max(8, left);
    const maxH = Math.min(480, window.innerHeight - top - 12);
    if (maxH < 220) {
      top = Math.max(12, rect.top - Math.min(420, window.innerHeight * 0.6) - 8);
    }
    pop.style.width = `${width}px`;
    pop.style.maxHeight = `${Math.max(200, window.innerHeight - top - 12)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  }

  function openPopover(insight, anchor) {
    const pop = ensurePopover();
    STATE.activeId = insight.kpiId;
    pop.querySelector('[data-insight-title]').textContent = insight.title || 'Alerta';
    pop.querySelector('[data-insight-summary]').textContent = insight.summary || '';
    pop.querySelector('[data-insight-analysis]').textContent = insight.analysis || '';
    const ul = pop.querySelector('[data-insight-recs]');
    const recs = Array.isArray(insight.recommendations) ? insight.recommendations : [];
    ul.innerHTML = recs.length
      ? recs.map((r) => `<li>${esc(r)}</li>`).join('')
      : '<li>Sin recomendaciones adicionales.</li>';
    pop.classList.toggle('is-critical', insight.severity === 'critical');
    pop.classList.remove('hidden');
    positionPopover(anchor);
  }

  function clearMarks() {
    document.querySelectorAll('.kpi-insight-btn').forEach((b) => b.remove());
    document.querySelectorAll('.kpi-card--has-insight').forEach((c) => {
      c.classList.remove('kpi-card--has-insight', 'kpi-card--insight-critical');
    });
    STATE.byKpi.clear();
    closePopover();
  }

  function attachInsight(insight) {
    if (!insight?.kpiId) return;
    // Prefer exact id; also allow matching elements by id that aren't cards (ytd)
    let host = document.getElementById(insight.kpiId);
    if (!host) return;

    // If host is not a card, wrap visual on closest card or mark the element itself
    const card = host.classList.contains('kpi-card') ? host : (host.closest('.kpi-card') || host);
    STATE.byKpi.set(insight.kpiId, insight);
    card.classList.add('kpi-card--has-insight');
    if (insight.severity === 'critical') card.classList.add('kpi-card--insight-critical');

    if (card.querySelector(`.kpi-insight-btn[data-kpi="${insight.kpiId}"]`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `kpi-insight-btn${insight.severity === 'critical' ? ' is-critical' : ''}`;
    btn.dataset.kpi = insight.kpiId;
    btn.title = 'Alerta inteligente';
    btn.setAttribute('aria-label', `Alerta inteligente: ${insight.title || ''}`);
    btn.innerHTML = '<span class="kpi-insight-dot" aria-hidden="true"></span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = STATE.byKpi.get(insight.kpiId);
      if (!current) return;
      if (STATE.activeId === insight.kpiId && !STATE.popover?.classList.contains('hidden')) {
        closePopover();
        return;
      }
      openPopover(current, btn);
    });

    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }
    card.appendChild(btn);
  }

  async function applyInsights(module, context) {
    clearMarks();
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
      // One insight per kpiId (highest severity wins)
      const rank = { critical: 3, warning: 2, info: 1 };
      const best = new Map();
      for (const insight of insights) {
        const prev = best.get(insight.kpiId);
        if (!prev || (rank[insight.severity] || 0) > (rank[prev.severity] || 0)) {
          best.set(insight.kpiId, insight);
        }
      }
      best.forEach((insight) => attachInsight(insight));
      return [...best.values()];
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
