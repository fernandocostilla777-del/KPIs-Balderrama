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
    rolePermissionsGrid: document.getElementById('rolePermissionsGrid'),
    rolePermissionsMeta: document.getElementById('rolePermissionsMeta'),
    btnSaveRolePermissions: document.getElementById('btnSaveRolePermissions'),
    btnResetRolePermissions: document.getElementById('btnResetRolePermissions'),
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
    listaPreciosCatalogMeta: document.getElementById('listaPreciosCatalogMeta'),
    listaPreciosFile: document.getElementById('listaPreciosFile'),
    listaPreciosFileName: document.getElementById('listaPreciosFileName'),
    listaPreciosUploadStatus: document.getElementById('listaPreciosUploadStatus'),
    btnUploadListaPrecios: document.getElementById('btnUploadListaPrecios'),
    listaPreciosImageModelo: document.getElementById('listaPreciosImageModelo'),
    listaPreciosImageFile: document.getElementById('listaPreciosImageFile'),
    btnUploadListaPreciosImage: document.getElementById('btnUploadListaPreciosImage'),
    listaPreciosImageStatus: document.getElementById('listaPreciosImageStatus'),
    listaPreciosImagesMeta: document.getElementById('listaPreciosImagesMeta'),
    listaPreciosImagesGrid: document.getElementById('listaPreciosImagesGrid'),
  };

  let roles = [];
  let users = [];
  let alertTypes = [];
  let alertPrefs = {};
  let pageCatalog = [];
  let rolePageDefaults = {};
  let rolePagesByRole = {};
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

  function renderRolePermissions() {
    if (!els.rolePermissionsGrid) return;
    if (!roles.length || !pageCatalog.length) {
      els.rolePermissionsGrid.innerHTML = '<p class="admin-hint">No hay roles o páginas configuradas.</p>';
      return;
    }

    els.rolePermissionsGrid.innerHTML = roles.map((role) => {
      const enabled = new Set(rolePagesByRole[role.id] || role.pages || []);
      const lockAdmin = role.id === 'administracion';
      const checks = pageCatalog.map((page) => {
        const locked = lockAdmin && page.id === 'admin';
        const checked = enabled.has(page.id) || locked;
        return `
          <label class="admin-alert-check${locked ? ' is-locked' : ''}">
            <input type="checkbox"
              data-role-perm="${esc(role.id)}"
              data-page="${esc(page.id)}"
              ${checked ? 'checked' : ''}
              ${locked ? 'disabled' : ''}/>
            <span>
              <strong>${esc(page.label)}</strong>
              <small>${esc(page.description || '')}${locked ? ' · obligatorio para Administración' : ''}</small>
            </span>
          </label>
        `;
      }).join('');
      return `
        <div class="admin-alert-role">
          <div class="admin-role-perm-head">
            <h3 class="admin-alert-role-title">${esc(role.label)}</h3>
            <div class="admin-role-perm-actions">
              <button type="button" class="btn-glass btn-secondary btn-xs" data-role-select-all="${esc(role.id)}">Todos</button>
              <button type="button" class="btn-glass btn-secondary btn-xs" data-role-select-none="${esc(role.id)}">Ninguno</button>
            </div>
          </div>
          <div class="admin-alert-checks">${checks}</div>
        </div>
      `;
    }).join('');
  }

  function collectRolePermissionsFromDom() {
    const next = {};
    roles.forEach((r) => { next[r.id] = { pages: [] }; });
    els.rolePermissionsGrid?.querySelectorAll('input[type="checkbox"][data-role-perm][data-page]').forEach((input) => {
      if (!input.checked && !input.disabled) return;
      const role = input.dataset.rolePerm;
      const page = input.dataset.page;
      if (!next[role]) next[role] = { pages: [] };
      if (input.checked || input.disabled) next[role].pages.push(page);
    });
    // Administración siempre incluye admin aunque el checkbox esté disabled
    if (next.administracion && !next.administracion.pages.includes('admin')) {
      next.administracion.pages.unshift('admin');
    }
    return next;
  }

  async function loadRolePermissions() {
    if (!els.rolePermissionsGrid) return;
    try {
      const data = await api('/auth/role-permissions');
      pageCatalog = data.pages || [];
      rolePageDefaults = data.defaults || {};
      rolePagesByRole = {};
      Object.entries(data.byRole || {}).forEach(([id, cfg]) => {
        rolePagesByRole[id] = cfg?.pages || [];
      });
      if (data.roles?.length) {
        roles = data.roles.map((r) => ({ id: r.id, label: r.label, pages: r.pages }));
      }
      if (els.rolePermissionsMeta) {
        els.rolePermissionsMeta.textContent = data.updatedAt
          ? `Última actualización: ${new Date(data.updatedAt).toLocaleString('es-MX')}`
          : 'Usando permisos precargados (sin cambios guardados).';
      }
      renderRolePermissions();
    } catch (err) {
      els.rolePermissionsGrid.innerHTML = `<p class="admin-hint">${esc(err.message || 'No se pudieron cargar los permisos.')}</p>`;
    }
  }

  async function saveRolePermissions({ reset = false } = {}) {
    showLoading(true);
    try {
      const payload = reset
        ? { reset: true }
        : { byRole: collectRolePermissionsFromDom() };
      const res = await fetch('/api/auth/role-permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      pageCatalog = data.pages || pageCatalog;
      rolePageDefaults = data.defaults || rolePageDefaults;
      rolePagesByRole = {};
      Object.entries(data.byRole || {}).forEach(([id, cfg]) => {
        rolePagesByRole[id] = cfg?.pages || [];
      });
      if (data.roles?.length) {
        roles = data.roles.map((r) => ({ id: r.id, label: r.label, pages: r.pages }));
        fillRoleOptions(els.formRole?.value || roles[0]?.id);
      }
      if (els.rolePermissionsMeta) {
        els.rolePermissionsMeta.textContent = data.updatedAt
          ? `Última actualización: ${new Date(data.updatedAt).toLocaleString('es-MX')}`
          : 'Permisos actualizados.';
      }
      renderRolePermissions();
      showMessage(reset ? 'Permisos restablecidos a los valores precargados.' : 'Permisos por rol guardados.', 'success');
    } catch (err) {
      showMessage(err.message || 'No se pudieron guardar los permisos.', 'error');
    } finally {
      showLoading(false);
    }
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

  function formatListaPreciosMeta(data) {
    if (!data?.exists) {
      return 'Aún no hay catálogo publicado. Suba el PDF completo mensual de Planes Chevrolet.';
    }
    const parts = [];
    if (data.vigencia) parts.push(`Vigencia: ${data.vigencia}`);
    if (data.sourceFile) parts.push(`Archivo: ${data.sourceFile}`);
    if (data.stats) {
      parts.push(`${data.stats.administracion || 0} planes administración · ${data.stats.bonoTomaCuenta || 0} bono TAC · ${data.stats.modelos || data.modelos?.length || 0} modelos`);
      if (data.stats.paginasAdministracion) parts.push(`págs. admin ${data.stats.paginasAdministracion}`);
      if (data.stats.paginasBonoTomaCuenta) parts.push(`págs. bono ${data.stats.paginasBonoTomaCuenta}`);
      if (data.stats.sinModelo) parts.push(`${data.stats.sinModelo} sin modelo`);
    }
    if (data.uploadedAt || data.fileUpdatedAt) {
      parts.push(`Actualizado: ${formatDate(data.uploadedAt || data.fileUpdatedAt)}`);
    }
    if (data.uploadedBy) parts.push(`por ${data.uploadedBy}`);
    return parts.join(' · ');
  }

  async function loadListaPreciosCatalog() {
    if (!els.listaPreciosCatalogMeta) return;
    try {
      const data = await api('/auth/lista-precios/catalog');
      els.listaPreciosCatalogMeta.textContent = formatListaPreciosMeta(data);
    } catch (err) {
      els.listaPreciosCatalogMeta.textContent = err.message || 'No se pudo leer el catálogo vigente.';
    }
  }

  function syncListaPreciosFileUi() {
    const file = els.listaPreciosFile?.files?.[0];
    if (els.listaPreciosFileName) {
      els.listaPreciosFileName.textContent = file
        ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : 'Ningún archivo seleccionado';
    }
    if (els.btnUploadListaPrecios) {
      els.btnUploadListaPrecios.disabled = !file;
    }
  }

  async function uploadListaPrecios() {
    const file = els.listaPreciosFile?.files?.[0];
    if (!file) {
      showMessage('Seleccione el PDF de la lista de precios.', 'error');
      return;
    }
    if (els.listaPreciosUploadStatus) {
      els.listaPreciosUploadStatus.textContent = 'Procesando PDF… esto puede tardar unos segundos.';
    }
    showLoading(true);
    els.btnUploadListaPrecios.disabled = true;
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/auth/lista-precios/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      if (res.status === 401) {
        window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
        throw new Error('Sesión expirada');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      showMessage(`Lista publicada. Vigencia: ${data.vigencia || '—'} · ${data.stats?.administracion || 0} planes.`, 'success');
      if (els.listaPreciosUploadStatus) {
        els.listaPreciosUploadStatus.textContent = formatListaPreciosMeta({
          exists: true,
          ...data,
          modelos: data.catalog?.modelos,
        });
      }
      if (els.listaPreciosFile) els.listaPreciosFile.value = '';
      syncListaPreciosFileUi();
      await loadListaPreciosCatalog();
      await loadListaPreciosImages();
    } catch (err) {
      showMessage(err.message || 'No se pudo publicar la lista.', 'error');
      if (els.listaPreciosUploadStatus) {
        els.listaPreciosUploadStatus.textContent = err.message || 'Error al procesar el PDF.';
      }
      syncListaPreciosFileUi();
    } finally {
      showLoading(false);
    }
  }

  function syncListaPreciosImageUi() {
    const modelo = els.listaPreciosImageModelo?.value || '';
    const file = els.listaPreciosImageFile?.files?.[0];
    if (els.btnUploadListaPreciosImage) {
      els.btnUploadListaPreciosImage.disabled = !(modelo && file);
    }
  }

  function renderListaPreciosImages(modelos = []) {
    if (!els.listaPreciosImagesGrid) return;
    const withImg = modelos.filter((m) => m.imagen?.url);
    if (!withImg.length) {
      els.listaPreciosImagesGrid.innerHTML = '<p class="admin-hint">Aún no hay imágenes cargadas.</p>';
      return;
    }
    els.listaPreciosImagesGrid.innerHTML = withImg.map((m) => `
      <article class="admin-lp-image-card" data-modelo="${esc(m.modelo)}">
        <img src="${esc(m.imagen.url)}" alt="${esc(m.modelo)}" loading="lazy"/>
        <div class="admin-lp-image-meta">
          <strong>${esc(m.modelo)}</strong>
          <span>${m.imagen.uploadedAt ? formatDate(m.imagen.uploadedAt) : '—'}${m.imagen.uploadedBy ? ` · ${esc(m.imagen.uploadedBy)}` : ''}</span>
        </div>
        <button type="button" class="btn-glass btn-secondary admin-lp-image-delete" data-action="delete-lp-image" data-modelo="${esc(m.modelo)}" title="Eliminar imagen">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </article>`).join('');
  }

  async function loadListaPreciosImages() {
    if (!els.listaPreciosImageModelo && !els.listaPreciosImagesGrid) return;
    try {
      const data = await api('/auth/lista-precios/images');
      const modelos = data.modelos || [];
      const selected = els.listaPreciosImageModelo?.value || '';
      if (els.listaPreciosImageModelo) {
        els.listaPreciosImageModelo.innerHTML = `<option value="">Seleccionar modelo…</option>${
          modelos.map((m) => `<option value="${esc(m.modelo)}">${esc(m.modelo)}${m.imagen ? ' · con imagen' : ''}</option>`).join('')
        }`;
        if (selected && [...els.listaPreciosImageModelo.options].some((o) => o.value === selected)) {
          els.listaPreciosImageModelo.value = selected;
        }
      }
      if (els.listaPreciosImagesMeta) {
        els.listaPreciosImagesMeta.textContent = `${data.totalConImagen || 0} de ${modelos.length} con imagen`;
      }
      renderListaPreciosImages(modelos);
      syncListaPreciosImageUi();
    } catch (err) {
      if (els.listaPreciosImagesMeta) {
        els.listaPreciosImagesMeta.textContent = err.message || 'No se pudieron cargar las imágenes.';
      }
    }
  }

  async function uploadListaPreciosImage() {
    const modelo = els.listaPreciosImageModelo?.value || '';
    const file = els.listaPreciosImageFile?.files?.[0];
    if (!modelo || !file) {
      showMessage('Seleccione modelo e imagen.', 'error');
      return;
    }
    if (els.listaPreciosImageStatus) {
      els.listaPreciosImageStatus.textContent = `Subiendo imagen de ${modelo}…`;
    }
    showLoading(true);
    if (els.btnUploadListaPreciosImage) els.btnUploadListaPreciosImage.disabled = true;
    try {
      const body = new FormData();
      body.append('modelo', modelo);
      body.append('file', file);
      const res = await fetch('/api/auth/lista-precios/images', {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      if (res.status === 401) {
        window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
        throw new Error('Sesión expirada');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      showMessage(`Imagen de ${modelo} publicada.`, 'success');
      if (els.listaPreciosImageStatus) {
        els.listaPreciosImageStatus.textContent = `Imagen de ${modelo} actualizada.`;
      }
      if (els.listaPreciosImageFile) els.listaPreciosImageFile.value = '';
      await loadListaPreciosImages();
    } catch (err) {
      showMessage(err.message || 'No se pudo subir la imagen.', 'error');
      if (els.listaPreciosImageStatus) {
        els.listaPreciosImageStatus.textContent = err.message || 'Error al subir.';
      }
      syncListaPreciosImageUi();
    } finally {
      showLoading(false);
    }
  }

  async function deleteListaPreciosImage(modelo) {
    if (!modelo) return;
    if (!window.confirm(`¿Eliminar la imagen de ${modelo}?`)) return;
    showLoading(true);
    try {
      const res = await fetch(`/api/auth/lista-precios/images/${encodeURIComponent(modelo)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        window.location.href = `/login.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
        throw new Error('Sesión expirada');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      showMessage(`Imagen de ${modelo} eliminada.`, 'success');
      await loadListaPreciosImages();
    } catch (err) {
      showMessage(err.message || 'No se pudo eliminar la imagen.', 'error');
    } finally {
      showLoading(false);
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
  els.btnSaveRolePermissions?.addEventListener('click', () => saveRolePermissions());
  els.btnResetRolePermissions?.addEventListener('click', () => {
    if (!window.confirm('¿Restablecer los permisos de todos los roles a los valores precargados?')) return;
    saveRolePermissions({ reset: true });
  });
  els.rolePermissionsGrid?.addEventListener('click', (e) => {
    const allBtn = e.target.closest('[data-role-select-all]');
    const noneBtn = e.target.closest('[data-role-select-none]');
    const roleId = allBtn?.dataset.roleSelectAll || noneBtn?.dataset.roleSelectNone;
    if (!roleId) return;
    const selectAll = Boolean(allBtn);
    els.rolePermissionsGrid.querySelectorAll(`input[type="checkbox"][data-role-perm="${roleId}"]`).forEach((input) => {
      if (input.disabled) return;
      input.checked = selectAll;
    });
  });
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

  els.listaPreciosFile?.addEventListener('change', syncListaPreciosFileUi);
  els.btnUploadListaPrecios?.addEventListener('click', () => uploadListaPrecios());
  els.listaPreciosImageModelo?.addEventListener('change', syncListaPreciosImageUi);
  els.listaPreciosImageFile?.addEventListener('change', syncListaPreciosImageUi);
  els.btnUploadListaPreciosImage?.addEventListener('click', () => uploadListaPreciosImage());
  els.listaPreciosImagesGrid?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete-lp-image"]');
    if (!btn) return;
    deleteListaPreciosImage(btn.dataset.modelo);
  });

  els.tableBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const username = btn.dataset.username;
    if (btn.dataset.action === 'edit') openEditForm(username);
    if (btn.dataset.action === 'delete') removeUser(username);
  });

  Promise.all([
    loadUsers(),
    loadRolePermissions(),
    loadAlertPrefs(),
    loadProration(),
    loadListaPreciosCatalog(),
    loadListaPreciosImages(),
  ]);
  syncListaPreciosFileUi();
  syncListaPreciosImageUi();
})();
