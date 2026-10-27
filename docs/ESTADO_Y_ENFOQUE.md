# Estado del proyecto y enfoque (corte 1 oct 2026)

Este documento reemplaza como fuente de verdad el estado de julio que aparece en `DOCUMENTACION.md` y `PLAN_PROYECTO.md`. Esos dos siguen siendo útiles para instalación, arquitectura y decisiones cerradas.

## Qué cambió desde el corte de julio

El go-live objetivo de `PLAN_PROYECTO.md` era el 24 ago 2026 y ya pasó. Después de esa fecha se agregó o cambió, entre otras cosas:

- Leads con embudo CRM y Seguimiento 360 (ficha por cliente, vendedor, cierres de taller).
- Lista de precios y fichas de modelo.
- Presupuesto próximos 12 meses y simulador.
- Alertas inteligentes con semáforo por catálogo de KPI ABP, bandeja de mensajes y asistente «Analista BALDERRAMA».
- Inicio rediseñado de Seguimiento 360 con tarjetas + gráficos (ver `PATRON_SECCION_KPI.md`).
- Pruebas automáticas de alertas (`backend/test/`).

## Discrepancias detectadas entre el mapa visual y el repositorio

| Tema | Mapa visual | Repositorio al corte |
|---|---|---|
| Proceso de Prospección (SLA de primera atención, contacto efectivo, CSI de atención, conversiones, cobertura de gestión) | Descrito en Leads | Está en este equipo (`sales.html`, `leads.js`, `crmCiclosService.js`) y aún no está publicado en GitHub. |
| `docs/guia-imagenes/` | Capturas de uso | No existe en el repo (solo `guia-uso-balderrama.html`). |
| Fichas CMI C-4, C-7, C-8 | Ocultas | Confirmado: pendiente marcado en `sales.html` y `analisisComercial.js`. |

## Enfoque recomendado (en este orden)

1. **Estabilizar lo existente antes de abrir módulos nuevos.** Publicar el trabajo local (Proceso de Prospección) y cerrar pendientes como C-4/C-7/C-8.
2. **Un solo patrón de sección.** Toda sección con solo tarjetas se reacomoda con `PATRON_SECCION_KPI.md`. Prioridad según el conteo de tarjetas sin gráfico:
   1. Inventario: autos nuevos (`#autosKpiGrid`), seminuevos (`#semiKpiGrid`) y postventa (`#kpiPostventaOverview`).
   2. Ventas: resultado del periodo.
   3. Seguimiento 360: acumulado por vendedor.
   4. Contabilidad: EEFF ventas y comparativa.
3. **Proteger las alertas.** Mantener verde `npm test --prefix backend` y agregar una prueba por cada alerta nueva.
4. **Congelar frentes secundarios.** `cloud-api`, `desktop`, `mobile-app` y `objetivos-web` se mantienen solo con correcciones hasta cerrar los puntos 1 a 3.
5. **Deuda de frontend.** `css/dashboard.css` (casi 19,000 líneas) y `inventory.js` (casi 5,000) son los archivos que más encarecen cada cambio. No se refactorizan de golpe. Regla: al tocar una sección, extraer su CSS y JS a un archivo propio.

## Riesgos conocidos

- **Alertas que compiten por tarjeta.** Dos alertas con el mismo `kpiId` muestran solo la de mayor severidad. Hoy comparten tarjeta `psPromesasVencidas` (PostVenta) y `kOrdenes` (Seguimiento 360, vista cliente). Aceptable, pero hay que tenerlo presente al agregar más.
- **Coherencia de ids.** Una alerta con un `kpiId` sin tarjeta se calcula pero nunca se ve. La prueba `contrato-kpiid.test.js` lo detecta. Al introducir esta prueba se corrigieron 5 casos (4 en PostVenta y 1 en Seguimiento 360).
- **Sin pruebas de pantalla.** Las pruebas actuales cubren el backend. Una prueba de navegador por módulo queda como siguiente paso.
