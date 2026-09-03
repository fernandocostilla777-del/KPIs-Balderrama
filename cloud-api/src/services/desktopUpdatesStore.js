const fs = require('fs');
const path = require('path');

const UPDATES_DIR = process.env.DESKTOP_UPDATES_DIR
  || path.join(__dirname, '../../data/desktop-updates');

function ensureDir() {
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  return UPDATES_DIR;
}

function safeFileName(name) {
  const base = path.basename(String(name || '').trim());
  if (!base || base.includes('..')) return null;
  if (!/^[\w.\- ()]+\.(yml|yaml|exe|blockmap)$/i.test(base)) return null;
  return base;
}

function filePath(name) {
  const safe = safeFileName(name);
  if (!safe) return null;
  return path.join(ensureDir(), safe);
}

function listFiles() {
  ensureDir();
  return fs.readdirSync(UPDATES_DIR)
    .filter((name) => safeFileName(name))
    .map((name) => {
      const stat = fs.statSync(path.join(UPDATES_DIR, name));
      return {
        name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readLatestYml() {
  const ymlPath = path.join(ensureDir(), 'latest.yml');
  if (!fs.existsSync(ymlPath)) return null;
  try {
    const text = fs.readFileSync(ymlPath, 'utf8');
    const pick = (key) => {
      const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return match ? String(match[1]).trim().replace(/^['"]|['"]$/g, '') : null;
    };
    return {
      version: pick('version'),
      path: pick('path'),
      releaseDate: pick('releaseDate'),
    };
  } catch {
    return null;
  }
}

function status() {
  const latest = readLatestYml();
  return {
    ok: true,
    feed: '/desktop-updates',
    version: latest?.version || null,
    path: latest?.path || latest?.files?.[0]?.url || null,
    releaseDate: latest?.releaseDate || null,
    files: listFiles(),
  };
}

module.exports = {
  UPDATES_DIR,
  ensureDir,
  safeFileName,
  filePath,
  listFiles,
  readLatestYml,
  status,
};
