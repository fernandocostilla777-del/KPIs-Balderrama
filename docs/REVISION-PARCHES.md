# Revisión antes de generar un parche · KPIs Balderrama

Adaptación de la lista de KPIs-VECSA a este repositorio. El foco aquí es que el
tablero **se lea fácil**: filtros que no pierden la vista, información en el
orden correcto, bloques bien acomodados y KPIs claros por perfil.

`CHECKLIST_REVISION.md` sigue siendo la lista para **preparar una demo** con
Contraloría o Gerencia General. Esta es la lista para **entregar un parche**.

**Resumen en 7 pasos:**
1. Partir de la punta real de `main`.
2. Separar lo nuevo de lo que ya estaba.
3. Revisar filtros, orden de la información y visuales (sección 3).
4. Revisar cifras, permisos y alertas (sección 4).
5. Correr las pruebas y ver la pantalla por perfil y tamaño.
6. Empaquetar y comprobar que el parche aplica limpio.
7. Dejar claro qué solo se puede validar en la oficina.

---

## 1. Partir de la punta correcta

- En este repo se trabaja sobre `main`. Cada parche sale de una rama de trabajo:
  ```bash
  git fetch origin main
  git log --oneline -5 origin/main
  git worktree add -b revision/<tema> ../revision origin/main
  ```
- **¿Ya se aplicó el parche anterior?** `git apply --check 00NN-*.patch`.
  Si falla, comparar con `git diff <mi-commit> origin/main`.
- Nunca trabajar sobre una copia con cambios locales. `npm install` puede
  modificar `backend/package-lock.json`; si no es parte del cambio, se restaura.

## 2. Leer qué cambió

- `git show --stat <commit>` y después el diff de cada archivo.
- Contrastar el mensaje del commit con el código.
- Si toca `dashboard.css`, revisar que el bloque nuevo **no se haya insertado
  a mitad de otra regla** (ver sección 3, trampa de llaves).

## 3. Filtros, orden de la información y visuales

### Filtros

| Pantalla | Cómo guarda la vista | Filtro de fechas |
|---|---|---|
| Resumen (`index.html`) | — | `initDateFilter` |
| Ventas (`sales.html`) | `#financiamiento`, `#leads`, `#afluencia`, `#comisiones` o `?tab=` | propio de `sales.js` |
| Contabilidad | `?tab=analisis` / `?tab=balance` / `?tab=eeff&vista=` (seminuevos, ventas, postventa, comparativa) | `initDateFilter` |
| Postventa | `#hyp`, `#refacciones`, `#servicio` | `initDateFilter` |
| Inventario | `?tab=postventa`, `seminuevos`, `cierre` | propio |
| Pronóstico | `?tab=` | propio |

- **Consultar no debe perder la pestaña.** `syncDateParamsToUrl` solo toca
  `fechaInicio` y `fechaFin`; conserva `tab`, `goto` y el `#hash`.
  Lo vigila `frontend-filtros-visuales.test.js`.
- **Probar el ciclo completo:** elegir pestaña → cambiar periodo → Consultar →
  recargar. Debe volver a la misma pestaña con el mismo periodo.
- La petición a `/api` debe llevar el parámetro del filtro (revisar en la
  pestaña Red) y la URL debe conservarlo.
- **El filtro va en la barra de filtros** (`filters-compact-bar`), no dentro de
  un bloque de resultados.

### Orden de la información

- Arriba, los KPIs que el perfil necesita para decidir; abajo, el detalle.
- En tablas por mes, **el acumulado y la variación van junto al concepto**,
  antes de los meses, para que se vean sin desplazar.
- Sin cifras repetidas entre el titular y las tarjetas, ni entre pestañas: lo que ya
  está en Estado de resultados o Análisis no se vuelve a pintar en Departamentos.
- En real contra presupuesto, el color dice si la variación **favorece**: en costos
  y gastos, quedar abajo del presupuesto es verde.
- Cada KPI con su unidad y su comparativo (`$X · var. ±Y%`), con
  `fmt.money` y el signo explícito.
- Textos de negocio, no nombres de hojas de Excel ni de tablas SQL.

### Acomodo y visuales

