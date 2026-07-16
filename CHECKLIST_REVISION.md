# Checklist pre-revisión — entregables

Úsalo **antes** de la sesión con Contraloría o Gerente general. Objetivo: pantalla clara, Export CSV listo, sin jerga técnica de Excel.

---

## A. Ambiente (5 min)

- [ ] `npm start` arriba · Auth activado  
- [ ] Ctrl+F5 en Contabilidad y Pronóstico  
- [ ] Login de prueba: `contraloria` / `gerente.general` ([PILOTO_USUARIOS.md](./PILOTO_USUARIOS.md))  
- [ ] Periodo sugerido demo: `2026-01-01` → hoy (YTD) **o** mes cerrado jun 2026  

---

## B. Contabilidad / EEFF — Contraloría (10 min)

Ruta: Contabilidad → pestaña **EEFF**

| Verificación | OK |
|--------------|----|
| Subtítulos en lenguaje de negocio (sin “DIC 2025 SUMMARY”, “hoja BALANCE…”) | [ ] |
| Balance / Edo. resultados cargan sin error | [ ] |
| Prorrateo admin 2026 visible / explicable (Piso 38.56%, etc.) | [ ] |
| Pestaña **Comparativa PPTO** | [ ] |
| Subtítulo tipo: *Real vs Presupuesto 2026 · Ene–Jul · acumulado YTD* | [ ] |
| Leyenda: verde = arriba PPTO · rojo = abajo · Var.$ = Real−PPTO | [ ] |
| KPIs con dinero formateado (`$X · var. ±Y%`) | [ ] |
| Botón **Exportar CSV** descarga archivo usable para acta | [ ] |
| Si fechas ≠ 2026: alerta clara + botón “Usar acumulado 2026” | [ ] |

**Paquete a entregar en reunión:** pantalla + CSV exportado + Excel oficial de Contraloría para cruzar.

---

## C. Comparativa PPTO — Gerente general (10 min)

Misma pestaña Comparativa PPTO, usuario `gerente.general`.

| Verificación | OK |
|--------------|----|
| Entra a Contabilidad/EEFF desde menú Dirección | [ ] |
| Ve KPIs Ventas / Util. bruta / Util. operación vs PPTO | [ ] |
| Menudeo y Postventa en tablas Real/PPTO/Var. | [ ] |
| Export CSV adjunto al correo del acta | [ ] |
| Confirmar que `presupuesto-2026.xlsx` es el archivo oficial vigente | [ ] |

---

## D. Forecast — presentar limpio (5 min)

Ruta: Pronóstico (`gerencia` / `comercial` / dirección)

| Verificación | OK |
|--------------|----|
| Histórico = últimos **12 meses** + horizonte | [ ] |
| Badge MAPE: Bueno / Aceptable / Revisar | [ ] |
| Fuente: “Datos operativos (SQL)…” (no jerga ADE_VTAFI) | [ ] |
| Bloque “mapeo de campos” **colapsado** (no abrir en demo ejecutiva) | [ ] |
| Tabla de pronóstico mensual + rangos visibles | [ ] |

---

## E. Guion corto de demo (orden sugerido)

1. Login con el rol del stakeholder.  
2. Contabilidad → EEFF → periodo acordado → Consultar.  
3. Recorrer Balance / Edo. (Contraloría) o ir directo a **Comparativa PPTO** (GG).  
4. Explicar leyenda de colores en 20 segundos.  
5. Exportar CSV y dejarlo en carpeta de la reunión.  
6. (Opcional) Forecast: gráfico 12m + badge de precisión.  

---

## F. Mejoras ya aplicadas en UI (esta iteración)

1. Textos EEFF humanizados (sin nombres de hojas Excel).  
2. Subtítulo ejecutivo Real vs PPTO + leyenda de variaciones.  
3. Export CSV de comparativa (edo. financiero, menudeo, postventa).  
4. KPIs PPTO con `fmt.money` y % con signo.  
5. Forecast: MAPE con calidad; mapeo técnico en `<details>` colapsado.  

Detalle agenda: [AGENDA_VALIDACION.md](./AGENDA_VALIDACION.md) · Plan: [PLAN_PROYECTO.md](./PLAN_PROYECTO.md)
