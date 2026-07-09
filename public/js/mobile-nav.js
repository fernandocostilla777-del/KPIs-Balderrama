(function () {
  const MOBILE_BP = 900;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mobile-menu-btn';
  btn.setAttribute('aria-label', 'Abrir menú de navegación');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">menu</span>';

  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  const topBar = document.querySelector('.top-bar');
  if (topBar) topBar.insertBefore(btn, topBar.firstChild);

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  function setOpen(open) {
    sidebar.classList.toggle('is-open', open);
    overlay.classList.toggle('hidden', !open);
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
    btn.querySelector('.material-symbols-outlined').textContent = open ? 'close' : 'menu';
  }

  function close() {
    if (sidebar.classList.contains('is-open')) setOpen(false);
  }

  btn.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
  overlay.addEventListener('click', close);

  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar-link')) close();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();
