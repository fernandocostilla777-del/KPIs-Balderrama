# KPIs BALDERRAMA

Dashboard ejecutivo conectado a SQL Server (GMOFARRIL): ventas, contabilidad, inventario, post-venta y pronóstico.

## Estructura del proyecto

```
├── backend/          # API REST (Node.js + Express + SQL Server)
│   ├── src/          # Rutas, servicios, auth, ETL
│   ├── scripts/      # Scripts de exploración y validación
│   ├── data/         # Usuarios y datos locales
│   └── server.js     # Puerto 3000 — solo API
│
├── frontend/         # Interfaz web (HTML/CSS/JS estático)
│   ├── public/       # Páginas, estilos e imágenes
│   └── server.js     # Puerto 5173 — sirve UI y proxy /api → backend
│
├── desktop/          # App Electron (Windows / Mac)
│   ├── main.js       # Arranca backend+frontend y abre la ventana
│   └── README.md
│
├── cloud-api/        # API en la nube (PostgreSQL) — desplegar en Railway
│   └── DEPLOY_RAILWAY.md  # Guía de despliegue Railway
│
├── mobile-app/       # App móvil Ionic (Liquid Glass + Capacitor)
│   └── README.md
│
└── package.json      # Arranca backend + frontend juntos (solo local)
```

## Requisitos

- Node.js 18+
- Acceso a SQL Server (variables en `backend/.env`)
- Puertos **3000** (API) y **5173** (UI) libres en la red local

## Instalación

```bash
git clone https://github.com/fernandocostilla777-del/KPIs-Balderrama.git
cd KPIs-Balderrama
npm run install:all
copy backend\.env.example backend\.env
```

Edite `backend/.env` con host, base de datos y credenciales SQL.

Si ya tenía un `.env` en la raíz del proyecto, cópielo a `backend/.env`.

## Ejecución (navegador)

```bash
npm start
```

Esto inicia ambos servicios:

| Servicio | URL | Descripción |
|----------|-----|-------------|
| Frontend | http://localhost:5173 | Dashboard (login, páginas) |
| Backend  | http://localhost:3000/api | API REST |
| Swagger API | http://localhost:3000/api/docs | Documentación interactiva de todas las APIs |
| OpenAPI JSON | http://localhost:3000/api/openapi.json | Especificación OpenAPI 3.0 |

También puede iniciarlos por separado:

```bash
npm run start:backend   # solo API
npm run start:frontend  # solo UI
```

Abra **http://localhost:5173** (o la IP LAN que muestre la consola del frontend).

## App de escritorio (Electron)

La carpeta `desktop/` envuelve el mismo backend + frontend en una ventana nativa.

```bash
npm run install:all
npm run desktop          # desarrollo (abre la app)
npm run dist:win         # instalador Windows (.exe NSIS + portable)
npm run publish:win      # sube el .exe a Railway para actualizar PCs remotas
npm run dist:mac         # .dmg — ejecutar en un Mac (no desde Windows)
```

Requisitos adicionales:

- Mismo `backend/.env` con SQL Server accesible desde la PC
- En la app empaquetada, la configuración se copia a la carpeta de datos de usuario (menú **Archivo → Abrir carpeta de configuración**)
- El build de Mac debe hacerse en macOS; `better-sqlite3` es nativo por plataforma

Detalle: [`desktop/README.md`](./desktop/README.md).

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [`DOCUMENTACION.md`](./DOCUMENTACION.md) | Arquitectura y módulos del dashboard |
| [`DOCUMENTACION-MIGRACION.md`](./DOCUMENTACION-MIGRACION.md) | Guía para migrar a otra base de datos |
| [`cloud-api/DEPLOY_RAILWAY.md`](./cloud-api/DEPLOY_RAILWAY.md) | Despliegue cloud-api en Railway |

## Módulos

| Ruta | Descripción |
|------|-------------|
| `/login.html` | Acceso y sesión |
| `/` | Resumen ejecutivo |
| `/sales.html` | Ventas y comparativo YTD |
| `/contabilidad.html` | Catálogo KPIs + EEFF / PPTO 2026 (`?tab=eeff`) |
| `/inventory.html` | Autos nuevos (incl. apartadas SEP) y postventa |
| `/post-sales.html` | Postventa, servicio y acumulado mes curso |
| `/forecast.html` | Pronóstico (histórico gráfico = 12 meses) |
| `/assistant.html` | Asistente IA |
| `/admin.html` | Usuarios (rol administración) |

Detalle de avance, APIs y criterios de negocio: **[DOCUMENTACION.md](./DOCUMENTACION.md)**.  
Plan de fases / roadmap: **[PLAN_PROYECTO.md](./PLAN_PROYECTO.md)**.  
Usuarios piloto (semana 1): **[PILOTO_USUARIOS.md](./PILOTO_USUARIOS.md)**.  
Agenda validación EEFF/PPTO: **[AGENDA_VALIDACION.md](./AGENDA_VALIDACION.md)**.  
Checklist pre-revisión: **[CHECKLIST_REVISION.md](./CHECKLIST_REVISION.md)**.

## Despliegue en servidor (local)

Guía completa de **instalación inicial** y **actualizaciones solo con cambios**:  
**[DEPLOY_SERVIDOR.md](./DEPLOY_SERVIDOR.md)**

Resumen:

1. Instalación una vez: zip de código + datos + `backend/.env` + `npm run install:all` + `npm start`
2. Updates: generar delta con `.\scripts\pack-server-update.ps1 -Since "YYYY-MM-DD"` y descomprimir encima en el servidor
3. Opcional: nginx delante con el frontend en `/` y proxy `/api` al backend

## Despliegue en Railway (nube — solo réplica intermedia)

Guía completa: **[cloud-api/DEPLOY_RAILWAY.md](./cloud-api/DEPLOY_RAILWAY.md)**

Solo se despliega `cloud-api/` + PostgreSQL. El dashboard operativo permanece en la oficina.

## Notas

- No suba `.env` ni `node_modules/` (ya están en `.gitignore`).
- Tras cambios en el backend, reinicie con `npm run start:backend` o `npm start`.
- Scripts de validación: `npm run test:etl --prefix backend -- 2026-06-01 2026-06-30`
