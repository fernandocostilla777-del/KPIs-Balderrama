# Mapa visual — KPIs Balderrama

**Corte:** 1 oct 2026. Briefing para otra IA o para quien se incorpore al proyecto. No sustituye el código. Los nombres que se ven en pantalla son los de este documento; las claves internas (P-PRO, HT-PRO, C-n) no se imprimen.

> Estado real contra el repositorio y enfoque vigente: [ESTADO_Y_ENFOQUE.md](./ESTADO_Y_ENFOQUE.md). Receta para armar secciones nuevas: [PATRON_SECCION_KPI.md](./PATRON_SECCION_KPI.md).

Dashboard ejecutivo de un concesionario Chevrolet (Balderrama). HTML/CSS/JS estático, sin framework de UI. Barra lateral fija, barra superior, tarjetas KPI, tablas y gráficos. Iconos Material Symbols.

## Cómo se ve una pantalla

1. **Login** (`/login.html`): usuario y contraseña. La sesión es cookie. Si `AUTH_ENABLED=true`, el resto pide sesión.
2. **Shell común** en todas las páginas autenticadas:
   - Izquierda: sidebar (`frontend/public/js/sidebar.js`), filtrado por rol.
   - Arriba: periodo, lupa de indicadores, mensajes, notificaciones, usuario (`topbar.js`).
   - Centro: pestañas de la página y, debajo, secciones con tarjetas (`.kpi-card`) y tablas (`.data-table`).
3. La lupa busca por el texto visible del catálogo en `KPI_NAV_CATALOG` (`topbar.js`) y salta a la sección (`#id`) y, si aplica, abre la pestaña.
4. Semáforo de tarjetas: verde (cumple meta), ámbar (debajo), gris (`Sin dato`).
5. **Alertas inteligentes:** un punto de semáforo sobre la tarjeta abre una ventana flotante con análisis, recomendaciones, acción sugerida al agente y asignación de responsable (`kpi-insights.js`; reglas en `backend/src/services/intelligentInsightsService.js`).
6. **Ventanas de detalle:** al hacer clic en una tarjeta se abre su desglose (`.kpi-detail-panel`).

Local: UI en `http://127.0.0.1:5173` (proxy `/api` → backend `:3000`). `localhost:5173` puede caer en otro proyecto.

## Menú lateral

| Etiqueta | Archivo | Qué muestra |
|---|---|---|
| Resumen | `index.html` | Tablero ejecutivo. Hasta 8 espacios de KPI que el usuario acomoda. |
| Ventas | `sales.html` | 5 pestañas (abajo). |
| PostVenta | `post-sales.html` | PostVenta, Servicio, Refacciones, HyP. |
| Inventario | `inventory.html` | Autos nuevos, Cierre de unidades vendidas, Autos seminuevos, Postventa. |
| Lista de precios | `lista-precios.html` | Precios y fichas de modelo. |
| Contabilidad | `contabilidad.html` | Balance General y EEFF. El catálogo de cuentas está oculto. `/eeff.html` redirige a `?tab=eeff`. |
| Pronóstico | `forecast.html` | Pronóstico de ventas, Presupuesto próximos 12 meses, Simulador, Seguimiento PPTO 2026. |
| Seguimiento 360 | `seguimiento.html` | Cliente, VIN, vendedor, expediente y cartera. |
| Administración | `admin.html` | Usuarios y permisos por rol. |

También existe `/assistant.html` (chat) y una burbuja de IA en otras páginas.

## Ventas (`sales.html`)

Pestañas: **Ventas · Financiamiento · Leads · Afluencia · Comisiones**.

**Ventas.** Tarjetas: total, retail, flotillas, notificaciones de entrega SOFIA, carry over, cobertura. Avance de facturas GMMX y de entregas SOFIA. Ventas por departamento, antigüedad de origen, tipo de cliente, variación interanual, tomas a cuenta, mix de entregas.

Las fichas CMI de mercado y fuerza (C-4, C-7, C-8) están ocultas. El backend sigue. Para volver a mostrarlas hay que restaurar `#acMountVentasCore` en `sales.html` y el mount en `analisisComercial.js`.

**Financiamiento.** Penetración GMF / F&I / PVA.

**Leads.** Embudo CRM, reportes de campañas y el bloque **Proceso de Prospección** (ya está en este equipo; falta publicarlo en GitHub):

