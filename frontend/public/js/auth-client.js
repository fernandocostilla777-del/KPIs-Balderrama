(function () {
  let cachedSession = null;
  let sessionPromise = null;

  function isLoginPage() {
    const path = window.location.pathname;
    return path.endsWith('/login.html') || path === '/login.html';
  }

  function redirectToLogin() {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?returnUrl=${returnUrl}`;
  }

  async function fetchSession() {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) {
      const err = new Error('No autenticado');
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function getSession(forceRefresh) {
    if (!forceRefresh && cachedSession) return cachedSession;
    if (!forceRefresh && sessionPromise) return sessionPromise;
    sessionPromise = fetchSession()
      .then((data) => {
        cachedSession = data;
        return data;
      })
      .finally(() => {
        sessionPromise = null;
      });
    return sessionPromise;
  }

  async function guardPage() {
    if (isLoginPage()) {
      try {
        const session = await getSession();
        if (session?.username) {
          window.location.href = session.homePath || '/';
        }
      } catch {
        /* sin sesión: permanecer en login */
      }
      return;
    }

    const pageId = document.body?.dataset?.page;
    if (!pageId) return;

    try {
      const session = await getSession(true);
      if (!session.pages?.includes(pageId)) {
        window.location.href = session.homePath || '/login.html';
      }
    } catch {
      redirectToLogin();
    }
  }

  window.DashboardAuth = {
    getSession,
    guardPage,
    clearCache() {
      cachedSession = null;
    },
  };

  guardPage();
})();
