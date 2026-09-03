export type AuthUser = {
  username: string;
  role: string;
  roleLabel?: string;
  pages?: string[];
  homePath?: string;
  canManageUsers?: boolean;
};

export function isAdministrator(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  return role === "administracion" || role === "admin" || user.canManageUsers === true;
}

const TOKEN_KEY = "balderrama_objetivos_token";
const USER_KEY = "balderrama_objetivos_user";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

function persistSession(user: AuthUser, token?: string | null) {
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const headers = new Headers(extra);
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await fetch("/backend-api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || "Usuario o contraseña incorrectos");
  }

  const user: AuthUser = data.user || {
    username: data.username,
    role: data.role,
    roleLabel: data.roleLabel,
    homePath: data.homePath,
    canManageUsers: data.canManageUsers,
  };

  if (!user?.username) {
    throw new Error("Respuesta de login inválida");
  }

  persistSession(user, data.token || null);
  return user;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch("/backend-api/auth/me", {
    credentials: "include",
    cache: "no-store",
    headers: authHeaders(),
  });
  if (response.status === 401) {
    clearSession();
    return null;
  }
  if (!response.ok) return null;
  const data = await response.json();
  const user: AuthUser = data.user || data;
  if (!user?.username) return null;
  persistSession(user, getStoredToken());
  return user;
}

export async function logout(): Promise<void> {
  try {
    await fetch("/backend-api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: authHeaders({ "Content-Type": "application/json" }),
    });
  } catch {
    // ignore network errors on logout
  } finally {
    clearSession();
  }
}