- Tema claro, azul y blanco. **Rojo solo para algo grave**; verde arriba de la
  meta, rojo abajo, con leyenda visible cuando hay comparativa.
- Bloques del Resumen separados por `.analytics-block` (28 px y línea fina).
- En cuadrículas de 2 columnas no meter elementos de más: se desacomoda el
  bloque siguiente.

### Trampas del frontend de este repo

| Síntoma | Causa |
|---|---|
| Una regla de CSS «no existe» aunque está escrita | Una `}` sobrante arriba: el navegador descarta la regla siguiente. Así se perdió `.analytics-block`. Lo vigila la prueba de llaves |
| Las reglas nuevas del CSS no aplican | Un `@media` sin cerrar más arriba (misma prueba) |
| Se pierde la pestaña al consultar | `syncDateParamsToUrl` reescribiendo la URL desde cero |
| Una tabla no se desplaza | `.table-scroll` está bloqueada (`overflow: hidden !important`) hasta que el usuario la activa (`is-scroll-unlocked`). Es a propósito; confirmar que la tabla nueva use el mismo patrón |
| Una tabla se corta a media pantalla | `.table-scroll` tiene `max-height: 440px` |
| El texto de una celda no se parte | `.data-table td { white-space: nowrap }` o una regla más específica |
| Un cambio no se ve después de subirlo | No se subió el `?v=`, o **la misma hoja tiene distinta `?v=` en cada página**. Se sube en todas las páginas a la vez; lo vigila la prueba de versiones |
| Algo «oculto» no aparece aunque le quites la clase | `.hidden` lleva `!important` |
| La alerta no se ve | Su `kpiId` no existe en la pantalla. Lo vigila `contrato-kpiid.test.js` |

## 4. Cifras, permisos y alertas

### Cifras (Contabilidad / EEFF)
- **Formato VECSA, cálculo Balderrama.** Estado de resultados, Análisis y Balance
  salen de `contabilidadFormatoService.js`, que solo ordena lo que ya calculan
  `eeffSummaryService`, `balanceGeneralService` y `breakEvenService`. Una regla
  contable nueva va en esos servicios o en `eeffSummaryConfig.js`, no en el formato.
- **Signo de presentación:** ingresos en positivo; costo y gastos en negativo.
- Totales que deben cuadrar: líneas de negocio = utilidad bruta; rubros =
  total de gastos; activo = pasivo + capital + resultado. Lo vigila
  `contabilidad-formato.test.js`.
- **No esconder lo que no cuadra:** cuentas con saldo sin renglón, cuentas en dos
  renglones y departamentos (GPO) con gasto fuera del estado se señalan en
  «Revisión de la balanza» y en su alerta.
- **Cuadre contra el libro (oficina):**
  `node backend/scripts/cuadra-estado-resultados.js --libro "<EEFF.xlsx>" --desde AAAA-MM-DD --hasta AAAA-MM-DD`.
  La primera vez, confirmar qué renglón tomó para cada concepto.
- Real contra presupuesto: el periodo debe ser 2026 (`presupuesto-2026.xlsx`);
  si no, alerta clara y botón «Usar acumulado 2026».
- El mes en curso está abierto: decirlo en pantalla.

### Permisos y perfiles
- En `backend/src/auth/roles.js`: `pages` y `apiPrefixes` de cada rol, y
  `ALWAYS_API_PREFIXES`.
- Restringir también en la ruta, no solo ocultando en pantalla.
- **Perfiles que se prueban:** Administración, Dirección, Gerencia Comercial,
  Vendedor, Contabilidad, Mercadotecnia (MTK) y Gestión de inventario.
- La app móvil tiene sus propios roles en `cloud-api/src/services/mobileRoles.js`.

### Balvo y alertas
- Balvo: `aiTools.js` (herramienta), `aiRoleAccess.js` (qué ve cada perfil),
  `aiAgent.js` (reglas para elegir herramienta).
- Alertas: cada `kpiId` de `intelligentInsightsService.js` debe existir en la
  pantalla del mapa `PANTALLAS` de `contrato-kpiid.test.js`.
- `POST /ai/insights` debe quedar debajo de 100 kB (`express.json()` sin límite
  explícito en `backend/server.js`).

