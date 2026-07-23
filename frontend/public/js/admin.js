(function () {
  const api = window.api || window.Dashboard?.api;
  const setText = window.setText || window.Dashboard?.setText;
  const showLoading = window.showLoading || window.Dashboard?.showLoading;

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const els = {
    tableBody: document.getElementById('usersTableBody'),
    formPanel: document.getElementById('userFormPanel'),
    form: document.getElementById('userForm'),
    formTitle: document.getElementById('userFormTitle'),
    editUsername: document.getElementById('editUsername'),
    formUsername: document.getElementById('formUsername'),
    formPassword: document.getElementById('formPassword'),
    formRole: document.getElementById('formRole'),
    formActive: document.getElementById('formActive'),
    activeFieldWrap: document.getElementById('activeFieldWrap'),
    passwordHint: document.getElementById('passwordHint'),
    passwordRevealWrap: document.getElementById('passwordRevealWrap'),
    btnRevealPassword: document.getElementById('btnRevealPassword'),
    revealedPassword: document.getElementById('revealedPassword'),
    message: document.getElementById('adminMessage'),
    btnNew: document.getElementById('btnNewUser'),
    btnCancel: document.getElementById('btnCancelUser'),
    alertPrefsGrid: document.getElementById('alertPrefsGrid'),
    btnSaveAlertPrefs: document.getElementById('btnSaveAlertPrefs'),
    prorationMeta: document.getElementById('prorationMeta'),
    prorationVentasShare: document.getElementById('prorationVentasShare'),
    prorationPostventaShare: document.getElementById('prorationPostventaShare'),
    prorationShareTotal: document.getElementById('prorationShareTotal'),
    prorationVentasBody: document.getElementById('prorationVentasBody'),
    prorationPostventaBody: document.getElementById('prorationPostventaBody'),
    prorationVentasBlockSum: document.getElementById('prorationVentasBlockSum'),
    prorationVentasTotalSum: document.getElementById('prorationVentasTotalSum'),
    prorationPostventaSum: document.getElementById('prorationPostventaSum'),
    btnSaveProration: document.getElementById('btnSaveProration'),
    btnResetProration: document.getElementById('btnResetProration'),
  };

  let roles = [];
  let users = [];
  let alertTypes = [];
  let alertPrefs = {};
  let prorationCatalog = { ventas: [], postventa: [] };
  let prorationConfig = null;

  function showMessage(text, type = 'info') {
    if (!els.message) return;
    els.message.textContent = text;
    els.message.className = `admin-message admin-message--${type}`;
    els.message.classList.remove('hidden');
    window.clearTimeout(showMessage._timer);
    showMessage._timer = window.setTimeout(() => els.message.classList.add('hidden'), 4500);
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fillRoleOptions(selected) {
    els.formRole.innerHTML = roles
      .map((r) => `<option value="${r.id}"${r.id === selected ? ' selected' : ''}>${r.label}</option>`)
      .join('');
  }

  function renderUsers() {
    if (!users.length) {
      els.tableBody.innerHTML = '<tr><td colspan="5">No hay usuarios registrados.</td></tr>';
      return;
    }

    els.tableBody.innerHTML = users.map((user) => `
      <tr>
        <td><strong>${user.username}</strong></td>
        <td>${user.roleLabel}</td>
        <td><span class="admin-status ${user.active ? 'is-active' : 'is-inactive'}">${user.active ? 'Activo' : 'Inactivo'}</span></td>
        <td>${formatDate(user.createdAt)}</td>
        <td class="admin-actions">
          <button type="button" class="btn-icon" data-action="edit" data-username="${user.username}" title="Editar">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button type="button" class="btn-icon btn-icon-danger" data-action="delete" data-username="${user.username}" title="Eliminar">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderAlertPrefs() {
    if (!els.alertPrefsGrid) return;
    if (!roles.length || !alertTypes.length) {
      els.alertPrefsGrid.innerHTML = '<p class="admin-hint">No hay perfiles o tipos de alerta configurados.</p>';
      return;
    }

    els.alertPrefsGrid.innerHTML = roles.map((role) => {
      const enabled = new Set(alertPrefs[role.id] || []);
      const checks = alertTypes.map((t) => `
        <label class="admin-alert-check">
          <input type="checkbox" data-role="${role.id}" data-alert="${t.id}" ${enabled.has(t.id) ? 'checked' : ''}/>
          <span>
            <strong>${t.label}</strong>
            <small>${t.description || t.category || ''}</small>
          </span>
        </label>
      `).join('');
      return `
        <div class="admin-alert-role">
          <h3 class="admin-alert-role-title">${role.label}</h3>
          <div class="admin-alert-checks">${checks}</div>
        </div>
      `;
    }).join('');
  }

  function collectAlertPrefsFromDom() {
    const next = {};
    roles.forEach((r) => { next[r.id] = []; });
    els.alertPrefsGrid?.querySelectorAll('input[type="checkbox"][data-role][data-alert]').forEach((input) => {
      if (!input.checked) return;
      const role = input.dataset.role;
      const alertId = input.dataset.alert;
      if (!next[role]) next[role] = [];
      next[role].push(alertId);
    });
    return next;
  }

  function openCreateForm() {
    els.formTitle.textContent = 'Nuevo usuario';
    els.editUsername.value = '';
    els.formUsername.value = '';
    els.formUsername.disabled = false;
    els.formPassword.value = '';
    els.formPassword.required = true;
    els.formActive.checked = true;
    els.activeFieldWrap.classList.add('hidden');
    els.passwordHint.textContent = 'Mínimo 8 caracteres.';
    els.passwordRevealWrap?.classList.add('hidden');
    if (els.revealedPassword) els.revealedPassword.textContent = '';
    fillRoleOptions(roles[0]?.id);
    els.formPanel.classList.remove('hidden');
    els.formUsername.focus();
  }

  function openEditForm(username) {
    const user = users.find((u) => u.username === username);
    if (!user) return;
    els.formTitle.textContent = `Editar usuario: ${user.username}`;
    els.editUsername.value = user.username;
    els.formUsername.value = user.username;
    els.formUsername.disabled = true;
    els.formPassword.value = '';
    els.formPassword.required = false;
    els.formActive.checked = user.active !== false;
    els.activeFieldWrap.classList.remove('hidden');
    els.passwordHint.textContent = 'Deje vacío para mantener la contraseña actual.';
    els.passwordRevealWrap?.classList.remove('hidden');
    if (els.revealedPassword) {
      els.revealedPassword.textContent = user.hasRevealablePassword
        ? 'Pulse el botón para mostrar la contraseña actual.'
        : 'Sin contraseña recuperable: restablézcala para habilitar la visualización.';
    }
    fillRoleOptions(user.role);
    els.formPanel.classList.remove('hidden');
    els.formPassword.focus();
  }

  function closeForm() {
    els.formPanel.classList.add('hidden');
    els.form.reset();
    els.editUsername.value = '';
    els.formUsername.disabled = false;
    els.formPassword.required = true;
    els.passwordRevealWrap?.classList.add('hidden');
    if (els.revealedPassword) els.revealedPassword.textContent = '';
  }

  async function loadUsers() {
    showLoading(true);
    try {
      const data = await api('/auth/users');
      users = data.users || [];
      roles = data.roles || [];
      renderUsers();
      setText('statusBadge', `${users.length} usuario(s)`);
    } catch (err) {
      showMessage(err.message || 'No se pudieron cargar los usuarios.', 'error');
    } finally {
      showLoading(false);
    }
  }

  async function loadAlertPrefs() {
    try {
      const data = await api('/auth/alert-prefs');
      alertTypes = data.types || [];
      alertPrefs = data.byRole || {};
      if (data.roles?.length) roles = data.roles;
      renderAlertPrefs();
    } catch (err) {
      if (els.alertPrefsGrid) {
        els.alertPrefsGrid.innerHTML = `<p class="admin-hint">${err.message || 'No se pudieron cargar las preferencias de alertas.'}</p>`;
      }
    }
  }

  async function saveAlertPrefs() {
    showLoading(true);
    try {
      const byRole = collectAlertPrefsFromDom();
      const res = await fetch('/api/auth/alert-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ byRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      alertPrefs = data.byRole || byRole;
      showMessage('Preferencias de alertas guardadas.', 'success');
      renderAlertPrefs();
    } catch (err) {
      showMessage(err.message || 'No se pudieron guardar las alertas.', 'error');
    } finally {
      showLoading(false);
    }
  }

  function fmtPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `${Math.round(v * 100) / 100}%`;
  }

  function readProrationFromDom() {
    const ventas = {};
    els.prorationVentasBody?.querySelectorAll('input[data-ventas-key]').forEach((input) => {
      ventas[input.dataset.ventasKey] = Number(input.value || 0);
    });
    const postventa = {};
    els.prorationPostventaBody?.querySelectorAll('input[data-postventa-key]').forEach((input) => {
      postventa[input.dataset.postventaKey] = Number(input.value || 0);
    });
    return {
      ventasSharePct: Number(els.prorationVentasShare?.value || 0),
      postventaSharePct: Number(els.prorationPostventaShare?.value || 0),
      ventas,
      postventa,
    };
  }

  function updateProrationTotals() {
    const cfg = readProrationFromDom();
    const shareSum = cfg.ventasSharePct + cfg.postventaSharePct;
    if (els.prorationShareTotal) {
      els.prorationShareTotal.textContent = fmtPct(shareSum);
      els.prorationShareTotal.parentElement?.classList.toggle('is-invalid', Math.abs(shareSum - 100) > 0.05);
    }

    let blockSum = 0;
    let totalFromVentas = 0;
    els.prorationVentasBody?.querySelectorAll('tr[data-key]').forEach((row) => {
      const key = row.dataset.key;
      const input = row.querySelector('input');
      const pct = Number(input?.value || 0);
      blockSum += pct;
      const ofTotal = (cfg.ventasSharePct / 100) * pct;
      totalFromVentas += ofTotal;
      const cell = row.querySelector('[data-total-pct]');
      if (cell) cell.textContent = fmtPct(ofTotal);
    });

    let postSum = 0;
    els.prorationPostventaBody?.querySelectorAll('input').forEach((input) => {
      postSum += Number(input.value || 0);
    });

    if (els.prorationVentasBlockSum) els.prorationVentasBlockSum.textContent = fmtPct(blockSum);
    if (els.prorationVentasTotalSum) els.prorationVentasTotalSum.textContent = fmtPct(totalFromVentas);
    if (els.prorationPostventaSum) els.prorationPostventaSum.textContent = fmtPct(postSum);
  }

  function renderProration(data) {
    const cfg = data?.config || data;
    const catalog = data?.catalog || prorationCatalog;
    prorationConfig = cfg;
    prorationCatalog = catalog;

    if (els.prorationVentasShare) els.prorationVentasShare.value = cfg.ventasSharePct ?? 70;
    if (els.prorationPostventaShare) els.prorationPostventaShare.value = cfg.postventaSharePct ?? 30;

    if (els.prorationMeta) {
      const updated = cfg.updatedAt
        ? new Date(cfg.updatedAt).toLocaleString('es-MX')
        : 'valores precargados';
      els.prorationMeta.textContent = `Fuente activa del EEFF · última actualización: ${updated}`;
    }

    const ventasItems = catalog.ventas?.length
      ? catalog.ventas
      : Object.keys(cfg.ventas || {}).map((key) => ({ key, label: key }));
    const postItems = catalog.postventa?.length
      ? catalog.postventa
      : Object.keys(cfg.postventa || {}).map((key) => ({ key, label: key }));

    if (els.prorationVentasBody) {
      els.prorationVentasBody.innerHTML = ventasItems.map((item) => `
        <tr data-key="${esc(item.key)}">
          <td>${esc(item.label)}</td>
          <td class="cell-num">
            <input type="number" min="0" max="100" step="0.1" data-ventas-key="${esc(item.key)}" value="${Number(cfg.ventas?.[item.key] ?? 0)}"/>
          </td>
          <td class="cell-num" data-total-pct>—</td>
        </tr>
      `).join('');
    }

    if (els.prorationPostventaBody) {
      els.prorationPostventaBody.innerHTML = postItems.map((item) => `
        <tr>
          <td>${esc(item.label)}</td>
          <td class="cell-num">
            <input type="number" min="0" max="100" step="0.1" data-postventa-key="${esc(item.key)}" value="${Number(cfg.postventa?.[item.key] ?? 0)}"/>
          </td>
        </tr>
      `).join('');
    }

    updateProrationTotals();
  }

  async function loadProration() {
    if (!els.prorationVentasBody) return;
    try {
      const data = await api('/auth/admin-expense-proration');
      renderProration(data);
    } catch (err) {
      if (els.prorationMeta) {
        els.prorationMeta.textContent = err.message || 'No se pudo cargar el prorrateo.';
      }
    }
  }

  async function saveProration({ reset = false } = {}) {
    showLoading(true);
    try {
      const payload = reset
        ? { reset: true }
        : { config: readProrationFromDom() };
      const res = await fetch('/api/auth/admin-expense-proration', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      renderProration(data);
      showMessage(reset ? 'Prorrateo restablecido a valores precargados.' : 'Prorrateo de gastos de administración guardado.', 'success');
    } catch (err) {
      showMessage(err.message || 'No se pudo guardar el prorrateo.', 'error');
    } finally {
      showLoading(false);
    }
  }

  async function revealPassword() {
    const username = els.editUsername.value;
    if (!username || !els.revealedPassword) return;
    els.btnRevealPassword.disabled = true;
    els.revealedPassword.textContent = 'Consultando…';
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}/password`, {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.available) {
        els.revealedPassword.textContent = data.message || 'Contraseña no disponible.';
        return;
      }
      els.revealedPassword.innerHTML = `Contraseña actual: <code>${esc(data.password)}</code>`;
    } catch (err) {
      els.revealedPassword.textContent = err.message || 'No se pudo obtener la contraseña.';
    } finally {
      els.btnRevealPassword.disabled = false;
    }
  }

  async function saveUser(e) {
    e.preventDefault();
    const editing = els.editUsername.value;
    const payload = {
      username: els.formUsername.value.trim(),
      password: els.formPassword.value,
      role: els.formRole.value,
    };

    showLoading(true);
    try {
      if (editing) {
        const body = { role: payload.role, active: els.formActive.checked };
        if (payload.password) body.password = payload.password;
        await fetch(`/api/auth/users/${encodeURIComponent(editing)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        }).then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || res.statusText);
          }
          return res.json();
        });
        showMessage('Usuario actualizado correctamente.', 'success');
      } else {
        await fetch('/api/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        }).then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || res.statusText);
          }
          return res.json();
        });
        showMessage('Usuario creado correctamente.', 'success');
      }
      closeForm();
      await loadUsers();
    } catch (err) {
      showMessage(err.message || 'No se pudo guardar el usuario.', 'error');
    } finally {
      showLoading(false);
    }
  }

  async function removeUser(username) {
    if (!window.confirm(`¿Eliminar el usuario "${username}"?`)) return;
    showLoading(true);
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      showMessage('Usuario eliminado.', 'success');
      await loadUsers();
    } catch (err) {
      showMessage(err.message || 'No se pudo eliminar el usuario.', 'error');
    } finally {
      showLoading(false);
    }
  }

  els.btnNew?.addEventListener('click', openCreateForm);
  els.btnCancel?.addEventListener('click', closeForm);
  els.form?.addEventListener('submit', saveUser);
  els.btnSaveAlertPrefs?.addEventListener('click', saveAlertPrefs);
  els.btnSaveProration?.addEventListener('click', () => saveProration());
  els.btnResetProration?.addEventListener('click', () => {
    if (!window.confirm('¿Restablecer el prorrateo a 70% ventas / 30% postventa con los valores precargados?')) return;
    saveProration({ reset: true });
  });
  els.btnRevealPassword?.addEventListener('click', revealPassword);

  els.prorationVentasShare?.addEventListener('input', updateProrationTotals);
  els.prorationPostventaShare?.addEventListener('input', updateProrationTotals);
  els.prorationVentasBody?.addEventListener('input', updateProrationTotals);
  els.prorationPostventaBody?.addEventListener('input', updateProrationTotals);

  els.tableBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const username = btn.dataset.username;
    if (btn.dataset.action === 'edit') openEditForm(username);
    if (btn.dataset.action === 'delete') removeUser(username);
  });

  Promise.all([loadUsers(), loadAlertPrefs(), loadProration()]);
})();
