(function (global) {
  'use strict';

  const OPEN = new Set(['A', 'T', 'D', 'P']);
  const AGING_BUCKETS = ['0-30', '31-60', '61-90', '91-120', '+120'];
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function sum(arr, fn) {
    return arr.reduce((s, r) => s + fn(r), 0);
  }

  function avgNums(nums) {
    if (!nums.length) return 0;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  }

  function medianNums(nums) {
    if (!nums.length) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  }

  /** Días de espera típica de valuación aseguradora (se restan del ciclo). */
  const CICLO_AJUSTE_VALUACION_DIAS = 3;

  /** HyP: ciclo solo con ORE_FECHACIE en estas letras. */
  const HYP_CICLO_LETRAS = new Set(['A', 'F', 'H', 'J', 'V', 'Z', '\u00D3', 'Ó']);

  function letterOfCycle(r) {
    const OT = global.PostSalesOrderTypes;
    if (OT?.letterOfRecord) return OT.letterOfRecord(r);
    const fromField = String(r?.letraOrden || '').trim().toUpperCase();
    if (fromField) return fromField;
    return String(r?.orden || '').trim().charAt(0).toUpperCase();
  }

  /** Días de ciclo ingreso → cierre (ORE_FECHACIE). HyP A/F/H/J/V/Z/Ó exige cierre. */
  function cycleDaysOf(r) {
    const letra = letterOfCycle(r);
    const hypCore = HYP_CICLO_LETRAS.has(letra);

    if (r.ingresoDate && r.cierreDate) {
      const a = new Date(`${r.ingresoDate}T12:00:00`);
      const b = new Date(`${r.cierreDate}T12:00:00`);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        return Math.max(0, Math.round((b - a) / 86400000));
      }
    }
    // Sin ORE_FECHACIE no hay ciclo válido para letras HyP core
    if (hypCore) return null;

    if (r.diasCiclo != null && Number.isFinite(Number(r.diasCiclo))) {
      return Math.max(0, Number(r.diasCiclo));
    }
    return null;
  }

  /** Ciclo neto: bruto − 3 d de espera de valuación aseguradora (mín. 0). */
  function cycleDaysAjustadoOf(r) {
    const d = cycleDaysOf(r);
    if (d == null || !Number.isFinite(d)) return null;
    return Math.max(0, d - CICLO_AJUSTE_VALUACION_DIAS);
  }

  function isHypCicloOrden(r) {
    return HYP_CICLO_LETRAS.has(letterOfCycle(r));
  }

  function daysVsPromesaOf(r) {
    if (r.diasVsPromesa != null && Number.isFinite(Number(r.diasVsPromesa))) {
      return Number(r.diasVsPromesa);
    }
    if (!r.promesaDate) return null;
    const ref = r.cierreDate || null;
    if (!ref) return null;
    const p = new Date(`${r.promesaDate}T12:00:00`);
    const c = new Date(`${ref}T12:00:00`);
    if (Number.isNaN(p) || Number.isNaN(c)) return null;
    return Math.round((c - p) / 86400000);
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

    // Filtro rápido HyP por letra (chips de indicadores operativos)
    if (area === 'hyp' && filters.hypLetras != null) {
      const letras = Array.isArray(filters.hypLetras)
        ? filters.hypLetras.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean)
        : [];
      if (!letras.length) {
        rows = [];
      } else {
        const set = new Set(letras);
        const letterOf = (r) => {
          if (global.PostSalesOrderTypes?.letterOfRecord) {
            return global.PostSalesOrderTypes.letterOfRecord(r);
          }
          const fromField = String(r?.letraOrden || '').trim().toUpperCase();
          if (fromField) return fromField;
          return String(r?.orden || '').trim().charAt(0).toUpperCase();
        };
        rows = rows.filter((r) => set.has(letterOf(r)));
      }
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

  /** Mes de referencia del filtro de fechas (prioridad: fechaFin → fechaInicio → hoy). */
  function resolveMesReferencia(filters = {}) {
    const fin = String(filters.fechaFin || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(fin)) return fin;
    const ini = String(filters.fechaInicio || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ini)) return ini;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Resultado del mes del filtro vs mejor mes (YTD). */
  function buildMesEnCursoStats(monthlyYtd, mejorMesStats, filters = {}) {
    const key = resolveMesReferencia(filters);
    const [y, m] = key.split('-').map(Number);
    const entry = monthlyYtd.find(([k]) => k === key);
    const importeFacturado = entry ? entry[1].importeFacturado : 0;
    const facturadas = entry ? entry[1].facturadas : 0;
    const ingresadas = entry ? entry[1].ingresadas : 0;
    const now = new Date();
    const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const diasEnMes = new Date(y, m, 0).getDate();
    let diaDelMes;
    if (key === nowKey) {
      diaDelMes = now.getDate();
    } else if (key < nowKey) {
      diaDelMes = diasEnMes;
    } else {
      diaDelMes = 0;
    }
    const mejorImporte = mejorMesStats?.importeFacturado || 0;
    const ritmoProyectado = diaDelMes > 0 ? (importeFacturado / diaDelMes) * diasEnMes : 0;
    const ranking = (mejorMesStats?.ranking || []).map((row) => ({
      ...row,
      esActual: row.key === key,
    }));
    const topMeses = ranking.slice(0, 8);

    return {
      key,
      label: monthLabel(key),
      importeFacturado,
      facturadas,
      ingresadas,
      diaDelMes,
      diasEnMes,
      pctMesTranscurrido: diasEnMes > 0
        ? Math.round((diaDelMes / diasEnMes) * 1000) / 10
        : 0,
      mesCerrado: key < nowKey,
      mejorMesLabel: mejorMesStats?.label || '—',
      mejorMesKey: mejorMesStats?.key || null,
      mejorMesImporte: mejorImporte,
      pctVsMejor: mejorImporte > 0
        ? Math.round((importeFacturado / mejorImporte) * 1000) / 10
        : null,
      gapVsMejor: mejorImporte - importeFacturado,
      ritmoProyectado,
      pctRitmoVsMejor: mejorImporte > 0
        ? Math.round((ritmoProyectado / mejorImporte) * 1000) / 10
        : null,
      topMeses,
      ranking,
    };
  }

  function computeDashboard(records, filters = {}, openSnapshot = [], ytdRecords = null) {
    const filtered = applyFilters(records, filters);
    const filteredOpen = applyFilters(openSnapshot, filters);
    const ytdFiltered = Array.isArray(ytdRecords) && ytdRecords.length
      ? applyFilters(ytdRecords, filters)
      : filtered;
    const facturadas = filtered.filter((r) => r.status === 'I');
    const isAseguradora = (r) => {
      const OT = global.PostSalesOrderTypes;
      return OT && typeof OT.isAseguradora === 'function'
        ? OT.isAseguradora(r)
        : ['A', 'F', 'V'].includes(String(r?.letraOrden || r?.orden || '').trim().toUpperCase().charAt(0));
    };
    /** Ticket promedio: solo facturadas de aseguradoras (A / F / V). */
    const facturadasAseg = facturadas.filter(isAseguradora);
    const importeFacturadoAseg = sum(facturadasAseg, (r) => r.importeFacturado || r.importe);
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

    // Operación de taller: tiempos de ciclo, estancia y cumplimiento de promesa
    // HyP A/F/H/J/V/Z/Ó: ciclo solo con ORE_FECHACIE; neto = bruto − 3 d valuación
    const areaKey = String(filters.area || '').toLowerCase();
    const facturadasCiclo = areaKey === 'hyp'
      ? facturadas.filter(isHypCicloOrden)
      : facturadas;
    const ciclosFacturados = facturadasCiclo
      .map(cycleDaysAjustadoOf)
      .filter((d) => d != null && Number.isFinite(d));
    const estanciaAbiertas = filteredOpen
      .map((r) => Number(r.dias))
      .filter((d) => Number.isFinite(d) && d >= 0);
    const factConPromesa = facturadas.filter((r) => r.promesaDate && (r.cierreDate || r.diasCiclo != null));
    const vsPromesa = factConPromesa
      .map(daysVsPromesaOf)
      .filter((d) => d != null && Number.isFinite(d));
    const cumplidasPromesa = vsPromesa.filter((d) => d <= 0);
    const retrasadas = vsPromesa.filter((d) => d > 0);
    const facturasPorSemana = weekly.length
      ? Math.round((facturadas.length / weekly.length) * 10) / 10
      : 0;

    // Tiempos por etapa operativa (snapshot de abiertas)
    // Mecánica: Servicio en taller/activa · Espera RE: Detenida o Pendiente con refacciones · Pintura: HyP abierta
    const matchArea = (r, area) =>
      Boolean(global.PostSalesOrderTypes?.matchesArea?.(r, area));
    const stageDias = (rows) =>
      avgNums(rows.map((r) => Number(r.dias)).filter((d) => Number.isFinite(d) && d >= 0));
    const enMecanica = filteredOpen.filter(
      (r) => matchArea(r, 'servicio') && (r.status === 'T' || r.status === 'A'),
    );
    const enEsperaRefacc = filteredOpen.filter(
      (r) => r.status === 'D' || (r.status === 'P' && hasRefacciones(r)),
    );
    const enPintura = filteredOpen.filter((r) => matchArea(r, 'hyp'));

    const operations = {
      tiempoPromCiclo: avgNums(ciclosFacturados),
      tiempoMedCiclo: medianNums(ciclosFacturados),
      ciclosConDato: ciclosFacturados.length,
      cicloAjusteValuacionDias: CICLO_AJUSTE_VALUACION_DIAS,
      estanciaPromAbiertas: avgNums(estanciaAbiertas),
      estanciaMedAbiertas: medianNums(estanciaAbiertas),
      diasPromMecanica: stageDias(enMecanica),
      ordenesMecanica: enMecanica.length,
      diasPromEsperaRefacc: stageDias(enEsperaRefacc),
      ordenesEsperaRefacc: enEsperaRefacc.length,
      diasPromPintura: stageDias(enPintura),
      ordenesPintura: enPintura.length,
      cumplimientoPromesaPct: vsPromesa.length
        ? Math.round((cumplidasPromesa.length / vsPromesa.length) * 1000) / 10
        : 0,
      cumplimientoBase: vsPromesa.length,
      retrasoPromDias: avgNums(retrasadas),
      retrasadas: retrasadas.length,
      promesasVencidas: risk.promesasVencidas,
      facturasPorSemana,
      criticas60: risk.criticas60,
      ingresoPorSemana: risk.promedioSemanal,
    };

    const monthly = buildMonthlyMap(filtered);
    const monthlyYtd = buildMonthlyMap(ytdFiltered);
    const lastMonth = monthly[monthly.length - 1];
    const prevMonth = monthly[monthly.length - 2];
    const { bestMonth, mejorMesStats } = buildMejorMesStats(monthlyYtd);
    const mesEnCursoStats = buildMesEnCursoStats(monthlyYtd, mejorMesStats, filters);

    const canceladas = filtered.filter((r) => r.status === 'C');
    /** Solo cerradas “puras”: no abiertas, no facturadas (I), no canceladas (C). */
    const cerradas = filtered.filter((r) => {
      const st = String(r.status || '').trim().toUpperCase();
      return st && !OPEN.has(st) && st !== 'I' && st !== 'C';
    });
    const abiertasPeriodo = filtered.filter((r) => OPEN.has(String(r.status || '').trim().toUpperCase()));
    const importeAbiertoPeriodo = sum(abiertasPeriodo, (r) => r.importeAbierto || r.importe);
    const abiertasPeriodoKeys = new Set(
      abiertasPeriodo.map((r) => String(r.orden || '').trim().toUpperCase()).filter(Boolean),
    );
    /** Backlog abierto actual menos las abiertas ingresadas en el periodo. */
    const abiertasAcumuladasRows = filteredOpen.filter(
      (r) => !abiertasPeriodoKeys.has(String(r.orden || '').trim().toUpperCase()),
    );
    const importeAbiertoAcumulado = sum(abiertasAcumuladasRows, (r) => r.importeAbierto || r.importe);
    const pctImporteFacturado = importeIngresado > 0
      ? Math.round((importeFacturado / importeIngresado) * 1000) / 10
      : 0;

    const executive = {
      totalOrdenes: filtered.length,
      importeIngresado,
      abiertas: filteredOpen.length,
      importeAbierto: importeAbiertoSnapshot,
      abiertasPeriodo: abiertasPeriodo.length,
      importeAbiertoPeriodo,
      pctAbiertasPeriodo: filtered.length
        ? Math.round((abiertasPeriodo.length / filtered.length) * 1000) / 10
        : 0,
      abiertasAcumuladas: abiertasAcumuladasRows.length,
      importeAbiertoAcumulado,
      facturadas: facturadas.length,
      importeFacturado,
      pctFacturado: filtered.length ? Math.round((facturadas.length / filtered.length) * 1000) / 10 : 0,
      ticketPromFacturado: facturadasAseg.length ? importeFacturadoAseg / facturadasAseg.length : 0,
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
      ticketPromedio: facturadasAseg.length ? importeFacturadoAseg / facturadasAseg.length : 0,
      pctImporteFacturado,
      ticketPromIngresado: filtered.length ? importeIngresado / filtered.length : 0,
      ultimoMesLabel: lastMonth ? monthLabel(lastMonth[0]) : '—',
      ultimoMesKey: lastMonth ? lastMonth[0] : null,
      mejorMesKey: bestMonth ? bestMonth.key : null,
      mejorMesStats,
      mesEnCursoStats,
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
      operations,
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
