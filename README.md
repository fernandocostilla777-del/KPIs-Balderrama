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
└── package.json      # Arranca backend + frontend juntos
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

## Ejecución

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

## Despliegue en servidor

1. Instalar dependencias: `npm run install:all`
2. Configurar `backend/.env` (BD, auth, OpenAI)
3. Ejecutar `npm start` o usar un gestor de procesos (PM2, systemd)
4. Opcional: poner nginx delante con el frontend en `/` y proxy `/api` al backend

## Notas

- No suba `.env` ni `node_modules/` (ya están en `.gitignore`).
- Tras cambios en el backend, reinicie con `npm run start:backend` o `npm start`.
- Scripts de validación: `npm run test:etl --prefix backend -- 2026-06-01 2026-06-30`
