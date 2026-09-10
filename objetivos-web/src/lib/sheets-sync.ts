import { authHeaders, clearSession } from "./auth";

export type SheetsSyncPayload = {
  ok?: boolean;
  pending?: boolean;
  jobId?: string;
  status?: string;
  error?: string;
  message?: string;
  reason?: string;
  skipped?: boolean;
  cloud?: { ok?: boolean; skipped?: boolean; error?: string } | null;
  [key: string]: unknown;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJob(jobId: string): Promise<SheetsSyncPayload> {
  const response = await fetch(`/backend-api/crm/sheets-sync/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: authHeaders(),
  });
  const payload = (await response.json().catch(() => ({}))) as SheetsSyncPayload;
  if (response.status === 401) {
    clearSession();
    const err = new Error("Sesión expirada. Vuelve a iniciar sesión.");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  if (!response.ok) {
    throw new Error(payload.error || `Estado sync: ${response.status}`);
  }
  return payload;
}

/**
 * Espera a que el job remoto (oficina vía cloud) termine.
 * El POST puede devolver 202 si la oficina aún no respondió.
 */
export async function waitForSheetsSyncJob(
  jobId: string,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (status: string) => void;
  } = {},
): Promise<SheetsSyncPayload> {
  const timeoutMs = opts.timeoutMs ?? 12 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 3000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await readJob(jobId);
    const status = String(job.status || "");
    opts.onProgress?.(status);
    if (status === "done") {
      return { ok: true, jobId, ...(job.result as object || {}), status };
    }
    if (status === "failed") {
      throw new Error(job.error || "La sincronización en oficina falló.");
    }
    await sleep(intervalMs);
  }
  throw new Error(
    "La oficina no completó la sincronización a tiempo. Verifica que el backend local esté encendido.",
  );
}

export async function runSheetsSync(opts: {
  fullObjetivos?: boolean;
  onProgress?: (message: string) => void;
} = {}): Promise<SheetsSyncPayload> {
  const response = await fetch("/backend-api/crm/sheets-sync/run", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      fullObjetivos: opts.fullObjetivos === true,
      waitMs: 20_000,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as SheetsSyncPayload;

  if (response.status === 401) {
    clearSession();
    const err = new Error("Sesión expirada. Vuelve a iniciar sesión.");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  if (response.status === 403) {
    throw new Error(payload.error || "Sin permiso para actualización completa.");
  }
  if (response.status === 409 && payload.skipped) {
    const err = new Error(payload.reason || "Ya hay una sincronización en curso.");
    (err as Error & { skipped?: boolean; status?: number }).skipped = true;
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  if (response.status === 404) {
    throw new Error(
      "El endpoint de actualización no está disponible en la nube todavía. Espera el deploy o reinicia cloud-api.",
    );
  }

  if ((response.status === 202 || payload.pending) && payload.jobId) {
    opts.onProgress?.(
      "Pedido enviado a oficina. Esperando sincronización de Google Sheets…",
    );
    return waitForSheetsSyncJob(payload.jobId, {
      onProgress: (status) => {
        if (status === "claimed") {
          opts.onProgress?.("Oficina ejecutando sync CRM…");
        } else if (status === "pending") {
          opts.onProgress?.("En cola: esperando al servidor de oficina…");
        }
      },
    });
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.message || `Actualización: ${response.status}`);
  }

  if (payload.jobId && (payload.status === "pending" || payload.status === "claimed")) {
    opts.onProgress?.("Esperando al servidor de oficina…");
    return waitForSheetsSyncJob(payload.jobId, {
      onProgress: (status) => {
        if (status === "claimed") opts.onProgress?.("Oficina ejecutando sync CRM…");
      },
    });
  }

  return payload;
}
