const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listUsers, findUser } = require('../auth/userStore');
const { getRole } = require('../auth/roles');

const MESSAGES_FILE = path.join(__dirname, '../../data/messages.json');

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = 'msg') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function loadStore() {
  try {
    if (!fs.existsSync(MESSAGES_FILE)) {
      return { messages: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.messages)) return { messages: [] };
    return parsed;
  } catch {
    return { messages: [] };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(MESSAGES_FILE), { recursive: true });
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function sanitizeSource(source = {}) {
  if (!source || typeof source !== 'object') return null;
  const kind = String(source.kind || 'manual').trim().toLowerCase();
  const allowed = new Set(['kpi_insight', 'alert', 'manual']);
  return {
    kind: allowed.has(kind) ? kind : 'manual',
    module: source.module ? String(source.module).slice(0, 64) : null,
    kpiId: source.kpiId ? String(source.kpiId).slice(0, 128) : null,
    severity: source.severity ? String(source.severity).slice(0, 32) : null,
    insightTitle: source.insightTitle ? String(source.insightTitle).slice(0, 200) : null,
    insightSummary: source.insightSummary ? String(source.insightSummary).slice(0, 500) : null,
    href: source.href ? String(source.href).slice(0, 300) : null,
  };
}

function publicMessage(msg, viewer) {
  const me = normalizeUsername(viewer);
  return {
    id: msg.id,
    type: msg.type,
    fromUsername: msg.fromUsername,
    toUsername: msg.toUsername,
    subject: msg.subject,
    body: msg.body,
    status: msg.status,
    readAt: msg.readAt || null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
    source: msg.source || null,
    resolution: msg.resolution || null,
    thread: Array.isArray(msg.thread) ? msg.thread : [],
    unreadForViewer: msg.toUsername === me && !msg.readAt,
    direction: msg.toUsername === me ? 'inbox' : 'sent',
  };
}

function listDirectory(excludeUsername) {
  const exclude = normalizeUsername(excludeUsername);
  return listUsers()
    .filter((u) => u.active !== false && u.username !== exclude)
    .map((u) => ({
      username: u.username,
      role: u.role,
      roleLabel: u.roleLabel || getRole(u.role)?.label || u.role,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function assertActiveUser(username) {
  const key = normalizeUsername(username);
  const user = findUser(key);
  if (!user || user.active === false) {
    throw Object.assign(new Error(`Usuario destino no encontrado: ${key}`), { status: 400 });
  }
  return key;
}

function createMessage({
  fromUsername,
  toUsername,
  subject,
  body,
  type = 'direct',
  source = null,
}) {
  const from = normalizeUsername(fromUsername);
  const to = assertActiveUser(toUsername);
  if (from === to) {
    throw Object.assign(new Error('No puede enviarse un mensaje a sí mismo.'), { status: 400 });
  }
  const text = String(body || '').trim();
  if (!text) {
    throw Object.assign(new Error('El mensaje no puede estar vacío.'), { status: 400 });
  }
  const subj = String(subject || '').trim() || (
    type === 'followup' ? 'Seguimiento de alerta inteligente' : 'Mensaje'
  );
  const ts = nowIso();
  const msg = {
    id: newId('msg'),
    type: type === 'followup' ? 'followup' : 'direct',
    fromUsername: from,
    toUsername: to,
    subject: subj.slice(0, 200),
    body: text.slice(0, 4000),
    status: 'open',
    readAt: null,
    createdAt: ts,
    updatedAt: ts,
    source: sanitizeSource(source),
    thread: [],
  };
  const store = loadStore();
  store.messages.unshift(msg);
  saveStore(store);
  return publicMessage(msg, from);
}

function listMessagesForUser(username, { box = 'inbox', includeDone = true } = {}) {
  const me = normalizeUsername(username);
  const store = loadStore();
  return store.messages
    .filter((m) => {
      if (box === 'sent') return m.fromUsername === me;
      if (box === 'all') return m.fromUsername === me || m.toUsername === me;
      return m.toUsername === me;
    })
    .filter((m) => includeDone || m.status !== 'done')
    .map((m) => publicMessage(m, me));
}

function countUnread(username) {
  const me = normalizeUsername(username);
  return loadStore().messages.filter((m) => m.toUsername === me && !m.readAt && m.status !== 'done').length;
}

function getMessage(id, username) {
  const me = normalizeUsername(username);
  const msg = loadStore().messages.find((m) => m.id === id);
  if (!msg) {
    throw Object.assign(new Error('Mensaje no encontrado.'), { status: 404 });
  }
  if (msg.fromUsername !== me && msg.toUsername !== me) {
    throw Object.assign(new Error('No tiene acceso a este mensaje.'), { status: 403 });
  }
  return msg;
}

function markRead(id, username) {
  const store = loadStore();
  const msg = store.messages.find((m) => m.id === id);
  if (!msg) throw Object.assign(new Error('Mensaje no encontrado.'), { status: 404 });
  const me = normalizeUsername(username);
  if (msg.toUsername !== me) {
    throw Object.assign(new Error('Solo el destinatario puede marcar como leído.'), { status: 403 });
  }
  if (!msg.readAt) {
    msg.readAt = nowIso();
    msg.updatedAt = msg.readAt;
    saveStore(store);
  }
  return publicMessage(msg, me);
}

function replyMessage(id, username, body) {
  const text = String(body || '').trim();
  if (!text) {
    throw Object.assign(new Error('La respuesta no puede estar vacía.'), { status: 400 });
  }
  const store = loadStore();
  const msg = store.messages.find((m) => m.id === id);
  if (!msg) throw Object.assign(new Error('Mensaje no encontrado.'), { status: 404 });
  const me = normalizeUsername(username);
  if (msg.fromUsername !== me && msg.toUsername !== me) {
    throw Object.assign(new Error('No tiene acceso a este mensaje.'), { status: 403 });
  }
  const reply = {
    id: newId('rpl'),
    fromUsername: me,
    body: text.slice(0, 4000),
    createdAt: nowIso(),
  };
  if (!Array.isArray(msg.thread)) msg.thread = [];
  msg.thread.push(reply);
  msg.status = 'open';
  msg.updatedAt = reply.createdAt;
  // If recipient replies, keep unread for original sender by flipping "attention"
  if (me === msg.toUsername) {
    msg.readAt = reply.createdAt;
  } else {
    msg.readAt = null;
  }
  saveStore(store);
  return publicMessage(msg, me);
}

function closeMessage(id, username, resolutionInput = {}) {
  const store = loadStore();
  const msg = store.messages.find((m) => m.id === id);
  if (!msg) throw Object.assign(new Error('Mensaje no encontrado.'), { status: 404 });
  const me = normalizeUsername(username);
  if (msg.fromUsername !== me && msg.toUsername !== me) {
    throw Object.assign(new Error('No tiene acceso a este mensaje.'), { status: 403 });
  }
  if (msg.status === 'done' && msg.resolution) {
    return publicMessage(msg, me);
  }

  const actionTaken = String(resolutionInput.actionTaken || resolutionInput.whatWasDone || '').trim();
  const period = String(resolutionInput.period || '').trim();
  const requestedBy = normalizeUsername(
    resolutionInput.requestedBy || msg.fromUsername
  ) || msg.fromUsername;

  if (!actionTaken) {
    throw Object.assign(new Error('Documente qué se realizó al cerrar el caso.'), { status: 400 });
  }
  if (!period) {
    throw Object.assign(new Error('Indique el periodo del seguimiento.'), { status: 400 });
  }

  const ts = nowIso();
  const resolution = {
    actionTaken: actionTaken.slice(0, 4000),
    period: period.slice(0, 120),
    requestedBy,
    closedBy: me,
    closedAt: ts,
  };
  msg.resolution = resolution;
  msg.status = 'done';
  msg.updatedAt = ts;
  if (msg.toUsername === me && !msg.readAt) msg.readAt = ts;

  if (!Array.isArray(msg.thread)) msg.thread = [];
  msg.thread.push({
    id: newId('cls'),
    kind: 'closure',
    fromUsername: me,
    body: [
      'Caso cerrado',
      `Solicitó el seguimiento: ${requestedBy}`,
      `Periodo: ${period}`,
      `Qué se realizó: ${actionTaken}`,
      `Cerrado por: ${me}`,
    ].join('\n'),
    createdAt: ts,
    resolution,
  });

  saveStore(store);
  return publicMessage(msg, me);
}

function messagesAsAlertItems(username) {
  return listMessagesForUser(username, { box: 'inbox', includeDone: false }).map((m) => {
    const isFollowup = m.type === 'followup' || m.source?.kind === 'kpi_insight';
    const severity = m.source?.severity === 'critical'
      ? 'high'
      : (m.source?.severity === 'warning' ? 'medium' : 'low');
    return {
      id: `msg:${m.id}`,
      type: isFollowup ? 'seguimiento' : 'mensaje',
      typeLabel: isFollowup ? 'Seguimiento' : 'Mensaje',
      category: 'Mensajería',
      severity,
      title: m.subject,
      message: `De ${m.fromUsername}: ${m.body}`,
      href: m.source?.href || null,
      messageId: m.id,
      createdAt: m.createdAt,
      readAt: m.readAt,
      status: m.status,
    };
  });
}

module.exports = {
  listDirectory,
  createMessage,
  listMessagesForUser,
  countUnread,
  getMessage,
  markRead,
  replyMessage,
  closeMessage,
  messagesAsAlertItems,
  publicMessage,
};
