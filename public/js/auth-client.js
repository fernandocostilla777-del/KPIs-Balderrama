(function () {
  let cachedSession = null;
  let sessionPromise = null;

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

  window.DashboardAuth = {
    getSession,
    clearCache() {
      cachedSession = null;
    },
  };
})();
