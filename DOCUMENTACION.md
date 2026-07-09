# Documentación — Dashboard Ventas ABP

Proyecto en `Desktop\Conexion ABP` para consultar ventas de unidades en **SQL Server (GMOFARRIL)** y visualizarlas en un dashboard web.

---

## 1. Arquitectura

| Capa | Tecnología |
|---|---|
| Base de datos | SQL Server — BD `GMOFARRIL` |
| Backend | Node.js + Express |
| Frontend | HTML, CSS, JavaScript, Chart.js |
| Conexión DB | `mssql` + pool en `db.js` |
| Configuración | `.env` (credenciales y puerto) |

```
Browser → GET /api/ventas → services/ventas.js
                              ├── services/canales-venta.js
                              ├── services/sofia-entregas.js
                              └── services/ytd-comparativo.js
         ← JSON → public/js/app.js → gráficas + tablas
```

---

## 2. Configuración e inicio

### Variables (`.env`)

| Variable | Uso |
|---|---|
| `DB_HOST` | Servidor SQL |
| `DB_PORT` | Puerto (1433) |
| `DB_NAME` | `GMOFARRIL` |
| `DB_USER` / `DB_PASSWORD` | Credenciales |
| `HOST` | `0.0.0.0` |
| `PORT` | `3000` |

Plantilla: `.env.example`

### Comandos

```bash
npm install
npm run test:connection    # Prueba conexión SQL
npm start                  # Dashboard en http://localhost:3000
npm run analyze:tables     # Análisis de 4,541 tablas
node analyze-sofia.js      # Reporte SOFIA
```

---

## 3. API REST

### `GET /api/health`

Estado del servicio.

**Respuesta:**

```json
{ "ok": true, "service": "dashboard-ventas-abp" }
```

### `GET /api/ventas?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD`

Consulta principal del dashboard.

**Respuesta:**

| Campo | Contenido |
|---|---|
| `filtros` | Fechas consultadas |
| `resumen` | KPIs, agrupaciones, comparativo mensual |
| `comparativoYtd` | YTD año actual vs anterior |
| `registros` | Detalle de ventas |
| `entregasSofia` | Detalle notificaciones entrega SOFIA |

---

## 4. Consulta de ventas (lógica de negocio)

**Tablas principales:**

- `ADE_VTAFI` — facturas de venta
- `PER_PERSONAS` — cliente y vendedor
- `SER_VEHICULO` — unidad vendida
- `UNI_CATACOLOR` — color
- `PNC_PARAMETR` — estado del cliente

**Filtros:**

- `VTE_TIPODOCTO = 'A'`
- `VTE_STATUS = 'I'`
- `VEH_SITUACION = 'VEN'`
- Excluye `VENTAMRS`, `VTACON`
- Rango: `VTE_FECHDOCTO` (formato `dd/mm/yyyy`)

**Tipo de venta (`TIPOVENTA`):** derivado de `VTE_FORMAPAGO` (GMF, CONTADO, BBVA, FLOTILLA, etc.)

**Flotillas:** `FLOT` y `FLOTGMF` → `FLOTILLA` (separadas de retail en KPIs y tablas)

---

## 5. Departamentos / canales de venta

No vienen de `PER_DEPTO` (vacío en BD). Se calculan por **`VTE_FORMAPAGO`**:

| Canal | Formas de pago |
|---|---|
| Piso | `PISO*`, `CRE`, `PLNCON`, `INT`, `CON`, `SNPCON`, `SNPCRE` |
| Foráneos | `FOR*` |
| Cholula | `CH*` |
| Zacatelco | `ZAC*` |
| Casa | `CASA*` |
| Suauto | `SUAGMF`, `CXCSUA*`, `SNPSUA`, `SUA` |
| Flotillas | `FLOT`, `FLOTGMF` |

**Archivos:** `services/canales-venta.js`, `public/js/canales.js` (fallback en frontend)

---

## 6. Dashboard web — componentes

### Filtros de fecha

- Fecha inicio / fin
- Presets: mes actual, mes anterior, últimos 30 días, acumulado del año, año completo

### KPIs

| KPI | Descripción |
|---|---|
| Total ventas | Unidades en el periodo |
| Ventas retail | Sin flotillas |
| Flotillas | `FLOT` / `FLOTGMF` |
| Vendedores | Vendedores distintos |
| Notif. entrega SOFIA | Entregas exitosas por **fecha de factura** |

### Gráficas activas

