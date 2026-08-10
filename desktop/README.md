# KPIs Balderrama — Desktop (Electron)

Aplicación de escritorio para Windows y Mac. Arranca el **backend** y el **frontend** locales y abre el dashboard en una ventana nativa.

## Requisitos

- Node.js 18+
- Dependencias del monorepo instaladas (`npm run install:all` en la raíz)
- `backend/.env` configurado (SQL Server)

## Desarrollo

Desde la raíz del repo:

```bash
npm run desktop
```

O desde esta carpeta:

```bash
npm install
npm start
```

La app:

1. Muestra una pantalla de carga
2. Inicia API en `127.0.0.1:3000` y UI en `127.0.0.1:5173`
3. Abre el login del dashboard

## Build / instaladores

```bash
# Windows (desde Windows)
npm run dist:win

# Mac (desde macOS — no funciona cross-compile fiable desde Windows)
npm run dist:mac
```

Salida en `desktop/dist/`.

### Notas de empaquetado

- Se empaquetan `backend/` y `frontend/` como `extraResources`.
- En producción los servidores se ejecutan con `ELECTRON_RUN_AS_NODE=1` (Electron actúa como Node).
- `better-sqlite3` es un módulo nativo: compile en la misma plataforma/arquitectura del instalador.
- El `.env` con secretos se incluye en builds internos hechos en esta máquina (para que SQL funcione al abrir).
  En el primer arranque también se copia a la carpeta de datos de usuario (menú **Archivo → Abrir carpeta de configuración**).
  Si `DB_HOST` está vacío, la app avisa y no habrá datos.
- Firma de código / notarización de Apple: no incluida (paso posterior si se distribuye fuera de la red interna).

## Puertos

| Variable | Default |
|----------|---------|
| `DESKTOP_BACKEND_PORT` | 3000 |
| `DESKTOP_FRONTEND_PORT` | 5173 |

Si el puerto preferido está ocupado, la app elige el siguiente libre automáticamente.
En desarrollo usa `backend/.env` del monorepo; en el instalador, el `.env` de la carpeta de datos de usuario.
