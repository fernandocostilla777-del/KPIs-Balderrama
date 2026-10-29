#!/usr/bin/env node
/**
 * Prepara binarios nativos win32-x64 en backend/node_modules (desde macOS),
 * corre el comando hijo (p. ej. electron-builder --win) y restaura Darwin.
 *
 * Motivo: el .exe empaquetado desde Mac incluía better-sqlite3 Mach-O y el
 * backend salía con código 1 en Windows al require('better-sqlite3').
 */
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const BACKEND = path.join(ROOT, 'backend');
const SQLITE = path.join(BACKEND, 'node_modules', 'better-sqlite3');
const SQLITE_NODE = path.join(SQLITE, 'build', 'Release', 'better_sqlite3.node');
const CANVAS_WIN = path.join(BACKEND, 'node_modules', '@napi-rs', 'canvas-win32-x64-msvc');
const NODE_TARGET = process.version.replace(/^v/, '');
const CHILD_ARGS = process.argv.slice(2);

function log(...args) {
  console.log('[with-win-natives]', ...args);
}

function fileType(filePath) {
  try {
    return execFileSync('file', ['-b', filePath], { encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function installSqliteWin() {
  if (!fs.existsSync(SQLITE)) {
    throw new Error(`No existe ${SQLITE}. Corre npm install en backend.`);
  }
  log(`Instalando better-sqlite3 win32-x64 (Node ${NODE_TARGET})…`);
  const r = spawnSync(
    process.execPath,
    [
      path.join(BACKEND, 'node_modules', 'prebuild-install', 'bin.js'),
      '--platform',
      'win32',
      '--arch',
      'x64',
      '--target',
      NODE_TARGET,
      '--runtime',
      'node',
    ],
    {
      cwd: SQLITE,
      env: process.env,
      stdio: 'inherit',
    }
  );
  if (r.status !== 0) {
    // Fallback: npx
    const r2 = spawnSync(
      'npx',
      [
        '--yes',
        'prebuild-install',
        '--platform',
        'win32',
        '--arch',
        'x64',
        '--target',
        NODE_TARGET,
        '--runtime',
        'node',
      ],
      { cwd: SQLITE, env: process.env, stdio: 'inherit', shell: true }
    );
    if (r2.status !== 0) {
      throw new Error('No se pudo instalar prebuild win32 de better-sqlite3');
    }
  }
  const kind = fileType(SQLITE_NODE);
  if (!/PE32\+|MS Windows|DLL/i.test(kind)) {
    throw new Error(`better-sqlite3 no es win32 tras el install: ${kind}`);
  }
  log('better-sqlite3 OK:', kind);
}

async function ensureCanvasWin() {
  const nodeFile = path.join(CANVAS_WIN, 'skia.win32-x64-msvc.node');
  if (fs.existsSync(nodeFile)) {
    log('canvas-win32-x64-msvc ya presente');
    return;
  }
  log('Descargando @napi-rs/canvas-win32-x64-msvc…');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napi-win-'));
  const tgz = path.join(tmp, 'pkg.tgz');
  const pack = spawnSync('npm', ['pack', '@napi-rs/canvas-win32-x64-msvc@0.1.80', `--pack-destination=${tmp}`], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  if (pack.status !== 0) {
    throw new Error(`npm pack canvas-win32 falló: ${pack.stderr || pack.stdout}`);
  }
  const packed = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!packed) throw new Error('npm pack no generó tgz de canvas-win32');
  ensureDir(CANVAS_WIN);
  spawnSync('tar', ['-xzf', path.join(tmp, packed), '-C', CANVAS_WIN, '--strip-components=1'], {
    stdio: 'inherit',
  });
  if (!fs.existsSync(nodeFile)) {
    throw new Error(`No quedó ${nodeFile}`);
  }
  log('canvas-win32 OK:', fileType(nodeFile));
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}

function restoreDarwinSqlite() {
  log(`Restaurando better-sqlite3 Darwin (Node ${NODE_TARGET})…`);
  const r = spawnSync(
    'npx',
    [
      '--yes',
      'prebuild-install',
      '--platform',
      'darwin',
      '--arch',
      process.arch === 'arm64' ? 'arm64' : 'x64',
      '--target',
      NODE_TARGET,
      '--runtime',
      'node',
    ],
    { cwd: SQLITE, env: process.env, stdio: 'inherit', shell: true }
  );
  if (r.status !== 0) {
    log('Aviso: restaura manualmente con: npm rebuild better-sqlite3 --prefix backend');
    return;
  }
  log('Restaurado:', fileType(SQLITE_NODE));
}

async function main() {
  if (!CHILD_ARGS.length) {
    console.error('Uso: node scripts/with-win-natives.js <comando> [args…]');
    process.exit(2);
  }

  const backup = `${SQLITE_NODE}.darwin-bak`;
  if (fs.existsSync(SQLITE_NODE)) {
    fs.copyFileSync(SQLITE_NODE, backup);
  }

  let exitCode = 1;
  try {
    installSqliteWin();
    await ensureCanvasWin();

    log('Ejecutando:', CHILD_ARGS.join(' '));
    const child = spawnSync(CHILD_ARGS[0], CHILD_ARGS.slice(1), {
      cwd: path.join(ROOT, 'desktop'),
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    exitCode = child.status == null ? 1 : child.status;
  } finally {
    if (fs.existsSync(backup)) {
      try {
        fs.copyFileSync(backup, SQLITE_NODE);
        fs.unlinkSync(backup);
        const kind = fileType(SQLITE_NODE);
        if (!/Mach-O/i.test(kind)) {
          restoreDarwinSqlite();
        } else {
          log('Backup Darwin restaurado:', kind);
        }
      } catch (err) {
        log('No se pudo restaurar backup:', err.message);
        restoreDarwinSqlite();
      }
    } else {
      restoreDarwinSqlite();
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[with-win-natives]', err.message || err);
  try {
    restoreDarwinSqlite();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
