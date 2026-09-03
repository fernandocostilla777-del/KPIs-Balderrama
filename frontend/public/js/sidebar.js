(function () {
  const items = [
    { id: 'overview', href: '/', icon: 'dashboard', label: 'Resumen' },
    { id: 'sales', href: '/sales.html', icon: 'bar_chart', label: 'Ventas' },
    { id: 'post-sales', href: '/post-sales.html', icon: 'handshake', label: 'PostVenta' },
    { id: 'inventory', href: '/inventory.html', icon: 'inventory_2', label: 'Inventario' },
    { id: 'lista-precios', href: '/lista-precios.html', icon: 'sell', label: 'Lista de precios' },
    { id: 'contabilidad', href: '/contabilidad.html', icon: 'account_balance', label: 'Contabilidad' },
    { id: 'forecast', href: '/forecast.html', icon: 'timeline', label: 'Pronóstico' },
    { id: 'seguimiento', href: '/seguimiento.html', icon: 'person_search', label: 'Seguimiento 360' },
    { id: 'admin', href: '/admin.html', icon: 'admin_panel_settings', label: 'Administración' },
  ];

  const active = document.body.dataset.page || 'overview';
  const el = document.getElementById('sidebar');
  if (!el) return;

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function bindLogout() {
    const logoutBtn = document.getElementById('btnLogout');
    if (!logoutBtn || logoutBtn.dataset.bound === '1') return;
    logoutBtn.dataset.bound = '1';
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } finally {
        window.location.href = '/login.html';
      }
    });
  }

  function renderSidebar(session) {
    const allowed = new Set(session?.pages || items.map((i) => i.id));
    const visible = items.filter((i) => allowed.has(i.id));

    const prevStatus = document.getElementById('statusBadge')?.textContent || 'Listo';
    const prevUpdated = document.getElementById('lastUpdated')?.textContent || '';
    const prevStatusClass = document.getElementById('statusBadge')?.className || 'sidebar-status-line';

    el.className = 'sidebar-glass';
    el.innerHTML = `
    <nav class="sidebar-nav">
      ${visible.map((i) => `
        <a class="sidebar-link${i.id === active ? ' active' : ''}" href="${i.href}">
          <span class="material-symbols-outlined">${i.icon}</span>
          <span>${i.label}</span>
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <span class="material-symbols-outlined sidebar-user-icon">badge</span>
        <div class="sidebar-user-meta">
          <span class="sidebar-user-role">${esc(session?.roleLabel || 'Usuario')}</span>
          <span class="sidebar-user-name">${esc(session?.username || '')}</span>
        </div>
      </div>
      <button type="button" class="sidebar-logout-btn" id="btnLogout">
        <span class="material-symbols-outlined">logout</span>
        <span>Cerrar sesión</span>
      </button>
      <div class="sidebar-connection-status" title="Estado de datos">
        <span class="status-dot" data-status-dot aria-hidden="true"></span>
        <div class="sidebar-status-meta">
          <span id="statusBadge" class="${esc(prevStatusClass.includes('sidebar-status-line') ? prevStatusClass : 'sidebar-status-line')}">${esc(prevStatus)}</span>
          <span id="lastUpdated" class="sidebar-last-updated">${esc(prevUpdated)}</span>
        </div>
      </div>
    </div>`;

    bindLogout();
  }

  // Render inmediato para que #statusBadge / #lastUpdated existan antes de las consultas
  renderSidebar(null);

  el.addEventListener('pointerenter', (event) => {
    const link = event.target.closest('.sidebar-link');
    if (!link || link.classList.contains('active') || link.dataset.prefetched === '1') return;
    link.dataset.prefetched = '1';
    const prefetch = document.createElement('link');
    prefetch.rel = 'prefetch';
    prefetch.href = link.href;
    document.head.appendChild(prefetch);
  }, true);

  if (window.DashboardAuth) {
    window.DashboardAuth.getSession(true).then(renderSidebar).catch(() => renderSidebar(null));
  }
})();
