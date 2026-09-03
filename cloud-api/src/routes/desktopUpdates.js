const express = require('express');
const multer = require('multer');
const path = require('path');
const { requireApiKey } = require('../middleware/apiKey');
const store = require('../services/desktopUpdatesStore');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, store.ensureDir()),
    filename: (_req, file, cb) => {
      const safe = store.safeFileName(file.originalname);
      if (!safe) return cb(new Error('Nombre de archivo no permitido'));
      cb(null, safe);
    },
  }),
  limits: { fileSize: 800 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    const ok = Boolean(store.safeFileName(file.originalname));
    cb(ok ? null : new Error('Nombre de archivo no permitido'), ok);
  },
});

router.get('/status', (_req, res) => {
  res.json(store.status());
});

router.post('/upload', requireApiKey, upload.array('files', 6), (req, res) => {
  const uploaded = (req.files || []).map((file) => ({
    name: file.filename,
    size: file.size,
  }));
  if (!uploaded.length) {
    return res.status(400).json({ ok: false, error: 'Envía uno o más archivos (latest.yml y el instalador).' });
  }
  res.json({
    ok: true,
    uploaded,
    status: store.status(),
  });
});

router.get('/:file', (req, res) => {
  const dest = store.filePath(req.params.file);
  if (!dest) return res.status(400).json({ ok: false, error: 'Archivo inválido' });
  res.sendFile(path.resolve(dest), (err) => {
    if (!err) return;
    if (err.code === 'ENOENT') return res.status(404).json({ ok: false, error: 'Archivo no publicado' });
    res.status(500).json({ ok: false, error: 'No se pudo servir el archivo' });
  });
});

module.exports = router;
