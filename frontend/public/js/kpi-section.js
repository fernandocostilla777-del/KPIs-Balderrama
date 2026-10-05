/**
 * kpi-section.js — patrón único de sección «tarjetas + gráfico + alerta».
 *
 * Una sección KPI se compone de:
 *   1) Tarjetas con id propio (ancla de alertas y de ventanas de detalle).
 *   2) Uno o dos gráficos al lado (misma fuente de datos que las tarjetas).
 *   3) Alerta inteligente anclada a una tarjeta (kpi-insights.js).
 *
 * Este módulo solo resuelve (2) y (3) de forma uniforme; el marcado usa las
 * clases .kpi-section* de dashboard.css. Guía completa: docs/PATRON_SECCION_KPI.md
 *
 * API:
 *   KpiSection.chart(key, canvas, spec)   -> instancia Chart.js (o null)
 *       spec = { type: 'bar' | 'hbar' | 'doughnut',
 *                labels: [], values: [], colors: [] | '#hex',
 *                unit: '$' | '%' | '', onClick(index), clickable(index) }
 *   KpiSection.destroy(key)
 *   KpiSection.alert(module, payload)     -> aplica alertas (si hay KpiInsights)
 *
 * Reglas de oro:
 *   - No clones ni reescribas tarjetas con innerHTML si tienen alerta o detalle:
 *     cambia solo el texto del valor (setText) para conservar listeners y botón.
 *   - El id que emite el backend (kpiId) debe existir en la pantalla
 *     (la prueba backend/test/contrato-kpiid.test.js lo verifica).
 */
(function (global) {
  'use strict';

  var instances = {};
  var PALETTE = {
    primary: '#2D5BFF', success: '#27AE60', warn: '#F59E0B', danger: '#EF4444',
    muted: '#CBD5E1', sky: '#8FB0FF', navy: '#1E3A8A',
  };

  function fmt(n, unit) {
    if (n == null || isNaN(n)) return '—';
    if (unit === '%') return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + '%';
    if (unit === '$') {
      var a = Math.abs(n);
      var sign = n < 0 ? '\u2212' : '';
      if (a >= 1e6) return sign + '$' + (a / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' M';
      if (a >= 1e3) return sign + '$' + (a / 1e3).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' k';
      return sign + '$' + a.toLocaleString('es-MX', { maximumFractionDigits: 0 });
    }
    return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });
  }

  function destroy(key) {
    if (instances[key]) { instances[key].destroy(); delete instances[key]; }
  }

  function chart(key, canvas, spec) {
    destroy(key);
    if (typeof global.Chart === 'undefined' || !canvas) return null;
    var existing = global.Chart.getChart(canvas);
    if (existing) existing.destroy();

    var type = spec.type || 'bar';
    var ring = type === 'doughnut';
    var horizontal = type === 'hbar';
    var unit = spec.unit || '';
    var colors = spec.colors || PALETTE.primary;

    var options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { display: ring, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var raw = ring ? ctx.parsed : (horizontal ? ctx.parsed.x : ctx.parsed.y);
              return ' ' + ctx.label + ': ' + fmt(raw, unit);
            },
          },
        },
      },
      onHover: function (evt, els) {
        if (!evt || !evt.native) return;
        var ok = els.length && (!spec.clickable || spec.clickable(els[0].index)) && spec.onClick;
        evt.native.target.style.cursor = ok ? 'pointer' : 'default';
      },
      onClick: function (evt, els) {
        if (!els.length || !spec.onClick) return;
        var i = els[0].index;
        if (!spec.clickable || spec.clickable(i)) spec.onClick(i);
      },
    };
    if (ring) {
      options.cutout = '64%';
    } else {
      var money = unit === '$';
      var valueTicks = { font: { size: 11 } };
      if (money) valueTicks.callback = function (v) { return fmt(v, '$'); };
      options.indexAxis = horizontal ? 'y' : 'x';
      options.scales = {
        x: { grid: { display: horizontal, color: 'rgba(148,163,184,.2)' }, ticks: horizontal ? valueTicks : { font: { size: 11 } } },
        y: { grid: { display: !horizontal, color: 'rgba(148,163,184,.2)' }, ticks: horizontal ? { font: { size: 11 } } : valueTicks },
      };
    }

    instances[key] = new global.Chart(canvas, {
      type: ring ? 'doughnut' : 'bar',
      data: {
        labels: spec.labels || [],
        datasets: [{
          data: spec.values || [],
          backgroundColor: colors,
          borderWidth: ring ? 2 : 0,
          borderColor: '#fff',
          borderRadius: ring ? 0 : 6,
          maxBarThickness: horizontal ? 22 : 34,
        }],
      },
      options: options,
    });
    return instances[key];
  }

  function alert(module, payload) {
    if (global.KpiInsights && global.KpiInsights.apply) {
      return global.KpiInsights.apply(module, payload || {});
    }
    return null;
  }

  global.KpiSection = { chart: chart, destroy: destroy, alert: alert, palette: PALETTE, format: fmt };
})(window);