### Base del CRM (SQLite → PostgreSQL)
- Los servicios leen el CRM por `src/db/crmStore.js`, nunca abriendo
  `crm-ciclos.db` directo. Ver `docs/MIGRACION-CRM-POSTGRES.md`.
- Consulta nueva o migrada: marcadores `?`, sin funciones propias de SQLite
  (`julianday`, `instr`, `printf`, `GLOB`…), y con prueba que compare el resultado
  de SQLite contra el de PostgreSQL.
- Sin base cargada, el servicio responde «sin datos», no un error.
- **Pendiente etapa 2:** `crmCiclosService.js` y `leadsSupervivenciaService.js` (Leads y
  tiempo a compra) todavía abren `crm-ciclos.db` directo y usan `julianday`.
- Correr las pruebas también con PostgreSQL:
  `CRM_PG_URL_TEST=postgresql://… npm test` (sin la variable, esas pruebas se omiten).

### Modo nube (réplica)
- **Ruta nueva con fechas** que se use al abrir una pantalla: agregarla a
  `RUTAS_CON_FECHAS` (o `RUTAS_FIJAS` con sus parámetros exactos) en
  `cloudReplica/replicaPublisher.js`. La consulta publicada debe ser igual a la
  que manda el frontend; si no, se publica algo que nadie lee.
- **Vista de un cliente individual** (nombre, teléfono, historial): agregarla a
  `PREFIJOS_EXCLUIDOS` en `replicaKey.js` **y** en `cloud-api/.../desktopCacheStore.js`.
  Una prueba vigila que coincidan.
- **Ruta que no depende de SQL Server:** agregarla a `LOCAL_PREFIXES` en
  `replicaMiddleware.js` para no ir a la nube sin necesidad.
- Ver `docs/REPLICA-NUBE.md`.

### Datos personales
- Nada con nombre, teléfono, correo, RFC o VIN de clientes en el repositorio.
  **Pendiente:** `backend/data/forecast-source.csv` hoy trae nombres de clientes,
  VIN y facturas, y el repo es público.

## 5. Pruebas

```bash
cd backend && npm test                      # todas
for f in ../frontend/public/js/*.js; do node --check "$f"; done
```

- Cada regla nueva lleva su prueba, con datos sintéticos.

## 6. Verificación visual

- Playwright con `/api` simulada y la sesión de cada perfil (`/api/auth/me`).
- Cada perfil en escritorio (1440 px) y celular (390 px).
- Revisar: que la página no se desplace de lado; que la pestaña sobreviva a
  Consultar; posición de cada bloque; textos encimados con íconos; alertas
  ancladas a su tarjeta; que la burbuja de Balvo no tape KPIs en celular.
- Gráficas: capturar por elemento (la página completa deforma Chart.js).
- Antes y después: generar la versión anterior con
  `git archive main frontend/public` y capturar ambas.
- Si las fuentes de Google no cargan, los íconos salen como texto: esas
  capturas no sirven para juzgar encimados.

## 7. Lo que solo se valida en la oficina

- Cifras contra SQL Server real y el libro de Excel de Contraloría.
- Sincronización a la nube (`cloudSync/` → `cloud-api`) y réplica (`desktop-cache`) con datos reales.
- Tiempos de respuesta con datos completos.
- Íconos y textos encimados con las fuentes cargadas.
- Tiempo a compra de Leads: antes de leer sus cifras, correr
  `node backend/scripts/diagnostico-maduracion-leads.js` y revisar el veredicto
  (Kaplan–Meier, Cox, curación, riesgos competitivos, hitos). Solo imprime conteos.

## 8. Empaquetar y entregar

1. **Commit en español:** qué cambia y por qué, sin lista de archivos.
2. **Generar el parche:** `git format-patch -1 --start-number NN` y renombrar a
   `00NN-tema.patch`. El primero de este repo es el `0001`.
3. **Comprobar en un worktree nuevo de `origin/main`:**
   `git am 00NN-tema.patch && cd backend && npm test`.
4. **Entrega:** el parche y las capturas. Si usan datos simulados, el nombre lo dice.
5. **Mensaje:** resumen ejecutivo, qué corrige, qué revisar en la oficina,
   preguntas abiertas.
