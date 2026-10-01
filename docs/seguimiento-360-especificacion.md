# Seguimiento 360 — Especificación funcional (estado actual)

Guía para replicar en otro proyecto el módulo **Seguimiento 360** tal como funciona hoy en el dashboard Balderrama (`frontend/public/seguimiento.html` + `js/seguimiento.js`, servicio `backend/src/services/crmCiclosService.js`).

> Las secciones 1–6 describen lo que **ya está programado**. La sección 7 lista lo que está documentado como visión pero **aún no existe en código**.

---

## 1. Propósito

Expediente único del **cliente y su unidad (VIN) después de la venta**. Junta en una pantalla la historia comercial (CRM), el financiamiento, el taller y las quejas, para trabajar **retención en taller** y **recompra**. No es un embudo de prospectos nuevos (eso vive en Ventas → Leads).

---

## 2. Fuentes de datos y cómo se cruzan

| Fuente | Qué aporta | Llave de cruce |
|---|---|---|
| Google Sheets del CRM → SQLite (`crm-ciclos.db`, vía ETL) | Ciclos de venta, leads, solicitudes F&I, pruebas de manejo | ID CRM (`idContacto`) |
| Hoja "Histórico de contratos" | Contratos: plazo, enganche, aseguradora, productos adicionales (GAP, garantía extendida, OnStar, mantenimiento) | VIN |
| Hojas CSI Posventa y CSI Ventas | Quejas o incidencias | Posventa: número de orden · Ventas: VIN |
| DMS SQL Server `SER_VEHICULO` | Unidades a nombre del cliente, modelo, año | Cliente / VIN |
| DMS `ADE_VTAFI` | Factura de venta de la unidad | VIN (`VTE_SERIE`) |
| DMS `SER_ORDEN` (+ detalle) | Órdenes de taller: ingreso, cierre, asesor, importe, kilometraje | VIN |

**Regla central:** el cliente se identifica por **ID CRM** → se obtienen sus **VIN** → con los VIN se consulta el DMS (compras, taller) y los contratos.

---

## 3. Pantalla — filtros generales

- Selector de vista: **Por cliente** / **Por vendedor**.
- Periodo: fechas *Desde* / *Hasta* + accesos rápidos: mes actual, mes anterior, trimestre actual, acumulado del año, año actual, año anterior, todo el histórico.

---

## 4. Vista por cliente

### 4.1 Búsqueda

Un solo campo: **ID CRM, nombre, VIN, teléfono o correo**. Resultado en tabla: ID CRM, nombre, leads, ciclos, solicitudes, pruebas, compras, teléfono, correo, última actividad y botón para abrir el expediente.

### 4.2 Estado vacío (sin cliente abierto)

Resumen del periodo:

- Órdenes de taller cerradas, clientes, cuántos tienen ID CRM, importe de taller.
- Listado de clientes con órdenes cerradas (fecha de cierre en el rango).
- Gráficas: top 10 clientes por importe y clientes identificados en CRM.
- Cada fila abre el expediente del cliente.

### 4.3 Encabezado del expediente

Nombre, ID CRM, vendedor que atiende, teléfono, correo, fecha de primera actividad.

Etiquetas automáticas:

- Entró por lead · Solicitud F&I · Realizó prueba de manejo · Prueba → compra · Compró
- N unidades vinculadas · Cliente de taller
- Estatus de sus ciclos (`estatus: n`)
- "SQL no disponible" si falla el DMS

### 4.4 Radiografía 360

Tarjeta con la **unidad actual** (modelo, año, VIN) y 16 indicadores:

| Grupo | Indicadores |
|---|---|
| Compra | Última compra · Historial de compras (VIN distintos entre compras del CRM, contratos y facturas de venta del DMS) |
| Financiamiento | Número de contrato · Seguro del auto · Tipo de compra · Plazo contratado · Mensualidades estimadas · Saldo estimado · Valor de referencia |
| Taller | Último servicio · Kilometraje registrado (última orden) · Servicios realizados |
| Relación | Último contacto comercial · Interacciones digitales (leads y eventos por canal digital) · Quejas o incidencias (CSI) |

**Estimaciones** (la pantalla debe mostrar una nota "Cómo leer las estimaciones"):

- **Mensualidades estimadas:** meses transcurridos desde la compra, con tope en el plazo. No confirma pagos reales.
- **Saldo estimado:** `monto financiado × (1 − mensualidades estimadas ÷ plazo)`. Amortización lineal, sin intereses, pagos anticipados ni mora.
- **Valor de referencia:** monto financiado + enganche al contratar. No es un avalúo actual.
- **Unidad vigente:** la factura de venta más reciente del cliente en el DMS. El modelo, el VIN, la fecha de compra, el kilometraje y la última visita son de esa unidad (no de la compra más vieja del CRM).
- **Kilometraje:** último de la unidad vigente, tomado de su orden de taller más reciente.
- **Quejas:** CSI Posventa (orden) + CSI Ventas (VIN); el área se infiere del texto de la incidencia.

### 4.5 Tarjetas de volumen

Leads · Ciclos de venta · Unidades vinculadas (DMS) · Solicitudes F&I · Pruebas de manejo · Órdenes de servicio · **CLV promedio**.

**CLV** (dentro del periodo filtrado) = suma de:

