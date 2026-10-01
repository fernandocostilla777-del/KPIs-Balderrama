# Strega × Seguimiento 360 — Estimados de crecimiento (DMS, ventana única 36 meses)

**Fecha de corte:** 23 sep 2026  
**Ventana de análisis:** **36 meses** — 24 sep 2023 → 23 sep 2026 (misma ventana para ventas, taller, retención, recompra y pipeline)  
**Fuente plan:** `Strega_Seguimiento360_Plan_de_consolidacion.pdf`  
**Fuente datos:** DMS `ADE_VTAFI` (entregas) + `SER_ORDEN` / `SER_FACORDEN` / `SER_ORDENDET` / `SER_ORDTOTCXP` (taller)  
**Horizonte de impacto:** año 1 post-arranque (feb 2027 – ene 2028)

> Estimados para validar con Dirección en Etapa 0. No sustituyen el diagnóstico formal del arranque.

---

## Criterios de la ventana (aplican a todo el documento)

| Concepto | Regla |
|----------|-------|
| Entregas | `ADE_VTAFI` tipo `A`, estatus `I`, forma de pago ≠ `VENTAMRS`/`VTACON`, unidad `SER_VEHICULO` situación `VEN`; fecha factura dentro de la ventana |
| Taller | `SER_ORDEN` estatus `I` (facturada) con fecha de cierre dentro de la ventana; importe = `SER_FACORDEN` → si no, `SER_ORDENDET` (subtotal + IVA) → si no, `SER_ORDTOTCXP` |
| Sub-periodos | A1 = 0–11 m (sep 25 → sep 26) · A2 = 12–23 m · A3 = 24–36 m. Los "anuales promedio" son `total 36 m ÷ 3` |
| Retención | VIN entregado en la ventana con ≥1 orden facturada ingresada >30 días después de la venta; "activo 12 m" = con orden cerrada en A1 |
| Recompra | Cliente (`VTE_IDCLIENTE`) con ≥2 entregas dentro de la ventana |
| Pipeline | Clientes según antigüedad de su **última** compra dentro de la ventana |

---

## Constantes de cálculo (DMS · 36 m)

| Constante | Valor | Cómo se obtiene | Uso |
|-----------|-------|-----------------|-----|
| Ticket promedio unidad | **$441,982** | `$2,323.1 M ÷ 5,256` entregas 36 m | Recompra y VIP |
| Importe taller anual promedio | **$85,998,941** | `$258.0 M ÷ 3` | Base de share of wallet |
| Ticket taller / VIN·año | **$10,355** | `$85,998,941 ÷ 8,305` VIN promedio por año | Retención FG |
| Parque que sale de garantía en año 1 | **1,671** VIN | Entregas A3 (24–36 m) | Denominador retención FG |
| Retención actual del parque FG | **49.4%** | 825 de 1,671 con taller en A1 | Punto de partida |
| Pipeline recompra | **1,289** clientes | Última compra hace 24–36 m | Universo de ventana |
| Contactados (meta plan 8/10) | **1,031** = `round(1,289 × 0.8)` | — | Base de conversión de recompra |

---

## Punto de partida (DMS · 36 meses · 24 sep 2023 → 23 sep 2026)

### Ventas

| Indicador | A3 (24–36 m) | A2 (12–23 m) | A1 (0–11 m) | **36 m** |
|-----------|-------------:|-------------:|------------:|---------:|
| Unidades entregadas | 1,671 | 1,764 | 1,821 | **5,256** |
| Clientes distintos | 1,470 | 1,501 | 1,593 | **4,302** |
| Monto factura | $729.0 M | $810.1 M | $784.0 M | **$2,323.1 M** |
| Ticket promedio | $436,280 | $459,214 | $430,521 | **$441,982** |

- Ritmo: **~146 unidades/mes** · **1,752 unidades/año** promedio.
- Mix forma de pago 36 m: financiado **4,180 (79.5%)** · contado **826 (15.7%)** · flotilla **248 (4.7%)** · pérdida total 2.

### Taller (órdenes facturadas)

