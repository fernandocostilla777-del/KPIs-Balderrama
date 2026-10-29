/**
 * Ventas › Vendedores Cholula › Seguimiento del equipo.
 * Para que el gerente vea el trabajo de cada asesor:
 *  - Equipo hoy: cumplimiento de compromisos, vencidos, para hoy, clientes sin seguimiento y revisiones.
 *  - Clientes: etiqueta, compromiso que dejó el asesor en el CRM y la revisión que programa el gerente.
 *  - Agenda (al lado): el mes con lo vencido, lo por hacer y las revisiones; abajo, solo el día elegido.
 * Sin etiqueta del equipo se muestra la sugerida, con borde punteado, hasta que alguien la confirme.
 */
(() => {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const num = (n) => Number(n || 0).toLocaleString('es-MX');
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const POR_PAGINA = 40;
  const MAX_EVENTOS_DIA = 8;
  const ACTIVAS = ['caliente', 'seguimiento'];

  const estado = {
    data: null,
    clave: null,
    equipo: null,
    filtro: 'vencidos',
    etiqueta: '',
    vendedor: '',
    vendedorNombre: '',
    texto: '',
    visibles: POR_PAGINA,
    editando: null,
    guardando: false,
    error: '',
    foco: null,
    cal: { mes: null, dia: null, data: null, cargando: false, todos: false, manual: false },
  };

  const $ = (id) => document.getElementById(id);

  function fechaCorta(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${MESES[m - 1]}`;
  }

  function fechaHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()} ${MESES[d.getMonth()]} · ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function hace(dias) {
    if (dias == null) return '';
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias === -1) return 'mañana';
    return dias > 0 ? `hace ${num(dias)} días` : `en ${num(-dias)} días`;
  }

  function sumarDias(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  const hoy = () => estado.data?.hoy || estado.equipo?.hoy || (() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  })();

  function etiquetaDef(clave) {
    return (estado.data?.etiquetas || []).find((e) => e.clave === clave) || { clave, label: clave };
  }

  function pill(et, { boton = false, idCrm = '' } = {}) {
    const def = etiquetaDef(et.clave);
    const sugerida = et.origen === 'sugerida';
    const titulo = sugerida
      ? 'Sugerida por el avance en el CRM; confírmala o cámbiala'
      : et.origen === 'crm' ? 'El CRM registra la compra' : `Puesta por ${et.autor || 'el equipo'}`;
    const clase = `cc-pill cc-pill--${et.clave}${sugerida ? ' is-sugerida' : ''}`;
    const texto = `${esc(def.label)}${sugerida ? ' <small>sugerida</small>' : ''}`;
    if (boton && et.origen !== 'crm') {
      return `<button type="button" class="${clase}" data-cc-editar="${esc(idCrm)}" title="${esc(titulo)}">${texto}<span class="material-symbols-outlined" aria-hidden="true">expand_more</span></button>`;
    }
    return `<span class="${clase}" title="${esc(titulo)}">${texto}</span>`;
  }

  // ── Filtros ───────────────────────────────────────────────────────────────

  const esActivo = (c) => ACTIVAS.includes(c.etiqueta.clave) || (!!c.cartera && !['no_compra', 'compro'].includes(c.etiqueta.clave));
  const FILTROS = [
    { id: 'vencidos', label: 'Compromiso vencido', punto: 'alerta', prueba: (c) => !!c.compromiso?.vencido },
    { id: 'hoy', label: 'Para hoy', punto: 'caliente', prueba: (c) => c.compromiso && !c.compromiso.vencido && c.compromiso.fecha === hoy() },
    { id: 'sinseg', label: 'Sin seguimiento', punto: 'alerta', prueba: (c) => c.alertaSeguimiento, titulo: 'Calientes o en seguimiento sin actividad en más de 7 días' },
    { id: 'revision', label: 'Con revisión', punto: 'revision', prueba: (c) => !!c.revision },
    { id: 'activos', label: 'Activos', prueba: esActivo, titulo: 'Calientes, en seguimiento y la cartera del ejecutivo' },
    { id: 'todos', label: 'Todos', prueba: () => true },
  ];

  const delVendedor = (c) => !estado.vendedor || c.vendedorKey === estado.vendedor;

  function filtrados() {
    const lista = estado.data?.clientes || [];
    const texto = estado.texto.trim().toLowerCase();
    const f = FILTROS.find((x) => x.id === estado.filtro) || FILTROS[0];
    return lista.filter((c) => {
      if (!delVendedor(c)) return false;
      if (!f.prueba(c)) return false;
      if (estado.etiqueta && c.etiqueta.clave !== estado.etiqueta) return false;
      if (texto && !`${c.cliente} ${c.telefono} ${c.auto} ${c.cartera?.estatus || ''} ${(c.solicitudes || []).map((s) => s.folio).join(' ')}`.toLowerCase().includes(texto)) return false;
      return true;
    });
  }

  function pintarFiltros() {
    const caja = $('cholCarteraFiltros');
    if (!caja || !estado.data) return;
    const base = (estado.data.clientes || []).filter(delVendedor);
    const vendedores = [...new Map((estado.data.clientes || []).map((c) => [c.vendedorKey, c.vendedor])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'es'));
    caja.innerHTML = `
      <div class="cc-chips" role="group" aria-label="Filtrar clientes">
        ${FILTROS.map((f) => `<button type="button" class="cc-chip${estado.filtro === f.id ? ' is-on' : ''}" data-cc-filtro="${f.id}"${f.titulo ? ` title="${esc(f.titulo)}"` : ''} aria-pressed="${estado.filtro === f.id}">${f.punto ? `<i class="cc-dot cc-dot--${f.punto}"></i>` : ''}${esc(f.label)} <b>${num(base.filter(f.prueba).length)}</b></button>`).join('')}
      </div>
      <div class="cc-busqueda">
        <label class="cc-campo"><span class="sr-only">Asesor</span>
          <select id="cholCarteraVendedor">
            <option value="">Todo el equipo</option>
            ${vendedores.map(([k, v]) => `<option value="${esc(k)}"${k === estado.vendedor ? ' selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </label>
        <label class="cc-campo"><span class="sr-only">Etiqueta</span>
          <select id="cholCarteraEtiqueta">
            <option value="">Cualquier etiqueta</option>
            ${(estado.data.etiquetas || []).map((e) => `<option value="${esc(e.clave)}"${e.clave === estado.etiqueta ? ' selected' : ''}>${esc(e.label)}</option>`).join('')}
          </select>
        </label>
        <label class="cc-campo cc-campo--texto"><span class="material-symbols-outlined" aria-hidden="true">search</span><span class="sr-only">Buscar cliente</span>
          <input id="cholCarteraTexto" type="search" placeholder="Cliente, teléfono, auto o folio" value="${esc(estado.texto)}" autocomplete="off">
        </label>
      </div>`;
  }

  // ── Equipo hoy ───────────────────────────────────────────────────────────

  function pintarEquipo() {
    const body = $('cholEquipoBody');
    const e = estado.equipo;
    if (!body) return;
    if (!e) {
      body.innerHTML = '<tr><td colspan="6" class="empty-row">Cargando al equipo…</td></tr>';
      return;
    }
    const sub = $('cholEquipoSub');
    if (sub) sub.textContent = `Al ${fechaCorta(e.hoy)} · compromisos con fecha que cada asesor dejó en el CRM · clic en un asesor para ver sus clientes`;
    const nota = $('cholEquipoNota');
    if (nota) nota.textContent = e.nota || '';
    const fila = (v) => {
      const sel = estado.vendedor && estado.vendedor === v.key;
      const total = v.compromisos || 0;
      const ancho = (n) => (total ? Math.round((n / total) * 100) : 0);
      const barra = total
        ? `<div class="cs-barra" aria-hidden="true"><i class="cs-b-ok" style="width:${ancho(v.aTiempo)}%"></i><i class="cs-b-tarde" style="width:${ancho(v.tarde)}%"></i><i class="cs-b-venc" style="width:${ancho(v.vencidas)}%"></i></div>
           <span class="cc-sub">${v.pctATiempo == null ? '—' : `${Number(v.pctATiempo).toFixed(0)} % a tiempo`} · ${num(v.aTiempo)} de ${num(total)}</span>`
        : '<span class="cc-gris">Sin compromisos</span>';
      const cero = (n, clase = '') => (n ? `<span class="${clase}">${num(n)}</span>` : '<span class="cc-gris">0</span>');
      return `
        <tr class="cs-fila${sel ? ' is-open' : ''}" data-cs-asesor="${esc(v.key)}" data-cs-nombre="${esc(v.vendedor)}" tabindex="0" aria-pressed="${sel ? 'true' : 'false'}">
          <td class="cv-nombre">${esc(v.vendedor)}${v.pctATiempo == null ? '' : `<span class="cc-sub cs-solo-movil">${Number(v.pctATiempo).toFixed(0)} % a tiempo</span>`}</td>
          <td class="cc-col-op cs-cumpl">${barra}</td>
          <td class="num">${cero(v.vencidas, 'cs-chip cs-chip--ambar')}</td>
          <td class="num">${v.paraHoy ? `${num(v.paraHoy)}${v.paraHoyCumplidas ? ` <span class="cv-de">${num(v.paraHoyCumplidas)} ${v.paraHoyCumplidas === 1 ? 'lista' : 'listas'}</span>` : ''}` : '<span class="cc-gris">0</span>'}</td>
          <td class="num cc-col-op">${cero(v.sinSeguimiento)}</td>
          <td class="num">${v.revisiones ? `<span class="cs-chip cs-chip--violeta">${num(v.revisiones)}${v.revisionesHoy ? ' · hoy' : ''}</span>` : '<span class="cc-gris">—</span>'}</td>
        </tr>`;
    };
    const t = e.totales || {};
    body.innerHTML = (e.vendedores || []).map(fila).join('')
      || '<tr><td colspan="6" class="empty-row">Sin asesores en el equipo.</td></tr>';
    const foot = $('cholEquipoFoot');
    if (foot) {
      foot.innerHTML = `
        <tr class="cv-total">
          <td>Equipo</td>
          <td class="cc-col-op">${t.compromisos ? `${Math.round((t.aTiempo / t.compromisos) * 100)} % a tiempo · ${num(t.aTiempo)} de ${num(t.compromisos)}` : '—'}</td>
          <td class="num">${num(t.vencidas)}</td>
          <td class="num">${num(t.paraHoy)}</td>
          <td class="num cc-col-op">${num(t.sinSeguimiento)}</td>
          <td class="num">${num(t.revisiones)}</td>
        </tr>`;
    }
  }

  // ── Clientes ─────────────────────────────────────────────────────────────

  function avance(p) {
    const pasos = [['contacto', 'Contacto'], ['cita', 'Cita'], ['asistio', 'Asistió'], ['cotizacion', 'Cotizó'], ['credito', 'Crédito']];
    return pasos.map(([k, l]) => `<span class="cv-paso${p[k] ? ' is-ok' : ''}">${l}</span>`).join('');
  }

  function lineaCredito(c) {
    const lista = c.solicitudes || [];
    if (!lista.length) return '';
    const u = lista[0];
    const fin = u.financiera ? ` · ${esc(u.financiera)}` : '';
    return `<span class="cc-sub"><span class="cv-estatus${u.aprobada ? ' is-ok' : ''}">${esc(u.estatus || 'Solicitud')}</span>${fin}${u.fecha ? ` · ${fechaCorta(u.fecha)}` : ''}</span>`;
  }

  function lineaCartera(c) {
    if (!c.cartera) return '';
    return `<span class="cc-sub">Cartera · <b>${esc(c.cartera.estatus || 'Activa')}</b></span>`;
  }

  function detalleCredito(c) {
    const lista = c.solicitudes || [];
    if (!lista.length) return '';
    const items = lista.map((s) => {
      const partes = [
        s.financiera,
        s.folio ? `Folio ${s.folio}` : '',
        s.unidad,
        s.respuesta,
        s.contrato ? `Contrato ${s.contrato}` : '',
        s.enganche != null ? `Enganche ${Number(s.enganche).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })}` : '',
      ].filter(Boolean);
      return `<li><span class="cc-hist__fecha">${esc(fechaCorta(s.fecha) || '—')}</span><span><span class="cv-estatus${s.aprobada ? ' is-ok' : ''}">${esc(s.estatus || 'Solicitud')}</span> ${esc(partes.join(' · '))}</span></li>`;
    }).join('');
    return `<div class="cc-hist"><span class="cc-hist__fecha">Solicitudes de crédito</span><ul>${items}</ul></div>`;
  }

  function celdaCompromiso(c) {
    const k = c.compromiso;
    if (c.etiqueta.clave === 'compro') return '<span class="cc-gris">—</span>';
    if (!k) return `<span class="cc-gris">Sin compromiso con fecha</span>${lineaUltimo(c)}`;
    const clase = k.vencido ? 'cc-fecha is-vencida' : (k.fecha === hoy() ? 'cc-fecha is-hoy' : 'cc-fecha');
    const cuando = k.vencido ? `${fechaCorta(k.fecha)} · ${hace(k.dias)}` : (k.fecha === hoy() ? 'Hoy' : `${fechaCorta(k.fecha)} · ${hace(k.dias)}`);
    return `<span class="${clase}">${esc(cuando)}</span>${k.comentario ? `<span class="cc-sub cc-nota">«${esc(k.comentario)}»</span>` : ''}${lineaUltimo(c)}`;
  }

  function lineaUltimo(c) {
    const texto = c.ultimoSeguimiento ? `Última actividad ${hace(c.diasSinSeguimiento)}` : 'Sin actividad registrada';
    return `<span class="cc-sub${c.alertaSeguimiento ? ' cc-ultimo--alerta' : ''}">${esc(texto)}</span>`;
  }

  function celdaRevision(c) {
    const r = c.revision;
    if (!r) {
      return `<button type="button" class="cc-btn cc-btn--chico" data-cc-revisar="${esc(c.idCrm)}">Programar</button>`;
    }
    const vencida = r.fecha < hoy();
    const cuando = r.fecha === hoy() ? 'Hoy' : fechaCorta(r.fecha);
    return `<button type="button" class="cs-rev${vencida ? ' is-vencida' : ''}" data-cc-revisar="${esc(c.idCrm)}" title="${esc(r.nota || r.queLabel)}">${esc(cuando)}</button>
      <span class="cc-sub cc-nota">${esc(r.queLabel)}${r.asesorRegistro ? ' · el asesor ya registró actividad' : ''}</span>`;
  }

  function editorHtml(c) {
    const ed = estado.editando;
    const actual = c.etiqueta.origen === 'equipo' ? c.etiqueta : null;
    const sel = (ed.etiqueta !== undefined && ed.etiqueta !== null && ed.etiqueta !== '')
      ? ed.etiqueta
      : (actual?.clave || (c.etiqueta?.origen !== 'crm' ? c.etiqueta?.clave : '') || '');
    const motivoOk = sel !== 'no_compra' || !!(ed.motivo || actual?.motivo);
    const puedeGuardar = !estado.guardando && motivoOk && (sel || (actual && (ed.nota || '').trim()));
    const manuales = (estado.data.etiquetas || []).filter((e) => e.manual);
    const historial = (c.historial || []).map((h) => `
      <li><span class="cc-hist__fecha">${esc(fechaHora(h.fecha))}</span>
      <span>${h.etiqueta ? esc(etiquetaDef(h.etiqueta).label) : 'Quitó la etiqueta'}${h.motivoLabel ? ` · ${esc(h.motivoLabel)}` : ''}${h.nota ? ` — ${esc(h.nota)}` : ''}</span>
      <span class="cc-hist__autor">${esc(h.autor || '')}</span></li>`).join('');
    const r = c.revision;
    const manana = sumarDias(hoy(), 1);
    const bloqueRevision = r
      ? `<div class="cs-rev-actual">
          <p><b>Revisión del ${esc(fechaCorta(r.fecha))}</b> · ${esc(r.queLabel)}${r.nota ? ` — ${esc(r.nota)}` : ''}</p>
          <p class="cc-sub">Programada por ${esc(r.autor || 'el gerente')} el ${esc(fechaHora(r.creada))}${r.asesorRegistro ? ' · el asesor ya registró actividad después' : ' · el asesor no ha registrado actividad desde entonces'}</p>
          <div class="cc-editor__acciones">
            <button type="button" class="cc-btn cc-btn--primario" data-cs-cerrar="lista" data-cs-id="${esc(r.id)}"${estado.guardando ? ' disabled' : ''}>Marcar revisada</button>
            <button type="button" class="cc-quitar" data-cs-cerrar="cancelada" data-cs-id="${esc(r.id)}">Cancelar revisión</button>
          </div>
        </div>`
      : `<div class="cs-rev-form">
          <label class="cc-campo cc-campo--motivo"><span>Revisar el</span><input type="date" data-cs-fecha min="${esc(hoy())}" value="${esc(ed.rev?.fecha || manana)}"></label>
          <label class="cc-campo cc-campo--motivo"><span>Qué confirmar</span>
            <select data-cs-que>${(estado.data.queRevisar || []).map((q) => `<option value="${esc(q.clave)}"${q.clave === (ed.rev?.que || 'estatus') ? ' selected' : ''}>${esc(q.label)}</option>`).join('')}</select>
          </label>
          <label class="cc-campo cc-campo--nota"><span>Nota para el asesor <small>(opcional)</small></span><input type="text" data-cs-nota maxlength="500" value="${esc(ed.rev?.nota || '')}" placeholder="Ej. si no responde, pásalo a Frío"></label>
          <div class="cc-editor__acciones"><button type="button" class="cc-btn cc-btn--violeta" data-cs-programar${estado.guardando ? ' disabled' : ''}>Programar revisión</button></div>
        </div>`;
    return `
      <tr class="cc-editor-fila"><td colspan="4">
        <div class="cc-editor cs-editor" role="group" aria-label="Seguimiento de ${esc(c.cliente)}">
          <section class="cs-editor__col">
            <h4 class="cs-editor__titulo">Etiqueta</h4>
            <div class="cc-editor__opciones">
              ${manuales.map((e) => `<button type="button" class="cc-opcion cc-pill--${e.clave}${sel === e.clave ? ' is-on' : ''}" data-cc-opcion="${e.clave}" aria-pressed="${sel === e.clave}" title="${esc(e.descripcion || '')}">${esc(e.label)}</button>`).join('')}
            </div>
            ${sel === 'no_compra' ? `
            <label class="cc-campo cc-campo--motivo"><span>Motivo</span>
              <select data-cc-motivo>
                <option value="">Elige el motivo…</option>
                ${(estado.data.motivos || []).map((m) => `<option value="${esc(m.clave)}"${m.clave === (ed.motivo || '') ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
              </select>
            </label>` : ''}
            <label class="cc-campo cc-campo--nota"><span>Nota <small>(opcional)</small></span>
              <input type="text" data-cc-nota maxlength="500" value="${esc(ed.nota || '')}" placeholder="Ej. viene el sábado a firmar">
            </label>
            <div class="cc-editor__acciones">
              <button type="button" class="cc-btn cc-btn--primario" data-cc-guardar${puedeGuardar ? '' : ' disabled'}>${estado.guardando ? 'Guardando…' : (sel ? 'Guardar etiqueta' : 'Guardar nota')}</button>
              ${actual ? '<button type="button" class="cc-quitar" data-cc-quitar>Quitar etiqueta</button>' : ''}
            </div>
          </section>
          <section class="cs-editor__col cs-editor__col--rev">
            <h4 class="cs-editor__titulo"><i class="cc-dot cc-dot--revision"></i>Revisión del gerente</h4>
            ${bloqueRevision}
          </section>
          ${estado.error ? `<p class="cc-error">${esc(estado.error)}</p>` : ''}
          <div class="cs-editor__pie">
            <div class="cc-avance">${avance(c.pasos)}</div>
            ${detalleCredito(c)}
            ${historial ? `<details class="cc-hist"><summary>Historial de etiquetas (${c.historial.length})</summary><ul>${historial}</ul></details>` : ''}
            <button type="button" class="cc-btn" data-cc-cancelar>Cerrar</button>
          </div>
        </div>
      </td></tr>`;
  }

  function filaHtml(c) {
    const abierta = estado.editando?.idCrm === c.idCrm;
    const sub = [c.auto, c.campana].filter(Boolean).map(esc).join(' · ');
    const nota = c.etiqueta.origen === 'equipo' && (c.etiqueta.motivoLabel || c.etiqueta.nota)
      ? `<span class="cc-sub cc-nota">${esc([c.etiqueta.motivoLabel, c.etiqueta.nota].filter(Boolean).join(' — '))}</span>`
      : '';
    const clases = ['cc-fila'];
    if (abierta) clases.push('is-open');
    if (c.compromiso?.vencido) clases.push('has-vencido');
    if (estado.foco === c.idCrm) clases.push('is-foco');
    return `
      <tr class="${clases.join(' ')}" data-cc-fila="${esc(c.idCrm)}">
        <td class="cc-cliente">
          <strong>${esc(c.cliente)}</strong>
          <span class="cc-sub">${sub}${c.telefono ? `${sub ? ' · ' : ''}<a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : ''}</span>
          ${lineaCartera(c)}
          ${lineaCredito(c)}
          <span class="cc-sub cc-vend-sub">${esc(c.vendedor)}</span>
        </td>
        <td class="cc-col-etiqueta">${pill(c.etiqueta, { boton: true, idCrm: c.idCrm })}${nota}</td>
        <td class="cc-col-comp">${celdaCompromiso(c)}</td>
        <td class="cc-col-rev">${celdaRevision(c)}</td>
      </tr>
      ${abierta ? editorHtml(c) : ''}`;
  }

  function pintarTabla() {
    const body = $('cholCarteraBody');
    const mas = $('cholCarteraMas');
    if (!body || !estado.data) return;
    const tabla = $('cholCarteraTable');
    tabla?.classList.toggle('cc-tabla--equipo', !estado.vendedor);
    const lista = filtrados();
    const vista = lista.slice(0, estado.visibles);
    // El cliente abierto o señalado desde la agenda se queda visible aunque salga del filtro.
    for (const id of [estado.foco, estado.editando?.idCrm]) {
      if (id && !vista.some((c) => c.idCrm === id)) {
        const c = estado.data.clientes.find((x) => x.idCrm === id);
        if (c) vista.unshift(c);
      }
    }
    body.innerHTML = vista.length
      ? vista.map(filaHtml).join('')
      : `<tr><td colspan="4" class="empty-row">${estado.filtro === 'vencidos' ? 'Sin compromisos vencidos. ' : ''}Ningún cliente con este filtro.</td></tr>`;
    if (mas) {
      const faltan = lista.length - Math.min(lista.length, estado.visibles);
      mas.hidden = faltan <= 0;
      mas.textContent = `Mostrar ${num(Math.min(POR_PAGINA, faltan))} más de ${num(faltan)}`;
    }
  }

  function pintarEncabezado() {
    const d = estado.data;
    if (!d) return;
    const titulo = $('cholCarteraTitulo');
    if (titulo) titulo.textContent = estado.vendedorNombre ? `Clientes de ${estado.vendedorNombre}` : 'Clientes del equipo';
    const sub = $('cholCarteraSub');
    if (sub) {
      const base = (d.clientes || []).filter(delVendedor);
      sub.textContent = `${num(base.length)} clientes vivos al ${fechaCorta(d.fechaCorte)} · primero lo vencido`
        + `${estado.vendedorNombre ? '' : ' · elige un asesor arriba para ver solo los suyos'}`;
    }
    const nota = $('cholCarteraNota');
    if (nota) nota.textContent = d.nota || '';
  }

  function pintar() {
    pintarEquipo();
    pintarEncabezado();
    pintarFiltros();
    pintarTabla();
    pintarAgenda();
  }

  // ── Agenda ───────────────────────────────────────────────────────────────

  function mesDe(iso) { return String(iso || '').slice(0, 7); }

  async function cargarCalendario(mes) {
    const cal = estado.cal;
    cal.mes = mes;
    cal.cargando = true;
    pintarAgenda();
    try {
      const data = await api(`/ventas/monitoreo-cholula/calendario?mes=${mes}`);
      if (cal.mes !== mes) return;
      cal.data = data;
    } catch (err) {
      if (cal.mes === mes) cal.data = { mes, error: err.message || 'No se pudo cargar la agenda.', eventos: [], revisiones: [] };
    } finally {
      if (cal.mes === mes) cal.cargando = false;
      pintarAgenda();
    }
  }

  function eventosDelFiltro() {
    const data = estado.cal.data;
    if (!data || data.mes !== estado.cal.mes) return { eventos: [], revisiones: [] };
    const nombre = estado.vendedorNombre;
    const del = (v) => !nombre || v === nombre;
    return {
      eventos: (data.eventos || []).filter((e) => del(e.vendedor)),
      revisiones: (data.revisiones || []).filter((r) => del(r.vendedor)),
    };
  }

  function eventoHtml(ev) {
    const tono = ev.cumplida ? 'verde' : (ev.vencida ? 'ambar' : 'azul');
    const estadoTxt = ev.cumplida
      ? (ev.aTiempo ? 'Cumplida' : `Cumplida tarde · ${fechaCorta(ev.respuesta)}`)
      : (ev.vencida ? 'Sin cumplir' : 'Por hacer');
    const tipo = ev.tipo && ev.tipo !== ev.comentario ? ` · ${esc(ev.tipo.toLowerCase())}` : '';
    return `<button type="button" class="cs-evento cs-evento--${tono}" data-cs-cliente="${esc(ev.idCrm || '')}">
      <strong>${esc(ev.cliente)}</strong>
      <span class="cs-evento__que">${esc(ev.comentario)}</span>
      <span class="cs-evento__meta">${esc(ev.vendedor)}${tipo} · <b>${esc(estadoTxt)}</b></span>
    </button>`;
  }

  function revisionHtml(r) {
    const cerrada = r.estado !== 'pendiente';
    return `<div class="cs-evento cs-evento--violeta${cerrada ? ' is-cerrada' : ''}">
      <button type="button" class="cs-evento__abrir" data-cs-cliente="${esc(r.idCrm)}">
        <strong>${esc(r.cliente)}</strong>
        <span class="cs-evento__que">${esc(r.queLabel)}${r.nota ? ` — ${esc(r.nota)}` : ''}</span>
        <span class="cs-evento__meta">${esc(r.vendedor || '')}${cerrada ? ` · <b>${r.estado === 'lista' ? 'Revisada' : 'Cancelada'}</b>` : ''}</span>
      </button>
      ${cerrada ? '' : `<button type="button" class="cc-btn cc-btn--chico" data-cs-cerrar="lista" data-cs-id="${esc(r.id)}">Revisada</button>`}
    </div>`;
  }

  function pintarAgenda() {
    const host = $('cholAgenda');
    if (!host) return;
    const cal = estado.cal;
    const hoyDia = hoy();
    if (!cal.mes) cal.mes = mesDe(hoyDia);
    if (!cal.dia || mesDe(cal.dia) !== cal.mes) cal.dia = mesDe(hoyDia) === cal.mes ? hoyDia : `${cal.mes}-01`;
    const [anio, mesNum] = cal.mes.split('-').map(Number);
    const { eventos, revisiones } = eventosDelFiltro();
    const porDia = new Map();
    const marca = (iso) => {
      if (!porDia.has(iso)) porDia.set(iso, { venc: 0, hacer: 0, ok: 0, rev: 0 });
      return porDia.get(iso);
    };
    for (const e of eventos) {
      const m = marca(e.fecha);
      if (e.cumplida) m.ok += 1; else if (e.vencida) m.venc += 1; else m.hacer += 1;
    }
    for (const r of revisiones) if (r.estado === 'pendiente') marca(r.fecha).rev += 1;
    const huecos = (new Date(anio, mesNum - 1, 1).getDay() + 6) % 7;
    const ultimo = new Date(anio, mesNum, 0).getDate();
    const celdas = [];
    for (let i = 0; i < huecos; i += 1) celdas.push('<span class="cs-dia is-vacio"></span>');
    for (let dia = 1; dia <= ultimo; dia += 1) {
      const iso = `${cal.mes}-${String(dia).padStart(2, '0')}`;
      const m = porDia.get(iso);
      const puntos = [];
      if (m?.venc) puntos.push('<i class="cs-p cs-p--ambar"></i>');
      if (m?.hacer) puntos.push('<i class="cs-p cs-p--azul"></i>');
      if (m?.rev) puntos.push('<i class="cs-p cs-p--violeta"></i>');
      if (m && !m.venc && !m.hacer && m.ok) puntos.push('<i class="cs-p cs-p--verde"></i>');
      const clases = ['cs-dia'];
      if (iso < hoyDia) clases.push('is-pasado');
      if (iso === hoyDia) clases.push('is-hoy');
      if (iso === cal.dia) clases.push('is-sel');
      const titulo = m ? [m.venc && `${m.venc} sin cumplir`, m.hacer && `${m.hacer} por hacer`, m.rev && `${m.rev} revisiones`, m.ok && `${m.ok} cumplidas`].filter(Boolean).join(' · ') : 'Sin actividades';
      celdas.push(`<button type="button" class="${clases.join(' ')}" data-cs-dia="${iso}" aria-pressed="${iso === cal.dia}" title="${esc(titulo)}"><span>${dia}</span><span class="cs-ps">${puntos.join('')}</span></button>`);
    }
    const delDia = eventos.filter((e) => e.fecha === cal.dia);
    const revDia = revisiones.filter((r) => r.fecha === cal.dia);
    const orden = (a, b) => Number(a.cumplida) - Number(b.cumplida) || a.vendedor.localeCompare(b.vendedor, 'es');
    delDia.sort(orden);
    const tope = window.matchMedia?.('(max-width: 639px)').matches ? 4 : MAX_EVENTOS_DIA;
    const visibles = cal.todos ? delDia : delDia.slice(0, tope);
    const pend = delDia.filter((e) => !e.cumplida).length;
    const esPasado = cal.dia < hoyDia;
    const tituloDia = cal.dia === hoyDia ? `Hoy, ${fechaCorta(cal.dia)}` : fechaCorta(cal.dia);
    let cuerpo;
    if (cal.cargando && !cal.data) cuerpo = '<p class="cv-leyenda">Cargando agenda…</p>';
    else if (cal.data?.error) cuerpo = `<p class="cv-leyenda">${esc(cal.data.error)}</p>`;
    else {
      cuerpo = `
        ${revDia.length ? `<div class="cs-grupo"><h4><i class="cs-p cs-p--violeta"></i>Revisiones · ${num(revDia.length)}</h4>${revDia.map(revisionHtml).join('')}</div>` : ''}
        <div class="cs-grupo">
          <h4><i class="cs-p ${esPasado ? 'cs-p--ambar' : 'cs-p--azul'}"></i>Compromisos · ${num(delDia.length)}${pend ? ` <span class="cv-de">${num(pend)} ${esPasado ? 'sin cumplir' : (pend === 1 ? 'pendiente' : 'pendientes')}</span>` : ''}</h4>
          ${visibles.length ? visibles.map(eventoHtml).join('') : '<p class="cv-leyenda">Ese día el equipo no tiene compromisos.</p>'}
          ${delDia.length > visibles.length ? `<button type="button" class="cc-mas" data-cs-todos>Ver los ${num(delDia.length)}</button>` : ''}
        </div>
        ${resumenVencidas()}`;
    }
    host.innerHTML = `
      <div class="cs-agenda__cab">
        <h3 class="cv-subtitulo">${esc(MESES_LARGOS[mesNum - 1])} ${anio}</h3>
        <div class="cs-flechas">
          <button type="button" class="cs-flecha" data-cs-mes="-1" aria-label="Mes anterior"><span class="material-symbols-outlined" aria-hidden="true">chevron_left</span></button>
          <button type="button" class="cs-flecha" data-cs-mes="0" aria-label="Ir a hoy">Hoy</button>
          <button type="button" class="cs-flecha" data-cs-mes="1" aria-label="Mes siguiente"><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
        </div>
      </div>
      <p class="cv-leyenda cs-agenda__quien">${estado.vendedorNombre ? `Agenda de ${esc(estado.vendedorNombre)}` : 'Agenda de todo el equipo'}</p>
      <div class="cs-mes" role="group" aria-label="Días del mes">
        ${DIAS_SEMANA.map((d) => `<span class="cs-dn">${d}</span>`).join('')}
        ${celdas.join('')}
      </div>
      <div class="cs-ley">
        <span><i class="cs-p cs-p--ambar"></i>sin cumplir</span><span><i class="cs-p cs-p--azul"></i>por hacer</span><span><i class="cs-p cs-p--violeta"></i>revisión</span><span><i class="cs-p cs-p--verde"></i>todo cumplido</span>
      </div>
      <h3 class="cs-agenda__dia">${esc(tituloDia)}</h3>
      ${cuerpo}`;
  }

  function resumenVencidas() {
    const e = estado.equipo;
    if (!e || estado.vendedor) return '';
    const con = (e.vendedores || []).filter((v) => v.vencidas).sort((a, b) => b.vencidas - a.vencidas);
    if (!con.length) return '';
    return `<div class="cs-grupo"><h4><i class="cs-p cs-p--ambar"></i>Vencidos del equipo · ${num(e.totales?.vencidas)}</h4>
      <p class="cs-vencidos">${con.map((v) => `<button type="button" class="cs-link" data-cs-asesor="${esc(v.key)}" data-cs-nombre="${esc(v.vendedor)}">${esc(v.vendedor.split(' ')[0])} ${num(v.vencidas)}</button>`).join(' · ')}</p>
      <p class="cv-leyenda">Últimos ${num(e.ventanaDias)} días</p></div>`;
  }

  // ── Carga ────────────────────────────────────────────────────────────────

  async function cargarEquipo(fechaInicio, opts = {}) {
    try {
      const q = new URLSearchParams(fechaInicio ? { fechaInicio } : {});
      estado.equipo = await api(`/ventas/monitoreo-cholula/equipo?${q}`);
    } catch (err) {
      estado.equipo = null;
      const body = $('cholEquipoBody');
      if (body) body.innerHTML = `<tr><td colspan="6" class="empty-row">${esc(err.message || 'No se pudo cargar al equipo.')}</td></tr>`;
      return;
    }
    if (!opts.silencioso) pintar();
    else { pintarEquipo(); pintarAgenda(); }
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    if (!fechaFin) return null;
    const clave = `${fechaInicio}|${fechaFin}`;
    if (!opts.force && estado.clave === clave && estado.data) {
      pintar();
      return estado.data;
    }
    const body = $('cholCarteraBody');
    if (body && !opts.silencioso) body.innerHTML = '<tr><td colspan="4" class="empty-row">Cargando clientes…</td></tr>';
    const q = new URLSearchParams({ fechaInicio, fechaFin });
    const equipo = cargarEquipo(fechaInicio, { silencioso: true });
    if (!estado.cal.manual || !estado.cal.data) void cargarCalendario(estado.cal.mes || mesDe(hoy()));
    try {
      const data = await api(`/ventas/monitoreo-cholula/clientes?${q}`);
      estado.data = data;
      estado.clave = clave;
      if (!opts.silencioso) {
        estado.editando = null;
        estado.visibles = POR_PAGINA;
      }
      if (!estado.cal.manual && mesDe(data.hoy) !== estado.cal.mes) void cargarCalendario(mesDe(data.hoy));
      await equipo;
      pintar();
      return data;
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="4" class="empty-row">${esc(err.message || 'No se pudo cargar la cartera.')}</td></tr>`;
      return null;
    }
  }

  async function recargarTodo() {
    const [fi, ff] = String(estado.clave || '|').split('|');
    await Promise.all([
      load(fi, ff, { force: true, silencioso: true }),
      cargarCalendario(estado.cal.mes || mesDe(hoy())),
    ]);
  }

  function contar(key) {
    if (!estado.data) return null;
    return (estado.data.clientes || []).filter((c) => !key || c.vendedorKey === key).length;
  }

  /** Lo llaman el ranking y la tabla del equipo al elegir un asesor (o null para todo el equipo). */
  function verVendedor(key, nombre) {
    estado.vendedor = key || '';
    estado.vendedorNombre = key ? (nombre || '') : '';
    estado.visibles = POR_PAGINA;
    estado.editando = null;
    estado.foco = null;
    estado.cal.todos = false;
    if (estado.data) pintar();
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  function leerEditor() {
    const caja = document.querySelector('#cholCarteraBody .cc-editor');
    const ed = estado.editando;
    if (!caja || !ed) return;
    const motivo = caja.querySelector('[data-cc-motivo]');
    const nota = caja.querySelector('[data-cc-nota]');
    if (motivo) ed.motivo = motivo.value;
    if (nota) ed.nota = nota.value;
    const f = caja.querySelector('[data-cs-fecha]');
    const q = caja.querySelector('[data-cs-que]');
    const n = caja.querySelector('[data-cs-nota]');
    ed.rev = {
      fecha: f ? f.value : ed.rev?.fecha,
      que: q ? q.value : ed.rev?.que,
      nota: n ? n.value : ed.rev?.nota,
    };
  }

  async function enviar(fn) {
    if (estado.guardando) return;
    leerEditor();
    estado.guardando = true;
    estado.error = '';
    pintarTabla();
    try {
      await fn();
      await recargarTodo();
      return true;
    } catch (err) {
      estado.error = err.message || 'No se pudo guardar.';
      return false;
    } finally {
      estado.guardando = false;
      pintarTabla();
    }
  }

  function guardarEtiqueta(quitar = false) {
    const e = estado.editando;
    if (!e) return;
    leerEditor();
    const c = estado.data?.clientes.find((x) => x.idCrm === e.idCrm);
    const actual = c?.etiqueta?.origen === 'equipo' ? c.etiqueta : null;
    let etiqueta = quitar ? '' : (e.etiqueta || actual?.clave || '');
    if (!quitar && !etiqueta && (e.nota || '').trim() && actual?.clave) etiqueta = '';
    if (!quitar && !etiqueta && !(e.nota || '').trim()) {
      estado.error = 'Elige una etiqueta o escribe una nota.';
      pintarTabla();
      return;
    }
    if (!quitar && etiqueta === 'no_compra' && !(e.motivo || actual?.motivo)) {
      estado.error = 'Indica el motivo de «No compra».';
      pintarTabla();
      return;
    }
    void enviar(() => api(`/ventas/monitoreo-cholula/clientes/${encodeURIComponent(e.idCrm)}`, {
      method: 'PUT',
      body: JSON.stringify(quitar
        ? { etiqueta: '' }
        : {
          etiqueta,
          motivo: e.motivo || actual?.motivo || '',
          nota: e.nota,
        }),
    }));
  }

  function programarRevision() {
    const e = estado.editando;
    if (!e) return;
    void enviar(() => api(`/ventas/monitoreo-cholula/clientes/${encodeURIComponent(e.idCrm)}/revisiones`, {
      method: 'POST',
      body: JSON.stringify({ fecha: e.rev?.fecha, que: e.rev?.que, nota: e.rev?.nota }),
    }));
  }

  function cerrarRevision(id, estadoNuevo) {
    void enviar(() => api(`/ventas/monitoreo-cholula/revisiones/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ estado: estadoNuevo }),
    }));
  }

  function abrirEditor(id) {
    const c = estado.data?.clientes.find((x) => x.idCrm === id);
    if (!c) return;
    const propia = c.etiqueta.origen === 'equipo';
    estado.editando = {
      idCrm: id,
      etiqueta: propia ? c.etiqueta.clave : (c.etiqueta.clave === 'compro' ? '' : c.etiqueta.clave || ''),
      motivo: propia ? c.etiqueta.motivo || '' : '',
      nota: propia ? c.etiqueta.nota || '' : '',
      rev: null,
    };
    estado.error = '';
  }

  function enfocarCliente(id) {
    if (!id) return;
    const c = estado.data?.clientes.find((x) => x.idCrm === id);
    if (!c) {
      estado.error = '';
      const sub = $('cholCarteraSub');
      if (sub) sub.textContent = 'Ese cliente ya no está en la cartera viva de Cholula.';
      return;
    }
    estado.foco = id;
    abrirEditor(id);
    pintarTabla();
    document.querySelector(`#cholCarteraBody [data-cc-fila="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function elegirAsesor(key, nombre) {
    if (estado.vendedor === key) verVendedor(null);
    else verVendedor(key, nombre);
  }

  const sec = $('cholSeguimiento');
  sec?.addEventListener('click', (ev) => {
    const t = ev.target;
    const asesor = t.closest('[data-cs-asesor]');
    if (asesor) { elegirAsesor(asesor.dataset.csAsesor, asesor.dataset.csNombre); return; }
    const filtro = t.closest('[data-cc-filtro]');
    if (filtro) {
      estado.filtro = filtro.dataset.ccFiltro;
      estado.visibles = POR_PAGINA;
      estado.foco = null;
      pintarFiltros();
      pintarTabla();
      return;
    }
    const editar = t.closest('[data-cc-editar], [data-cc-revisar]');
    if (editar) {
      const id = editar.dataset.ccEditar || editar.dataset.ccRevisar;
      if (estado.editando?.idCrm === id) estado.editando = null;
      else abrirEditor(id);
      pintarTabla();
      return;
    }
    const opcion = t.closest('[data-cc-opcion]');
    if (opcion && estado.editando) {
      leerEditor();
      estado.editando.etiqueta = opcion.dataset.ccOpcion;
      estado.error = '';
      pintarTabla();
      return;
    }
    if (t.closest('[data-cc-guardar]')) { guardarEtiqueta(false); return; }
    if (t.closest('[data-cc-quitar]')) { guardarEtiqueta(true); return; }
    if (t.closest('[data-cs-programar]')) { programarRevision(); return; }
    const cerrar = t.closest('[data-cs-cerrar]');
    if (cerrar) { cerrarRevision(cerrar.dataset.csId, cerrar.dataset.csCerrar); return; }
    if (t.closest('[data-cc-cancelar]')) {
      estado.editando = null;
      estado.foco = null;
      estado.error = '';
      pintarTabla();
      return;
    }
    if (t.id === 'cholCarteraMas') {
      estado.visibles += POR_PAGINA;
      pintarTabla();
      return;
    }
    const dia = t.closest('[data-cs-dia]');
    if (dia) {
      estado.cal.dia = dia.dataset.csDia;
      estado.cal.todos = false;
      pintarAgenda();
      return;
    }
    const mes = t.closest('[data-cs-mes]');
    if (mes) {
      const paso = Number(mes.dataset.csMes);
      const cal = estado.cal;
      if (paso === 0) {
        cal.manual = false;
        cal.dia = hoy();
        void cargarCalendario(mesDe(hoy()));
        return;
      }
      cal.manual = true;
      const [y, m] = cal.mes.split('-').map(Number);
      const d = new Date(y, m - 1 + paso, 1);
      cal.dia = null;
      void cargarCalendario(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      return;
    }
    if (t.closest('[data-cs-todos]')) { estado.cal.todos = true; pintarAgenda(); return; }
    const cliente = t.closest('[data-cs-cliente]');
    if (cliente) enfocarCliente(cliente.dataset.csCliente);
  });
  sec?.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('tr[data-cs-asesor]')) {
      ev.preventDefault();
      elegirAsesor(ev.target.dataset.csAsesor, ev.target.dataset.csNombre);
      return;
    }
    if (ev.key === 'Enter' && ev.target.matches?.('[data-cc-nota]')) {
      ev.preventDefault();
      guardarEtiqueta(false);
    }
  });
  sec?.addEventListener('change', (ev) => {
    if (ev.target.id === 'cholCarteraVendedor') {
      const opt = ev.target.selectedOptions[0];
      verVendedor(ev.target.value, ev.target.value ? opt?.textContent : '');
    }
    if (ev.target.id === 'cholCarteraEtiqueta') {
      estado.etiqueta = ev.target.value;
      estado.visibles = POR_PAGINA;
      pintarTabla();
    }
  });
  sec?.addEventListener('input', (ev) => {
    if (ev.target.id === 'cholCarteraTexto') {
      estado.texto = ev.target.value;
      estado.visibles = POR_PAGINA;
      pintarTabla();
    }
    if (ev.target.matches?.('[data-cc-nota], [data-cc-motivo]') && estado.editando) {
      leerEditor();
      pintarTabla();
    }
  });

  window.CarteraCholula = { load, verVendedor, contar, enfocarCliente };
})();
