(function () {
  const loginForm = document.getElementById('loginForm');
  const resetForm = document.getElementById('resetForm');
  const loginErrorEl = document.getElementById('loginError');
  const loginSuccessEl = document.getElementById('loginSuccess');
  const resetErrorEl = document.getElementById('resetError');
  const resetInfoEl = document.getElementById('resetInfo');
  const btnLogin = document.getElementById('btnLogin');
  const btnRequestCode = document.getElementById('btnRequestCode');
  const btnResetPassword = document.getElementById('btnResetPassword');
  const passwordInput = document.getElementById('password');
  const resetPasswordInput = document.getElementById('resetPassword');
  const params = new URLSearchParams(window.location.search);
  const returnUrl = params.get('returnUrl') || '';

  function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle('hidden', hidden);
  }

  function showAlert(el, msg) {
    if (!el) return;
    el.textContent = msg;
    setHidden(el, !msg);
  }

  function wirePasswordToggle(btnId, input, iconAttr) {
    const btn = document.getElementById(btnId);
    const icon = btn?.querySelector(`[${iconAttr}]`);
    btn?.addEventListener('click', () => {
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      const nextShow = !showing;
      btn.setAttribute('aria-pressed', nextShow ? 'true' : 'false');
      btn.setAttribute('aria-label', nextShow ? 'Ocultar contraseña' : 'Mostrar contraseña');
      btn.title = nextShow ? 'Ocultar contraseña' : 'Mostrar contraseña';
      if (icon) icon.textContent = nextShow ? 'visibility_off' : 'visibility';
      input.focus({ preventScroll: true });
    });
  }

  function showLogin() {
    setHidden(loginForm, false);
    setHidden(resetForm, true);
    showAlert(resetErrorEl, '');
    showAlert(resetInfoEl, '');
  }

  function showReset() {
    setHidden(loginForm, true);
    setHidden(resetForm, false);
    showAlert(loginErrorEl, '');
    const currentUser = document.getElementById('username')?.value.trim();
    if (currentUser && !document.getElementById('resetUsername').value) {
      document.getElementById('resetUsername').value = currentUser;
    }
    document.getElementById('resetUsername')?.focus();
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'No se pudo completar la solicitud.');
    }
    return data;
  }

  wirePasswordToggle('btnTogglePassword', passwordInput, 'data-password-icon');
  wirePasswordToggle('btnToggleResetPassword', resetPasswordInput, 'data-reset-password-icon');

  document.getElementById('btnForgot')?.addEventListener('click', showReset);
  document.getElementById('btnBackLogin')?.addEventListener('click', showLogin);

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert(loginErrorEl, '');
    showAlert(loginSuccessEl, '');
    btnLogin.disabled = true;

    const username = document.getElementById('username').value.trim();
    const password = passwordInput.value;

    try {
      const data = await postJson('/api/auth/login', { username, password });
      const target = returnUrl && returnUrl.startsWith('/') ? returnUrl : (data.homePath || '/');
      window.location.href = target;
    } catch (err) {
      showAlert(loginErrorEl, err.message || 'No se pudo iniciar sesión.');
    } finally {
      btnLogin.disabled = false;
    }
  });

  btnRequestCode?.addEventListener('click', async () => {
    showAlert(resetErrorEl, '');
    showAlert(resetInfoEl, '');
    const username = document.getElementById('resetUsername').value.trim();
    if (!username) {
      showAlert(resetErrorEl, 'Escribe tu usuario para enviar el código.');
      return;
    }
    btnRequestCode.disabled = true;
    try {
      const data = await postJson('/api/auth/password-reset/request', { username });
      showAlert(resetInfoEl, data.message || 'Si el usuario existe, Administración recibió el código.');
      document.getElementById('resetCode')?.focus();
    } catch (err) {
      showAlert(resetErrorEl, err.message);
    } finally {
      btnRequestCode.disabled = false;
    }
  });

  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert(resetErrorEl, '');
    const username = document.getElementById('resetUsername').value.trim();
    const code = document.getElementById('resetCode').value.trim();
    const password = resetPasswordInput.value;
    const confirm = document.getElementById('resetPassword2').value;
    if (!/^\d{6}$/.test(code)) {
      showAlert(resetErrorEl, 'El código debe tener 6 dígitos.');
      return;
    }
    if (password.length < 8) {
      showAlert(resetErrorEl, 'La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      showAlert(resetErrorEl, 'Las contraseñas no coinciden.');
      return;
    }
    btnResetPassword.disabled = true;
    try {
      const data = await postJson('/api/auth/password-reset/confirm', { username, code, password });
      showLogin();
      showAlert(loginSuccessEl, data.message || 'Contraseña actualizada. Ya puedes iniciar sesión.');
      document.getElementById('username').value = username;
      passwordInput.value = '';
      passwordInput.focus();
    } catch (err) {
      showAlert(resetErrorEl, err.message);
    } finally {
      btnResetPassword.disabled = false;
    }
  });
})();
