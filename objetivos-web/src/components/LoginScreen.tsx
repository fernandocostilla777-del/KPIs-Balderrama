"use client";

import { Eye, EyeOff, LogIn } from "lucide-react";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { login, type AuthUser } from "@/lib/auth";

export function LoginScreen({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      onSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-body">
      <section className="login-shell">
        <div className="login-card">
          <div className="login-brand">
            <Image
              src="/balderrama.png"
              alt="BALDERRAMA"
              width={640}
              height={116}
              className="login-logo"
              priority
            />
            <p className="login-subtitle">Objetivos y resultados</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} autoComplete="on">
            <label className="login-field">
              <span>Usuario</span>
              <input
                type="text"
                name="username"
                required
                autoComplete="username"
                placeholder="admin, direccion, gerencia…"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <label className="login-field">
              <span>Contraseña</span>
              <div className="login-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="login-submit" disabled={loading}>
              <LogIn size={18} />
              <span>{loading ? "Ingresando…" : "Ingresar"}</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
