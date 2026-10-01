const fs = require('fs');

const kpi = JSON.parse(fs.readFileSync('docs/_kpi-export.json', 'utf8'));
const summary = JSON.parse(fs.readFileSync('docs/_summary-kpis.json', 'utf8'));

const roles = [
  {
    id: 'administracion',
    label: 'Administración',
    home: 'Resumen (/)',
    pages: ['Admin', 'Resumen', 'Ventas', 'Pronóstico', 'Inventario', 'Lista de precios', 'Contabilidad', 'Postventa', 'Seguimiento 360'],
    extras: ['Gestión de usuarios', 'Permisos por rol', 'Preferencias de alertas', 'Catálogo de planes'],
    nivel: 'Gobierno del sistema + visión transversal de todos los módulos',
  },
  {
    id: 'direccion',
    label: 'Dirección',
    home: 'Resumen (/)',
    pages: ['Resumen', 'Ventas', 'Pronóstico', 'Inventario', 'Lista de precios', 'Contabilidad', 'Postventa', 'Seguimiento 360'],
    extras: ['Vista ejecutiva completa', 'Alertas inteligentes ABP', 'Asignación de seguimientos'],
    nivel: 'Signos Vitales + Financiera + Commercial/Procesos (lectura estratégica)',
  },
  {
    id: 'gerencia_comercial',
    label: 'Gerencia Comercial',
    home: 'Resumen (/)',
    pages: ['Resumen', 'Ventas', 'Pronóstico', 'Lista de precios', 'Seguimiento 360'],
    extras: ['Resumen personalizable', 'Objetivos comerciales', 'CRM / seguimiento'],
    nivel: 'Comercial + Procesos de venta/marketing/inventario (sin EEFF completo)',
  },
  {
    id: 'vendedor',
    label: 'Vendedor',
    home: 'Seguimiento 360',
    pages: ['Ventas', 'Lista de precios', 'Seguimiento 360'],
    extras: ['Foco en pipeline y cliente', 'Consulta de precios/planes'],
    nivel: 'Operativo de cierre: pipeline, precios y expediente 360 del cliente',
  },
  {
    id: 'contabilidad',
    label: 'Contabilidad',
    home: 'Contabilidad',
    pages: ['Contabilidad'],
    extras: ['EEFF / liquidez / PE', 'Alertas financieras ABP'],
    nivel: 'Signos Vitales + Financiera (estado de resultados, balance, ratios)',
  },
];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fig(src, caption, n) {
  return `<img class="shot" src="guia-imagenes/${src}" alt="${esc(caption)}"/>
  <p class="caption">Figura ${n}. ${esc(caption)}</p>`;
}

let figN = 1;
function nextFig(src, caption) {
  const n = figN++;
  return fig(src, caption, n);
}

