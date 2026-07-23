(function (global) {
  'use strict';

  const OPEN = new Set(['A', 'T', 'D', 'P']);
  const AGING_BUCKETS = ['0-30', '31-60', '61-90', '91-120', '+120'];
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function sum(arr, fn) {
    return arr.reduce((s, r) => s + fn(r), 0);
  }

  function groupCount(arr, keyFn) {
    const map = new Map();
    for (const r of arr) {
      const k = keyFn(r) || 'Sin dato';
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }

  function groupSum(arr, keyFn, valFn) {
    const map = new Map();
    for (const r of arr) {
      const k = keyFn(r) || 'Sin dato';
      map.set(k, (map.get(k) || 0) + valFn(r));
    }
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }

  function weekKey(dateStr) {
    if (!dateStr) return 'Sin fecha';
    const d = new Date(`${dateStr}T12:00:00`);
    const one = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - one) / 86400000) + one.getDay() + 1) / 7);
    return `${d.getFullYear()}-S${String(week).padStart(2, '0')}`;
  }

  function monthKey(dateStr) {
    if (!dateStr) return null;
    const d = new Date(`${dateStr}T12:00:00`);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabel(key) {
    if (!key) return 'Sin dato';
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y.slice(-2)}`;
  }

  function orderTypeLabel(r) {
    const tipo = r.tipoPorLetra || r.tipoOrden;
    if (r.letraOrden && tipo) return `${r.letraOrden} — ${tipo}`;
    if (global.PostSalesOrderTypes?.fromOrden) return global.PostSalesOrderTypes.fromOrden(r.orden).label;
    return tipo || '';
  }

  function hasRefacciones(r) {
    return Boolean(r?.conRefacciones) || Number(r?.refaccionesLineas || 0) > 0;
  }

  function applyFilters(records, filters = {}) {
    let rows = records.slice();
    const q = (filters.buscar || '').trim().toLowerCase();
    const area = String(filters.area || '').toLowerCase();

    if (area === 'servicio' || area === 'hyp') {
      if (global.PostSalesOrderTypes?.matchesArea) {
        rows = rows.filter((r) => global.PostSalesOrderTypes.matchesArea(r, area));
      }
    } else if (area === 'refacciones') {
      rows = [];
    }

    if (filters.status) rows = rows.filter((r) => r.statusGroup === filters.status || r.statusLabel === filters.status);
    if (filters.asesor) rows = rows.filter((r) => r.asesor === filters.asesor);
    if (filters.aseguradora) rows = rows.filter((r) => (r.aseguradora || 'Sin aseguradora') === filters.aseguradora);
    if (filters.tipo != null) {
      const tipos = Array.isArray(filters.tipo)
        ? filters.tipo
        : String(filters.tipo).split('|').map((t) => t.trim()).filter(Boolean);
      if (!tipos.length) {
        rows = [];
      } else {
        const set = new Set(tipos);
        rows = rows.filter((r) => set.has(orderTypeLabel(r)));
      }
    }
    if (filters.antiguedad) rows = rows.filter((r) => r.antiguedad === filters.antiguedad);
    if (filters.semaforo) rows = rows.filter((r) => r.semaforo === filters.semaforo);
    if (filters.importeMin != null && filters.importeMin !== '') {
      rows = rows.filter((r) => r.importe >= Number(filters.importeMin));
    }
    if (filters.importeMax != null && filters.importeMax !== '') {
      rows = rows.filter((r) => r.importe <= Number(filters.importeMax));
    }
    if (filters.soloCriticas) rows = rows.filter((r) => r.critica);
    if (filters.promesaVencida) rows = rows.filter((r) => r.promesaVencida);
    if (q) {
      rows = rows.filter((r) =>
        [r.orden, r.nombre, r.factura, r.telefono, r.celular, r.statusLabel, r.auto, r.modelo, r.serie, r.asesor, r.aseguradora, r.correo, r.tipoOrden]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    return rows;
  }

  function buildFilterOptions(records, openSnapshot = []) {
    const all = records.concat(openSnapshot);
    const uniq = (fn) => [...new Set(all.map(fn).filter(Boolean))].sort();
    return {
      status: uniq((r) => r.statusGroup),
      asesor: uniq((r) => r.asesor),
      aseguradora: uniq((r) => r.aseguradora || 'Sin aseguradora'),
      tipo: uniq((r) => orderTypeLabel(r)),
      antiguedad: ['0-30', '31-60', '61-90', '91-120', '+120'],
      semaforo: ['Verde', 'Amarillo', 'Rojo'],
    };
  }

  function buildMonthlyMap(rows) {
    const monthlyMap = new Map();
    for (const r of rows) {
      const mk = monthKey(r.ingresoDate);
      if (!mk) continue;
      if (!monthlyMap.has(mk)) {
        monthlyMap.set(mk, { ingresadas: 0, facturadas: 0, importeFacturado: 0, importeAbierto: 0, importeIngresado: 0 });
      }
      const m = monthlyMap.get(mk);
      m.ingresadas += 1;
      m.importeIngresado += r.importe;
      if (r.status === 'I') {
        m.facturadas += 1;
        m.importeFacturado += r.importeFacturado || r.importe;
      }
      if (OPEN.has(r.status)) m.importeAbierto += r.importeAbierto || r.importe;
    }
    return [...monthlyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function buildMejorMesStats(monthly) {
    const bestMonth = monthly.reduce((best, [k, v]) => (
      !best || v.importeFacturado > best.importeFacturado ? { key: k, ...v } : best
    ), null);
    if (!bestMonth) return { bestMonth: null, mejorMesStats: null };

    const monthsRanked = monthly
      .map(([k, v]) => ({ key: k, label: monthLabel(k), ...v }))
      .sort((a, b) => b.importeFacturado - a.importeFacturado);
    const secondBest = monthsRanked[1] || null;
    const totalFacturadoMeses = monthsRanked.reduce((s, m) => s + m.importeFacturado, 0);
    const promedioMensualFacturado = monthsRanked.length
      ? totalFacturadoMeses / monthsRanked.length
      : 0;

    return {
      bestMonth,
      mejorMesStats: {
        key: bestMonth.key,
        label: monthLabel(bestMonth.key),
        importeFacturado: bestMonth.importeFacturado,
        facturadas: bestMonth.facturadas,
        ingresadas: bestMonth.ingresadas,
        importeIngresado: bestMonth.importeIngresado,
        ticket: bestMonth.facturadas ? bestMonth.importeFacturado / bestMonth.facturadas : 0,
        pctFacturacion: bestMonth.ingresadas
          ? Math.round((bestMonth.facturadas / bestMonth.ingresadas) * 1000) / 10
          : 0,
        mesesComparados: monthsRanked.length,
        segundoMes: secondBest ? secondBest.label : null,
        segundoKey: secondBest ? secondBest.key : null,
        segundoImporte: secondBest ? secondBest.importeFacturado : 0,
        vsSegundoImporte: secondBest ? bestMonth.importeFacturado - secondBest.importeFacturado : 0,
        vsSegundoPct: secondBest && secondBest.importeFacturado > 0
          ? Math.round(((bestMonth.importeFacturado - secondBest.importeFacturado) / secondBest.importeFacturado) * 1000) / 10
          : null,
        promedioMensual: promedioMensualFacturado,
        vsPromedioImporte: bestMonth.importeFacturado - promedioMensualFacturado,
        vsPromedioPct: promedioMensualFacturado > 0
          ? Math.round(((bestMonth.importeFacturado - promedioMensualFacturado) / promedioMensualFacturado) * 1000) / 10
          : null,
        sharePct: totalFacturadoMeses > 0
          ? Math.round((bestMonth.importeFacturado / totalFacturadoMeses) * 1000) / 10
          : 0,
        alcance: 'acumulado-anio',
        ranking: monthsRanked.map((m, i) => ({
          posicion: i + 1,
          key: m.key,
          label: m.label,
          importeFacturado: m.importeFacturado,
          facturadas: m.facturadas,
          ingresadas: m.ingresadas,
          esMejor: m.key === bestMonth.key,
        })),
      },
    };
  }

  function computeDashboard(records, filters = {}, openSnapshot = [], ytdRecords = null) {
    const filtered = applyFilters(records, filters);
    const filteredOpen = applyFilters(openSnapshot, filters);
    const ytdFiltered = Array.isArray(ytdRecords) && ytdRecords.length
      ? applyFilters(ytdRecords, filters)
      : filtered;
    const facturadas = filtered.filter((r) => r.status === 'I');
    const importeIngresado = sum(filtered, (r) => r.importe);
    const importeFacturado = sum(facturadas, (r) => r.importeFacturado || r.importe);
    const importeAbiertoSnapshot = sum(filteredOpen, (r) => r.importeAbierto || r.importe);

    const aging = {
      b0_30: filteredOpen.filter((r) => r.antiguedad === '0-30').length,
      b31_60: filteredOpen.filter((r) => r.antiguedad === '31-60').length,
      b61_90: filteredOpen.filter((r) => r.antiguedad === '61-90').length,
      b91_120: filteredOpen.filter((r) => r.antiguedad === '91-120').length,
      b120p: filteredOpen.filter((r) => r.antiguedad === '+120').length,
    };

    const weeklyMap = new Map();
    for (const r of filtered) {
      const wk = weekKey(r.ingresoDate);
      if (!weeklyMap.has(wk)) weeklyMap.set(wk, { ingresadas: 0, facturadas: 0 });
      const e = weeklyMap.get(wk);
      e.ingresadas += 1;
      if (r.status === 'I') e.facturadas += 1;
    }
    const weekly = [...weeklyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);

    const risk = {
      criticas60: filteredOpen.filter((r) => r.critica).length,
      conRefacciones: filteredOpen.filter((r) => hasRefacciones(r)).length,
      conRefaccionesImporte: sum(
        filteredOpen.filter((r) => hasRefacciones(r)),
        (r) => r.importeAbierto || r.importe,
      ),
      promesasVencidas: filteredOpen.filter((r) => r.promesaVencida).length,
      promedioSemanal: weekly.length
        ? Math.round((sum(filtered, () => 1) / weekly.length) * 10) / 10
        : 0,
      sinImporte: filteredOpen.filter((r) => r.sinImporte).length,
      sinAseguradora: filteredOpen.filter((r) => r.sinAseguradora).length,
      abiertasSinPromesa: filteredOpen.filter((r) => r.abiertaSinPromesa).length,
      sinFechaIngreso: filteredOpen.filter((r) => r.sinFechaIngreso).length,
      excluidos: filtered.filter((r) => r.excluido).length,
    };

    const monthly = buildMonthlyMap(filtered);
    const monthlyYtd = buildMonthlyMap(ytdFiltered);
    const lastMonth = monthly[monthly.length - 1];
    const prevMonth = monthly[monthly.length - 2];
    const { bestMonth, mejorMesStats } = buildMejorMesStats(monthlyYtd);

    const canceladas = filtered.filter((r) => r.status === 'C');
    const cerradas = filtered.filter((r) => !OPEN.has(r.status));
    const pctImporteFacturado = importeIngresado > 0
      ? Math.round((importeFacturado / importeIngresado) * 1000) / 10
      : 0;

    const executive = {
      totalOrdenes: filtered.length,
      importeIngresado,
      abiertas: filteredOpen.length,
      importeAbierto: importeAbiertoSnapshot,
      facturadas: facturadas.length,
      importeFacturado,
      pctFacturado: filtered.length ? Math.round((facturadas.length / filtered.length) * 1000) / 10 : 0,
      ticketPromFacturado: facturadas.length ? importeFacturado / facturadas.length : 0,
      canceladas: canceladas.length,
      cerradas: cerradas.length,
      pctCerrado: filtered.length ? Math.round((cerradas.length / filtered.length) * 1000) / 10 : 0,
      importeCerrado: sum(cerradas, (r) => r.importeFacturado || r.importe),
    };

    const finance = {
      importeIngresado,
      importeFacturado,
      importeAbierto: importeAbiertoSnapshot,
      facturadoUltimoMes: lastMonth ? lastMonth[1].importeFacturado : 0,
      crecimientoFacturado: prevMonth && prevMonth[1].importeFacturado
        ? Math.round(((lastMonth[1].importeFacturado - prevMonth[1].importeFacturado) / prevMonth[1].importeFacturado) * 1000) / 10
        : 0,
      mejorMes: bestMonth ? monthLabel(bestMonth.key) : '—',
      mejorMesImporte: bestMonth ? bestMonth.importeFacturado : 0,
      riesgo120: sum(filteredOpen.filter((r) => r.antiguedad === '+120'), (r) => r.importeAbierto || r.importe),
      ticketPromedio: facturadas.length ? importeFacturado / facturadas.length : 0,
      pctImporteFacturado,
      ticketPromIngresado: filtered.length ? importeIngresado / filtered.length : 0,
      ultimoMesLabel: lastMonth ? monthLabel(lastMonth[0]) : '—',
      ultimoMesKey: lastMonth ? lastMonth[0] : null,
      mejorMesKey: bestMonth ? bestMonth.key : null,
      mejorMesStats,
      mejorMesAlcance: 'acumulado-anio',
      tieneMesAnterior: Boolean(prevMonth),
    };

    const summary = { ...executive, ...finance };

    const charts = {
      statusDonut: groupCount(filtered, (r) => r.statusGroup),
      agingOpen: AGING_BUCKETS.map((b) => ({
        label: b,
        value: filteredOpen.filter((r) => r.antiguedad === b).length,
      })),
      monthlyOps: monthly.map(([k, v]) => ({
        label: monthLabel(k),
        ingresadas: v.ingresadas,
        facturadas: v.facturadas,
        importeFacturado: v.importeFacturado,
        importeAbierto: v.importeAbierto,
      })),
      weeklyFlow: weekly.map(([k, v]) => ({ label: k, ingresadas: v.ingresadas, facturadas: v.facturadas })),
      statusByWeek: (() => {
        const map = new Map();
        for (const r of filtered) {
          const wk = weekKey(r.ingresoDate);
          if (!map.has(wk)) map.set(wk, {});
          const bucket = map.get(wk);
          const g = r.statusGroup;
          bucket[g] = (bucket[g] || 0) + 1;
        }
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-10).map(([label, groups]) => ({ label, groups }));
      })(),
      tipoOrden: groupCount(filtered, (r) => r.tipoOrden).sort((a, b) => b.value - a.value).slice(0, 10),
      importeAbiertoTipo: groupSum(filteredOpen, (r) => r.tipoOrden, (r) => r.importeAbierto || r.importe)
        .sort((a, b) => b.value - a.value).slice(0, 10),
    };

    const tables = {
      criticas: filteredOpen.filter((r) => r.critica)
        .sort((a, b) => b.dias - a.dias || (b.importeAbierto - a.importeAbierto))
        .slice(0, 50),
      productividadAsesor: groupCount(filtered, (r) => r.asesor)
        .map((a) => {
          const asesorRows = filtered.filter((r) => r.asesor === a.label);
          const fac = asesorRows.filter((r) => r.status === 'I');
          return {
            asesor: a.label,
            ordenes: a.value,
            facturadas: fac.length,
            abiertas: asesorRows.filter((r) => OPEN.has(r.status)).length,
            importe: sum(asesorRows, (r) => r.importe),
          };
        })
        .sort((a, b) => b.ordenes - a.ordenes)
        .slice(0, 20),
      controlAseguradora: groupCount(filtered.filter((r) => !r.sinAseguradora), (r) => r.aseguradora)
        .map((a) => {
          const rowsA = filtered.filter((r) => r.aseguradora === a.label);
          const abiertasRows = rowsA.filter((r) => OPEN.has(r.status));
          const facturadasRows = rowsA.filter((r) => r.status === 'I');
          return {
            aseguradora: a.label,
            ordenes: a.value,
            facturadas: facturadasRows.length,
            importeFacturado: sum(facturadasRows, (r) => r.importeFacturado || r.importe),
            abiertas: abiertasRows.length,
            importeAbierto: sum(abiertasRows, (r) => r.importeAbierto || r.importe),
          };
        })
        .sort((a, b) => b.importeFacturado - a.importeFacturado)
        .slice(0, 20),
      controlOrdenes: (() => {
        const OT = global.PostSalesOrderTypes || {};
        const fromOrden = OT.fromOrden || ((orden) => {
          const letra = String(orden || '').trim().charAt(0).toUpperCase();
          const tipo = letra ? `Tipo ${letra}` : 'Sin clasificar';
          return { letra, tipo, label: letra ? `${letra} — ${tipo}` : tipo };
        });
        const sinAseg = OT.isSinAseguradora
          ? (r) => OT.isSinAseguradora(r)
          : (r) => !String(r.aseguradora || '').trim();

        const buckets = new Map();
        for (const r of filtered.filter(sinAseg)) {
          const { letra, tipo } = fromOrden(r.orden);
          const key = letra || '_';
          if (!buckets.has(key)) buckets.set(key, { tipoOrden: tipo, letra, rows: [] });
          buckets.get(key).rows.push(r);
        }

        const catalogOrder = (OT.CATALOGO || []).map((c) => c.letra);
        const sortIdx = (letra) => {
          const i = catalogOrder.indexOf(letra);
          return i === -1 ? 999 : i;
        };

        return [...buckets.values()]
          .map(({ tipoOrden, letra, rows }) => {
            const abiertasRows = rows.filter((r) => OPEN.has(r.status));
            const facturadasRows = rows.filter((r) => r.status === 'I');
            return {
              tipoOrden,
              letra,
              ordenes: rows.length,
              facturadas: facturadasRows.length,
              importeFacturado: sum(facturadasRows, (r) => r.importeFacturado || r.importe),
              abiertas: abiertasRows.length,
              importeAbierto: sum(abiertasRows, (r) => r.importeAbierto || r.importe),
            };
          })
          .sort((a, b) => sortIdx(a.letra) - sortIdx(b.letra) || b.importeFacturado - a.importeFacturado);
      })(),
      detalle: filtered,
    };

    return {
      filtered,
      filterOptions: buildFilterOptions(records, openSnapshot),
      summary,
      executive,
      aging,
      risk,
      finance,
      charts,
      tables,
    };
  }

  global.PostSalesAnalytics = {
    applyFilters,
    buildFilterOptions,
    computeDashboard,
  };
}(typeof window !== 'undefined' ? window : global));