| Gráfica | Cuándo aparece |
|---|---|
| Ventas por departamento | Siempre |
| Top vendedores | Siempre |
| Comparativo mensual (total, flotillas vs retail, tipo retail, canal, vendedores, SOFIA) | Acumulado anual (≥2 meses desde enero) |
| Notificaciones entrega SOFIA por mes | Acumulado anual |
| Comparativo YTD vs año anterior | Siempre (arriba de detalle ventas) |

### Gráficas eliminadas

- Ventas por día
- Retail vs flotillas (dona)
- Tipo de venta retail (dona)

### Tablas

1. **Detalle de ventas** — búsqueda + export CSV
2. **Detalle notificaciones entrega SOFIA** — búsqueda + export CSV

---

## 7. SOFIA — integración GM

### Análisis (`reporte-sofia.txt` / `.json`)

- 7 tablas `SOF_*`
- 49 parámetros en `PNC_PARAMETR`
- 101 columnas SOFIA en otras tablas

### Tabla principal: `SOF_Venta_Cancel_DEMO`

Bitácora de envíos, cancelaciones y entregas a SOFIA.

### Notificaciones de entrega (dashboard)

**Criterio:**

- `SOF_OrigenOpe = 'Entrega'`
- `SOF_Resultado = 'EXITO'`
- **Fecha del periodo:** `SOF_FechFact`, o `VTE_FECHDOCTO` si falta (misma lógica que ventas)

**Campos en tabla:** fecha factura, fecha registro, hora, factura, VIN, pedido, no. transacción, cliente, estatus, usuario.

**Ejemplo:** transacción `1596836` = entrega de factura `ANS000035092`, VIN `LSFAM2ABXTA077826`.

### IDs SOFIA relevantes

| Campo | Uso |
|---|---|
| `SOF_NoTransaccion` | Folio interno de envío (`PNC` → `FF/DOIDSOFIA`) |
| `SOF_IDSOFIA` | ID de operación en portal GM |
| `PER_IDSOFIA` | ID del cliente en SOFIA |
| `VTE_MOTIVOSOFIA` | Motivo SOFIA en factura de venta |

---

## 8. Comparativo YTD

**Servicio:** `services/ytd-comparativo.js`

| Concepto | Definición |
|---|---|
| YTD actual | 1 ene del año de `fechaFin` → `fechaFin` |
| YTD anterior | Mismo rango del año previo |
| Gráfica | Barras mensuales comparando ambos años |
| Totales | YTD actual, YTD anterior, variación % |

Usa los mismos filtros de ventas que el dashboard.

---

## 9. Estructura de archivos

```
Conexion ABP/
├── .env / .env.example / .gitignore
├── DOCUMENTACION.md           # Este archivo
├── db.js                      # Pool SQL Server
├── server.js                  # Express + API
├── package.json
├── services/
│   ├── ventas.js              # Query principal + resumen
│   ├── canales-venta.js       # Departamentos por forma de pago
│   ├── sofia-entregas.js      # Notificaciones entrega SOFIA
│   └── ytd-comparativo.js     # YTD vs año anterior
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js             # UI, gráficas, tablas
│       └── canales.js         # Fallback departamentos
├── test-connection.js
├── analyze-tables.js          # → analisis-tablas.json/.txt
├── analyze-sofia.js           # → reporte-sofia.json/.txt
├── query-ventas-junio.js      # Consulta puntual junio 2026
└── reporte-sofia.txt / .json
```

---

## 10. Scripts de utilidad

| Script | Función |
|---|---|
| `test-connection.js` | Verifica conexión a GMOFARRIL |
| `analyze-tables.js` | Inventario de 4,541 tablas (~335M registros) |
| `analyze-sofia.js` | Reporte completo SOFIA |
| `query-ventas-junio.js` | Ventas junio 2026 (consulta puntual) |

---

## 11. Pendientes / notas

| Tema | Estado |
|---|---|
| `REPSOFIA` | No existe como columna en BD; placeholder vacío en consulta original |
| `PER_DEPTO` / `PER_ROLES` | Vacíos; departamento = forma de pago |
| Reinicio servidor | Tras cambios en `services/`, ejecutar `node server.js` |
| `PER_IDSOFIA` | ID cliente en SOFIA (~17,754 personas con valor) |

---

## 12. Flujo de uso

1. Configurar `.env` con credenciales SQL
2. `npm start`
3. Abrir http://localhost:3000
4. Elegir rango de fechas → **Consultar**
5. Revisar KPIs, gráficas, YTD, tablas de ventas y SOFIA
6. Exportar CSV si se necesita

---

## 13. Dependencias npm

| Paquete | Versión | Uso |
|---|---|---|
| `express` | ^4.21.2 | Servidor web |
| `mssql` | ^11.0.1 | Cliente SQL Server |

---

*Última actualización: julio 2026*
