# KPIs BALDERRAMA

Dashboard ejecutivo conectado a SQL Server (GMOFARRIL): ventas, contabilidad, inventario, post-venta y pronóstico.

## Requisitos

- Node.js 18+
- Acceso a SQL Server (variables en `.env`)
- Puerto **3000** libre en la red local

## Instalación

```bash
git clone https://github.com/fernandocostilla777-del/KPIs-Balderrama.git
cd KPIs-Balderrama
npm install
copy .env.example .env
```

Edite `.env` con host, base de datos y credenciales SQL.

## Ejecución

```bash
npm start
```

Abra `http://localhost:3000` (o la IP LAN que muestre la consola).

## Módulos

| Ruta | Descripción |
|------|-------------|
| `/` | Resumen ejecutivo |
| `/sales.html` | Ventas y comparativo YTD |
| `/contabilidad.html` | EEFF, VTASMEN autos nuevos, desglose diario |
| `/inventory.html` | Inventario y plan piso |
| `/post-sales.html` | Post-venta y servicio |
| `/forecast.html` | Pronóstico |

## Notas

- No suba `.env` ni `node_modules/` (ya están en `.gitignore`).
- Tras cambios en el backend, reinicie con `npm start`.
