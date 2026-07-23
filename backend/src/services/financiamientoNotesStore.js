const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NOTES_FILE = path.join(__dirname, '../../data/financiamiento-notes.json');

function loadStore() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.notes)) return parsed;
    }
  } catch {
    /* archivo corrupto o ausente */
  }
  return { notes: [] };
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true });
  fs.writeFileSync(NOTES_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function listNotes({ fechaInicio, fechaFin, factura, soloFacturas } = {}) {
  const store = loadStore();
  let notes = store.notes.slice();

  if (factura) {
    const key = String(factura).trim().toUpperCase();
    notes = notes.filter((n) => String(n.factura || '').trim().toUpperCase() === key);
  } else if (soloFacturas) {
    notes = notes.filter((n) => n.factura);
  } else {
    // Notas generales / de periodo (sin factura específica)
    notes = notes.filter((n) => !n.factura);
    if (fechaInicio && fechaFin) {
      const periodNotes = notes.filter(
        (n) => n.periodo?.fechaInicio === fechaInicio && n.periodo?.fechaFin === fechaFin
      );
      const globalNotes = notes.filter((n) => !n.periodo?.fechaInicio);
      notes = [...periodNotes, ...globalNotes];
    }
  }

  return notes.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function createNote({ text, author, fechaInicio, fechaFin, scope, factura } = {}) {
  const cleaned = String(text || '').trim();
  if (!cleaned) throw Object.assign(new Error('La nota no puede estar vacía.'), { status: 400 });
  if (cleaned.length > 4000) throw Object.assign(new Error('La nota supera el límite de 4000 caracteres.'), { status: 400 });

  const now = new Date().toISOString();
  const facturaId = factura ? String(factura).trim() : null;
  const note = {
    id: crypto.randomUUID(),
    text: cleaned,
    author: String(author || 'usuario').trim() || 'usuario',
    createdAt: now,
    updatedAt: now,
    factura: facturaId,
    periodo: facturaId || scope === 'global' || !fechaInicio || !fechaFin
      ? null
      : { fechaInicio, fechaFin },
  };

  const store = loadStore();
  store.notes.unshift(note);
  saveStore(store);
  return note;
}

function updateNote(id, { text, author } = {}) {
  const store = loadStore();
  const idx = store.notes.findIndex((n) => n.id === id);
  if (idx < 0) throw Object.assign(new Error('Nota no encontrada.'), { status: 404 });

  if (text !== undefined) {
    const cleaned = String(text || '').trim();
    if (!cleaned) throw Object.assign(new Error('La nota no puede estar vacía.'), { status: 400 });
    if (cleaned.length > 4000) throw Object.assign(new Error('La nota supera el límite de 4000 caracteres.'), { status: 400 });
    store.notes[idx].text = cleaned;
  }
  if (author) store.notes[idx].author = String(author).trim();
  store.notes[idx].updatedAt = new Date().toISOString();
  saveStore(store);
  return store.notes[idx];
}

function deleteNote(id) {
  const store = loadStore();
  const idx = store.notes.findIndex((n) => n.id === id);
  if (idx < 0) throw Object.assign(new Error('Nota no encontrada.'), { status: 404 });
  const [removed] = store.notes.splice(idx, 1);
  saveStore(store);
  return removed;
}

module.exports = {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
};
