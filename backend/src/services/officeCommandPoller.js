/**
 * Poll de comandos remotos desde la Cloud API (p. ej. botón Admin de Objetivos Web).
 * La nube no puede leer Google Sheets; la oficina ejecuta el sync y reporta el resultado.
 */
const { getCloudConfig } = require('./cloudSync/cloudSyncClient');

const POLL_MS = Math.max(5_000, Number(process.env.OFFICE_COMMAND_POLL_MS || 12_000));
const COMMAND_TYPES = ['crm-sheets-sync-full', 'crm-sheets-sync'];

const state = {
  enabled: false,
  timer: null,
  running: false,
  lastPollAt: null,
  lastError: null,
  lastCommandId: null,
};

async function fetchJson(url, { method = 'GET', apiKey, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data.error || data.detail || res.statusText || `HTTP ${res.status}`);
  }
  return data;
}

async function completeRemote(cfg, commandId, payload) {
  return fetchJson(`${cfg.baseUrl}/api/sync/office-commands/${encodeURIComponent(commandId)}/complete`, {
    method: 'POST',
    apiKey: cfg.apiKey,
    body: payload,
  });
}

async function handleCommand(cfg, command) {
  const sheetsSync = require('./crmSheetsSync');
  const fullObjetivos = command.type === 'crm-sheets-sync-full'
    || command.payload?.fullObjetivos === true;
  console.log(
    `[office-commands] Ejecutando ${command.id} (${command.type})`
    + `${fullObjetivos ? ' · FULL Objetivos Web' : ''}`,
  );
  const result = await sheetsSync.runSync({
    reason: command.payload?.reason || `remote-${command.type}`,
    fullObjetivos,
    skipCloud: command.payload?.skipCloud === true,
  });
  await completeRemote(cfg, command.id, {
    ok: !!result.ok,
    result,
    error: result.ok ? null : (result.error || result.reason || 'Sync falló'),
  });
  console.log(`[office-commands] Completado ${command.id} ok=${!!result.ok}`);
  return result;
}

async function pollOnce() {
  if (state.running) return;
  const cfg = getCloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) {
    state.enabled = false;
    return;
  }
  state.enabled = true;
  state.running = true;
  state.lastPollAt = new Date().toISOString();
  try {
    const types = encodeURIComponent(COMMAND_TYPES.join(','));
    const data = await fetchJson(
      `${cfg.baseUrl}/api/sync/office-commands/next?types=${types}`,
      { apiKey: cfg.apiKey },
    );
    state.lastError = null;
    const command = data.command;
    if (!command?.id) return;
    state.lastCommandId = command.id;
    try {
      await handleCommand(cfg, command);
    } catch (err) {
      console.error(`[office-commands] Error en ${command.id}:`, err.message);
      try {
        await completeRemote(cfg, command.id, {
          ok: false,
          error: err.message || String(err),
        });
      } catch (completeErr) {
        console.error('[office-commands] No se pudo reportar fallo:', completeErr.message);
      }
    }
  } catch (err) {
    state.lastError = err.message || String(err);
    // Silenciar errores intermitentes de red; el siguiente poll reintenta.
    if (!/ECONNREFUSED|ETIMEDOUT|fetch failed|ENOTFOUND/i.test(state.lastError)) {
      console.warn('[office-commands] Poll:', state.lastError);
    }
  } finally {
    state.running = false;
  }
}

function scheduleNext() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    await pollOnce();
    scheduleNext();
  }, POLL_MS);
}

function startPoller() {
  const disabled = ['0', 'false', 'no', 'off'].includes(
    String(process.env.OFFICE_COMMAND_POLL_ENABLED ?? 'true').trim().toLowerCase(),
  );
  if (disabled) {
    console.log('[office-commands] Desactivado (OFFICE_COMMAND_POLL_ENABLED=false)');
    return;
  }
  const cfg = getCloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) {
    console.log('[office-commands] Sin cloud sync configurado; poll remoto omitido');
    return;
  }
  console.log(`[office-commands] Poll cada ${Math.round(POLL_MS / 1000)}s → ${cfg.baseUrl}`);
  // Primera pasada pronto para que el botón admin no espere el intervalo completo.
  setTimeout(() => {
    pollOnce().finally(scheduleNext);
  }, 2_000);
}

function getStatus() {
  return {
    enabled: state.enabled,
    pollMs: POLL_MS,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    lastCommandId: state.lastCommandId,
    running: state.running,
  };
}

module.exports = {
  startPoller,
  pollOnce,
  getStatus,
};
