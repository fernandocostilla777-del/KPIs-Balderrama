# Usuarios piloto — Semana 1

**Ambiente:** piloto con `AUTH_ENABLED=true`  
**Archivo de usuarios:** `backend/data/users.json` (no versionado)  
**Crear / sincronizar:** `node backend/scripts/seed-piloto-users.js`

Tras el go-live, **cambiar contraseñas** desde `/admin.html` (usuario `admin`).

---

## Matriz de acceso

| Usuario | Contraseña temporal | Rol sistema | Quién lo usa | Páginas |
|---------|---------------------|-------------|--------------|---------|
| `admin` | `Admin2026!` | Administración | TI / soporte | Todo + gestión de usuarios |
| `gerente.general` | `GgBalderrama2026!` | Dirección | **Gerente general** (valida PPTO) | Overview, ventas, forecast, inventario, contabilidad/EEFF, postventa |
| `direccion` | `Direccion2026!` | Dirección | Dirección / suplente GG | Igual que arriba |
| `contraloria` | `Contraloria2026!` | Contabilidad | **Contraloría** (valida EEFF) | Contabilidad + EEFF |
| `contabilidad` | `Conta2026!` | Contabilidad | Contabilidad operativa | Contabilidad + EEFF |
| `gerencia` | `Comercial2026!` | Gerencia comercial | Gerencia comercial | Ventas + forecast |
| `comercial` | `Comercial2026!` | Gerencia comercial | Analista comercial (piloto forecast) | Ventas + forecast |

---

## Validaciones del plan (quién entra con qué)

| Validación | Stakeholder | Usuario recomendado | Módulo |
|------------|-------------|---------------------|--------|
| EEFF + prorrateo 2026 | Contraloría | `contraloria` | Contabilidad → pestaña EEFF |
| PPTO 2026 | Gerente general | `gerente.general` | Contabilidad → EEFF (comparativa PPTO) |
| Forecast | Comercial | `gerencia` o `comercial` | Pronóstico |
| Contabilidad operativa | Contabilidad | `contabilidad` | Contabilidad (catálogo + EEFF) |

---

## Checklist Semana 1

- [x] Confirmar auth activo en piloto (API: `Auth: activado`)
- [x] Ejecutar `node backend/scripts/seed-piloto-users.js` (7 usuarios)
- [x] Probar login API `contraloria` + `gerente.general`
- [x] Verificar UI `contraloria` → solo Contabilidad / EEFF
- [ ] Verificar UI `gerente.general` (manual; automatización de pass bloqueada)
- [ ] Verificar UI `gerencia` / `comercial` → solo Ventas y Pronóstico
- [ ] Entregar credenciales por canal seguro
- [ ] Agendar revisiones → ver **[AGENDA_VALIDACION.md](./AGENDA_VALIDACION.md)**

---

## Notas

- Si ya existe `users.json`, el script **actualiza** contraseñas y roles de los usuarios piloto sin borrar otros.
- Roles del código: `administracion` | `direccion` | `gerencia_comercial` | `contabilidad` (`backend/src/auth/roles.js`).
- No hay rol “contraloría” aparte: usa el rol **contabilidad** (acceso a `/contabilidad` y `/eeff`).
- Contraseñas de este documento son **solo para piloto**; rotar antes de producción (semana 6).
