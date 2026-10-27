# Patrón de sección KPI: tarjetas + gráfico + alerta

Toda sección nueva (o que se reacomode) sigue esta receta. Evita resolver cada pantalla desde cero y protege las ventanas de detalle y las alertas inteligentes.

## 1. Marcado

```html
<div class="kpi-section">
  <div class="kpi-section__cards">
    <!-- Tarjetas con id propio. Ese id es el ancla de alerta y de detalle. -->
    <div id="miTarjetaCrm" class="vista360-empty__kpi kpi-insight-anchor">…</div>
  </div>
  <div class="kpi-section__charts">
    <figure class="kpi-section__chart kpi-section__chart--wide">
      <figcaption>Título del gráfico</figcaption>
      <div class="kpi-section__canvas"><canvas id="chartMio"></canvas></div>
    </figure>
  </div>
</div>
```

Estilos: bloque «Patrón de sección KPI» al final de `css/dashboard.css`. En pantallas anchas va tarjetas a la izquierda y gráficos a la derecha; bajo 1100 px se apila.

## 2. Gráficos (`js/kpi-section.js`)

```js
KpiSection.chart('clave', document.getElementById('chartMio'), {
  type: 'hbar',            // 'bar' | 'hbar' | 'doughnut'
  unit: '$',               // '$' | '%' | ''
  labels, values,
  colors: [KpiSection.palette.primary, …],
  clickable: (i) => Boolean(filas[i].id),
  onClick: (i) => abrirDetalle(filas[i].id),
});
```

El módulo destruye la instancia anterior con la misma clave, así que se puede llamar en cada refresco.

## 3. Alerta inteligente

1. El backend (`intelligentInsightsService.js`) emite la alerta con un `kpiId`.
2. `kpi-insights.js` busca `document.getElementById(kpiId)` y le pone el punto de semáforo.
3. Si el elemento tiene la clase `kpi-insight-anchor`, el punto se agrega dentro de él; si no, dentro de su `.kpi-card`.
4. Una alerta puede cambiar de tarjeta con un parámetro del payload (ejemplo: `anchorCrm`).

```js
KpiSection.alert('seguimiento', { vista: 'cierres', anchorCrm: 'miTarjetaCrm', totales });
```

## 4. Reglas de oro

- No clones ni reescribas con `innerHTML` una tarjeta que tenga alerta o detalle. Cambia solo el texto del valor para no perder listeners ni el botón de semáforo.
- El `kpiId` que emite el backend debe existir en la pantalla. La prueba `backend/test/contrato-kpiid.test.js` lo verifica.
- Si dos alertas comparten tarjeta, solo se muestra la de mayor severidad.
- El gráfico usa los mismos datos que las tarjetas. No agregues una segunda consulta.
- Las ventanas de detalle (`kpi-detail-panel`) y la ventana de alerta (`kpi-insight-popover`) no se tocan.

## 5. Lista de verificación antes de cerrar una sección

- [ ] Cada tarjeta tiene `id`.
- [ ] Hay al menos un gráfico y cabe sin scroll horizontal a 1100 px y a 390 px.
- [ ] La alerta de la sección se ve y abre su ventana.
- [ ] `npm test --prefix backend` pasa.

## Ejemplo en producción

Inicio de Seguimiento 360 (`seguimiento.html`, bloque `#emptyState`): 4 tarjetas, gráfico de top clientes, dona de cobertura de ID CRM y alerta «Cierres de taller sin ID CRM» anclada a `#emptyCardCrm`.
