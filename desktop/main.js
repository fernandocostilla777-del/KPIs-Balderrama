const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { initAutoUpdater, checkForUpdates, getUpdateStatus, downloadUpdate, installUpdate } = require('./updater');

const isDev = !app.isPackaged;
// En app empaquetada ignorar DESKTOP_* heredados del shell (p. ej. pruebas);
// en desarrollo sí permiten override.
let BACKEND_PORT = parseInt(
  (isDev ? process.env.DESKTOP_BACKEND_PORT : null) || '3000',
  10
);
let FRONTEND_PORT = parseInt(
  (isDev ? process.env.DESKTOP_FRONTEND_PORT : null) || '5173',
  10
);

let mainWindow = null;
let backendProc = null;
let frontendProc = null;
let shuttingDown = false;

function repoRoot() {
  // desktop/ is one level under monorepo root in development
  return path.resolve(__dirname, '..');
}

function resourceRoot() {
  return isDev ? repoRoot() : process.resourcesPath;
}

function backendDir() {
  return path.join(resourceRoot(), 'backend');
}

function frontendDir() {
  return path.join(resourceRoot(), 'frontend');
}

function userDataEnvPath() {
  return path.join(app.getPath('userData'), '.env');
}

function configEnvPath() {
  if (isDev) {
    return path.join(backendDir(), '.env');
  }
  return userDataEnvPath();
}

function readEnvValue(filePath, key) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const m = text.match(re);
    return m ? String(m[1] || '').trim() : '';
  } catch (_) {
    return '';
  }
}

function envLooksConfigured(filePath) {
  return Boolean(readEnvValue(filePath, 'DB_HOST'));
}

function ensureUserEnv() {
  // En desarrollo usamos backend/.env del monorepo directamente.
  if (isDev) {
    const devEnv = path.join(backendDir(), '.env');
    return fs.existsSync(devEnv) ? devEnv : null;
  }

  const dest = userDataEnvPath();
  const candidates = [
    path.join(backendDir(), '.env'),
    path.join(backendDir(), '.env.example'),
  ].filter((p) => fs.existsSync(p));

  if (!fs.existsSync(dest)) {
    const src = candidates.find((p) => envLooksConfigured(p)) || candidates[0];
    if (src) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  } else if (!envLooksConfigured(dest)) {
    // Primera instalación copió .env.example vacío: reemplazar si hay .env real empaquetado
    const better = candidates.find((p) => envLooksConfigured(p));
    if (better) {
      fs.copyFileSync(better, dest);
    }
  }

  return fs.existsSync(dest) ? dest : null;
}

function assertDbConfigured(envFile) {
  if (!envFile || envLooksConfigured(envFile)) return;
  const message =
    `Faltan credenciales SQL (DB_HOST vacío) en:\n${envFile}\n\n` +
    'Complete DB_HOST, DB_NAME, DB_USER y DB_PASSWORD, guarde el archivo y reinicie.';
  dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Configuración incompleta',
    message: 'Sin conexión a SQL Server no habrá datos',
    detail: message,
    buttons: ['Abrir carpeta de configuración', 'Continuar'],
    defaultId: 0,
  }) === 0 && shell.openPath(path.dirname(envFile));
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    // 0.0.0.0: detecta también listeners en todas las interfaces (Windows)
    server.listen(port, '0.0.0.0');
  });
}

async function isPortResponding(port) {
  const paths = [`http://127.0.0.1:${port}/api/health`, `http://127.0.0.1:${port}/`];
  for (const url of paths) {
    // eslint-disable-next-line no-await-in-loop
    if (await httpOk(url, 600)) return true;
  }
  return false;
}

async function pickPort(preferred, label) {
  for (let offset = 0; offset <= 40; offset += 1) {
    const candidate = preferred + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortResponding(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!(await portFree(candidate))) continue;
    if (offset > 0) {
      console.log(`[desktop] Puerto ${preferred} ocupado; ${label} usará ${candidate}`);
    }
    return candidate;
  }
  throw new Error(`No hay puerto libre cerca de ${preferred} para ${label}`);
}

