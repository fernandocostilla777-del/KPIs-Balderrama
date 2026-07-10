(function () {
  const items = [
    { id: 'admin', href: '/admin.html', icon: 'admin_panel_settings', label: 'Administración' },
    { id: 'overview', href: '/', icon: 'dashboard', label: 'Resumen' },
    { id: 'sales', href: '/sales.html', icon: 'bar_chart', label: 'Ventas' },
    { id: 'forecast', href: '/forecast.html', icon: 'timeline', label: 'Pronóstico' },
    { id: 'inventory', href: '/inventory.html', icon: 'inventory_2', label: 'Inventario' },
    { id: 'contabilidad', href: '/contabilidad.html', icon: 'account_balance', label: 'Contabilidad' },
    { id: 'post-sales', href: '/post-sales.html', icon: 'handshake', label: 'Postventa' },
    { id: 'assistant', href: '/assistant.html', icon: 'smart_toy', label: 'Asistente IA' },
  ];

  const active = document.body.dataset.page || 'overview';
  const el = document.getElementById('sidebar');
  if (!el) return;

  function renderSidebar(session) {
    const allowed = new Set(session?.pages || items.map((i) => i.id));
    const visible = items.filter((i) => allowed.has(i.id));

    el.className = 'sidebar-glass';
    el.innerHTML = `
    <div class="sidebar-brand">
      <a href="${session?.homePath || '/'}" class="sidebar-logo-link" aria-label="BALDERRAMA — Inicio">
        <img src="/img/image%20(1).png" alt="BALDERRAMA" class="sidebar-logo"/>
      </a>
    </div>
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
          <span class="sidebar-user-role">${session?.roleLabel || 'Usuario'}</span>
          <span class="sidebar-user-name">${session?.username || ''}</span>
        </div>
      </div>
      <button type="button" class="sidebar-logout-btn" id="btnLogout">
        <span class="material-symbols-outlined">logout</span>
        <span>Cerrar sesión</span>
      </button>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <span class="status-dot"></span>
        <span style="font-size:11px;font-weight:700;color:#7F8C8D;">SQL Server conectado</span>
      </div>
    </div>`;

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } finally {
          window.location.href = '/login.html';
        }
      });
    }
  }

  if (window.DashboardAuth) {
    window.DashboardAuth.getSession(true).then(renderSidebar).catch(() => renderSidebar(null));
  } else {
    renderSidebar(null);
  }
})();