| Componente | Origen |
|---|---|
| Venta de vehículo | Utilidad de la factura, una sola vez por número de factura (el libro de ventas a veces duplica el documento). Desde la 2.ª compra cuenta como **renovación** |
| Financiamiento | Comisión + GAP + garantía extendida + OnStar + mantenimiento |
| Accesorios | Monto de accesorios del contrato |
| Servicio | Importe de órdenes de taller no canceladas |
| Colisión | Órdenes de hojalatería y pintura (HyP) |

- Variación % contra el periodo anterior equivalente.
- Segmento:
  - **Alto valor:** CLV ≥ $100,000
  - **Medio:** CLV ≥ $40,000
  - **En riesgo:** > 365 días sin visitar taller y CLV < $40,000
  - **Bajo:** el resto

### 4.6 Interacción (ventana flotante)

Al hacer clic en cualquier indicador de la radiografía o tarjeta de volumen:

- Se abre una **ventana flotante** junto al elemento, con fondo oscurecido, con el desglose del dato.
- Se cierra con **Escape** o clic afuera.
- Botón **"Ver tabla completa"** que cierra la ventana y lleva a la tabla correspondiente.
- **No** debe desplazar la página hacia la tabla al hacer clic.

### 4.7 Historia del cliente (línea de tiempo única)

- Filtros con contador por categoría: Todo, Compras, Financiamiento, Taller, Comercial, Digital, Pruebas, Quejas CSI (solo se muestran las que tienen eventos).
- Cada evento: fecha, categoría, título, detalle, VIN.
- Una sola línea de tiempo por expediente (no duplicar).

### 4.8 Desglose por dominio

Gráficas:

- Actividad del cliente por año.
- Importe de taller por año.

Tablas:

| Tabla | Columnas |
|---|---|
| Unidades vinculadas | Serie, modelo, año, órdenes, primera visita, última visita, venta registrada en agencia (sí/no), factura |
| Compras | VIN, producto, modelo DMS, factura, fecha, vendedor, órdenes |
| Financiamiento y PVA | VIN, contrato, unidad, fecha, plazo, enganche % y monto, GAP, garantía extendida, OnStar (+ plazo), mantenimiento, aseguradora, robo parcial, plan |
| Órdenes de servicio | Orden, serie, modelo, ingreso, cierre, asesor, factura, importe (+ importe total generado) |
| Pruebas de manejo | Fecha, hora, auto de interés, tipo, VIN, ejecutivo, sucursal, km recorridos |
| Leads | Fecha, sucursal, tipo, canal, auto de interés, resultado, ejecutivo, cita |

---

## 5. Vista por vendedor

- Selector con autocompletado. Los nombres del CRM se **unifican** cuando la misma persona aparece escrita de formas distintas (p. ej. "Diana Soriano Reyes" = "SORIANO REYES DIANA PATRICIA").
- Tarjetas (cada una abre su desglose):
  - Clientes · Ciclos · Leads · Solicitudes F&I · Pruebas de manejo
  - Ventas en libro (`ADE_VTAFI`)
  - Contratos de financiamiento · Monto financiado · Plazo promedio
  - PVAs promedio por contrato
  - Retorno: clientes con compra que regresan
- Tabla de clientes del vendedor: ID CRM, cliente, leads, ciclos, solicitudes, pruebas, compras, actividades, última actividad, botón al expediente.

---

## 6. API que alimenta la pantalla

Detalle completo en [`api-seguimiento-360.md`](./api-seguimiento-360.md).

| Endpoint | Uso |
|---|---|
| `GET /api/seguimiento-360/buscar?q=` | Búsqueda |
| `GET /api/seguimiento-360/cliente/:idContacto?fechaInicio=&fechaFin=` | Expediente: `resumen`, `ficha360`, `timeline360`, `clv`, `compras`, `contratosFinanciamiento`, `ordenesServicio`, `unidadesDistribuidor`, `pruebasManejo`, `leads`, `quejasCsi` |
| `GET /api/seguimiento-360/cierres-taller?fechaInicio=&fechaFin=` | Estado vacío / clientes cerrados |
| `GET /api/seguimiento-360/vendedores` · `GET /api/seguimiento-360/vendedor?vendedor=` | Vista por vendedor |
| `GET /api/seguimiento-360/resumen?periodo=YYYY-MM` | KPIs agregados del periodo |

| Capa | Base | Auth | Alcance |
|---|---|---|---|
| Oficina | `http://localhost:3000` | Sesión dashboard (`Authorization: Bearer`) | Completo: CRM + DMS |
| Railway | `https://kpis-balderrama-production.up.railway.app` | `X-API-Key` (solo servidor a servidor) | CRM sincronizado; sin taller, CSI ni unidades (`limitacionesNube`) |

---

## 7. Pendientes (documentados, no programados)

1. **Pronóstico de próxima visita** — consumo promedio de km por carline y paquete, con las franjas de retención de planta (FEM), para estimar fecha y km de la siguiente visita.
2. **Señal Seminuevos con equity** — marcar VIN cuyo modelo/paquete busca Seminuevos y calcular equity (valor de referencia − saldo estimado) para ofrecer recompra.
3. **Clientes diamante** — sección para clientes con precios preferenciales y aprobación inmediata de financiamiento. Falta definir la fuente de la marca (lista F&I o criterio por historial).
