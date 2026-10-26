# Migración del CRM de SQLite a PostgreSQL

La base del CRM (`backend/data/crm-ciclos.db`) se queda corta por **volumen**,
**velocidad de consulta** y porque **la nube y la app móvil no pueden leer un
archivo local**. Se pasa a un PostgreSQL **en la oficina**, por etapas, con
SQLite como respaldo hasta validar cifras.

## Cómo funciona

- **Capa común:** `backend/src/db/crmStore.js`. Los servicios piden datos ahí y la
  capa decide el motor según `CRM_DB` (`sqlite` por omisión, o `postgres`).
- **Copia:** `backend/scripts/migrar-crm-a-postgres.js` lee la estructura del
  propio `.db`, carga cada tabla en `<tabla>__nuevo` y la intercambia en un solo
  paso. Mientras carga, el tablero sigue viendo los datos anteriores.
- **Verificación antes de intercambiar:** mismo número de filas y misma suma por
  columna numérica. Si no cuadra, la tabla anterior se queda intacta.
- **Texto en columnas numéricas:** SQLite lo permite y PostgreSQL no. Lo que no
  es un número limpio (`$1,200`, `N/A`) queda en NULL y se reporta por columna.
  No se «limpia» a propósito, para no mover cifras que ya se usan. Corregir esos
  datos es una decisión aparte, en el ETL.
- **Refresco:** en estas etapas los ETL siguen escribiendo en SQLite. Con
  `CRM_DB=postgres`, la sincronización programada del CRM (10:00, 16:00, 18:00 y
  19:50) vuelve a copiar a PostgreSQL al terminar cada carga.

## Avance por etapas

| Etapa | Qué | Estado |
|---|---|---|
| 1 · parche 0002 | Capa común, script de migración, refresco automático y **Comisiones F&I** | Hecho |
| 2 | Financiamiento (4 consultas), Objetivos (4) y SOFIA entregas (2) | Pendiente |
| 3 | Pagos GMF (7), Inventario (9) y Afluencia (12) | Pendiente |
| 4 | **Seguimiento 360** (`crmCiclosService`, 129 consultas). Es el más pesado y el que más gana en velocidad | Pendiente |
| 5 | Los ETL y `sync-crm-ciclos-live` escriben directo a PostgreSQL; se retira SQLite | Pendiente |
| 6 | Índices y tipos de fecha reales (hoy las fechas siguen como texto, igual que en SQLite) | Pendiente |

Cada servicio que se migra lleva una prueba que compara el resultado leyendo
SQLite contra el resultado leyendo PostgreSQL. Ver `test/crm-postgres.test.js`.

Al traducir consultas, las funciones propias de SQLite cambian:

| SQLite | PostgreSQL |
|---|---|
| `date(x)` | `x::date` o `left(x, 10)` si se compara como texto |
| `julianday(a) - julianday(b)` | `a::date - b::date` |
| `instr(a, b)` | `strpos(a, b)` |
| `printf('%02d', n)` | `lpad(n::text, 2, '0')` |
| `x GLOB 'patrón'` | `x ~ 'expresión'` |
| `group_concat(x)` | `string_agg(x, ',')` |

## Instalación en la oficina

1. Instalar PostgreSQL 16 en el servidor de la oficina (el mismo equipo del backend
   o uno en la misma red).
2. Crear un usuario y una base solo para el CRM:
   ```sql
   CREATE ROLE kpis_crm LOGIN PASSWORD '<contraseña larga>';
   CREATE DATABASE kpis_crm OWNER kpis_crm;
   ```
3. En `backend/.env`:
   ```
   CRM_PG_URL=postgresql://kpis_crm:<contraseña>@localhost:5432/kpis_crm
   ```
   Con `CRM_DB` todavía en `sqlite`.
4. Primera copia, revisando el reporte:
   ```bash
   node backend/scripts/migrar-crm-a-postgres.js
   ```
   Cada tabla debe salir `OK`. Anotar las columnas con «texto no numérico → NULL».
5. Validar: abrir Comisiones F&I con un periodo cerrado y anotar las cifras.
   Cambiar a `CRM_DB=postgres`, reiniciar el backend y comparar. Deben ser iguales.
6. Si algo no cuadra, regresar a `CRM_DB=sqlite` y reiniciar. No se pierde nada:
   SQLite sigue siendo la fuente de los ETL.

## Datos personales

PostgreSQL guarda lo mismo que SQLite: nombres, teléfonos, correos, RFC, VIN y
licencias de clientes. Por eso va **en la oficina**, con un usuario propio y sin
puerto abierto a internet. Para la nube o la app móvil se publica solo lo
necesario, por `cloudSync`, no la base completa.
