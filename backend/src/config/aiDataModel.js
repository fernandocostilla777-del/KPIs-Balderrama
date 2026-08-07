/**
 * Mapa relacional GMOFARRIL para razonamiento del asistente IA.
 * No sustituye describir_tabla; orienta joins y campos de negocio.
 */
const AI_DATA_MODEL = `
## Modelo de datos GMOFARRIL (relaciones clave)

### Ventas de autos nuevos
- **ADE_VTAFI**: factura de venta (documento tipo 'A', status 'I').
  - VTE_SERIE → unidad vendida
  - VTE_FECHDOCTO → fecha de venta (formato dd/mm/yyyy en consultas)
  - VTE_FORMAPAGO → forma de pago / canal (FLOT/FLOTGMF = flotilla)
- **SER_VEHICULO**: unidad física.
  - VEH_NUMSERIE = VTE_SERIE
  - VEH_TIPOAUTO → nombre comercial del modelo (ej. AVEO, ONIX, CAVALIER)
  - VEH_ANMODELO → clave catálogo / año modelo (código interno)
  - VEH_SITUACION = 'VEN' → ya vendida
  - VEH_VENDEDOR → PER_PERSONAS (vendedor)
- **UNI_CATALOGO**: catálogo por modelo (VEH_ANMODELO + VEH_CATALOGO)
  - UNC_FAMILIA → **carline** / familia GM (AVEO, ONIX, CAPTIVA…)
  - Versión comercial = TIPOAUTO / VEH_TIPOAUTO (paquete/trim completo)
- **PER_PERSONAS**: clientes (VTE_IDCLIENTE) y vendedores (VEH_VENDEDOR)

Para "¿cuántos Aveo se vendieron?":
1. Filtrar ADE_VTAFI por rango de fechas (año = YTD si no indican mes).
2. JOIN SER_VEHICULO por serie.
3. Filtrar WHERE UPPER(VEH_TIPOAUTO) LIKE '%AVEO%' (también revisar variantes en resultados).
4. Contar unidades (COUNT DISTINCT VTE_SERIE o filas de factura).

### Inventario
- SER_VEHICULO (VEH_SITUACION <> 'VEN') + VEN_DETALLE (VHD_*) para costo/plan piso.

### Post-venta
- SER_ORDEN: órdenes de taller (ingreso, facturación, importes, asesor). El área se define por la **primera letra del folio** (ORE_IDORDEN):
  - **HyP**: A, F, H, J, V, Z, Ó (también I/E si el asesor es HyP: Jair, Brian/Brayan, Edel)
  - **Servicio**: C, D, G, I, K, N, O, Q, S, X, Y, Á, M, E, R
- Abiertas = estatus A/T/D/P; Facturadas = I; Canceladas = C.
- Herramienta: consultar_postventa con area=hyp|servicio y estatus=abiertas|facturadas|todas.
- **Segmentación UI HyP (chips)**:
  - **Externas** → tipo=externas → letras A, F, V, Z
  - **Internas HyP** → tipo=hyp_internas → letras J, H, Ó, I, E
  - No confundir hyp_internas con tipo=internas (I,J,Ó,M,H,O) del catálogo general de nomenclatura.

### Lista de precios (planes Chevrolet)
- Fuente: PDF mensual de planes GM parseado (Guía Administración + Bono Toma a Cuenta desde el índice del PDF).
- JSON activo + cruce con inventario DMS y fichas técnicas Excel 2026 por versión.
- En UI: **Precio de Venta GMMX** = campo MSRP del plan.
- Aveo **LT Plus** = transmisión **CVT (automática)**, no Manual.
- Herramienta: **consultar_lista_precios** (section=administracion|bono-toma-cuenta, modelo, soloConStock).
- Publicación: Admin sube el PDF; el asistente solo consulta el catálogo vigente (vigencia/fuente).

### Contabilidad / EEFF
- CON_CTAS01{AAAA}: saldos por cuenta y mes (CTA_GPOCONT, CTA_NUMCTA).
- Prefijos 0400-000N = ingreso por sucursal; 0600 = costo; 0700 = gastos operación.

### Reglas de razonamiento
- Antes de SQL ad-hoc, preferir herramientas especializadas (consultar_ventas_modelo, consultar_ventas, consultar_lista_precios).
- Si preguntan por modelo/marca/unidad específica → consultar_ventas_modelo.
- Si preguntan totales generales → consultar_ventas o consultar_resumen_ejecutivo.
- Si preguntan precio/plan/bono/stock de versión → consultar_lista_precios.
- Explica en 1-2 frases qué tablas/fuentes relacionaste y por qué.

### Seguimiento 360 (CRM Balderrama Ciclos + DMS)
- Vista **por cliente**: buscar_cliente_crm → historico_cliente_crm.
- Vista **por vendedor**: listar_vendedores_360 → resumen_vendedor_360.
- **Unidades vendidas del vendedor** = facturas ADE_VTAFI de los VIN de su cartera (no el conteo CRM de VIN como fuente primaria).
- **Promedio PVAs** = conteo de productos PVA con monto > 0 por contrato (GAP, garantía, etc.), no importe.

### Financiamiento F&I (CRM)
- Tabla **crm_financiamiento**: contratos colocados.
- **Modalidad**:
  - **Leasing / arrendamiento** → \`plan_2\` o \`especial\` contiene LEASING (también “FLOTILLA - LEASING”).
  - **Crédito** → el resto (TRADICIONAL, SUBSIDIADO, DIAMANTE, SEMINUEVO…).
- **Vendedor F&I** en rankings = campo **asesor** (no FI/AFI).
- Herramienta: **consultar_financiamiento** (default periodo = mes en curso).

### Segmento HIGH END (canal de lujo)
- **HIGH END** NO es un código de forma de pago: es el **canal/segmento de lujo** de la agencia.
- Incluye carlines: **SUBURBAN, TAHOE, CHEYENNE, TRAVERSE** (también variantes CHEYEN/CHEYENE en DMS).
- Para contar o detallar HIGH END → **consultar_ventas_modelo** con modelo="HIGH END" (o el carline puntual).
- En inventario, mismas familias/modelos en VEH_TIPOAUTO / UNC_FAMILIA.

### Utilidad por carline
- Agrupa ventas por **UNC_FAMILIA** (carline) y elige la **versión** (TIPOAUTO) con mejor utilidad.
- Reporta utilidad (promedio/total) y **margen bruto %** = utilidad / subtotal.
- Herramienta: **consultar_utilidad_carline** (default periodo = mes en curso).
`;

module.exports = { AI_DATA_MODEL };
