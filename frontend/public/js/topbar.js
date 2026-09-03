(function () {
  const PAGE_ICONS = {
    admin: 'admin_panel_settings',
    overview: 'dashboard',
    sales: 'bar_chart',
    forecast: 'timeline',
    inventory: 'inventory_2',
    'lista-precios': 'sell',
    contabilidad: 'account_balance',
    'post-sales': 'handshake',
    seguimiento: 'person_search',
  };

  const PAGE_LABELS = {
    admin: 'Administración',
    overview: 'Resumen',
    sales: 'Ventas',
    forecast: 'Pronóstico',
    inventory: 'Inventario',
    'lista-precios': 'Lista de precios',
    contabilidad: 'Contabilidad',
    'post-sales': 'PostVenta',
    seguimiento: 'Seguimiento 360',
  };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function enhanceTopBar(header) {
    if (header.dataset.enhanced === '1') return;

    const page = document.body.dataset.page || 'overview';
    const icon = PAGE_ICONS[page] || 'dashboard';
    const menuBtn = header.querySelector('.mobile-menu-btn');
    const titleEl = header.querySelector('.top-bar-title');
    const summaryEl = header.querySelector('.top-bar-summary');

    const trailingNodes = [];
    Array.from(header.children).forEach((child) => {
      if (child === menuBtn) return;
      if (child.classList.contains('top-bar-main')) return;
      if (child.querySelector('.top-bar-title')) return;
      // statusBadge / lastUpdated viven en el sidebar
      if (child.querySelector('#statusBadge, #lastUpdated') && !child.querySelector('.top-bar-title')) return;
      if (child.id === 'statusBadge' || child.id === 'lastUpdated') return;
      if (child.classList.contains('top-bar-user-wrap')) return;
      if (child.querySelector('.top-bar-user-wrap')) return;
      trailingNodes.push(child);
    });

    trailingNodes.forEach((node) => node.remove());
    Array.from(header.children).forEach((child) => {
      if (child === menuBtn) return;
      if (trailingNodes.includes(child)) return;
      if (child.classList.contains('top-bar-trailing')) return;
      if (child.classList.contains('top-bar-user-wrap')) return;
      child.remove();
    });

    const leading = document.createElement('div');
    leading.className = 'top-bar-leading';

    const brand = document.createElement('div');
    brand.className = 'top-bar-brand';
    brand.innerHTML = `
      <a href="/" class="top-bar-logo-link" aria-label="BALDERRAMA — Inicio">
        <img src="/img/image%20(1).png" alt="Chevrolet Balderrama" class="top-bar-logo">
      </a>
      <span class="top-bar-brand-accent" aria-hidden="true"></span>
    `;

    const pageBlock = document.createElement('div');
    pageBlock.className = 'top-bar-page';

    const iconEl = document.createElement('span');
    iconEl.className = `top-bar-page-icon material-symbols-outlined top-bar-page-icon--${page}`;
    iconEl.textContent = icon;

    const textWrap = document.createElement('div');
    textWrap.className = 'top-bar-page-text';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'top-bar-eyebrow';
    eyebrow.textContent = 'Balderrama · Inteligencia de negocio';
    textWrap.appendChild(eyebrow);

    if (titleEl) {
      if (titleEl.tagName !== 'H1') {
        const h1 = document.createElement('h1');
        h1.className = 'top-bar-title';
        if (titleEl.id) h1.id = titleEl.id;
        h1.textContent = titleEl.textContent;
        textWrap.appendChild(h1);
      } else {
        textWrap.appendChild(titleEl);
      }
    } else {
      const h1 = document.createElement('h1');
      h1.className = 'top-bar-title';
      h1.textContent = (document.title.split('|')[0] || 'Dashboard').trim();
      textWrap.appendChild(h1);
    }

    if (summaryEl) textWrap.appendChild(summaryEl);

    pageBlock.appendChild(iconEl);
    pageBlock.appendChild(textWrap);
    leading.appendChild(brand);
    leading.appendChild(pageBlock);

    const trailing = document.createElement('div');
    trailing.className = 'top-bar-trailing top-bar-actions';
    trailingNodes.forEach((node) => {
      if (node.classList.contains('avatar-glass') && !node.classList.contains('top-bar-user-btn')) return;
      trailing.appendChild(node);
    });

    if (menuBtn) header.insertBefore(leading, menuBtn.nextSibling);
    else header.insertBefore(leading, header.firstChild);
    header.appendChild(trailing);

    header.classList.add('top-bar--enhanced');
    header.dataset.enhanced = '1';
  }

  function closeUserPanel(wrap) {
    const btn = wrap.querySelector('.top-bar-user-btn');
    const panel = wrap.querySelector('.top-bar-user-panel');
    if (!btn || !panel) return;
    panel.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
  }

  function openUserPanel(wrap) {
    const btn = wrap.querySelector('.top-bar-user-btn');
    const panel = wrap.querySelector('.top-bar-user-panel');
    if (!btn || !panel) return;
    panel.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
  }

  function severityClass(sev) {
    if (sev === 'high') return 'is-high';
    if (sev === 'medium') return 'is-medium';
    return 'is-low';
  }

  /* ── Centro de notificaciones (junto al perfil) ── */
  const SEEN_KEY_PREFIX = 'balderrama_alerts_seen_v1:';
  const POLL_MS = 60_000;
  let alertsUi = null;
  let notifBtn = null;
  let msgBtn = null;
  let pollTimer = null;
  let currentUsername = '';
  let lastAlertsFingerprint = '';
  let panelAnchorBtn = null;

  function seenStorageKey() {
    return `${SEEN_KEY_PREFIX}${currentUsername || 'anon'}`;
  }

  function getSeenIds() {
    try {
      const raw = localStorage.getItem(seenStorageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return new Set(Array.isArray(parsed?.ids) ? parsed.ids : []);
    } catch {
      return new Set();
    }
  }

  function markAlertsSeen(alerts) {
    const ids = (alerts || [])
      .filter((a) => a.type !== 'sistema')
      .map((a) => a.id)
      .filter(Boolean);
    localStorage.setItem(seenStorageKey(), JSON.stringify({
      ids,
      at: new Date().toISOString(),
    }));
  }

  function actionableAlerts(alerts) {
    return (alerts || []).filter((a) => a.type !== 'sistema');
  }

  function fingerprint(alerts) {
    return actionableAlerts(alerts)
      .map((a) => a.id)
      .sort()
      .join('|');
  }

  function countUnread(alerts) {
    const seen = getSeenIds();
    return actionableAlerts(alerts).filter((a) => a.id && !seen.has(a.id)).length;
  }

  function setNotifDot(hasUnread, unreadCount = 0) {
    if (!notifBtn) return;
    const dot = notifBtn.querySelector('[data-notif-dot]');
    if (!dot) return;
    const show = Boolean(hasUnread);
    dot.classList.toggle('is-visible', show);
    dot.hidden = !show;
    notifBtn.classList.toggle('has-unread', show);
    notifBtn.setAttribute(
      'aria-label',
      show
        ? `Notificaciones · ${unreadCount || 'nuevas'} sin leer`
        : 'Notificaciones'
    );
  }

  function setMsgDot(hasUnread, unreadCount = 0) {
    if (!msgBtn) return;
    const show = Boolean(hasUnread);
    const dot = msgBtn.querySelector('[data-msg-dot]');
    if (dot) {
      dot.classList.remove('is-visible');
      dot.hidden = true;
    }
    msgBtn.classList.toggle('has-unread', show);
    const countEl = msgBtn.querySelector('[data-msg-badge]');
    if (countEl) {
      countEl.hidden = !show;
      countEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount || '');
    }
    msgBtn.setAttribute(
      'aria-label',
      show
        ? `Mensajes · ${unreadCount || 'nuevos'} sin leer`
        : 'Mensajes'
    );
  }

  function updateTopBadges(unreadAlerts, unreadMessages) {
    setNotifDot(unreadAlerts > 0, unreadAlerts);
    setMsgDot(unreadMessages > 0, unreadMessages);
  }

  function ensureAlertsPanel() {
    if (alertsUi) return alertsUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'alerts-drawer-backdrop';
    backdrop.id = 'alertsDrawerBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'alerts-drawer alerts-drawer--wide';
    panel.id = 'alertsDrawer';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Centro de notificaciones');
    panel.innerHTML = `
      <div class="alerts-drawer__header">
        <div class="alerts-drawer__title-wrap">
          <span class="material-symbols-outlined alerts-drawer__logo" data-drawer-logo>notifications_active</span>
          <div>
            <h2 class="alerts-drawer__title" data-drawer-title>Notificaciones</h2>
            <span class="alerts-drawer__status" data-alerts-status>Cargando…</span>
          </div>
        </div>
        <div class="alerts-drawer__actions">
          <button type="button" class="alerts-drawer__icon-btn hidden" data-alerts-compose title="Nuevo mensaje">
            <span class="material-symbols-outlined">edit_square</span>
          </button>
          <button type="button" class="alerts-drawer__icon-btn" data-alerts-refresh title="Actualizar">
            <span class="material-symbols-outlined">refresh</span>
          </button>
          <button type="button" class="alerts-drawer__icon-btn" data-alerts-close title="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="alerts-drawer__body custom-scrollbar" data-alerts-body>
        <p class="alerts-drawer__empty">Cargando…</p>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-alerts-status]');
    const bodyEl = panel.querySelector('[data-alerts-body]');
    const titleEl = panel.querySelector('[data-drawer-title]');
    const logoEl = panel.querySelector('[data-drawer-logo]');
    const composeBtn = panel.querySelector('[data-alerts-compose]');
    let activeMode = 'operativas';
    let lastPayload = { alerts: [], messages: [], unreadMessages: 0 };
    let directoryCache = null;
    let chatFloat = null;
    let activeChatId = null;

    function positionPanel() {
      const anchor = panelAnchorBtn || msgBtn || notifBtn;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const gap = 10;
      const width = Math.min(440, window.innerWidth - 16);
      const right = Math.max(8, window.innerWidth - rect.right);
      let top = rect.bottom + gap;
      const maxHeight = Math.max(240, window.innerHeight - top - 12);

      if (maxHeight < 220) {
        top = Math.max(12, window.innerHeight - Math.min(560, window.innerHeight - 24));
      }

      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = `${Math.round(right)}px`;
      panel.style.left = 'auto';
      panel.style.bottom = 'auto';
      panel.style.width = `${Math.round(width)}px`;
      panel.style.maxHeight = `${Math.round(Math.min(620, window.innerHeight - top - 12))}px`;
      panel.style.height = 'auto';
    }

    function syncExpandedAttrs(openState) {
      notifBtn?.setAttribute('aria-expanded', openState && panelAnchorBtn === notifBtn ? 'true' : 'false');
      msgBtn?.setAttribute('aria-expanded', openState && panelAnchorBtn === msgBtn ? 'true' : 'false');
    }

    function close() {
      panel.classList.remove('alerts-drawer--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('alerts-drawer-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('alerts-drawer-open');
      syncExpandedAttrs(false);
      panelAnchorBtn = null;
      window.removeEventListener('resize', positionPanel);
    }

    function applyModeChrome(mode) {
      activeMode = mode === 'mensajes' ? 'mensajes' : 'operativas';
      const isMessages = activeMode === 'mensajes';
      if (titleEl) titleEl.textContent = isMessages ? 'Mensajes' : 'Notificaciones';
      if (logoEl) logoEl.textContent = isMessages ? 'mail' : 'notifications_active';
      panel.setAttribute('aria-label', isMessages ? 'Mensajes' : 'Notificaciones');
      composeBtn?.classList.toggle('hidden', !isMessages);
    }

    async function markVisibleMessagesRead() {
      const unreadInbox = (lastPayload.messages || []).filter((m) => m.unreadForViewer);
      if (!unreadInbox.length) return;
      await Promise.all(unreadInbox.map((m) =>
        fetch(`/api/auth/messages/${encodeURIComponent(m.id)}/read`, {
          method: 'POST',
          credentials: 'same-origin',
        }).catch(() => null)
      ));
      lastPayload.messages = lastPayload.messages.map((m) => (
        m.unreadForViewer ? { ...m, unreadForViewer: false, readAt: m.readAt || new Date().toISOString() } : m
      ));
      lastPayload.unreadMessages = 0;
      const unreadAlerts = countUnread(lastPayload.alerts || []);
      updateTopBadges(unreadAlerts, 0);
    }

    function formatWhen(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString('es-MX', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    }

    async function fetchDirectory() {
      if (directoryCache) return directoryCache;
      const res = await fetch('/api/auth/directory', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      directoryCache = data.users || [];
      return directoryCache;
    }

    async function desktopUpdateAlert() {
      const api = window.desktopApp;
      if (!api?.getUpdateStatus) return null;
      try {
        const st = await api.getUpdateStatus();
        if (!st?.available || !st.latest) return null;
        const ready = st.state === 'ready';
        const downloading = st.state === 'downloading';
        return {
          id: `desktop-update-${st.latest}`,
          type: 'app_update',
          typeLabel: 'App escritorio',
          category: 'Sistema',
          title: ready
            ? `Actualización ${st.latest} lista`
            : `Nueva versión ${st.latest}`,
          message: ready
            ? 'Ya se descargó. Reinicie la app para instalarla.'
            : downloading
              ? `Descargando la versión ${st.latest}…`
              : `Está usando ${st.current}. Hay una actualización disponible.`,
          severity: 'medium',
          href: null,
          action: ready ? 'desktop-install' : 'desktop-download',
          actionLabel: ready
            ? 'Reiniciar e instalar'
            : (st.packaged ? 'Descargar ahora' : 'Ver canal de actualización'),
          createdAt: new Date().toISOString(),
        };
      } catch {
        return null;
      }
    }

    async function withDesktopUpdate(alerts) {
      const extra = await desktopUpdateAlert();
      const rest = (alerts || []).filter((a) => a.type !== 'app_update');
      return extra ? [extra, ...rest] : rest;
    }

    async function fetchAlerts() {
      const res = await fetch('/api/auth/alerts', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      data.alerts = await withDesktopUpdate(data.alerts || []);
      return data;
    }

    function renderOperativas(alerts, markSeen) {
      if (!alerts.length) {
        return `
          <div class="alerts-drawer__empty-state">
            <span class="material-symbols-outlined">notifications_off</span>
            <p>Sin alertas operativas para su perfil en este momento.</p>
          </div>`;
      }
      const seenIds = getSeenIds();
      return alerts.map((a) => {
        const isNew = a.type !== 'sistema' && a.id && !seenIds.has(a.id);
        const actionBtn = a.action
          ? `<button type="button" class="alerts-drawer__link" data-alert-action="${esc(a.action)}">
                  <span class="material-symbols-outlined">system_update</span>
                  ${esc(a.actionLabel || 'Actualizar')}
                </button>`
          : '';
        const hrefLink = !a.action && a.href
          ? `<a href="${esc(a.href)}" class="alerts-drawer__link">
                  <span class="material-symbols-outlined">arrow_forward</span>
                  Ver detalle
                </a>`
          : '';
        return `
          <article class="alerts-drawer__item ${severityClass(a.severity)}${isNew && !markSeen ? ' is-new' : ''}">
            <div class="alerts-drawer__item-head">
              <strong>${esc(a.title)}${isNew && !markSeen ? ' <span class="alerts-drawer__new">Nueva</span>' : ''}</strong>
              <span class="alerts-drawer__tag">${esc(a.typeLabel || a.category || '')}</span>
            </div>
            <p class="alerts-drawer__msg">${esc(a.message)}</p>
            ${actionBtn}${hrefLink}
          </article>`;
      }).join('');
    }

    function renderMessages(messages) {
      const openMsgs = messages.filter((m) => m.status !== 'done');
      const doneMsgs = messages.filter((m) => m.status === 'done');
      if (!messages.length) {
        return `
          <div class="alerts-drawer__empty-state">
            <span class="material-symbols-outlined">mail</span>
            <p>No hay mensajes. Use el botón de editar para escribir a un usuario.</p>
          </div>`;
      }
      const me = (currentUsername || '').toLowerCase();
      const block = (list, title) => {
        if (!list.length) return '';
        return `
          <div class="alerts-drawer__group-label">${esc(title)}</div>
          ${list.map((m) => {
            const peer = String(m.fromUsername || '').toLowerCase() === me ? m.toUsername : m.fromUsername;
            const replies = Array.isArray(m.thread) ? m.thread.length : 0;
            const preview = String(m.body || '').slice(0, 110);
            return `
            <button type="button" class="alerts-drawer__item alerts-drawer__item--msg alerts-drawer__item--msg-btn ${m.unreadForViewer ? 'is-new' : ''} ${m.type === 'followup' ? 'is-followup' : ''}" data-open-chat="${esc(m.id)}">
              <div class="alerts-drawer__item-head">
                <strong>${esc(m.subject)}${m.unreadForViewer ? ' <span class="alerts-drawer__new">Nuevo</span>' : ''}</strong>
                <span class="alerts-drawer__tag">${m.type === 'followup' ? 'Seguimiento' : 'Chat'}</span>
              </div>
              <p class="alerts-drawer__msg-meta">Con <strong>${esc(peer || '—')}</strong> · ${esc(formatWhen(m.updatedAt || m.createdAt))}</p>
              <p class="alerts-drawer__msg">${esc(preview)}${preview.length >= 110 ? '…' : ''}</p>
              <div class="alerts-drawer__msg-actions">
                <span class="alerts-drawer__msg-hint">
                  <span class="material-symbols-outlined">chat</span>
                  ${replies ? `${replies} respuesta${replies === 1 ? '' : 's'}` : 'Abrir chat'}
                </span>
              </div>
            </button>`;
          }).join('')}`;
      };
      return `${block(openMsgs, 'Pendientes')}${block(doneMsgs, 'Cerrados')}`;
    }

    function ensureChatFloat() {
      if (chatFloat) return chatFloat;

      const el = document.createElement('div');
      el.id = 'messagesChatFloat';
      el.className = 'msg-chat-float hidden';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Chat de mensaje');
      el.innerHTML = `
        <div class="msg-chat-float__header" data-chat-drag>
          <div class="msg-chat-float__title-wrap">
            <span class="material-symbols-outlined">forum</span>
            <div>
              <h3 class="msg-chat-float__title" data-chat-title>Chat</h3>
              <p class="msg-chat-float__subtitle" data-chat-sub></p>
            </div>
          </div>
          <div class="msg-chat-float__actions">
            <button type="button" class="msg-chat-float__icon-btn" data-chat-done title="Cerrar seguimiento">
              <span class="material-symbols-outlined">task_alt</span>
            </button>
            <button type="button" class="msg-chat-float__icon-btn" data-chat-close title="Cerrar chat" aria-label="Cerrar chat">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div class="msg-chat-float__meta" data-chat-meta hidden></div>
        <div class="msg-chat-float__thread custom-scrollbar" data-chat-thread></div>
        <form class="msg-chat-float__close-form hidden" data-chat-close-form>
          <div class="msg-chat-float__close-title">Documentar cierre del caso</div>
          <label>Quién solicitó el seguimiento
            <input type="text" name="requestedBy" data-close-requested readonly />
          </label>
          <label>Periodo
            <input type="text" name="period" data-close-period required maxlength="120" placeholder="Ej. Julio 2026 / 2026-07-01 a 2026-07-31" />
          </label>
          <label>Qué se realizó
            <textarea name="actionTaken" data-close-action rows="3" required maxlength="4000" placeholder="Describa la acción tomada para resolver el seguimiento…"></textarea>
          </label>
          <div class="msg-chat-float__close-actions">
            <button type="button" class="btn-glass" data-close-cancel>Cancelar</button>
            <button type="submit" class="btn-glass btn-primary">Confirmar cierre</button>
          </div>
        </form>
        <form class="msg-chat-float__composer" data-chat-form>
          <textarea rows="2" placeholder="Escriba un mensaje…" maxlength="4000" required data-chat-input></textarea>
          <button type="submit" class="btn-glass btn-primary" title="Enviar">
            <span class="material-symbols-outlined">send</span>
          </button>
        </form>
      `;
      document.body.appendChild(el);

      const threadEl = el.querySelector('[data-chat-thread]');
      const form = el.querySelector('[data-chat-form]');
      const input = el.querySelector('[data-chat-input]');
      const doneBtn = el.querySelector('[data-chat-done]');
      const closeForm = el.querySelector('[data-chat-close-form]');

      el.querySelector('[data-chat-close]')?.addEventListener('click', closeChatFloat);
      el.querySelector('[data-close-cancel]')?.addEventListener('click', () => {
        closeForm?.classList.add('hidden');
        form?.classList.remove('hidden');
      });

      doneBtn?.addEventListener('click', () => {
        if (!activeChatId) return;
        const msg = findMessage(activeChatId);
        if (!msg) return;
        showCloseCaseForm(msg);
      });

      closeForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeChatId) return;
        const actionTaken = String(closeForm.querySelector('[data-close-action]')?.value || '').trim();
        const period = String(closeForm.querySelector('[data-close-period]')?.value || '').trim();
        const requestedBy = String(closeForm.querySelector('[data-close-requested]')?.value || '').trim();
        try {
          const res = await fetch(`/api/auth/messages/${encodeURIComponent(activeChatId)}/done`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTaken, period, requestedBy }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          closeForm.classList.add('hidden');
          await refreshMessagesKeepChat();
        } catch (err) {
          window.alert(err.message || 'No se pudo cerrar el seguimiento.');
        }
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeChatId) return;
        const body = String(input?.value || '').trim();
        if (!body) return;
        try {
          const res = await fetch(`/api/auth/messages/${encodeURIComponent(activeChatId)}/reply`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          if (input) input.value = '';
          await refreshMessagesKeepChat();
          threadEl?.scrollTo({ top: threadEl.scrollHeight, behavior: 'smooth' });
        } catch (err) {
          window.alert(err.message || 'No se pudo enviar el mensaje.');
        }
      });

      // Drag by header
      const dragHandle = el.querySelector('[data-chat-drag]');
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;
      dragHandle?.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        const rect = el.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('is-dragging');
      });
      dragHandle?.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, e.clientX - offsetX));
        const top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, e.clientY - offsetY));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      });
      const endDrag = () => {
        dragging = false;
        el.classList.remove('is-dragging');
      };
      dragHandle?.addEventListener('pointerup', endDrag);
      dragHandle?.addEventListener('pointercancel', endDrag);

      chatFloat = el;
      return el;
    }

    function guessPeriodLabel() {
      const fi = document.getElementById('fechaInicio')?.value;
      const ff = document.getElementById('fechaFin')?.value;
      if (fi && ff) return `${fi} a ${ff}`;
      const now = new Date();
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return `${months[now.getMonth()]} ${now.getFullYear()}`;
    }

    function showCloseCaseForm(msg) {
      const el = ensureChatFloat();
      const closeForm = el.querySelector('[data-chat-close-form]');
      const composer = el.querySelector('[data-chat-form]');
      if (!closeForm) return;
      composer?.classList.add('hidden');
      closeForm.classList.remove('hidden');
      const requested = closeForm.querySelector('[data-close-requested]');
      const period = closeForm.querySelector('[data-close-period]');
      const action = closeForm.querySelector('[data-close-action]');
      if (requested) requested.value = msg.fromUsername || '';
      if (period && !period.value) period.value = guessPeriodLabel();
      if (action) action.focus();
    }

    function closeChatFloat() {
      if (!chatFloat) return;
      chatFloat.classList.add('hidden');
      chatFloat.querySelector('[data-chat-close-form]')?.classList.add('hidden');
      activeChatId = null;
    }

    function findMessage(id) {
      return (lastPayload.messages || []).find((m) => m.id === id) || null;
    }

    function renderChatThread(msg) {
      const me = (currentUsername || '').toLowerCase();
      const bubbles = [];
      bubbles.push({
        fromUsername: msg.fromUsername,
        body: msg.body,
        createdAt: msg.createdAt,
        isMine: String(msg.fromUsername || '').toLowerCase() === me,
        kind: 'message',
      });
      for (const r of (msg.thread || [])) {
        bubbles.push({
          fromUsername: r.fromUsername,
          body: r.body,
          createdAt: r.createdAt,
          isMine: String(r.fromUsername || '').toLowerCase() === me,
          kind: r.kind === 'closure' ? 'closure' : 'message',
          resolution: r.resolution || null,
        });
      }

      let html = bubbles.map((b) => {
        if (b.kind === 'closure' || b.resolution) {
          const res = b.resolution || msg.resolution || {};
          return `
            <aside class="msg-chat-closure">
              <div class="msg-chat-closure__head">
                <span class="material-symbols-outlined">task_alt</span>
                <strong>Caso cerrado</strong>
                <span>${esc(formatWhen(b.createdAt || res.closedAt))}</span>
              </div>
              <dl class="msg-chat-closure__grid">
                <div><dt>Solicitó el seguimiento</dt><dd>${esc(res.requestedBy || msg.fromUsername || '—')}</dd></div>
                <div><dt>Periodo</dt><dd>${esc(res.period || '—')}</dd></div>
                <div><dt>Qué se realizó</dt><dd>${esc(res.actionTaken || b.body || '—')}</dd></div>
                <div><dt>Cerrado por</dt><dd>${esc(res.closedBy || b.fromUsername || '—')}</dd></div>
              </dl>
            </aside>`;
        }
        return `
          <div class="msg-chat-bubble ${b.isMine ? 'is-mine' : 'is-theirs'}">
            <div class="msg-chat-bubble__meta">
              <strong>${esc(b.fromUsername || '—')}</strong>
              <span>${esc(formatWhen(b.createdAt))}</span>
            </div>
            <p class="msg-chat-bubble__text">${esc(b.body || '')}</p>
          </div>`;
      }).join('');

      if (msg.status === 'done' && msg.resolution && !(msg.thread || []).some((r) => r.kind === 'closure')) {
        html += `
          <aside class="msg-chat-closure">
            <div class="msg-chat-closure__head">
              <span class="material-symbols-outlined">task_alt</span>
              <strong>Caso cerrado</strong>
              <span>${esc(formatWhen(msg.resolution.closedAt))}</span>
            </div>
            <dl class="msg-chat-closure__grid">
              <div><dt>Solicitó el seguimiento</dt><dd>${esc(msg.resolution.requestedBy || msg.fromUsername || '—')}</dd></div>
              <div><dt>Periodo</dt><dd>${esc(msg.resolution.period || '—')}</dd></div>
              <div><dt>Qué se realizó</dt><dd>${esc(msg.resolution.actionTaken || '—')}</dd></div>
              <div><dt>Cerrado por</dt><dd>${esc(msg.resolution.closedBy || '—')}</dd></div>
            </dl>
          </aside>`;
      }
      return html;
    }

    function paintChatFloat(msg) {
      const el = ensureChatFloat();
      if (!msg) {
        closeChatFloat();
        return;
      }
      const me = (currentUsername || '').toLowerCase();
      const peer = String(msg.fromUsername || '').toLowerCase() === me ? msg.toUsername : msg.fromUsername;
      el.querySelector('[data-chat-title]').textContent = msg.subject || 'Chat';
      el.querySelector('[data-chat-sub]').textContent = `Con ${peer || '—'} · ${msg.status === 'done' ? 'Cerrado' : 'Abierto'}`;
      const meta = el.querySelector('[data-chat-meta]');
      if (msg.source?.insightTitle) {
        meta.hidden = false;
        meta.innerHTML = `Alarma: <strong>${esc(msg.source.insightTitle)}</strong>${
          msg.source.href ? ` · <a href="${esc(msg.source.href)}">Ver KPI</a>` : ''
        }`;
      } else {
        meta.hidden = true;
        meta.innerHTML = '';
      }
      const threadEl = el.querySelector('[data-chat-thread]');
      threadEl.innerHTML = renderChatThread(msg);
      const form = el.querySelector('[data-chat-form]');
      const closeForm = el.querySelector('[data-chat-close-form]');
      const doneBtn = el.querySelector('[data-chat-done]');
      const closed = msg.status === 'done';
      closeForm?.classList.add('hidden');
      if (form) form.classList.toggle('hidden', closed);
      if (doneBtn) doneBtn.classList.toggle('hidden', closed);
      el.classList.remove('hidden');
      if (!el.style.left && !el.style.top) {
        el.style.right = '24px';
        el.style.bottom = '24px';
        el.style.left = 'auto';
        el.style.top = 'auto';
      }
      requestAnimationFrame(() => {
        threadEl.scrollTop = threadEl.scrollHeight;
      });
    }

    async function openChatFloat(messageId) {
      activeChatId = messageId;
      let msg = findMessage(messageId);
      if (!msg) {
        await refreshMessagesKeepChat(false);
        msg = findMessage(messageId);
      }
      if (!msg) {
        window.alert('No se encontró el mensaje.');
        return;
      }
      if (msg.unreadForViewer) {
        fetch(`/api/auth/messages/${encodeURIComponent(msg.id)}/read`, {
          method: 'POST',
          credentials: 'same-origin',
        }).catch(() => null);
        msg.unreadForViewer = false;
      }
      paintChatFloat(msg);
    }

    async function refreshMessagesKeepChat(repaint = true) {
      try {
        const res = await fetch('/api/auth/messages?box=all&includeDone=true', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        lastPayload.messages = data.messages || [];
        lastPayload.unreadMessages = Number(data.unread || 0);
        updateTopBadges(countUnread(lastPayload.alerts || []), lastPayload.unreadMessages);
        if (activeMode === 'mensajes' && !bodyEl.querySelector('[data-compose-form]')) {
          renderBody(false);
          statusEl.textContent = `${lastPayload.messages.length} mensaje(s)`;
        }
        if (repaint && activeChatId) {
          paintChatFloat(findMessage(activeChatId));
        }
      } catch (err) {
        console.warn('[messages-chat]', err.message);
      }
    }

    function renderComposeForm(users, preset = {}) {
      const opts = (users || []).map((u) =>
        `<option value="${esc(u.username)}" ${preset.toUsername === u.username ? 'selected' : ''}>${esc(u.username)} · ${esc(u.roleLabel || u.role)}</option>`
      ).join('');
      return `
        <form class="alerts-drawer__compose" data-compose-form>
          <div class="alerts-drawer__group-label">Nuevo mensaje / seguimiento</div>
          <label>Para
            <select name="toUsername" required>
              <option value="">Seleccione responsable…</option>
              ${opts}
            </select>
          </label>
          <label>Asunto
            <input name="subject" type="text" maxlength="200" value="${esc(preset.subject || '')}" placeholder="Asunto" required />
          </label>
          <label>Mensaje
            <textarea name="body" rows="4" maxlength="4000" required placeholder="Indique el seguimiento o instrucción…">${esc(preset.body || '')}</textarea>
          </label>
          <input type="hidden" name="type" value="${esc(preset.type || 'direct')}" />
          <input type="hidden" name="sourceJson" value="${esc(preset.sourceJson || '')}" />
          <div class="alerts-drawer__compose-actions">
            <button type="button" class="btn-glass" data-compose-cancel>Cancelar</button>
            <button type="submit" class="btn-glass btn-primary">Enviar</button>
          </div>
        </form>`;
    }

    function renderBody(markSeen = false) {
      const { alerts, messages } = lastPayload;
      if (activeMode === 'mensajes') {
        bodyEl.innerHTML = renderMessages(messages);
      } else {
        bodyEl.innerHTML = renderOperativas(alerts, markSeen);
      }
    }

    async function load({ markSeen = false } = {}) {
      bodyEl.innerHTML = '<p class="alerts-drawer__empty">Cargando…</p>';
      statusEl.textContent = 'Actualizando…';
      try {
        const data = await fetchAlerts();
        const alerts = data.alerts || [];
        let messages = data.messages || [];
        let unreadMessages = Number(data.unreadMessages || 0);
        const roleLabel = data.roleLabel || data.role || 'su perfil';
        const unreadAlerts = countUnread(alerts);

        if (activeMode === 'mensajes') {
          try {
            const msgRes = await fetch('/api/auth/messages?box=all&includeDone=true', { credentials: 'same-origin' });
            const msgData = await msgRes.json().catch(() => ({}));
            if (msgRes.ok) {
              messages = msgData.messages || messages;
              unreadMessages = Number(msgData.unread ?? unreadMessages);
            }
          } catch {
            /* keep inbox from alerts payload */
          }
        }

        lastAlertsFingerprint = fingerprint(alerts) + `|m:${unreadMessages}|${messages.map((m) => m.id + (m.readAt || '')).join(',')}`;
        lastPayload = { alerts, messages, unreadMessages };

        if (activeMode === 'mensajes') {
          statusEl.textContent = `${messages.length} mensaje(s)`;
        } else {
          statusEl.textContent = `${alerts.length} alerta(s) · ${roleLabel}`;
        }

        if (!markSeen) updateTopBadges(unreadAlerts, unreadMessages);

        renderBody(markSeen);
        if (markSeen && activeMode === 'operativas') {
          markAlertsSeen(alerts);
          updateTopBadges(0, unreadMessages);
        }
        if (activeMode === 'mensajes') {
          await markVisibleMessagesRead();
        }
        if (activeChatId) paintChatFloat(findMessage(activeChatId));
        return data;
      } catch (err) {
        statusEl.textContent = 'Error al cargar';
        bodyEl.innerHTML = `<p class="alerts-drawer__empty">${esc(err.message || 'No se pudieron cargar los datos.')}</p>`;
        return null;
      }
    }

    async function openCompose(preset = {}) {
      applyModeChrome('mensajes');
      try {
        const users = await fetchDirectory();
        bodyEl.innerHTML = renderComposeForm(users, preset);
        statusEl.textContent = 'Nuevo mensaje';
      } catch (err) {
        bodyEl.innerHTML = `<p class="alerts-drawer__empty">${esc(err.message || 'No se pudo cargar el directorio.')}</p>`;
      }
    }

    async function open(opts = {}) {
      const mode = opts.tab === 'mensajes' || opts.mode === 'mensajes' ? 'mensajes' : 'operativas';
      panelAnchorBtn = opts.anchor || (mode === 'mensajes' ? msgBtn : notifBtn) || notifBtn;
      applyModeChrome(mode);
      positionPanel();
      panel.classList.add('alerts-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('alerts-drawer-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('alerts-drawer-open');
      syncExpandedAttrs(true);
      window.addEventListener('resize', positionPanel);
      await load({ markSeen: mode === 'operativas' });
      positionPanel();
    }

    function toggle(opts = {}) {
      const mode = opts.tab === 'mensajes' || opts.mode === 'mensajes' ? 'mensajes' : 'operativas';
      const anchor = opts.anchor || (mode === 'mensajes' ? msgBtn : notifBtn);
      const sameOpen = panel.classList.contains('alerts-drawer--open')
        && panelAnchorBtn === anchor
        && activeMode === mode;
      if (sameOpen) close();
      else open({ mode, anchor });
    }

    panel.querySelector('[data-alerts-close]')?.addEventListener('click', close);
    panel.querySelector('[data-alerts-refresh]')?.addEventListener('click', () => load({ markSeen: false }));
    panel.querySelector('[data-alerts-compose]')?.addEventListener('click', () => openCompose());
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (chatFloat && !chatFloat.classList.contains('hidden')) {
        closeChatFloat();
        return;
      }
      if (panel.classList.contains('alerts-drawer--open')) close();
    });

    bodyEl.addEventListener('click', async (e) => {
      const updateBtn = e.target.closest('[data-alert-action]');
      if (updateBtn) {
        e.preventDefault();
        const action = updateBtn.getAttribute('data-alert-action');
        const api = window.desktopApp;
        if (!api) return;
        updateBtn.disabled = true;
        try {
          const result = action === 'desktop-install'
            ? await api.installUpdate()
            : await api.downloadUpdate();
          if (result?.error && !result.opened) {
            window.alert(result.error);
          }
          await load({ markSeen: false });
        } catch (err) {
          window.alert(err.message || 'No se pudo actualizar.');
        } finally {
          updateBtn.disabled = false;
        }
        return;
      }
      const openChatBtn = e.target.closest('[data-open-chat]');
      if (openChatBtn) {
        e.preventDefault();
        await openChatFloat(openChatBtn.getAttribute('data-open-chat'));
        return;
      }
      if (e.target.closest('[data-compose-cancel]')) {
        applyModeChrome('mensajes');
        renderBody();
        statusEl.textContent = `${(lastPayload.messages || []).length} mensaje(s)`;
      }
    });

    bodyEl.addEventListener('submit', async (e) => {
      const compose = e.target.closest('[data-compose-form]');
      if (!compose) return;
      e.preventDefault();
      const fd = new FormData(compose);
      let source = null;
      const rawSource = String(fd.get('sourceJson') || '').trim();
      if (rawSource) {
        try { source = JSON.parse(rawSource); } catch { source = null; }
      }
      try {
        const res = await fetch('/api/auth/messages', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toUsername: fd.get('toUsername'),
            subject: fd.get('subject'),
            body: fd.get('body'),
            type: fd.get('type') || 'direct',
            source,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        applyModeChrome('mensajes');
        await load({ markSeen: false });
        if (data.message?.id) await openChatFloat(data.message.id);
      } catch (err) {
        window.alert(err.message || 'No se pudo enviar el mensaje.');
      }
    });

    alertsUi = {
      open,
      close,
      toggle,
      load,
      fetchAlerts,
      openCompose,
      openChat: openChatFloat,
      openMessages() {
        return open({ mode: 'mensajes', anchor: msgBtn || notifBtn });
      },
      panel,
    };
    return alertsUi;
  }

  async function pollNotifications() {
    try {
      const ui = ensureAlertsPanel();
      const data = await ui.fetchAlerts();
      const alerts = data.alerts || [];
      const unreadMessages = Number(data.unreadMessages || 0);
      const fp = fingerprint(alerts) + `|m:${unreadMessages}`;
      const unreadAlerts = countUnread(alerts);
      lastAlertsFingerprint = fp || lastAlertsFingerprint;
      updateTopBadges(unreadAlerts, unreadMessages);
    } catch {
      /* silencioso en polling */
    }
  }

  function startNotificationsPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollNotifications();
    pollTimer = setInterval(pollNotifications, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pollNotifications();
    });
  }

  window.MessagesCenter = {
    openCompose(preset) {
      const ui = ensureAlertsPanel();
      ui.open({ mode: 'mensajes', anchor: msgBtn || notifBtn }).then(() => ui.openCompose(preset || {}));
    },
    openInbox() {
      ensureAlertsPanel().openMessages();
    },
  };

  function ensureNotificationsCenter(trailing) {
    if (trailing.querySelector('.top-bar-notif-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'top-bar-notif-wrap';

    const mailBtn = document.createElement('button');
    mailBtn.type = 'button';
    mailBtn.className = 'avatar-glass top-bar-notif-btn top-bar-msg-btn';
    mailBtn.setAttribute('aria-label', 'Mensajes');
    mailBtn.setAttribute('aria-expanded', 'false');
    mailBtn.setAttribute('aria-haspopup', 'dialog');
    mailBtn.setAttribute('aria-controls', 'alertsDrawer');
    mailBtn.title = 'Mensajes';
    mailBtn.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">mail</span>
      <span class="top-bar-notif-dot" data-msg-dot hidden aria-hidden="true"></span>
      <span class="top-bar-msg-badge" data-msg-badge hidden aria-hidden="true">0</span>
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-glass top-bar-notif-btn';
    btn.setAttribute('aria-label', 'Notificaciones');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-controls', 'alertsDrawer');
    btn.title = 'Notificaciones';
    btn.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
      <span class="top-bar-notif-dot" data-notif-dot hidden aria-hidden="true"></span>
    `;

    wrap.appendChild(mailBtn);
    wrap.appendChild(btn);
    trailing.appendChild(wrap);
    msgBtn = mailBtn;
    notifBtn = btn;

    if (window.desktopApp?.onUpdateStatus) {
      window.desktopApp.onUpdateStatus(() => {
        pollNotifications();
      });
    }
    if (window.desktopApp?.onOpenNotifications) {
      window.desktopApp.onOpenNotifications(() => {
        ensureAlertsPanel().open({ mode: 'operativas', anchor: notifBtn });
      });
    }

    mailBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAlertsPanel().toggle({ mode: 'mensajes', anchor: mailBtn });
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAlertsPanel().toggle({ mode: 'operativas', anchor: btn });
    });

    ensureAlertsPanel();
    startNotificationsPolling();
  }

  function renderUserPanel(panel, session) {
    const pages = (session?.pages || [])
      .map((id) => PAGE_LABELS[id] || id)
      .filter(Boolean);

    if (session?.username) currentUsername = session.username;

    const adminLink = session?.canManageUsers
      ? '<a href="/admin.html" class="top-bar-user-link"><span class="material-symbols-outlined">admin_panel_settings</span> Administrar usuarios</a>'
      : '';

    panel.innerHTML = `
      <div class="top-bar-user-head">
        <span class="top-bar-user-avatar material-symbols-outlined" aria-hidden="true">badge</span>
        <div class="top-bar-user-head-text">
          <strong class="top-bar-user-name">${esc(session?.username || 'Usuario')}</strong>
          <span class="top-bar-user-role">${esc(session?.roleLabel || session?.role || 'Sin rol')}</span>
        </div>
      </div>
      <div class="top-bar-user-body">
        <div class="top-bar-user-row">
          <span class="top-bar-user-label">Usuario</span>
          <span class="top-bar-user-value">${esc(session?.username || '—')}</span>
        </div>
        <div class="top-bar-user-row">
          <span class="top-bar-user-label">Perfil</span>
          <span class="top-bar-user-value">${esc(session?.roleLabel || '—')}</span>
        </div>
        <div class="top-bar-user-row top-bar-user-row--stack">
          <span class="top-bar-user-label">Módulos con acceso</span>
          <div class="top-bar-user-modules">
            ${pages.length
              ? pages.map((p) => `<span class="top-bar-user-chip">${esc(p)}</span>`).join('')
              : '<span class="top-bar-user-value">—</span>'}
          </div>
        </div>
      </div>
      ${adminLink}
      <button type="button" class="top-bar-user-logout" data-user-logout>
        <span class="material-symbols-outlined">logout</span>
        Cerrar sesión
      </button>
    `;

    panel.querySelector('[data-user-logout]')?.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } finally {
        window.location.href = '/login.html';
      }
    });

    pollNotifications();
  }

  async function loadUserSession(wrap) {
    const panel = wrap.querySelector('.top-bar-user-panel');
    if (!panel || !window.DashboardAuth) return;

    try {
      const session = await window.DashboardAuth.getSession();
      renderUserPanel(panel, session);
    } catch {
      panel.innerHTML = '<p class="top-bar-user-empty">No se pudo cargar la sesión.</p>';
    }
  }

  function ensureUserMenu(header) {
    if (header.querySelector('.top-bar-user-wrap')) return;

    const trailing = header.querySelector('.top-bar-trailing');
    if (!trailing) return;

    header.querySelectorAll('.avatar-glass:not(.top-bar-user-btn):not(.top-bar-notif-btn)').forEach((el) => el.remove());

    ensureNotificationsCenter(trailing);

    const wrap = document.createElement('div');
    wrap.className = 'top-bar-user-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-glass top-bar-user-btn';
    btn.setAttribute('aria-label', 'Ver datos del usuario');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'true');
    btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">person</span>';

    const panel = document.createElement('div');
    panel.className = 'top-bar-user-panel hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Datos del usuario');
    panel.innerHTML = '<p class="top-bar-user-empty">Cargando sesión…</p>';

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    trailing.appendChild(wrap);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrap.classList.contains('is-open')) closeUserPanel(wrap);
      else openUserPanel(wrap);
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closeUserPanel(wrap);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeUserPanel(wrap);
    });

    loadUserSession(wrap);
  }

  document.querySelectorAll('.top-bar').forEach((header) => {
    enhanceTopBar(header);
    ensureUserMenu(header);
  });
})();