| Nombre en pantalla | Qué mide | Dato |
|---|---|---|
| Cumplimiento del SLA de Primera Atención | Dos tarjetas, nunca promediadas: «Cobertura de Primera Atención» y «Cumplimiento del SLA ≤10 minutos» | Cobertura sí; el SLA de 10 min no (no hay hora) |
| Contacto Efectivo del Ejecutivo | Contacto de doble vía ≤24 h | Sin dato |
| CSI de Atención al Prospecto | Calificación 10 de la llamada al prospecto | Sin dato (el CSI actual es NPS de entrega) |
| Conversión Contacto → Cita Programada | Contactados que agendan cita | Sí |
| Conversión Cita Programada → Cita Asistida | Citas con resultado que asistieron | Sí |
| Cobertura de Gestión de la Cartera Comercial Activa | Ciclos activos con acción siguiente al corte | Sí. Tabla por ejecutivo |

El enlace de cada ejecutivo abre Seguimiento 360.

**Afluencia.** Tráfico de piso y marketing vs orgánico.

**Comisiones.** Comisiones de asesores.

## Seguimiento 360 (`seguimiento.html`)

- **Inicio (sin selección):** resumen del periodo con 4 tarjetas, gráfico de top clientes por importe de taller, cobertura de ID CRM, acceso rápido para abrir un 360 y la alerta «Cierres de taller sin ID CRM».
- Búsqueda de cliente / VIN y ficha.
- **Expediente Integral del Ejecutivo de Ventas (EIEV):** cartera activa del vendedor, cobertura de gestión y lista 1 a 1. Llega con `?vendedor=&fechaFin=`.
- **Expediente Integral del Prospecto (EIP):** una fila por ciclo. Llega con `?id=` (id CRM).
- Desempeño del vendedor, clientes cerrados, top por importe.

## Inventario y PostVenta

**Inventario.** Autos nuevos: situaciones FIS, DIS, PED, PEN, SEP (apartada), DEMO, TRAN; disponibles = FIS+DIS+SEP; plan piso e intereses; antigüedad; intercambios de planta. Cierre: utilidad neta de unidades vendidas e IEMC (F-2). Seminuevos. Postventa de almacén (servicio, refacciones, HyP).

**PostVenta.** Órdenes del taller, servicio, refacciones (rotación, obsoletos, traspasos) y HyP con cuadre de órdenes.

## Contabilidad y pronóstico

**Contabilidad.** Balance general. EEFF por ventas, postventa y seminuevos, con comparativa real vs presupuesto 2026 y prorrateo de administración.

**Pronóstico.** Histórico gráfico de 12 meses más horizonte. Simulador y seguimiento del presupuesto 2026.

## Carpetas (solo lo que importa)

```
backend/                 API Express :3000
  server.js
  src/routes/            api.js, auth.js, seguimiento360.js, objetivosResultados.js
  src/services/          un servicio por dominio (ventas, inventario, eeff, crm, …)
  src/config/            catálogos, presupuesto, prorrateo, EEFF
  src/auth/              roles, sesión, usuarios
  data/                  xlsx, json, crm-ciclos.db (SQLite del CRM)
  test/                  pruebas automáticas (npm test --prefix backend)
frontend/
  server.js              :5173, estáticos + proxy /api
  public/*.html          una página por módulo del menú
  public/js/             un JS por página (sales.js, leads.js, seguimiento.js, …) + sidebar.js + topbar.js
                         + kpi-insights.js (alertas) + kpi-section.js (patrón tarjetas+gráfico)
  public/css/
cloud-api/               réplica en Railway (PostgreSQL). No es el dashboard de la oficina.
desktop/                 Electron que abre el mismo backend + frontend
mobile-app/              app Ionic
objetivos-web/           app Next aparte (objetivos). No es el dashboard.
docs/                    guías, mapa visual, estado y enfoque, patrón de sección
```

Datos vivos: SQL Server GMOFARRIL (DMS) vía `backend/src/db.js`. CRM de prospección: SQLite `backend/data/crm-ciclos.db`, alimentado por el Excel de leads. Objetivos y parte del cierre mensual se publican a la nube.

## Qué no pedirle a la otra IA con solo este archivo

Criterios de cuenta, queries y umbrales viven en `backend/src/services/` y `backend/src/config/`. `DOCUMENTACION.md` y `PLAN_PROYECTO.md` están cortados en julio 2026 y no describen Leads, Proceso de Prospección, Seguimiento 360 ni Lista de precios.