const kpiTables = Object.entries(kpi.byPerspectiva).map(([persp, items]) => `
  <h3>${esc(persp)} <span class="badge">${items.length}</span></h3>
  <table>
    <thead><tr><th>Clave</th><th>KPI</th><th>Interpretación</th><th>Valor de control</th><th>Usado por</th><th>Responsable</th></tr></thead>
    <tbody>
      ${items.map((i) => `<tr>
        <td><code>${esc(i.clave)}</code></td>
        <td>${esc(i.kpi)}</td>
        <td>${esc(i.interpretacion)}</td>
        <td>${esc(i.valorControl)}</td>
        <td>${esc((i.usadoPor || []).join(', '))}</td>
        <td>${esc(i.responsable)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`).join('\n');

const summaryTable = `
<table>
  <thead><tr><th>Área</th><th>KPI del resumen</th><th>Descripción</th></tr></thead>
  <tbody>
    ${summary.map((s) => `<tr><td>${esc(s.area)}</td><td>${esc(s.label)}</td><td>${esc(s.desc)}</td></tr>`).join('')}
  </tbody>
</table>`;

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>Guía de uso · Dashboard KPIs Balderrama</title>
<style>
  :root { --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --brand:#0d9488; --brand2:#2563eb; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; font: 11.5pt/1.45 "Segoe UI", Calibri, sans-serif; color:var(--ink); background:#fff; }
  .cover { min-height: 100vh; padding: 48px 56px; background: linear-gradient(145deg,#0b1c2c 0%, #0f3d3a 55%, #0d9488 120%); color:#fff; display:flex; flex-direction:column; justify-content:flex-end; page-break-after: always; }
  .cover h1 { font-size: 2.6rem; margin: 0 0 12px; max-width: 16ch; line-height:1.1; }
  .cover p { max-width: 54ch; opacity:.9; font-size:1.05rem; }
  .cover .meta { margin-top: 40px; display:flex; gap:24px; flex-wrap:wrap; font-size:.95rem; opacity:.85; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 36px 28px 64px; }
  h2 { font-size: 1.45rem; margin: 28px 0 10px; border-bottom: 3px solid var(--brand); padding-bottom: 6px; page-break-after: avoid; }
  h3 { font-size: 1.15rem; margin: 22px 0 8px; color:#0f766e; page-break-after: avoid; }
  h4 { font-size: 1rem; margin: 14px 0 6px; color:#0f172a; }
  p, li { color: var(--muted); }
  .toc a { color: var(--brand2); text-decoration:none; }
  .toc li { margin: 4px 0; }
  .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 16px; page-break-inside: avoid; }
  .card h4 { margin:0 0 6px; font-size:1rem; color:var(--ink); }
  .badge { display:inline-block; background:rgba(13,148,136,.12); color:#0f766e; border-radius:999px; padding:1px 8px; font-size:.75rem; font-weight:700; }
  table { width:100%; border-collapse: collapse; font-size: 9.2pt; margin: 8px 0 18px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border:1px solid var(--line); padding:6px 7px; vertical-align:top; text-align:left; }
  th { background:#f1f5f9; color:#0f172a; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:.9em; }
  .module { page-break-inside: avoid; margin: 8px 0 22px; }
  .shot { width:100%; border-radius:12px; border:1px solid var(--line); margin:10px 0 6px; page-break-inside:avoid; box-shadow:0 6px 18px rgba(15,23,42,.08); }
  .caption { font-size:.85rem; color:#64748b; margin:0 0 16px; font-style:italic; }
  .semaforo { display:inline-flex; gap:10px; margin:8px 0 16px; flex-wrap:wrap; }
  .semaforo span { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:.8rem; font-weight:700; }
  .s-verde { background:rgba(22,163,74,.12); color:#15803d; }
  .s-amarillo { background:rgba(234,179,8,.16); color:#a16207; }
  .s-rojo { background:rgba(220,38,38,.12); color:#b91c1c; }
  .dot { width:8px; height:8px; border-radius:50%; background:currentColor; }
  .flow { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:12px 0 18px; }
  .flow5 { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin:12px 0 18px; }
  .flow div, .flow5 div { border:1px dashed #94a3b8; border-radius:12px; padding:10px; background:#f8fafc; font-size:.85rem; color:#334155; page-break-inside:avoid; }
  .flow strong, .flow5 strong { display:block; color:#0f172a; margin-bottom:4px; }
  .note { background:#ecfeff; border-left:4px solid var(--brand); padding:10px 12px; border-radius:0 10px 10px 0; color:#155e75; margin:12px 0; }
  .warn { background:#fff7ed; border-left:4px solid #ea580c; padding:10px 12px; border-radius:0 10px 10px 0; color:#9a3412; margin:12px 0; }
  @media print {
    body { font-size:10.5pt; }
    .cover { min-height:auto; height:100vh; }
    a { color:inherit; text-decoration:none; }
    .wrap { max-width:none; padding:12px 0; }
  }
  @page { size: A4; margin: 14mm 12mm; }
</style>
</head>
<body>
<section class="cover">
  <div>
    <div style="opacity:.8;letter-spacing:.12em;text-transform:uppercase;font-size:.8rem;margin-bottom:18px;">Balderrama · Chevrolet · ABP 2026</div>
    <h1>Guía de uso del Dashboard de KPIs</h1>
    <p>Manual completo de perfiles, submenús, cadena de indicadores ABP, Seguimiento 360 (retención taller + recompra Seminuevos), alertas, bandeja de mensajes y asistente IA. Todas las imágenes son capturas reales del tablero en operación.</p>
    <div class="meta">
      <div>Versión guía: 2026-08-17</div>
      <div>${kpi.count} KPIs del Mapa de indicadores</div>
      <div>5 modos de usuario</div>
      <div>Submenús · 360 · Mensajes · IA con gráficos</div>
    </div>
  </div>
</section>

<div class="wrap">
  <h2>1. Índice</h2>
  <ol class="toc">
    <li><a href="#acceso">Acceso y modos de usuario</a></li>
    <li><a href="#perfiles">Matriz de perfiles y secciones</a></li>
    <li><a href="#cadena">Cómo se relacionan los KPIs y el nivel de información por perfil</a></li>
    <li><a href="#modulos">Módulos y submenús (capturas reales)</a></li>
    <li><a href="#360">Seguimiento 360 · acompañamiento por cliente y VIN (retención + recompra)</a></li>
    <li><a href="#resumen">Resumen personalizable (espacios +)</a></li>
    <li><a href="#ia">Alertas inteligentes, semáforo y agente IA</a></li>
    <li><a href="#mensajes">Bandeja de mensajes · seguimiento de KPIs a la baja</a></li>
    <li><a href="#asistente">Asistente IA expandido con gráficos</a></li>
    <li><a href="#kpi-resumen">KPIs disponibles en el resumen</a></li>
    <li><a href="#kpi-abp">Catálogo ABP 2026 · Mapa de indicadores</a></li>
    <li><a href="#alertas">Tipos de alertas operativas</a></li>
  </ol>

  <h2 id="acceso">2. Acceso y modos de usuario</h2>
  ${nextFig('01-login.png', 'Pantalla de acceso real. El sistema identifica el rol y abre la página de inicio correspondiente.')}
  <div class="note">Modos de usuario (roles): Administración, Dirección, Gerencia Comercial, Vendedor y Contabilidad. Cada uno ve solo las secciones autorizadas y recibe alertas/notificaciones alineadas a la columna <em>Usado por</em> del Excel ABP 2026.</div>

  <h2 id="perfiles">3. Matriz de perfiles y secciones</h2>
  <div class="grid2">
    ${roles.map((r) => `<div class="card">
      <h4>${esc(r.label)} <span class="badge">${esc(r.id)}</span></h4>
      <p><strong>Inicio:</strong> ${esc(r.home)}</p>
      <p><strong>Secciones:</strong> ${esc(r.pages.join(' · '))}</p>
      <p><strong>Nivel de información:</strong> ${esc(r.nivel)}</p>
      <p><strong>Capacidades clave:</strong> ${esc(r.extras.join(' · '))}</p>
    </div>`).join('')}
  </div>

  <h2 id="cadena">4. Cómo se relacionan los KPIs · nivel correcto por perfil (Excel ABP)</h2>
  <p>El archivo <em>Catálogo de KPI´s ABP 2026</em> (hoja <strong>Mapa de indicadores</strong>) organiza ${kpi.count} indicadores en cinco perspectivas. No son tarjetas aisladas: forman una <strong>cadena causal</strong> para la toma de decisiones basada en datos. El dashboard filtra qué ve cada perfil según páginas autorizadas + audiencia (<em>Usado por</em>) + responsable.</p>

  <h3>4.1 Cadena causal entre perspectivas</h3>
  <div class="flow5">
    <div><strong>1. Procesos (P-1…P-6)</strong>Inventario, leads, marketing, mix, penetración F&I, retención y CLV. Son la “máquina” operativa.</div>
    <div><strong>2. Comercial (C-1…C-6)</strong>Margen, DRI, PVR F&I, CSI/NPS y crecimiento de ventas. Traducen procesos a resultado comercial.</div>
    <div><strong>3. Financiera (F-1…F-8)</strong>Ciclo de efectivo, DRC/DRP, liquidez inmediata, EBITDA y calidad de deuda. Traducen lo comercial a caja y estructura.</div>
    <div><strong>4. Signos Vitales (SV-1…SV-4)</strong>ROE, endeudamiento, liquidez y variación de utilidad neta. Lectura ejecutiva de salud del negocio.</div>
    <div><strong>5. Desarrollo org. (RH-1…RH-6)</strong>Plantilla, rotación y capacitación. Capacidad humana que sostiene (o frena) los procesos.</div>
  </div>

  <div class="note"><strong>Ejemplo de lectura encadenada:</strong> si <code>P-1 Días promedio de inventario</code> sube → sube <code>P-1 Costo financiero del inventario</code> (plan piso) → se deteriora <code>C-3 DRI</code> → baja <code>C-2 Margen bruto %</code> → cae <code>F-6 Margen EBITDA</code> → el semáforo de <code>SV-4 Variación utilidad neta</code> pasa a amarillo/rojo. Dirección ve el SV; Gerencia Comercial actúa en P/C; Contabilidad valida F/SV.</div>

  <h3>4.2 Nivel de información correcto según el perfil</h3>
  <table>
    <thead><tr><th>Perfil en el tablero</th><th>Perspectivas del Excel que le corresponden</th><th>Qué decide con esos datos</th><th>Qué NO necesita ver (para no saturar)</th></tr></thead>
    <tbody>
      <tr>
        <td><strong>Dirección</strong></td>
        <td>Signos Vitales + Financiera + lectura de Comercial/Procesos</td>
        <td>Priorizar riesgos (semáforo rojo), asignar seguimientos a gerencias, validar presupuesto vs real</td>
        <td>Detalle de folio de taller o comisión por contrato (salvo cuando profundiza en 360 / módulo)</td>
      </tr>
      <tr>
        <td><strong>Gerencia Comercial</strong></td>
        <td>Comercial (C-*) + Procesos de venta/marketing/inventario (P-1…P-6)</td>
        <td>Cubrir objetivo, mix, penetración F&I, leads/afluencia, stock envejecido y plan piso</td>
        <td>Ratios SV/F completos (ROE, endeudamiento) — los ve Dirección/Contabilidad</td>
      </tr>
      <tr>
        <td><strong>Vendedor</strong></td>
        <td>Procesos de pipeline (P-3/P-4) en su cartera + precios</td>
        <td>Cerrar unidades, acompañar cliente/VIN en 360 (taller, franjas FEM, equity seminuevos) y lista de precios</td>
        <td>EEFF, balance, plan piso consolidado, administración de usuarios</td>
      </tr>
      <tr>
        <td><strong>Contabilidad</strong></td>
        <td>Signos Vitales + Financiera (F-* / SV-*)</td>
        <td>Validar utilidad, liquidez, PE, real vs presupuesto, balance</td>
        <td>Embudo de leads o comisiones F&I operativas</td>
      </tr>
      <tr>
        <td><strong>Administración</strong></td>
        <td>Gobierno: permisos + qué alerta ve cada rol (audiencia del Excel)</td>
        <td>Asegurar que cada perfil reciba el nivel correcto de KPI/alerta</td>
        <td>—</td>
      </tr>
    </tbody>
  </table>

  <h3>4.3 Cómo el Excel se concreta en el tablero</h3>
  <ul>
    <li><strong>Columna KPI / Interpretación / Valor de control</strong> → popover de alerta inteligente + semáforo verde/amarillo/rojo.</li>
    <li><strong>Columna Usado por</strong> → filtra a quién se notifica y qué insights aparecen según el rol logueado.</li>
    <li><strong>Columna Responsable</strong> → sugiere a quién asignar el seguimiento en la bandeja de mensajes.</li>
    <li><strong>Perspectiva</strong> → agrupa el catálogo ABP en el PDF y en el backend (<code>kpiMapaCatalog.json</code>).</li>
  </ul>
  <p>Así, un KPI “a la baja” no se muestra igual a todos: <strong>Dirección</strong> ve el impacto en signos vitales; <strong>Gerencia</strong> ve la palanca operativa; <strong>Vendedor</strong> ve el cliente en 360; <strong>Contabilidad</strong> ve la cifra financiera.</p>

  <h2 id="modulos">5. Módulos y submenús (capturas reales)</h2>

  <div class="module">
    <h3>5.1 Resumen (tablero ejecutivo)</h3>
    <p>Home de Administración, Dirección y Gerencia Comercial. <strong>8 espacios personalizables</strong>; la primera vez llegan vacíos y cada “+” permite elegir un KPI permitido para el perfil.</p>
    ${nextFig('r01-overview.png', 'Resumen Ejecutivo real: espacios con Unidades vendidas, Días prom. inventario, Órdenes taller e Inventario disponible, más espacios libres.')}
  </div>

  <div class="module">
    <h3>5.2 Ventas · submenú Ventas</h3>
    <p>Desempeño del periodo: total, retail, flotillas, entregas SOFIA, carry over y cobertura vs objetivo editable.</p>
    ${nextFig('r02-ventas.png', 'Rendimiento de Ventas con anillos de avance GMMX/SOFIA y puntos de alerta inteligente en las tarjetas.')}
  </div>

  <div class="module">
    <h3>5.3 Ventas · Financiamiento</h3>
    <p>Penetración GMF sobre entregas SOFIA, solicitudes F&I, volumen colocado, plazo promedio y <strong>productos PVA</strong> (GAP, garantía extendida, OnStar, mantenimientos, etc.). Relaciona KPIs <code>P-4 Penetración de financiamiento</code> y <code>C-4 Ingreso financiero promedio por unidad</code>.</p>
    ${nextFig('s01-ventas-financiamiento.png', 'Financiamiento real: penetración GMF, solicitudes F&I y volumen del periodo.')}
    ${nextFig('s02-ventas-pva.png', 'Productos PVA: penetración por producto sobre contratos F&I del periodo.')}
  </div>

  <div class="module">
    <h3>5.4 Ventas · Leads</h3>
    <p>Cohorte por fecha de entrada CRM: embudo (oportunidades → contactados → citas → compra), tasas clave, alertas de caducidad, campañas y conversión por fuerza de ventas. Alimenta <code>P-3</code> (conversión prospecto/oportunidad, citas, asistencia) y <code>P-4 Tasa de cierre</code>.</p>
    ${nextFig('s03-ventas-leads.png', 'Leads con embudo de conversión, tasas clave y detalle de oportunidades del periodo con datos CRM.')}
  </div>

  <div class="module">
    <h3>5.5 Ventas · Afluencia</h3>
    <p>Tráfico de piso (NUEVOS · Fresh up + Citas · SNV · pruebas de manejo) por sucursal, más Marketing (MTK): origen del tráfico, campañas de leads y diagnósticos inteligentes. Relaciona <code>P-2</code> (costo por lead, conversión marketing→venta, CAC).</p>
    ${nextFig('s04-ventas-afluencia.png', 'Afluencia general por sucursal y bloques de marketing con diagnósticos de canal.')}
  </div>

  <div class="module">
    <h3>5.6 Ventas · Comisiones</h3>
    <p>Liquidación por tipo (p. ej. Comisiones F&I): conceptos, total a depositar y detalle por contrato del periodo.</p>
    ${nextFig('s05-ventas-comisiones.png', 'Comisiones F&I: resumen por concepto, total a depositar y detalle por contrato.')}
  </div>

  <div class="module">
    <h3>5.7 Inventario · Autos nuevos</h3>
    <p>Stock FIS/DIS/SEP/DEMO, sin previas, envejecidas, días promedio y Plan Piso. KPIs <code>P-1</code> (días promedio, envejecido, rotación, costo financiero) y <code>C-3 DRI</code>.</p>
    ${nextFig('r03-inventario.png', 'Inventario de autos nuevos: tarjetas de estado, Plan Piso por VIN y unidades envejecidas.')}
  </div>

  <div class="module">
    <h3>5.8 Inventario · Seminuevos</h3>
    <p>Stock seminuevo (SFIS), costo de toma, antigüedad, rotación histórica (días de adquisición a factura) y distribución por marca.</p>
    ${nextFig('s06-inv-seminuevos.png', 'Inventario seminuevos: disponibles, envejecidos, antigüedad y análisis de rotación.')}
  </div>

  <div class="module">
    <h3>5.9 Inventario · Postventa (piezas)</h3>
    <p>Inventario de taller/refacciones/HyP: piezas en proceso, existencias de almacén y materiales H&amp;P. Cruza con el módulo PostVenta operativo.</p>
    ${nextFig('s07-inv-postventa.png', 'Inventario Postventa: servicio en taller, refacciones en almacén y materiales HyP.')}
  </div>

  <div class="module">
    <h3>5.10 PostVenta · consolidado</h3>
    <p>Vista integral Servicio + Refacciones + HyP: órdenes ingresadas, facturadas, importe y backlog.</p>
    ${nextFig('r04-postventa.png', 'PostVenta consolidada con bloques de Servicio, Refacciones e HyP e indicadores de facturación.')}
  </div>

  <div class="module">
    <h3>5.11 PostVenta · Servicio</h3>
    <p>Órdenes de taller: volumen, importes, antigüedad, promesa vencida, cobranza aseguradoras, flujo semanal y productividad por asesor.</p>
    ${nextFig('s08-pv-servicio.png', 'Submenú Servicio: KPIs operativos de órdenes de reparación del periodo.')}
  </div>

  <div class="module">
    <h3>5.12 PostVenta · Refacciones</h3>
    <p>Ventas financieras 0481–0484, mostrador, existencias, pedidos a planta, stock trabado, top vendidos y utilidad.</p>
    ${nextFig('s09-pv-refacciones.png', 'Submenú Refacciones: canales, existencias, pedidos y alertas de inventario.')}
  </div>

  <div class="module">
    <h3>5.13 PostVenta · HyP</h3>
    <p>Hojalatería y pintura: folios por letra (aseguradoras, internas, particulares), importes abiertos vs facturados y distribución por estatus.</p>
    ${nextFig('s10-pv-hyp.png', 'Submenú HyP: órdenes abiertas por tipo de folio e importes del área.')}
  </div>

  <div class="module">
    <h3>5.14 Contabilidad · Catálogo / Estado de resultados</h3>
    <p>Flujo Ventas → Costos → Utilidad bruta → Gastos → Utilidad de operación desde CON_CTAS.</p>
    ${nextFig('r05-contabilidad.png', 'Estado de resultados por catálogo de cuentas con márgenes reales del periodo.')}
  </div>

  <div class="module">
    <h3>5.15 Contabilidad · Balance General</h3>
    <p>Activo, pasivo y capital al cierre; composición y ratios de liquidez/endeudamiento. Alimenta <code>SV-2</code>, <code>SV-3</code>, <code>F-2</code>.</p>
    ${nextFig('s11-cont-balance.png', 'Balance General real: totales, composición de activo/pasivo e indicadores de liquidez.')}
  </div>

  <div class="module">
    <h3>5.16 Contabilidad · EEFF</h3>
    <p>Estado financiero estructurado, punto de equilibrio, menudeo/flotillas, postventa por área y real vs presupuesto 2026. Relaciona <code>F-6/F-8</code> y <code>SV-4</code>.</p>
    ${nextFig('s12-cont-eeff.png', 'EEFF: resumen financiero, PE operativo y comparativo real vs presupuesto.')}
  </div>

  <div class="module">
    <h3>5.17 Pronóstico</h3>
    ${nextFig('r07-pronostico.png', 'Pronóstico de ventas con regresión, banda de confianza y MAPE del modelo.')}
  </div>

  <div class="module">
    <h3>5.18 Lista de precios</h3>
    ${nextFig('r14-lista-precios.png', 'Ficha comercial real (ejemplo AVEO): precios, promociones y existencia por color.')}
  </div>

  <div class="module">
    <h3>5.19 Administración</h3>
    ${nextFig('r12-administracion.png', 'Administración: usuarios por rol y matriz de permisos por módulo.')}
  </div>

  <h2 id="360">6. Seguimiento 360 · acompañamiento por cliente y VIN</h2>
  <p>El <strong>Seguimiento 360</strong> es la herramienta de acompañamiento del cliente que ya compró (y de su(s) VIN): no es un embudo de prospectos nuevos. Une <strong>CRM</strong> (ciclos, pruebas, quejas CSI) con <strong>DMS/SQL</strong> (facturas, órdenes de taller, km) para dos resultados de negocio:</p>
  <div class="flow">
    <div><strong>1. Retención en taller</strong>Traer al cliente a servicio en la franja correcta (FEM / planta) antes de perderlo.</div>
    <div><strong>2. Recompra / seminuevos</strong>Detectar unidades buscadas por Seminuevos y ofrecer equity para generar una venta nueva.</div>
  </div>
  <div class="note"><strong>Enfoque limpio:</strong> el 360 opera sobre la cartera de clientes con unidad entregada. La captación de leads fríos vive en Ventas → Leads; aquí se gestiona retención postventa y oportunidad de recompra.</div>

  <h3>6.1 Acompañamiento por cliente y por VIN</h3>
  <p>Hay dos puertas de entrada complementarias:</p>
  <ul>
    <li><strong>Por cliente (ID CRM / nombre):</strong> radiografía de la persona — ciclos, compras, F&amp;I, quejas, todas las unidades vinculadas y timeline unificada.</li>
    <li><strong>Por VIN:</strong> acompañamiento de la unidad — historial de órdenes, km, carline/paquete, franja de retención FEM y señal de equity / demanda Seminuevos.</li>
  </ul>
  <p>El cruce cliente ↔ VIN permite pasar del KPI agregado (retención, CSI, CLV) al caso accionable: <em>quién</em>, <em>qué unidad</em> y <em>qué hacer</em>.</p>
  ${nextFig('s13-360-busqueda.png', 'Seguimiento 360: búsqueda por cliente, periodo y resumen de cierres de taller del mes.')}
  ${nextFig('s14-360-cliente.png', 'Ejemplo real — SAULO BERMEJO GARCIA: 12 ciclos, 1 compra, 2 pruebas, 4 unidades vinculadas, cliente de taller, 1 queja CSI.')}
  ${nextFig('s15-360-ciclo.png', 'Radiografía 360: última compra, último servicio, kilometraje registrado (p. ej. 80,703 km), 41 servicios, quejas e historial de compras.')}

  <h3>6.2 Pronóstico de próxima visita (km · carline · paquete · franjas FEM)</h3>
  <p>El 360 proyecta la <strong>próxima visita a taller</strong> a partir del comportamiento de consumo de kilómetros del VIN, diferenciado por <strong>carline</strong> y <strong>paquete</strong>, y alineado a las <strong>franjas de retención marcadas por planta en FEM</strong> (intervalos de servicio / mantenimiento que la armadora define para no perder al cliente fuera de red).</p>
  <div class="flow">
    <div><strong>1. Km observado</strong>Último odómetro en orden de taller + historial de visitas del VIN.</div>
    <div><strong>2. Ritmo por carline/paquete</strong>Consumo estimado (km/día o km/mes) según el perfil del modelo/versión.</div>
    <div><strong>3. Franja FEM planta</strong>Se ubica el VIN en la franja de retención vigente (próximo servicio / mantenimiento).</div>
    <div><strong>4. Pronóstico + acción</strong>Fecha estimada de próxima visita → contacto BDC/asesor antes de salir de franja.</div>
  </div>
  <ul>
    <li>Si el ritmo de km adelanta la franja FEM → priorizar contacto temprano.</li>
    <li>Si el VIN está fuera de franja o sin visita reciente → alerta de riesgo de retención (P-6) y pérdida de ingreso de taller.</li>
    <li>La ficha conserva último servicio, km registrado y conteo de servicios; el pronóstico los usa como base, no como sustituto del historial.</li>
  </ul>

  <h3>6.3 Seminuevos · modelos buscados y oferta de equity</h3>
  <p>El 360 identifica VINs cuyo <strong>carline / modelo / paquete</strong> está en la lista de compra del área de <strong>Seminuevos</strong>. Sobre esos casos se puede construir una oferta de <strong>equity</strong> (valor de toma / diferencial vs unidad nueva o seminuevo objetivo) para:</p>
  <ul>
    <li>facilitar la <strong>recompra</strong> (cliente cambia su unidad y genera una venta nueva en la agencia);</li>
    <li>alimentar el inventario de Seminuevos con unidades demandadas;</li>
    <li>conectar retención de taller con oportunidad comercial, sin mezclarlo con el embudo de leads fríos.</li>
  </ul>
  <div class="note"><strong>Lectura comercial:</strong> retención en taller mantiene al cliente en la red; equity + demanda Seminuevos convierte esa relación en recompra y nueva entrega (C-1 / P-6).</div>

  <h3>6.4 Clientes diamante</h3>
  <p>El 360 incluye una sección para identificar a los <strong>clientes diamante</strong>: cartera preferente con tratos diferenciados en la recompra o en una nueva operación. Un cliente diamante se caracteriza por:</p>
  <ul>
    <li><strong>Precios preferenciales</strong> — condiciones comerciales especiales sobre lista / paquete.</li>
    <li><strong>Aprobación inmediata en financiamiento</strong> — vía rápida en F&amp;I sin el ciclo ordinario de evaluación.</li>
  </ul>
  <p>La ficha marca el estatus diamante en el expediente (cliente y, cuando aplique, VIN vinculado) para que ventas, F&amp;I y gerencia prioricen el cierre sin fricción y sin perder el historial de taller / equity Seminuevos.</p>
  <div class="note"><strong>Uso operativo:</strong> si el cliente es diamante y además está en franja FEM o en demanda Seminuevos, el acompañamiento combina retención, equity y cierre acelerado (precio + financiamiento).</div>

  <h3>6.5 Órdenes de servicio y radiografía</h3>
  <div class="flow">
    <div><strong>1. Orden en taller</strong>Se abre/cierra en PostVenta (SER_ORDEN) con VIN, km, asesor e importe.</div>
    <div><strong>2. Cruce por VIN</strong>El 360 toma los VIN del cliente (CRM + factura) y trae todas las órdenes ligadas.</div>
    <div><strong>3. Ficha 360</strong>Actualiza: último servicio, kilometraje, # servicios, badge “Cliente de taller”, CLV, pronóstico FEM.</div>
    <div><strong>4. Decisión</strong>Queja CSI + franja FEM + señal Seminuevos/equity informan retención (P-6), CSI y recompra.</div>
  </div>
  <ul>
    <li><strong>PostVenta → 360:</strong> cada orden aporta ingreso a taller, fecha de ingreso/cierre, asesor, factura e importe. El filtro de periodo limita el listado; la ficha y el pronóstico usan el histórico del VIN.</li>
    <li><strong>360 → PostVenta:</strong> se identifica si es cliente de taller, cuántas unidades tiene y si hay queja ligada a una orden.</li>
    <li><strong>Kilometraje:</strong> último km en taller alimenta el ritmo de consumo y la proyección de próxima visita.</li>
    <li><strong>Quejas CSI:</strong> en timeline filtrable y en el contador de incidencias de la radiografía.</li>
    <li><strong>KPIs ABP tocados:</strong> <code>P-6</code> retención / CLV / tiempo entre compras y visitas; CSI/NPS; operativamente backlog de PostVenta y pipeline de recompra Seminuevos.</li>
  </ul>
  ${nextFig('s16-360-timeline.png', 'Historia del cliente: comercial, pruebas de manejo y queja CSI ligada a orden de taller (texto real de la incidencia).')}
  ${nextFig('s17-360-dominios.png', 'Desglose por dominio: actividad por año (incluye órdenes taller) y unidades vinculadas con # de órdenes y primera/última visita.')}
  ${nextFig('s18-360-taller.png', 'Tabla Órdenes de servicio del cliente: 41 órdenes, importe acumulado, serie/modelo, ingreso, cierre, asesor e importe — más pruebas de manejo con km.')}

  <div class="warn"><strong>Lectura práctica:</strong> si retención o CSI bajan, el 360 abre el caso por cliente o por VIN: franja FEM, km, queja, y —si aplica— oportunidad Seminuevos/equity. La acción es asignar seguimiento a BDC, taller o Seminuevos, no quedarse en el número agregado.</div>

  <h2 id="resumen">7. Resumen personalizable</h2>
  <ol>
    <li>Entra a <strong>Resumen</strong>.</li>
    <li>La primera vez verás <strong>8 espacios en blanco</strong>.</li>
    <li>Pulsa el <strong>+</strong> (o “Organizar espacios”) → elige el KPI permitido para tu perfil.</li>
    <li>Puedes dejar espacios vacíos o mover KPIs entre espacios.</li>
    <li>Guarda: la configuración queda asociada a tu usuario.</li>
  </ol>
  ${nextFig('r13-organizar-espacios.png', 'Diálogo “Elegir KPI del espacio”: selector de espacio 1–8 y catálogo filtrado por rol.')}

  <h2 id="ia">8. Alertas inteligentes, semáforo y agente IA</h2>
  <p>Las alertas enriquecen hallazgos operativos con el Mapa ABP: interpretación, valor de control, audiencia (<em>Usado por</em>) y acción del agente.</p>
  <div class="semaforo">
    <span class="s-verde"><i class="dot"></i> Verde · En control</span>
    <span class="s-amarillo"><i class="dot"></i> Amarillo · Requiere ajuste</span>
    <span class="s-rojo"><i class="dot"></i> Rojo · Riesgo alto</span>
  </div>
  <div class="flow">
    <div><strong>1. Dato KPI</strong>Se calcula el indicador del periodo.</div>
    <div><strong>2. Semáforo ABP</strong>Se compara vs valor de control del Excel.</div>
    <div><strong>3. Alerta en card</strong>Punto de color + popover (solo si el rol está en “Usado por”).</div>
    <div><strong>4. Agente / seguimiento</strong>Plan de acción IA o asignación en bandeja.</div>
  </div>
  ${nextFig('r08-alerta-ia.png', 'Popover real de alerta inteligente con semáforo, interpretación ABP y botón “Pedir plan de acción al agente”.')}
  ${nextFig('r10-notificaciones.png', 'Centro de notificaciones: alertas por severidad filtradas por preferencias del rol.')}
  ${nextFig('r09-seguimiento-asignar.png', 'Asignar seguimiento desde la alerta: responsable del directorio + nota con contexto del KPI.')}

  <h2 id="mensajes">9. Bandeja de mensajes · seguimiento de KPIs a la baja</h2>
  <p>La bandeja (icono Mensajes del topbar) es el canal de <strong>follow-up operativo</strong> cuando un KPI se sale de control. No es chat social: cada hilo nace de una alerta/KPI, tiene responsable, periodo y cierre documentado.</p>
  <ul>
    <li><strong>Pendientes:</strong> casos abiertos que el responsable debe atender (ej. “Revisar cobertura SOFIA…”).</li>
    <li><strong>Cerrados:</strong> historial de KPIs ya gestionados (inventario sin previas, carry over/cobertura, días promedio de stock, etc.).</li>
    <li><strong>Dentro del chat:</strong> alarma con vínculo al KPI, mensajes entre quien asignó y quien resolvió, y bloque verde de cierre (qué se realizó, periodo, cerrado por).</li>
  </ul>
  ${nextFig('s21-mensajes.png', 'Bandeja real: 4 mensajes — 1 pendiente y 3 cerrados de seguimiento a KPIs (sin previas, carry over, días de stock).')}
  ${nextFig('s22-mensajes-chat.png', 'Detalle de un seguimiento cerrado: alarma de cobertura, conversación admin↔comercial y resolución documentada.')}

  <h2 id="asistente">10. Asistente IA · expandido con gráficos</h2>
  <p>El <strong>Analista BALDERRAMA</strong> responde en chat y, al expandir visualizaciones, genera <strong>KPIs + gráficas</strong> (comparativo YTD, ventas por sucursal, distribución por estatus, etc.) a partir de las herramientas del periodo consultado.</p>
  ${nextFig('s19-ia-expandido.png', 'Asistente expandido: chat con desglose de ventas por modelo + panel de visualizaciones (indicadores y comparativo YTD).')}
  ${nextFig('s20-ia-graficos.png', 'Gráficos generados por el asistente: histórico 2025 vs 2026 y barras de ventas por sucursal.')}

  <h2 id="kpi-resumen">11. KPIs disponibles en el resumen personalizado</h2>
  <p>Catálogo de ${summary.length} indicadores colocables en los 8 espacios (filtrados por páginas del rol).</p>
  ${summaryTable}

  <h2 id="kpi-abp">12. Catálogo ABP 2026 · Mapa de indicadores (${kpi.count})</h2>
  <p>Fuente: hoja <em>Mapa de indicadores</em>. Base de interpretación, umbrales, responsable y audiencia de las alertas inteligentes.</p>
  ${kpiTables}

  <h2 id="alertas">13. Tipos de alertas operativas</h2>
  <table>
    <thead><tr><th>ID</th><th>Alerta</th><th>Categoría</th><th>Severidad</th><th>Descripción</th></tr></thead>
    <tbody>
      <tr><td><code>inventario_envejecidas</code></td><td>Inventario envejecido 60+</td><td>Inventario</td><td>high</td><td>Unidades disponibles con más de 60 días en piso.</td></tr>
      <tr><td><code>inventario_sin_previas</code></td><td>Stock sin previas</td><td>Inventario</td><td>medium</td><td>Unidades sin órdenes de servicio previas.</td></tr>
      <tr><td><code>plan_piso</code></td><td>Plan piso acumulado</td><td>Inventario</td><td>high</td><td>Intereses de plan piso en disponibles.</td></tr>
      <tr><td><code>entregas_sin_previa</code></td><td>Entregas sin previa</td><td>Ventas</td><td>medium</td><td>Entregas SOFIA sin previas de taller.</td></tr>
      <tr><td><code>sin_timbrar</code></td><td>Unidades sin timbrar</td><td>Ventas</td><td>medium</td><td>Facturas pendientes de timbrado.</td></tr>
      <tr><td><code>margen_asesores</code></td><td>Alerta de margen</td><td>Ventas</td><td>high</td><td>Asesores alto volumen · bajo margen.</td></tr>
      <tr><td><code>taller_abiertas</code></td><td>Órdenes abiertas</td><td>Postventa</td><td>low</td><td>Órdenes pendientes de facturar.</td></tr>
      <tr><td><code>sistema</code></td><td>Avisos del sistema</td><td>Sistema</td><td>low</td><td>Mensajes generales de la plataforma.</td></tr>
    </tbody>
  </table>

  <p class="caption">Documento generado a partir del código, del catálogo ABP 2026 y de capturas reales del proyecto Balderrama KPIs (incluidos submenús, 360 por cliente/VIN con franjas FEM y equity Seminuevos, bandeja de mensajes y asistente con gráficos).</p>
</div>
</body>
</html>`;

fs.writeFileSync('docs/guia-uso-balderrama.html', html, 'utf8');
console.log('OK', 'docs/guia-uso-balderrama.html', Buffer.byteLength(html), 'bytes', 'figs', figN - 1);