| Indicador | A3 (24–36 m) | A2 (12–23 m) | A1 (0–11 m) | **36 m** |
|-----------|-------------:|-------------:|------------:|---------:|
| Órdenes cerradas | 17,784 | 17,240 | 17,006 | **52,030** |
| VIN distintos | 7,960 | 8,399 | 8,556 | **15,834** |
| Importe | $74.3 M | $91.5 M | $92.2 M | **$258.0 M** |
| Ticket / VIN·año | $9,331 | $10,897 | $10,776 | **$10,355** (promedio anual) |

- Promedio anual: **17,343 órdenes · 8,305 VIN · $86.0 M**.
- Órdenes por VIN en 36 m: **3.3**.

### Retención del parque entregado (mismos 5,256 VIN)

| Indicador | Valor |
|-----------|-------|
| VIN entregados en 36 m con ≥1 visita a taller (>30 d post-venta) | **3,731 / 5,256 = 71.0%** |
| Visitas de ese parque | 12,234 órdenes · **$61.1 M** (23.7% del taller 36 m) |
| VIN con ≥12 m de exposición (A2 + A3) | 3,435 |
| De esos, activos en taller en A1 | **2,098 = 61.1%** |
| VIN que salen de garantía en año 1 (A3, 24–36 m) | **1,671** |
| De esos, activos en taller en A1 | **825 = 49.4%** ← baseline retención FG |

### Recompra dentro de la ventana

| Indicador | Valor |
|-----------|-------|
| Clientes con compra en 36 m | 4,302 |
| Clientes con ≥2 compras en 36 m | **406 = 9.4%** |
| Unidades que fueron recompra | 954 (18.2% de las entregas; incluye flotillas) |
| Lapso medio entre compras (recompradores) | ~8.9 meses (sesgado por flotillas y por el recorte a 36 m) |

### Pipeline de recompra (antigüedad de la última compra)

| Cohorte | Clientes | Lectura |
|---------|---------:|---------|
| Última compra 24–36 m | **1,289** | Entran a ciclo típico de renovación (36–54 m) durante el año 1 → **ventana** |
| Última compra 12–23 m | 1,420 | Pre-ventana; calentar |
| Última compra 0–11 m | 1,593 | Recientes; retención y accesorios |

### Leads (CRM, referencia — no cubre 36 m)

El CRM sólo tiene leads desde 2025: últimos 12 m (24 sep 2025 → 23 sep 2026) **25,789** leads sin duplicados (~2,150/mes). No existe serie de 36 m; no se usa en las fórmulas.

---

## Fórmulas por objetivo

### Retención FG
`VIN extra = round(1,671 × 5%) = 84`  
`Ingreso = 84 × $10,355 = $869,820`  
(igual en los tres escenarios; viene de la meta fija +5 pp del plan)

### Recompra
`Contactados = round(1,289 × 8/10) = 1,031`  
`Unidades = round(Contactados × tasa de conversión)`  
`Ingreso = Unidades × $441,982`

| Escenario | Tasa sobre **contactados** | Unidades | Ingreso |
|-----------|----------------------------|---------:|--------:|
| Conservador | 5% | 52 | $22,983,064 |
| Base | 8% | 82 | $36,242,524 |
| Alto | 10% | 103 | $45,524,146 |

> La tasa **no** es % del pipeline (1,289). Es % de los **1,031 contactados**. Equivalente sobre pipeline: base ≈ 6.4% (82/1,289).

### Share of wallet
`Incremental = $85,998,941 × lift`

| Escenario | Lift | Incremental |
|-----------|------|------------:|
| Conservador | +5% | $4,299,947 |
| Base | +8% | $6,879,915 |
| Alto | +12% | $10,319,873 |

### VIP / diamante
`Ingreso = unidades extra × $441,982`

| Escenario | Unidades | Ingreso |
|-----------|---------:|--------:|
| Conservador | 10 | $4,419,820 |
| Base | 15 | $6,629,730 |
| Alto | 20 | $8,839,640 |

---

## Escenarios de impacto incremental (año 1)

Suma exacta de las cuatro líneas anteriores (sin redondeos intermedios):