function resolveNodeBinary() {
  const candidates = [
    process.env.npm_node_execpath,
    process.env.NODE,
    process.env.NODE_BINARY,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where.exe', ['node'], { encoding: 'utf8' });
      const first = String(out).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && fs.existsSync(first)) return first;
    } else {
      const out = execFileSync('which', ['node'], { encoding: 'utf8' }).trim();
      if (out && fs.existsSync(out)) return out;
    }
  } catch (_) {
    /* ignore */
  }

  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function nodeCommand() {
  // Preferir Node del sistema: better-sqlite3 y otros nativos están
  // compilados para Node, no para el ABI de Electron.
  const nodeBin = resolveNodeBinary();
  try {
    execFileSync(nodeBin, ['-v'], { stdio: 'ignore', windowsHide: true });
    return { cmd: nodeBin, electronAsNode: false };
  } catch (_) {
    /* fall through */
  }
  return { cmd: process.execPath, electronAsNode: true };
}

function spawnServer(label, cwd, scriptRel, envExtra = {}) {
  const { cmd, electronAsNode } = nodeCommand();
  const script = path.join(cwd, scriptRel);
  if (!fs.existsSync(script)) {
    throw new Error(`No se encontró ${script}`);
  }

  const env = {
    ...process.env,
    ...envExtra,
    HOST: '127.0.0.1',
    FORCE_COLOR: '0',
  };
  if (electronAsNode) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  const child = spawn(cmd, [script], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const prefix = `[${label}]`;
  child.stdout.on('data', (buf) => {
    const text = String(buf).trim();
    if (text) console.log(prefix, text);
  });
  child.stderr.on('data', (buf) => {
    const text = String(buf).trim();
    if (text) console.error(prefix, text);
  });
  child.on('exit', (code, signal) => {
    console.log(prefix, `exit code=${code} signal=${signal}`);
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Servicio detenido',
        `El proceso ${label} se detuvo inesperadamente (código ${code}).\nRevise la configuración SQL en:\n${userDataEnvPath()}`
      );
    }
  });

  return child;
}

function httpOk(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url, { attempts = 60, intervalMs = 500, onTick } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    if (typeof onTick === 'function') onTick(i, attempts);
    // eslint-disable-next-line no-await-in-loop
    const ok = await httpOk(url);
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function setLoadingStatus(text) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(
    `window.postMessage({ type: 'status', text: ${JSON.stringify(text)} }, '*');`,
    true
  ).catch(() => {});
}

