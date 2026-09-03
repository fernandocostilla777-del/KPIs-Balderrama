const { autoUpdater } = require('electron-updater');
const { dialog, app, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_FEED_URL = 'https://kpis-balderrama-production.up.railway.app/desktop-updates';

let getMainWindow = () => null;
let checking = false;
let downloadedVersion = null;
let lastNotifiedVersion = null;
let lastStatus = null;

function feedUrlFromFile() {
  try {
    const file = path.join(app.getPath('userData'), 'update-feed.txt');
    const url = fs.readFileSync(file, 'utf8').trim();
    if (/^https?:\/\//i.test(url)) return url.replace(/\/+$/, '');
  } catch {
    /* sin override */
  }
  return '';
}

function resolveFeedUrl() {
  const fromEnv = String(process.env.DESKTOP_UPDATE_URL || '').trim().replace(/\/+$/, '');
  return fromEnv || feedUrlFromFile() || DEFAULT_FEED_URL;
}

function cmpVer(a, b) {
  const pa = String(a || '0').split(/[^\d]+/).filter(Boolean).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split(/[^\d]+/).filter(Boolean).map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = /^https:/i.test(url) ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Feed HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Tiempo de espera al consultar actualizaciones'));
    });
  });
}

function buildStatus(partial = {}) {
  const current = app.getVersion();
  const latest = partial.latest || null;
  const available = Boolean(latest && cmpVer(latest, current) > 0);
  const state = downloadedVersion && latest && downloadedVersion === latest
    ? 'ready'
    : (partial.state || (available ? 'available' : 'ok'));
  lastStatus = {
    available,
    current,
    latest,
    state,
    packaged: app.isPackaged,
    feed: resolveFeedUrl(),
    downloaded: downloadedVersion,
  };
  return lastStatus;
}

function broadcastStatus(status) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:status', status);
  }
}

function showOsNotification(status) {
  if (!status?.available || !status.latest) return;
  if (lastNotifiedVersion === status.latest) return;
  lastNotifiedVersion = status.latest;
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'KPIs Balderrama',
      body: `Hay una actualización disponible (${status.latest}). Revísela en Notificaciones.`,
    });
    n.on('click', () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send('update:open-notifications');
      }
    });
    n.show();
  } catch (err) {
    console.warn('[desktop-updater] notificación OS:', err.message);
  }
}

function notifyIfAvailable(status) {
  broadcastStatus(status);
  if (status.available) showOsNotification(status);
}

async function probeFeed() {
  const feed = resolveFeedUrl();
  const data = await fetchJson(`${feed}/status`);
  return buildStatus({ latest: data?.version || null });
}

function notifyError(err, { silent } = {}) {
  const message = err && err.message ? err.message : String(err || 'Error desconocido');
  console.error('[desktop-updater]', message);
  if (silent) return;
  const win = getMainWindow();
  dialog.showMessageBox(win || undefined, {
    type: 'error',
    title: 'Actualización',
    message: 'No se pudo buscar o instalar la actualización.',
    detail: message,
  });
}

function askToDownload(info) {
  const win = getMainWindow();
  return dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: 'Nueva versión disponible',
    message: `Hay una actualización (${info.version}).`,
    detail: 'Se descargará e instalará al reiniciar. ¿Descargar ahora?',
    buttons: ['Descargar', 'Después'],
    defaultId: 0,
    cancelId: 1,
  });
}

function askToInstall(info) {
  const win = getMainWindow();
  return dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: 'Actualización lista',
    message: `La versión ${info.version || downloadedVersion || ''} ya se descargó.`,
    detail: 'La app se cerrará un momento para instalar. Guarde su trabajo.',
    buttons: ['Reiniciar ahora', 'Más tarde'],
    defaultId: 0,
    cancelId: 1,
  });
}

async function getUpdateStatus() {
  try {
    return await probeFeed();
  } catch (err) {
    console.warn('[desktop-updater] status:', err.message);
    return lastStatus || buildStatus({});
  }
}

async function downloadUpdate() {
  const status = lastStatus || await getUpdateStatus();
  if (!status.available) {
    return { ok: false, error: 'No hay actualización pendiente.' };
  }
  if (!app.isPackaged) {
    const url = `${status.feed}/status`;
    await shell.openExternal(url);
    return {
      ok: false,
      opened: true,
      error: 'En modo desarrollo no se instala sola. Abra el canal de actualizaciones o use el instalador.',
    };
  }
  try {
    broadcastStatus(buildStatus({ latest: status.latest, state: 'downloading' }));
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    notifyError(err, { silent: false });
    return { ok: false, error: err.message };
  }
}

async function installUpdate() {
  if (!app.isPackaged) {
    return { ok: false, error: 'Las actualizaciones remotas solo aplican al instalador (.exe).' };
  }
  if (!downloadedVersion) {
    return { ok: false, error: 'Aún no se descargó la actualización.' };
  }
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
}

async function checkForUpdates({ silent = false } = {}) {
  if (checking) return lastStatus;
  checking = true;
  try {
    const status = await probeFeed();
    notifyIfAvailable(status);

    if (app.isPackaged) {
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        notifyError(err, { silent });
      }
    }

    if (!silent) {
      if (status.available) {
        const { response } = await askToDownload({ version: status.latest });
        if (response === 0) await downloadUpdate();
      } else if (!app.isPackaged) {
        dialog.showMessageBox({
          type: 'info',
          title: 'Actualización',
          message: status.latest
            ? `Versión actual ${status.current}. Canal remoto: ${status.latest}.`
            : 'Aún no hay un instalador publicado en el canal de actualizaciones.',
        });
      } else {
        dialog.showMessageBox({
          type: 'info',
          title: 'Actualización',
          message: `Ya tienes la última versión (${status.current}).`,
        });
      }
    }
    return status;
  } catch (err) {
    notifyError(err, { silent });
    return lastStatus || buildStatus({});
  } finally {
    checking = false;
  }
}

function initAutoUpdater({ getWindow }) {
  getMainWindow = typeof getWindow === 'function' ? getWindow : () => null;

  if (app.isPackaged) {
    const feed = resolveFeedUrl();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    console.log('[desktop-updater] Canal:', feed);

    autoUpdater.on('update-available', (info) => {
      const status = buildStatus({ latest: info?.version || null });
      notifyIfAvailable(status);
    });

    autoUpdater.on('update-downloaded', async (info) => {
      downloadedVersion = info?.version || null;
      const status = buildStatus({ latest: downloadedVersion, state: 'ready' });
      notifyIfAvailable(status);
      const { response } = await askToInstall(info || {});
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });

    autoUpdater.on('error', (err) => notifyError(err, { silent: true }));
  } else {
    console.log('[desktop-updater] Canal (dev):', resolveFeedUrl());
  }

  setTimeout(() => {
    checkForUpdates({ silent: true }).catch(() => {});
  }, 8000);
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  getUpdateStatus,
  downloadUpdate,
  installUpdate,
  resolveFeedUrl,
};
