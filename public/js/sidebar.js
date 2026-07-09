(function () {
  const items = [
    { id: 'overview', href: '/', icon: 'dashboard', label: 'Resumen' },
    { id: 'sales', href: '/sales.html', icon: 'bar_chart', label: 'Ventas' },
    { id: 'forecast', href: '/forecast.html', icon: 'timeline', label: 'Pronóstico' },
    { id: 'inventory', href: '/inventory.html', icon: 'inventory_2', label: 'Inventario' },
    { id: 'contabilidad', href: '/contabilidad.html', icon: 'account_balance', label: 'Contabilidad' },
    { id: 'post-sales', href: '/post-sales.html', icon: 'handshake', label: 'Postventa' },
  ];
  const active = document.body.dataset.page || 'overview';
  const el = document.getElementById('sidebar');
  if (!el) return;
  el.className = 'sidebar-glass';
  el.innerHTML = `
    <div class="sidebar-brand">
      <a href="/" class="sidebar-logo-link" aria-label="BALDERRAMA — Inicio">
        <img src="/img/logo-balderrama.svg?v=1" alt="BALDERRAMA" class="sidebar-logo"/>
      </a>
      <p class="brand-accent">BALDERRAMA</p>
    </div>
    <nav class="sidebar-nav">
      ${items.map((i) => `
        <a class="sidebar-link${i.id === active ? ' active' : ''}" href="${i.href}">
          <span class="material-symbols-outlined">${i.icon}</span>
          <span>${i.label}</span>
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="status-dot"></span>
        <span style="font-size:11px;font-weight:700;color:#7F8C8D;">SQL Server conectado</span>
      </div>
    </div>`;
})();
