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
    'post-sales': 'Postventa',
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
    const statusBadge = header.querySelector('#statusBadge');

    const trailingNodes = [];
    Array.from(header.children).forEach((child) => {
      if (child === menuBtn) return;
      if (child.classList.contains('top-bar-main')) return;
      if (child.querySelector('.top-bar-title')) return;
      if (statusBadge && child.contains(statusBadge) && !child.querySelector('.top-bar-title')) return;
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
    leading.appendChild(pageBlock);

    if (statusBadge) {
      statusBadge.classList.add('top-bar-status');
      leading.appendChild(statusBadge);
    }

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

  function renderUserPanel(panel, session) {
    const pages = (session?.pages || [])
      .map((id) => PAGE_LABELS[id] || id)
      .filter(Boolean);

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

    header.querySelectorAll('.avatar-glass:not(.top-bar-user-btn)').forEach((el) => el.remove());

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
