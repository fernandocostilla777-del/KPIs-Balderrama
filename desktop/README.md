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
# Desde la raíz del monorepo (recomendado)
npm run install:all
npm run dist:mac          # DMG + ZIP arm64 (Apple Silicon)

# O desde desktop/
cd desktop
npm install
npm run dist:mac          # arm64
npm run dist:mac:x64      # Intel (opcional)
npm run dist:mac:universal # arm64+x64 (más lento)
```

**Windows** (desde Windows):

```bash
npm run dist:win
```

Salida en `desktop/dist/`.

### Requisitos Mac

| Requisito | Notas |
|-----------|--------|
| macOS + Node.js 18+ | La app empaquetada usa el `node` del sistema para backend/frontend (`better-sqlite3`) |
| Apple Silicon | Build por defecto: **arm64** |
| Firma Apple | Desactivada (`identity: null`) — Gatekeeper pedirá “Abrir de todos modos” |

### Icono

- `assets/icon.png` — 1024×1024 (stores / generico)
- `assets/icon.icns` — macOS Dock / Finder / DMG

### Notas de empaquetado

- Se empaquetan `backend/` y `frontend/` (con `node_modules`) como `extraResources`.
- En producción se intenta `node` del PATH; si no hay, cae a `ELECTRON_RUN_AS_NODE` (módulos nativos pueden fallar).
- `better-sqlite3` es nativo: compile en la misma arquitectura del instalador.
- El `.env` con secretos se incluye en builds internos hechos en esta máquina.
  En el primer arranque también se copia a la carpeta de datos de usuario (**Archivo → Abrir carpeta de configuración**).
  Si `DB_HOST` está vacío, la app avisa y no habrá datos.
- Firma / notarización de Apple: no incluida (paso posterior si se distribuye fuera).

## Puertos

| Variable | Default |
|----------|---------|
| `DESKTOP_BACKEND_PORT` | 3000 |
| `DESKTOP_FRONTEND_PORT` | 5173 |

Si el puerto preferido está ocupado, la app elige el siguiente libre automáticamente.
En desarrollo usa `backend/.env` del monorepo; en el instalador, el `.env` de la carpeta de datos de usuario.
