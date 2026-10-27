/**
 * Ventas › Vendedores Cholula › Seguimiento de clientes.
 * Cartera viva de Cholula (leads dentro de su vida) con una etiqueta por cliente:
 * caliente, en seguimiento, frío, no va a comprar (con motivo) o compró (del CRM).
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
  const POR_PAGINA = 50;
  const ORDEN = ['caliente', 'seguimiento', 'frio', 'no_compra', 'compro'];

  const estado = {
    data: null,
    clave: null,
    filtro: 'activos',
    soloAlertas: false,
    vendedor: '',
    vendedorNombre: '',
    texto: '',
    visibles: POR_PAGINA,
    editando: null,
    guardando: false,
    error: '',
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

  function filtrados() {
    const lista = estado.data?.clientes || [];
    const texto = estado.texto.trim().toLowerCase();
    return lista.filter((c) => {
      if (estado.vendedor && c.vendedorKey !== estado.vendedor) return false;
      if (estado.filtro === 'activos' && !['caliente', 'seguimiento'].includes(c.etiqueta.clave)) return false;
      if (estado.filtro !== 'todos' && estado.filtro !== 'activos' && c.etiqueta.clave !== estado.filtro) return false;
      if (estado.soloAlertas && !c.alertaSeguimiento) return false;
      if (texto && !`${c.cliente} ${c.telefono} ${c.auto}`.toLowerCase().includes(texto)) return false;
      return true;
    });
  }

  /** Conteos con el vendedor elegido aplicado, para que los filtros cuadren con la tabla. */
  function conteos() {
    const lista = (estado.data?.clientes || []).filter((c) => (
      (!estado.vendedor || c.vendedorKey === estado.vendedor)
    ));
    const out = { todos: lista.length, activos: 0, alertas: 0 };
    for (const k of ORDEN) out[k] = 0;
    for (const c of lista) {
      out[c.etiqueta.clave] += 1;
      if (c.etiqueta.clave === 'caliente' || c.etiqueta.clave === 'seguimiento') out.activos += 1;
      if (c.alertaSeguimiento) out.alertas += 1;
    }
    return out;
  }

  function pintarFiltros() {
    const caja = $('cholCarteraFiltros');
    if (!caja || !estado.data) return;
    const n = conteos();
    const chips = [
      { id: 'activos', label: 'Activos', titulo: 'Calientes y en seguimiento' },
      ...ORDEN.map((k) => ({ id: k, label: etiquetaDef(k).label, punto: k })),
      { id: 'todos', label: 'Todos' },
    ];
    const vendedores = [...new Map((estado.data.clientes || []).map((c) => [c.vendedorKey, c.vendedor])).entries()]
      .sort((a, b) => (a[1] === 'Sin asignar') - (b[1] === 'Sin asignar') || a[1].localeCompare(b[1], 'es'));
    caja.innerHTML = `
      <div class="cc-chips" role="group" aria-label="Filtrar por etiqueta">
        ${chips.map((c) => `<button type="button" class="cc-chip${estado.filtro === c.id ? ' is-on' : ''}" data-cc-filtro="${c.id}"${c.titulo ? ` title="${esc(c.titulo)}"` : ''} aria-pressed="${estado.filtro === c.id}">${c.punto ? `<i class="cc-dot cc-dot--${c.punto}"></i>` : ''}${esc(c.label)} <b>${num(n[c.id])}</b></button>`).join('')}
        <button type="button" class="cc-chip cc-chip--alerta${estado.soloAlertas ? ' is-on' : ''}" data-cc-alertas aria-pressed="${estado.soloAlertas}" title="Calientes o en seguimiento sin actividad registrada en más de ${num(estado.data.diasSinSeguimiento)} días"><i class="cc-dot cc-dot--alerta"></i>Sin seguimiento <b>${num(n.alertas)}</b></button>
      </div>
      <div class="cc-busqueda">
        <label class="cc-campo"><span class="sr-only">Vendedor</span>
          <select id="cholCarteraVendedor">
            <option value="">Todos los vendedores</option>
            ${vendedores.map(([k, v]) => `<option value="${esc(k)}"${k === estado.vendedor ? ' selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </label>
        <label class="cc-campo cc-campo--texto"><span class="material-symbols-outlined" aria-hidden="true">search</span><span class="sr-only">Buscar cliente</span>
          <input id="cholCarteraTexto" type="search" placeholder="Cliente, teléfono o auto" value="${esc(estado.texto)}" autocomplete="off">
        </label>
      </div>`;
  }

  function avance(p) {
    const pasos = [['contacto', 'Contacto'], ['cita', 'Cita'], ['asistio', 'Asistió'], ['cotizacion', 'Cotizó']];
    return pasos.map(([k, l]) => `<span class="cv-paso${p[k] ? ' is-ok' : ''}">${l}</span>`).join('');
  }

  function celdaSeguimiento(c) {
    if (c.etiqueta.clave === 'compro') return '<span class="cc-gris">—</span>';
    const alerta = c.alertaSeguimiento ? ' cc-alerta' : '';
    if (!c.ultimoSeguimiento) return `<span class="cc-seg${alerta}">Sin registro</span>`;
    const dias = c.diasSinSeguimiento;
    const hace = dias === 0 ? 'hoy' : dias === 1 ? 'hace 1 día' : `hace ${num(dias)} días`;
    return `<span class="cc-seg${alerta}">${hace}</span><span class="cc-sub">${fechaCorta(c.ultimoSeguimiento)} · ${num(c.seguimientos)} ${c.seguimientos === 1 ? 'actividad' : 'actividades'}</span>`;
  }

  function editorHtml(c) {
    const actual = c.etiqueta.origen === 'equipo' ? c.etiqueta : null;
    const sel = estado.editando?.etiqueta ?? (actual?.clave || '');
    const motivo = estado.editando?.motivo ?? (actual?.motivo || '');
    const nota = estado.editando?.nota ?? (actual?.nota || '');
    const manuales = (estado.data.etiquetas || []).filter((e) => e.manual);
    const historial = (c.historial || []).map((h) => `
      <li><span class="cc-hist__fecha">${esc(fechaHora(h.fecha))}</span>
      <span>${h.etiqueta ? esc(etiquetaDef(h.etiqueta).label) : 'Quitó la etiqueta'}${h.motivoLabel ? ` · ${esc(h.motivoLabel)}` : ''}${h.nota ? ` — ${esc(h.nota)}` : ''}</span>
      <span class="cc-hist__autor">${esc(h.autor || '')}</span></li>`).join('');
    return `
      <tr class="cc-editor-fila"><td colspan="6">
        <div class="cc-editor" role="group" aria-label="Etiqueta de ${esc(c.cliente)}">
          <div class="cc-editor__opciones">
            ${manuales.map((e) => `<button type="button" class="cc-opcion cc-pill--${e.clave}${sel === e.clave ? ' is-on' : ''}" data-cc-opcion="${e.clave}" aria-pressed="${sel === e.clave}" title="${esc(e.descripcion || '')}">${esc(e.label)}</button>`).join('')}
          </div>
          ${sel === 'no_compra' ? `
          <label class="cc-campo cc-campo--motivo"><span>Motivo</span>
            <select data-cc-motivo>
              <option value="">Elige el motivo…</option>
              ${(estado.data.motivos || []).map((m) => `<option value="${esc(m.clave)}"${m.clave === motivo ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </label>` : ''}
          <label class="cc-campo cc-campo--nota"><span>Nota <small>(opcional)</small></span>
            <input type="text" data-cc-nota maxlength="500" value="${esc(nota)}" placeholder="Ej. viene el sábado a firmar">
          </label>
          ${estado.error ? `<p class="cc-error">${esc(estado.error)}</p>` : ''}
          <div class="cc-editor__acciones">
            <button type="button" class="cc-btn cc-btn--primario" data-cc-guardar${sel && !estado.guardando ? '' : ' disabled'}>${estado.guardando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" class="cc-btn" data-cc-cancelar>Cancelar</button>
            ${actual ? '<button type="button" class="cc-quitar" data-cc-quitar>Quitar etiqueta</button>' : ''}
          </div>
          ${historial ? `<details class="cc-hist"><summary>Historial (${c.historial.length})</summary><ul>${historial}</ul></details>` : ''}
        </div>
      </td></tr>`;
  }

  function filaHtml(c) {
    const abierta = estado.editando?.idCrm === c.idCrm;
    const sub = [c.auto, c.campana].filter(Boolean).map(esc).join(' · ');
    const nota = c.etiqueta.origen === 'equipo' && (c.etiqueta.motivoLabel || c.etiqueta.nota)
      ? `<span class="cc-sub cc-nota">${esc([c.etiqueta.motivoLabel, c.etiqueta.nota].filter(Boolean).join(' — '))}</span>`
      : '';
    return `
      <tr class="cc-fila${abierta ? ' is-open' : ''}${c.alertaSeguimiento ? ' has-alerta' : ''}">
        <td class="cc-cliente">
          <strong>${esc(c.cliente)}</strong>
          <span class="cc-sub">${sub}${c.telefono ? `${sub ? ' · ' : ''}<a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : ''}</span>
          <span class="cc-sub cc-solo-movil">${esc(c.vendedor)}</span>
        </td>
        <td class="cc-col-vend">${esc(c.vendedor)}</td>
        <td class="cc-col-op"><span>${fechaCorta(c.fechaEntrada)}</span><span class="cc-sub">${c.diasRestantes > 0 ? `quedan ${num(c.diasRestantes)} días` : 'último día'}</span></td>
        <td class="cc-col-seg">${celdaSeguimiento(c)}</td>
        <td class="cc-col-op cc-avance">${avance(c.pasos)}</td>
        <td class="cc-col-etiqueta">${pill(c.etiqueta, { boton: true, idCrm: c.idCrm })}${nota}</td>
      </tr>
      ${abierta ? editorHtml(c) : ''}`;
  }

  function pintarTabla() {
    const body = $('cholCarteraBody');
    const mas = $('cholCarteraMas');
    if (!body || !estado.data) return;
    const lista = filtrados();
    const vista = lista.slice(0, estado.visibles);
    // El cliente que se está editando no desaparece aunque su nueva etiqueta salga del filtro.
    if (estado.editando && !vista.some((c) => c.idCrm === estado.editando.idCrm)) {
      const c = estado.data.clientes.find((x) => x.idCrm === estado.editando.idCrm);
      if (c) vista.unshift(c);
    }
    body.innerHTML = vista.length
      ? vista.map(filaHtml).join('')
      : '<tr><td colspan="6" class="empty-row">Ningún cliente con este filtro.</td></tr>';
    if (mas) {
      const faltan = lista.length - Math.min(lista.length, estado.visibles);
      mas.hidden = faltan <= 0;
      mas.textContent = `Mostrar ${num(Math.min(POR_PAGINA, faltan))} más de ${num(faltan)}`;
    }
  }

  function pintarEncabezado() {
    const d = estado.data;
    const sub = $('cholCarteraSub');
    if (!sub || !d) return;
    const r = d.resumen || {};
    const confirmadas = num((r.total || 0) - (r.sinEtiqueta || 0) - (r.compro || 0));
    sub.textContent = `${num(r.total)} clientes que entraron del ${fechaCorta(d.desdeVida)} al ${fechaCorta(d.fechaCorte)} · `
      + `${confirmadas} con etiqueta del equipo${estado.vendedorNombre ? ` · cartera de ${estado.vendedorNombre}` : ''}`;
    const nota = $('cholCarteraNota');
    if (nota) nota.textContent = d.nota || '';
  }

  function pintar() {
    pintarEncabezado();
    pintarFiltros();
    pintarTabla();
  }

  async function load(fechaInicio, fechaFin, opts = {}) {
    if (!fechaFin) return null;
    const clave = `${fechaInicio}|${fechaFin}`;
    if (!opts.force && estado.clave === clave && estado.data) {
      pintar();
      return estado.data;
    }
    const body = $('cholCarteraBody');
    if (body && !opts.silencioso) body.innerHTML = '<tr><td colspan="6" class="empty-row">Cargando clientes…</td></tr>';
    const q = new URLSearchParams({ fechaInicio, fechaFin });
    try {
      const data = await api(`/ventas/monitoreo-cholula/clientes?${q}`);
      estado.data = data;
      estado.clave = clave;
      if (!opts.silencioso) {
        estado.editando = null;
        estado.visibles = POR_PAGINA;
      }
      pintar();
      return data;
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="6" class="empty-row">${esc(err.message || 'No se pudo cargar la cartera.')}</td></tr>`;
      return null;
    }
  }

  /** Lo llama el ranking al abrir o cerrar un vendedor. */
  function verVendedor(key, nombre) {
    estado.vendedor = key || '';
    estado.vendedorNombre = key ? (nombre || '') : '';
    estado.visibles = POR_PAGINA;
    estado.editando = null;
    if (estado.data) pintar();
  }

  function leerEditor() {
    const caja = document.querySelector('#cholCarteraBody .cc-editor');
    if (!caja || !estado.editando) return;
    const motivo = caja.querySelector('[data-cc-motivo]');
    const nota = caja.querySelector('[data-cc-nota]');
    if (motivo) estado.editando.motivo = motivo.value;
    if (nota) estado.editando.nota = nota.value;
  }

  async function guardar(quitar = false) {
    if (!estado.editando || estado.guardando) return;
    leerEditor();
    const e = estado.editando;
    estado.guardando = true;
    estado.error = '';
    pintarTabla();
    try {
      await api(`/ventas/monitoreo-cholula/clientes/${encodeURIComponent(e.idCrm)}`, {
        method: 'PUT',
        body: JSON.stringify(quitar ? { etiqueta: '' } : { etiqueta: e.etiqueta, motivo: e.motivo, nota: e.nota }),
      });
      estado.editando = null;
      const [fi, ff] = String(estado.clave || '|').split('|');
      await load(fi, ff, { force: true, silencioso: true });
    } catch (err) {
      estado.error = err.message || 'No se pudo guardar.';
    } finally {
      estado.guardando = false;
      pintarTabla();
    }
  }

  const sec = $('cholCartera');
  sec?.addEventListener('click', (ev) => {
    const t = ev.target;
    const filtro = t.closest('[data-cc-filtro]');
    if (filtro) {
      estado.filtro = filtro.dataset.ccFiltro;
      estado.visibles = POR_PAGINA;
      pintarFiltros();
      pintarTabla();
      return;
    }
    if (t.closest('[data-cc-alertas]')) {
      estado.soloAlertas = !estado.soloAlertas;
      estado.visibles = POR_PAGINA;
      pintarFiltros();
      pintarTabla();
      return;
    }
    const editar = t.closest('[data-cc-editar]');
    if (editar) {
      const id = editar.dataset.ccEditar;
      if (estado.editando?.idCrm === id) {
        estado.editando = null;
      } else {
        const c = estado.data.clientes.find((x) => x.idCrm === id);
        const propia = c?.etiqueta.origen === 'equipo';
        estado.editando = {
          idCrm: id,
          etiqueta: propia ? c.etiqueta.clave : c?.etiqueta.clave === 'compro' ? '' : c?.etiqueta.clave || '',
          motivo: propia ? c.etiqueta.motivo || '' : '',
          nota: propia ? c.etiqueta.nota || '' : '',
        };
      }
      estado.error = '';
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
    if (t.closest('[data-cc-guardar]')) { void guardar(false); return; }
    if (t.closest('[data-cc-quitar]')) { void guardar(true); return; }
    if (t.closest('[data-cc-cancelar]')) {
      estado.editando = null;
      estado.error = '';
      pintarTabla();
      return;
    }
    if (t.id === 'cholCarteraMas') {
      estado.visibles += POR_PAGINA;
      pintarTabla();
    }
  });
  sec?.addEventListener('change', (ev) => {
    if (ev.target.id === 'cholCarteraVendedor') {
      const opt = ev.target.selectedOptions[0];
      verVendedor(ev.target.value, ev.target.value ? opt?.textContent : '');
    }
  });
  sec?.addEventListener('input', (ev) => {
    if (ev.target.id === 'cholCarteraTexto') {
      estado.texto = ev.target.value;
      estado.visibles = POR_PAGINA;
      pintarTabla();
    }
  });
  sec?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.matches?.('[data-cc-nota]')) {
      ev.preventDefault();
      void guardar(false);
    }
  });

  window.CarteraCholula = { load, verVendedor };
})();
