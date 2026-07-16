(function () {
  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('btnLogin');
  const params = new URLSearchParams(window.location.search);
  const returnUrl = params.get('returnUrl') || '';

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    btn.disabled = true;

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'No se pudo iniciar sesión.');
        return;
      }
      const target = returnUrl && returnUrl.startsWith('/') ? returnUrl : (data.homePath || '/');
      window.location.href = target;
    } catch {
      showError('Error de conexión con el servidor.');
    } finally {
      btn.disabled = false;
    }
  });
})();
