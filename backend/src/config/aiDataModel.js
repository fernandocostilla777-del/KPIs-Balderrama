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
  - UNC_FAMILIA → familia GM (útil para agrupar variantes)
- **PER_PERSONAS**: clientes (VTE_IDCLIENTE) y vendedores (VEH_VENDEDOR)

Para "¿cuántos Aveo se vendieron?":
1. Filtrar ADE_VTAFI por rango de fechas (año = YTD si no indican mes).
2. JOIN SER_VEHICULO por serie.
3. Filtrar WHERE UPPER(VEH_TIPOAUTO) LIKE '%AVEO%' (también revisar variantes en resultados).
4. Contar unidades (COUNT DISTINCT VTE_SERIE o filas de factura).

### Inventario
- SER_VEHICULO (VEH_SITUACION <> 'VEN') + VEN_DETALLE (VHD_*) para costo/plan piso.

### Post-venta
- SER_ORDEN: órdenes de servicio (ingreso, facturación, importes, asesor).

### Contabilidad / EEFF
- CON_CTAS01{AAAA}: saldos por cuenta y mes (CTA_GPOCONT, CTA_NUMCTA).
- Prefijos 0400-000N = ingreso por sucursal; 0600 = costo; 0700 = gastos operación.

### Reglas de razonamiento
- Antes de SQL ad-hoc, preferir herramientas especializadas (consultar_ventas_modelo, consultar_ventas).
- Si preguntan por modelo/marca/unidad específica → consultar_ventas_modelo.
- Si preguntan totales generales → consultar_ventas o consultar_resumen_ejecutivo.
- Explica en 1-2 frases qué tablas relacionaste y por qué.
`;

module.exports = { AI_DATA_MODEL };
