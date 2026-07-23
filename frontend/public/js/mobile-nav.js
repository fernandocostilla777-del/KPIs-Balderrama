(function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const MOBILE_BP = 900;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mobile-menu-btn';
  btn.setAttribute('aria-label', 'Abrir menú de navegación');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<img src="/img/image%20(1).png" alt="" class="sidebar-logo mobile-menu-btn-logo" aria-hidden="true">';

  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  const topBar = document.querySelector('.top-bar');
  if (topBar) topBar.insertBefore(btn, topBar.firstChild);

  function isMobileLayout() {
    return window.innerWidth <= MOBILE_BP;
  }

  function useRailMenu() {
    return !isMobileLayout();
  }

  function syncNavMode() {
    document.body.classList.toggle('nav-rail-mode', useRailMenu());
  }

  function setOpen(open) {
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (useRailMenu()) {
      overlay.classList.add('hidden');
      btn.setAttribute('aria-label', open ? 'Compactar menú de navegación' : 'Expandir menú de navegación');
    } else {
      overlay.classList.toggle('hidden', !open);
      btn.setAttribute('aria-label', open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
    }
  }

  function close() {
    if (sidebar.classList.contains('is-open')) setOpen(false);
  }

  function closeOnNavAction(e) {
    if (e.target.closest('.sidebar-link, .sidebar-logout-btn, .sidebar-logo-link')) {
      close();
    }
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    setOpen(!sidebar.classList.contains('is-open'));
  });

  sidebar.addEventListener('mouseover', (e) => {
    if (!useRailMenu() || sidebar.classList.contains('is-open')) return;
    if (e.target.closest('.sidebar-link')) setOpen(true);
  });

  sidebar.addEventListener('click', (e) => {
    if (useRailMenu() && !sidebar.classList.contains('is-open')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    closeOnNavAction(e);
  });

  overlay.addEventListener('click', close);

  document.addEventListener('pointerdown', (e) => {
    if (!sidebar.classList.contains('is-open')) return;
    if (sidebar.contains(e.target) || btn.contains(e.target)) return;
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('resize', () => {
    syncNavMode();
    if (sidebar.classList.contains('is-open') && useRailMenu()) {
      overlay.classList.add('hidden');
    }
  });

  syncNavMode();
})();
