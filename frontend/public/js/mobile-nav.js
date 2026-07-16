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

  function isTouchPrimary() {
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
  }

  function useHoverMenu() {
    return !isMobileLayout() && !isTouchPrimary();
  }

  function syncNavMode() {
    document.body.classList.toggle('nav-hover-mode', useHoverMenu());
  }

  function setOpen(open) {
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (useHoverMenu()) {
      overlay.classList.add('hidden');
      btn.setAttribute('aria-label', open ? 'Menú de navegación abierto' : 'Abrir menú de navegación');
    } else {
      overlay.classList.toggle('hidden', !open);
      btn.setAttribute('aria-label', open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
    }
  }

  function openMenu() {
    setOpen(true);
  }

  function close() {
    if (sidebar.classList.contains('is-open')) setOpen(false);
  }

  function closeOnNavAction(e) {
    if (e.target.closest('.sidebar-link, .sidebar-logout-btn, .sidebar-logo-link')) {
      close();
    }
  }

  btn.addEventListener('mouseenter', () => {
    if (useHoverMenu()) openMenu();
  });

  btn.addEventListener('click', (e) => {
    if (useHoverMenu()) {
      e.preventDefault();
      return;
    }
    setOpen(!sidebar.classList.contains('is-open'));
  });

  sidebar.addEventListener('mouseenter', () => {
    if (useHoverMenu()) openMenu();
  });

  sidebar.addEventListener('click', closeOnNavAction);

  overlay.addEventListener('click', () => {
    if (!useHoverMenu()) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('resize', () => {
    syncNavMode();
    if (sidebar.classList.contains('is-open') && useHoverMenu()) {
      overlay.classList.add('hidden');
    }
  });

  syncNavMode();
})();
