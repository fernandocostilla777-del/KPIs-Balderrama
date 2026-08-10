/**
 * Imágenes de carlines para Lista de precios.
 * Almacenamiento local: backend/data/lista-precios-images/
 */
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '../../data/lista-precios-images');
const MANIFEST_PATH = path.join(IMAGES_DIR, 'manifest.json');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_BYTES = 5 * 1024 * 1024;

function ensureDir() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function slugModelo(modelo) {
  return String(modelo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'MODELO';
}

function extFromFile(file) {
  const name = String(file?.originalname || '').toLowerCase();
  const fromName = path.extname(name);
  if (ALLOWED_EXT.has(fromName)) return fromName === '.jpeg' ? '.jpg' : fromName;
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return null;
}

function mimeFromExt(ext) {
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function readManifest() {
  ensureDir();
  if (!fs.existsSync(MANIFEST_PATH)) return { version: 1, images: {} };
  try {
    const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (!data || typeof data !== 'object') return { version: 1, images: {} };
    return { version: 1, images: data.images || {} };
  } catch {
    return { version: 1, images: {} };
  }
}

function writeManifest(manifest) {
  ensureDir();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

function imageUrl(modelo) {
  return `/api/lista-precios/images/${encodeURIComponent(String(modelo || '').trim())}`;
}

function getImageMeta(modelo) {
  const key = String(modelo || '').trim();
  if (!key) return null;
  const manifest = readManifest();
  const entry = manifest.images[key];
  if (!entry?.file) return null;
  const abs = path.join(IMAGES_DIR, entry.file);
  if (!fs.existsSync(abs)) return null;
  return {
    modelo: key,
    url: `${imageUrl(key)}?v=${encodeURIComponent(entry.uploadedAt || entry.file)}`,
    file: entry.file,
    mime: entry.mime || mimeFromExt(path.extname(entry.file)),
    originalName: entry.originalName || null,
    uploadedAt: entry.uploadedAt || null,
    uploadedBy: entry.uploadedBy || null,
    size: entry.size || null,
  };
}

function listImages() {
  const manifest = readManifest();
  return Object.keys(manifest.images)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((modelo) => getImageMeta(modelo))
    .filter(Boolean);
}

function getImageFile(modelo) {
  const meta = getImageMeta(modelo);
  if (!meta) return null;
  return {
    ...meta,
    absolutePath: path.join(IMAGES_DIR, meta.file),
  };
}

function saveImage(modelo, file, { uploadedBy } = {}) {
  const key = String(modelo || '').trim();
  if (!key) {
    const err = new Error('Indique el modelo (carline) de la imagen.');
    err.status = 400;
    throw err;
  }
  if (!file?.buffer?.length) {
    const err = new Error('Seleccione una imagen JPG, PNG o WEBP.');
    err.status = 400;
    throw err;
  }
  if (file.buffer.length > MAX_BYTES) {
    const err = new Error('La imagen no puede superar 5 MB.');
    err.status = 400;
    throw err;
  }
  const ext = extFromFile(file);
  if (!ext) {
    const err = new Error('Formato no permitido. Use JPG, PNG o WEBP.');
    err.status = 400;
    throw err;
  }

  ensureDir();
  const slug = slugModelo(key);
  const fileName = `${slug}${ext}`;
  const abs = path.join(IMAGES_DIR, fileName);

  const manifest = readManifest();
  const prev = manifest.images[key];
  if (prev?.file && prev.file !== fileName) {
    const prevAbs = path.join(IMAGES_DIR, prev.file);
    if (fs.existsSync(prevAbs)) {
      try { fs.unlinkSync(prevAbs); } catch { /* ignore */ }
    }
  }

  fs.writeFileSync(abs, file.buffer);
  manifest.images[key] = {
    file: fileName,
    mime: mimeFromExt(ext),
    originalName: file.originalname || fileName,
    size: file.buffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: uploadedBy || null,
  };
  writeManifest(manifest);
  return getImageMeta(key);
}

function deleteImage(modelo) {
  const key = String(modelo || '').trim();
  if (!key) {
    const err = new Error('Modelo requerido.');
    err.status = 400;
    throw err;
  }
  const manifest = readManifest();
  const prev = manifest.images[key];
  if (!prev) {
    const err = new Error('No hay imagen para ese modelo.');
    err.status = 404;
    throw err;
  }
  const abs = path.join(IMAGES_DIR, prev.file);
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch { /* ignore */ }
  }
  delete manifest.images[key];
  writeManifest(manifest);
  return { ok: true, modelo: key };
}

function attachImageUrls(modelos = []) {
  return (modelos || []).map((m) => {
    const meta = getImageMeta(m.modelo);
    return {
      ...m,
      imagenUrl: meta?.url || null,
      imagen: meta
        ? {
            url: meta.url,
            uploadedAt: meta.uploadedAt,
            uploadedBy: meta.uploadedBy,
          }
        : null,
    };
  });
}

module.exports = {
  IMAGES_DIR,
  MAX_BYTES,
  listImages,
  getImageMeta,
  getImageFile,
  saveImage,
  deleteImage,
  attachImageUrls,
  imageUrl,
};
