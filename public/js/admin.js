(function () {
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
    message: document.getElementById('adminMessage'),
    btnNew: document.getElementById('btnNewUser'),
    btnCancel: document.getElementById('btnCancelUser'),
  };

  let roles = [];
  let users = [];

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

  els.tableBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const username = btn.dataset.username;
    if (btn.dataset.action === 'edit') openEditForm(username);
    if (btn.dataset.action === 'delete') removeUser(username);
  });

  loadUsers();
})();
