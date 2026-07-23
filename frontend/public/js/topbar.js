(function () {
  const PAGE_ICONS = {
    admin: 'admin_panel_settings',
    overview: 'dashboard',
    sales: 'bar_chart',
    forecast: 'timeline',
    inventory: 'inventory_2',
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
  let pollTimer = null;
  let currentUsername = '';
  let lastAlertsFingerprint = '';

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
    setNotifDot(false);
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
        ? `Centro de notificaciones · ${unreadCount || 'nuevas'} sin leer`
        : 'Centro de notificaciones'
    );
  }

  function ensureAlertsPanel() {
    if (alertsUi) return alertsUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'alerts-drawer-backdrop';
    backdrop.id = 'alertsDrawerBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'alerts-drawer';
    panel.id = 'alertsDrawer';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Centro de notificaciones');
    panel.innerHTML = `
      <div class="alerts-drawer__header">
        <div class="alerts-drawer__title-wrap">
          <span class="material-symbols-outlined alerts-drawer__logo">notifications_active</span>
          <div>
            <h2 class="alerts-drawer__title">Centro de notificaciones</h2>
            <span class="alerts-drawer__status" data-alerts-status>Cargando…</span>
          </div>
        </div>
        <div class="alerts-drawer__actions">
          <button type="button" class="alerts-drawer__icon-btn" data-alerts-refresh title="Actualizar">
            <span class="material-symbols-outlined">refresh</span>
          </button>
          <button type="button" class="alerts-drawer__icon-btn" data-alerts-close title="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="alerts-drawer__body custom-scrollbar" data-alerts-body>
        <p class="alerts-drawer__empty">Cargando notificaciones…</p>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-alerts-status]');
    const bodyEl = panel.querySelector('[data-alerts-body]');

    function positionPanel() {
      if (!notifBtn || !panel) return;
      const rect = notifBtn.getBoundingClientRect();
      const gap = 10;
      const width = Math.min(400, window.innerWidth - 16);
      const right = Math.max(8, window.innerWidth - rect.right);
      let top = rect.bottom + gap;
      const maxHeight = Math.max(240, window.innerHeight - top - 12);

      // Si casi no cabe abajo, pegar al borde superior con margen
      if (maxHeight < 220) {
        top = Math.max(12, window.innerHeight - Math.min(520, window.innerHeight - 24));
      }

      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = `${Math.round(right)}px`;
      panel.style.left = 'auto';
      panel.style.bottom = 'auto';
      panel.style.width = `${Math.round(width)}px`;
      panel.style.maxHeight = `${Math.round(Math.min(560, window.innerHeight - top - 12))}px`;
      panel.style.height = 'auto';
    }

    function close() {
      panel.classList.remove('alerts-drawer--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('alerts-drawer-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('alerts-drawer-open');
      notifBtn?.setAttribute('aria-expanded', 'false');
      window.removeEventListener('resize', positionPanel);
    }

    async function fetchAlerts() {
      const res = await fetch('/api/auth/alerts', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    async function load({ markSeen = false } = {}) {
      bodyEl.innerHTML = '<p class="alerts-drawer__empty">Cargando notificaciones…</p>';
      statusEl.textContent = 'Actualizando…';
      try {
        const data = await fetchAlerts();
        const alerts = data.alerts || [];
        const roleLabel = data.roleLabel || data.role || 'su perfil';
        const unread = countUnread(alerts);
        lastAlertsFingerprint = fingerprint(alerts);
        statusEl.textContent = `${alerts.length} notificación(es) · ${roleLabel}`;

        if (!markSeen) setNotifDot(unread > 0, unread);

        if (!alerts.length) {
          bodyEl.innerHTML = `
            <div class="alerts-drawer__empty-state">
              <span class="material-symbols-outlined">notifications_off</span>
              <p>Sin notificaciones para su perfil en este momento.</p>
            </div>`;
          if (markSeen) markAlertsSeen(alerts);
          return alerts;
        }

        const seenIds = getSeenIds();
        bodyEl.innerHTML = alerts.map((a) => {
          const isNew = a.type !== 'sistema' && a.id && !seenIds.has(a.id);
          return `
          <article class="alerts-drawer__item ${severityClass(a.severity)}${isNew && !markSeen ? ' is-new' : ''}">
            <div class="alerts-drawer__item-head">
              <strong>${esc(a.title)}${isNew && !markSeen ? ' <span class="alerts-drawer__new">Nueva</span>' : ''}</strong>
              <span class="alerts-drawer__tag">${esc(a.typeLabel || a.category || '')}</span>
            </div>
            <p class="alerts-drawer__msg">${esc(a.message)}</p>
            ${a.href
              ? `<a href="${esc(a.href)}" class="alerts-drawer__link">
                  <span class="material-symbols-outlined">arrow_forward</span>
                  Ver detalle
                </a>`
              : ''}
          </article>`;
        }).join('');

        if (markSeen) markAlertsSeen(alerts);
        return alerts;
      } catch (err) {
        statusEl.textContent = 'Error al cargar';
        bodyEl.innerHTML = `<p class="alerts-drawer__empty">${esc(err.message || 'No se pudieron cargar las notificaciones.')}</p>`;
        return [];
      }
    }

    async function open() {
      positionPanel();
      panel.classList.add('alerts-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('alerts-drawer-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('alerts-drawer-open');
      notifBtn?.setAttribute('aria-expanded', 'true');
      window.addEventListener('resize', positionPanel);
      await load({ markSeen: true });
      positionPanel();
    }

    function toggle() {
      if (panel.classList.contains('alerts-drawer--open')) close();
      else open();
    }

    panel.querySelector('[data-alerts-close]')?.addEventListener('click', close);
    panel.querySelector('[data-alerts-refresh]')?.addEventListener('click', () => load({ markSeen: false }));
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('alerts-drawer--open')) close();
    });

    alertsUi = { open, close, toggle, load, fetchAlerts, panel };
    return alertsUi;
  }

  async function pollNotifications() {
    try {
      const ui = ensureAlertsPanel();
      const data = await ui.fetchAlerts();
      const alerts = data.alerts || [];
      const fp = fingerprint(alerts);
      const unread = countUnread(alerts);
      const changed = fp && fp !== lastAlertsFingerprint && lastAlertsFingerprint !== '';
      lastAlertsFingerprint = fp || lastAlertsFingerprint;
      setNotifDot(unread > 0 || changed, unread);
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

  function ensureNotificationsCenter(trailing) {
    if (trailing.querySelector('.top-bar-notif-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'top-bar-notif-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-glass top-bar-notif-btn';
    btn.setAttribute('aria-label', 'Centro de notificaciones');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-controls', 'alertsDrawer');
    btn.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
      <span class="top-bar-notif-dot" data-notif-dot hidden aria-hidden="true"></span>
    `;

    wrap.appendChild(btn);
    trailing.appendChild(wrap);
    notifBtn = btn;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAlertsPanel().toggle();
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
