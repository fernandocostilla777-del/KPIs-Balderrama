# Objetivos web (producción)

Dashboard de **objetivos** (facturas GMMX y entregas SOFIA) para Railway. Lee datos ya sincronizados en Cloud API; no usa SQL Server.

## Railway

En el mismo proyecto de KPIs Balderrama, crea un servicio **objetivos-web**:

| Campo | Valor |
|-------|--------|
| **Root Directory** | `objetivos-web` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

Variables:

| Variable | Valor |
|----------|--------|
| `CLOUD_API_URL` | `https://kpis-balderrama-production.up.railway.app` |
| `PORT` | lo asigna Railway |

Genera un dominio público para este servicio. El login es el mismo de la app móvil / Cloud API.

## Local

```bash
cd objetivos-web
npm install
cp .env.example .env
npm start
```

Abre http://localhost:4173
