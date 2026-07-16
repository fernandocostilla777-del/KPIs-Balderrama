# Agenda de validación — Semanas 2–3

**Objetivo:** obtener visto bueno escrito de **Contraloría** (EEFF) y **Gerente general** (PPTO) antes de expandir features.

**Cuándo agendar:** esta semana (14–20 jul) · **Reuniones:** 21 jul – 3 ago  
**URL piloto:** http://localhost:5173 (o URL LAN que muestre la consola)  
**Login:** ver [PILOTO_USUARIOS.md](./PILOTO_USUARIOS.md)

---

## 1. Qué debes hacer tú ahora (TI / Dirección)

1. **Invitar a Contraloría** — reunión 45–60 min entre **21 y 24 jul**.  
2. **Invitar a Gerente general** — reunión 45–60 min entre **28 jul y 31 jul** (o el mismo bloque si hay disponibilidad).  
3. **Entregar credenciales** por canal seguro (`contraloria` y `gerente.general`).  
4. Pedirles que traigan / tengan a mano el **Excel o reporte oficial** con el que contrastarán.

Al cerrar invitaciones, marca abajo:

- [ ] Invitación Contraloría enviada · fecha: ________  
- [ ] Invitación Gerente general enviada · fecha: ________  
- [ ] Credenciales entregadas  

---

## 2. Texto listo para invitación

### A) Contraloría — EEFF

**Asunto:** Validación EEFF dashboard Balderrama (21–24 jul)

Hola,

Para el piloto del dashboard KPIs Balderrama necesitamos validar el **Estado de resultados / EEFF** contra el reporte oficial.

- **Duración:** 45–60 min  
- **Usuario:** `contraloria` (te lo enviamos por separado)  
- **Ruta:** Login → Contabilidad → pestaña **EEFF**  
- **Periodos a revisar:** junio 2026 y, si alcanza, YTD julio 2026  
- **También:** prorrateo administración 2026 (Piso 38.56%, Foráneos 19.70%, etc.)

Salida esperada: visto bueno por mail o acta corta, o lista de discrepancias a corregir.

Gracias.

### B) Gerente general — PPTO

**Asunto:** Validación Real vs Presupuesto 2026 — dashboard Balderrama

Hola,

Necesitamos tu validación de la comparativa **Real vs PPTO 2026** en el dashboard.

- **Duración:** 45–60 min  
- **Usuario:** `gerente.general`  
- **Ruta:** Login → Contabilidad → **EEFF** → sección Real vs Presupuesto 2026  
- **Enfoque:** líneas críticas (ventas, gastos clave, utilidad) del periodo acordado  
- **Fuente PPTO:** archivo oficial `presupuesto-2026.xlsx`

Salida esperada: visto bueno a la comparativa o ajustes prioritarios.

Gracias.

---

## 3. Guion reunión Contraloría (45–60 min)

| Min | Actividad |
|-----|-----------|
| 0–5 | Login `contraloria`, explicar que solo ve Contabilidad/EEFF |
| 5–25 | Periodo **jun 2026**: comparar totales clave EEFF vs Excel oficial |
| 25–40 | Revisar **prorrateo admin 2026** (matriz) |
| 40–50 | Segundo periodo o YTD si hay tiempo |
| 50–60 | Capturar discrepancias + próximo paso (fix TI o aceptar diferencia) |

**Checklist en la reunión**

- [ ] Totales de ventas / costos / utilidad bruta coherentes (o documentados)  
- [ ] Postventa / menudeo entendible  
- [ ] Prorrateo 2026 aceptado o con observaciones  
- [ ] Acta / mail de resultado  

**Acta corta (copiar al cerrar)**

```
Fecha:
Participantes:
Periodos revisados:
Resultado: [ ] Visto bueno  [ ] Visto bueno con observaciones  [ ] Requiere corrección
Observaciones:
1.
2.
Firma / mail de Contraloría:
```

---

## 4. Guion reunión Gerente general (45–60 min)

| Min | Actividad |
|-----|-----------|
| 0–5 | Login `gerente.general`, ir a Contabilidad → EEFF |
| 5–20 | Mostrar **Real vs PPTO 2026** (periodo mes o YTD) |
| 20–40 | Revisar líneas críticas vs presupuesto oficial |
| 40–50 | Confirmar que el Excel PPTO cargado es el vigente |
| 50–60 | Visto bueno o lista de ajustes |

**Checklist**

- [ ] PPTO visible y del año 2026  
- [ ] Variaciones % / $ entendibles para dirección  
- [ ] Sin líneas “fantasma” o mal mapeadas críticas  
- [ ] Acta / mail de resultado  

**Acta corta**

```
Fecha:
Participantes:
Periodo / factor PPTO revisado:
Resultado: [ ] Visto bueno  [ ] Visto bueno con observaciones  [ ] Requiere corrección
Observaciones:
1.
2.
Firma / mail de Gerente general:
```

---

## 5. Material que TI prepara antes de cada reunión

| Material | Dónde |
|----------|--------|
| Usuarios y pass | [PILOTO_USUARIOS.md](./PILOTO_USUARIOS.md) |
| Servidores arriba | `npm start` → :5173 / :3000 |
| Pantalla EEFF | `/contabilidad.html?tab=eeff` |
| Matriz prorrateo | `backend/src/config/prorationMatrix.js` |
| Archivo PPTO | `backend/data/presupuesto-2026.xlsx` |
| Plan completo | [PLAN_PROYECTO.md](./PLAN_PROYECTO.md) |

**Periodos sugeridos en UI**

1. `2026-06-01` → `2026-06-30` (mes cerrado)  
2. `2026-01-01` → `2026-07-31` (YTD)  

---

## 6. Después de las reuniones

1. Pegar actas en este archivo o en carpeta de seguimiento.  
2. Abrir tickets de corrección P0 (números) antes de Semana 4.  
3. Solo con ambos Vistos buenos (o gaps no bloqueantes documentados) pasar a usabilidad Forecast + Contabilidad.