async function startServers() {
  const envFile = ensureUserEnv();
  assertDbConfigured(envFile);
  const beDir = backendDir();
  const feDir = frontendDir();

  if (!fs.existsSync(path.join(beDir, 'server.js'))) {
    throw new Error(`Backend no encontrado en ${beDir}`);
  }
  if (!fs.existsSync(path.join(feDir, 'server.js'))) {
    throw new Error(`Frontend no encontrado en ${feDir}`);
  }

  BACKEND_PORT = await pickPort(BACKEND_PORT, 'backend');
  FRONTEND_PORT = await pickPort(FRONTEND_PORT, 'frontend');
  if (FRONTEND_PORT === BACKEND_PORT) {
    FRONTEND_PORT = await pickPort(FRONTEND_PORT + 1, 'frontend');
  }

  const sharedEnv = {
    DESKTOP_MANAGED: '1',
    PORT: String(BACKEND_PORT),
    FRONTEND_PORT: String(FRONTEND_PORT),
    FRONTEND_HOST: '127.0.0.1',
    BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    FRONTEND_URL: `http://127.0.0.1:${FRONTEND_PORT}`,
    HOST: '127.0.0.1',
  };
  if (envFile) {
    // Los servers cargan backend/.env; en app empaquetada sincronizamos desde userData.
    if (!isDev) {
      try {
        fs.copyFileSync(envFile, path.join(beDir, '.env'));
      } catch (err) {
        console.warn('No se pudo sincronizar .env al backend:', err.message);
      }
    }
  }

  setLoadingStatus(`Arrancando API (backend :${BACKEND_PORT})…`);
  backendProc = spawnServer('backend', beDir, 'server.js', {
    ...sharedEnv,
    PORT: String(BACKEND_PORT),
  });

  setLoadingStatus(`Arrancando interfaz (frontend :${FRONTEND_PORT})…`);
  frontendProc = spawnServer('frontend', feDir, 'server.js', {
    ...sharedEnv,
    FRONTEND_PORT: String(FRONTEND_PORT),
    BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
  });

  const healthUrl = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
  const uiUrl = `http://127.0.0.1:${FRONTEND_PORT}/login.html`;

  setLoadingStatus('Esperando API…');
  const apiReady = await waitForUrl(healthUrl, {
    attempts: 90,
    intervalMs: 500,
    onTick: (i, total) => setLoadingStatus(`Esperando API… (${i}/${total})`),
  });
  if (!apiReady || !backendProc || backendProc.exitCode != null) {
    const exited = backendProc && backendProc.exitCode != null
      ? ` (proceso salió con código ${backendProc.exitCode})`
      : '';
    throw new Error(
      `El backend no respondió en ${healthUrl}${exited}.\nVerifique SQL Server y el archivo .env:\n${configEnvPath()}`
    );
  }

  setLoadingStatus('Esperando interfaz…');
  const uiReady = await waitForUrl(uiUrl, {
    attempts: 60,
    intervalMs: 400,
    onTick: (i, total) => setLoadingStatus(`Esperando interfaz… (${i}/${total})`),
  });
  if (!uiReady || !frontendProc || frontendProc.exitCode != null) {
    throw new Error(`El frontend no respondió en ${uiUrl}`);
  }

  return uiUrl;
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
      }, 1500);
    }
  } catch (_) {
    /* ignore */
  }
}

function stopServers() {
  shuttingDown = true;
  killProcessTree(frontendProc);
  killProcessTree(backendProc);
  frontendProc = null;
  backendProc = null;
}

function createMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir carpeta de configuración',
          click: () => shell.openPath(app.getPath('userData')),
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'forceReload', label: 'Forzar recarga' },
        ...(isDev ? [{ role: 'toggleDevTools', label: 'DevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Buscar actualizaciones',
          click: () => checkForUpdates({ silent: false }),
        },
        {
          label: 'Acerca de',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'KPIs Balderrama',
              message: `KPIs Balderrama ${app.getVersion()}`,
              detail: `Escritorio Electron\nBackend: 127.0.0.1:${BACKEND_PORT}\nFrontend: 127.0.0.1:${FRONTEND_PORT}\nConfig: ${configEnvPath()}`,
            });
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'KPIs Balderrama',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  createMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  await mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  try {
    const uiUrl = await startServers();
    setLoadingStatus('Cargando dashboard…');
    await mainWindow.loadURL(uiUrl);
  } catch (err) {
    console.error(err);
    const message = err && err.message ? err.message : String(err);
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><body style="font-family:Segoe UI,sans-serif;background:#0f172a;color:#f8fafc;padding:40px">
        <h1>No se pudo iniciar</h1>
        <p style="white-space:pre-wrap;color:#cbd5e1">${message.replace(/</g, '&lt;')}</p>
        <p style="color:#94a3b8">Edite la configuración SQL y reinicie la aplicación.</p>
        </body></html>`
      )}`
    );
    dialog.showErrorBox('Error al iniciar', message);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);
ipcMain.handle('update:status', () => getUpdateStatus());
ipcMain.handle('update:download', () => downloadUpdate());
ipcMain.handle('update:install', () => installUpdate());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.balderrama.kpis');
    }
    createWindow();
    initAutoUpdater({ getWindow: () => mainWindow });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    stopServers();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stopServers();
  });
}
