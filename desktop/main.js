const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const isDev = !app.isPackaged;
let BACKEND_PORT = parseInt(process.env.DESKTOP_BACKEND_PORT || '3000', 10);
let FRONTEND_PORT = parseInt(process.env.DESKTOP_FRONTEND_PORT || '5173', 10);

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

function ensureUserEnv() {
  // En desarrollo usamos backend/.env del monorepo directamente.
  if (isDev) {
    const devEnv = path.join(backendDir(), '.env');
    return fs.existsSync(devEnv) ? devEnv : null;
  }

  const dest = userDataEnvPath();
  if (fs.existsSync(dest)) return dest;

  const candidates = [
    path.join(backendDir(), '.env.example'),
    path.join(backendDir(), '.env'),
  ];
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      return dest;
    }
  }
  return null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort(preferred, label) {
  if (await portFree(preferred)) return preferred;
  for (let offset = 1; offset <= 40; offset += 1) {
    const candidate = preferred + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await portFree(candidate)) {
      console.log(`[desktop] Puerto ${preferred} ocupado; ${label} usará ${candidate}`);
      return candidate;
    }
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
  // Packaged: run JS with Electron binary as Node
  if (!isDev) {
    return { cmd: process.execPath, electronAsNode: true };
  }
  return { cmd: resolveNodeBinary(), electronAsNode: false };
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
  if (!apiReady) {
    throw new Error(
      `El backend no respondió en ${healthUrl}.\nVerifique SQL Server y el archivo .env:\n${configEnvPath()}`
    );
  }

  setLoadingStatus('Esperando interfaz…');
  const uiReady = await waitForUrl(uiUrl, {
    attempts: 60,
    intervalMs: 400,
    onTick: (i, total) => setLoadingStatus(`Esperando interfaz… (${i}/${total})`),
  });
  if (!uiReady) {
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

  app.whenReady().then(createWindow);

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