| Escenario | Recompra | Retención FG | Share of wallet | VIP / diamante | **Total** |
|-----------|---------:|-------------:|----------------:|---------------:|----------:|
| Conservador | $22,983,064 (52 u.) | $869,820 | $4,299,947 | $4,419,820 (10 u.) | **$32,572,651** |
| **Base** | **$36,242,524 (82 u.)** | **$869,820** | **$6,879,915** | **$6,629,730 (15 u.)** | **$50,621,989** |
| Alto | $45,524,146 (103 u.) | $869,820 | $10,319,873 | $8,839,640 (20 u.) | **$65,553,479** |

Comprobación base: `$36,242,524 + $869,820 + $6,879,915 + $6,629,730 = $50,621,989 ≈ $50.6 M`.

---

## Justificación por objetivo del plan

### 1. Retención en posventa (+5 pp)

- Población: los **1,671 VIN** entregados hace 24–36 m son los que cumplen 3 años (fin de garantía típica) durante el año 1 del plan.
- Baseline DMS: **49.4%** de ellos pasó por taller en los últimos 12 m; meta del plan **+5 pp → 54.4%**.
- VIN adicionales: **84** × ticket/VIN·año **$10,355** = **$869,820**.
- Referencia: en el parque con ≥12 m de exposición la retención es 61.1%; la caída a 49.4% en la cohorte 24–36 m es exactamente la fuga que Strega×360 debe frenar.
- Cómo se produce: copiloto de servicio + WhatsApp en **franjas FEM** por carline/paquete; tarea con responsable en Strega.
- Nota: la meta de "6/10 citas con ≥1 semana de anticipación" aún no tiene baseline limpio en DMS (solo proxy ingreso→cierre); se fija en Etapa 0.

### 2. Recompra vehicular oportuna

- Universo: **1,289** clientes cuya última compra fue hace 24–36 m (durante feb 2027–ene 2028 estarán en 29–52 m, la ventana 36–54 m del plan).
- Meta de contacto del plan: **8 de cada 10** → **1,031** contactados.
- Escenario base: **8% de conversión sobre contactados** → **82 unidades** × **$441,982** = **$36.2 M** (≈ 4.7% del volumen anual promedio de 1,752).
- Justificación: prioridad alta diaria + copiloto Seminuevos/equity + identificación de lead que ya es cliente. Se modela como uplift incremental vs. recompra orgánica.
- Apoyo histórico: 9.4% de los clientes recompró dentro de la misma ventana de 36 m (406/4,302); el gap operativo está en capturar la ventana a tiempo y calentar a los 1,420 en pre-ventana (12–23 m).

### 3. Share of wallet

- Ancla: **$85,998,941** de taller facturado por año (promedio de los 3 años; el último año cerró en $92.2 M).
- Base **+8%** → **$6.88 M**.
- Justificación: campañas uno-a-uno (accesorios post-entrega, refacciones en cita, post-HyP) vs. masivas.
- Limitación: mostrador aún debe ligarse a ID/VIN (Etapa 1); el estimado usa solo taller facturado.

### 4. Fast-track VIP / clientes diamante

- Plan: contacto a cuenta clave **&lt;2 días** + copiloto de financiamiento.
- Escenario base: **15 unidades** × **$441,982** = **$6.63 M**.
- Acción Etapa 0: publicar padrón diamante (precios + preaprobación) para sustituir este proxy.

---

## Condiciones para que los números se cumplan

1. Matching cliente↔VIN **≥95%** (meta de soporte del plan).  
2. Franjas FEM por carline/paquete validadas con Posventa.  
3. Guía de toma Seminuevos acordada.  
4. Padrón diamante y reglas alta/media/baja por gerencia.  
5. Arranque operativo ene 2027 + copilotos por área a mar 2027.

---

## Próximo paso sugerido

En la reunión de arranque (28 sep / cierre Etapa 0 · 2 oct): aprobar el **escenario base ($50.6 M año 1)** como referencia, o elegir conservador ($32.6 M) / alto ($65.6 M), y encargar a System Manager el tablero de los cuatro objetivos con estos baselines DMS a 36 meses.
