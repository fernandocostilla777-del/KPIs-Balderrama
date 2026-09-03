/**
 * Match MOVDET ↔ DMS para el Cuadre de Órdenes HyP (cuadreOrdenesHyp).
 * POL_REFERENCIA1 = VTE_DOCTO (SRV…), POL_REFERENCIA2 = VTE_REFERENCIA1 (V…).
 * Importes DMS y Contpaq: subtotal sin IVA.
 */

const CUENTAS = {
  '0470': { like: '0470-0001%', fields: ['hp', 'pi'], tol: 0.5 },
  '0479': { like: '0479-0001%', tol: 50, is479: true },
  '0476': { like: '0476-0001%', fields: ['tthp'], tol: 0.5 },
  '0477': { like: '0477-0001%', re: true },
};

function emptyPorCuenta() {
  return { '0470': 0, '0476': 0, '0477': 0, '0479': 0 };
}

function monthFromRange(fi) {
  const d = new Date(`${fi}T12:00:00`);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function facKey(orden, docto) {
  return `${String(orden || '').trim()}|${String(docto || '').trim()}`;
}

function inParams(prefix, values) {
  const params = {};
  const placeholders = values.map((v, i) => {
    params[`${prefix}${i}`] = v;
    return `@${prefix}${i}`;
  });
  return { params, placeholders };
}

function matchComponent(line, comp, fields, tol = 0.5) {
  const net = Number(line.net);
  const s = comp.st === 'C' ? -1 : 1;
  for (const f of fields) {
    const raw = Number(comp[f] || 0);
    const signed = raw * s;
    if (Math.abs(signed - net) < tol) return { field: f, amount: signed };
    if (line.tipo === 'VS' && net > 0 && Math.abs(raw - net) < tol) return { field: f, amount: raw };
    if (line.tipo === 'DVS' && net < 0 && Math.abs(raw + net) < tol) return { field: f, amount: net };
  }
  return null;
}

function tryAmount(line, comp, raw, tol) {
  const net = Number(line.net);
  const v = Number(raw || 0);
  if (Math.abs(v) < 0.001) return null;
  const s = comp.st === 'C' ? -1 : 1;
  const signed = v * s;
  if (Math.abs(signed - net) < tol) return signed;
  if (line.tipo === 'VS' && net > 0 && Math.abs(v - net) < tol) return v;
  if (line.tipo === 'DVS' && net < 0 && Math.abs(-v - net) < tol) return net;
  return null;
}

function match479(line, comp, detLines, tol = 50) {
  const aggregates = [
    ['vaPu', comp.vaPu],
    ['moi', comp.moi],
    ['tthp', comp.tthp],
    ['va', comp.va],
    ['pi', comp.pi],
    ['hp', comp.hp],
  ];
  for (const [, raw] of aggregates) {
    const hit = tryAmount(line, comp, raw, tol);
    if (hit != null) return { field: 'agg', amount: hit };
  }

  let best = null;
  for (const dl of detLines || []) {
    if (dl.used) continue;
    const hit = tryAmount(line, comp, dl.amt, tol);
    if (hit != null && (!best || Math.abs(hit - Number(line.net)) < Math.abs(best.amount - Number(line.net)))) {
      best = { dl, amount: hit };
    }
  }
  if (best) {
    best.dl.used = true;
    return { field: best.dl.cl, amount: best.amount };
  }
  return null;
}

async function loadMovLines(query, year, month, accountLike) {
  const table = `CON_MOVDET01${year}`;
  const polTable = `CON_POL01${year}`;
  return query(`
    SELECT
      LTRIM(RTRIM(p.POL_REFERENCIA2)) AS orden,
      LTRIM(RTRIM(p.POL_REFERENCIA1)) AS docto,
      m.MOV_TIPOPOL AS tipo,
      (ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0)) AS net
    FROM [${table}] m
    INNER JOIN [${polTable}] p
      ON p.POL_TIPO = m.MOV_TIPOPOL
      AND p.POL_CONSECUTIVO = m.MOV_CONSPOL
      AND p.POL_MES = m.MOV_MES
    WHERE m.MOV_MES = @month
      AND LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE @acct
      AND m.MOV_TIPOPOL IN ('VS', 'DVS')
      AND ABS(ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0)) > 0.001
  `, { month, acct: accountLike });
}

async function loadReLines(query, doctos) {
  if (!doctos.length) return new Map();
  const { params, placeholders } = inParams('d', doctos);
  const rows = await query(`
    SELECT d.VTD_IDDOCTO docto, LTRIM(RTRIM(v.VTE_REFERENCIA1)) orden, v.VTE_STATUS st,
      d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD AS sub
    FROM ADE_VTAFIDET d
    JOIN ADE_VTAFI v ON v.VTE_DOCTO = d.VTD_IDDOCTO
    WHERE UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'RE'
      AND d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD <> 0
      AND v.VTE_DOCTO IN (${placeholders.join(',')})
  `, params);
  const map = new Map();
  for (const r of rows) {
    const k = facKey(r.orden, r.docto);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ sub: Number(r.sub), st: r.st, used: false });
  }
  return map;
}

function reCandidates(line, rl) {
  const net = Number(line.net);
  const sub = Number(rl.sub);
  const s = rl.st === 'C' ? -1 : 1;
  const out = [{ amt: sub * s, d: Math.abs(sub * s - net) }];
  if (line.tipo === 'VS' && net > 0) {
    out.push({ amt: sub, d: Math.abs(sub - net) });
  }
  if (line.tipo === 'DVS' && net < 0) {
    out.push({ amt: -sub, d: Math.abs(-sub - net) });
  }
  return out;
}

function matchReLine(line, reLines, comp, tol = 1) {
  const net = Number(line.net);
  let best = null;
  for (const rl of reLines || []) {
    if (rl.used) continue;
    for (const c of reCandidates(line, rl)) {
      if (c.d < tol && (!best || c.d < best.d)) best = { rl, amt: c.amt, d: c.d };
    }
  }
  if (best) {
    best.rl.used = true;
    return best.amt;
  }
  if (!comp) return null;
  const s = comp.st === 'C' ? -1 : 1;
  const re = Number(comp.re || 0) * s;
  if (Math.abs(re - net) < tol) return re;
  if (line.tipo === 'VS' && net > 0 && Math.abs(Number(comp.re) - net) < tol) return Number(comp.re);
  return null;
}

async function load479Lines(query, doctos) {
  if (!doctos.length) return new Map();
  const { params, placeholders } = inParams('d', doctos);
  const rows = await query(`
    SELECT d.VTD_IDDOCTO docto, LTRIM(RTRIM(v.VTE_REFERENCIA1)) orden,
      UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) cl,
      d.VTD_PRECIOUNITARIO pu, d.VTD_CANTIDAD cant,
      d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD AS sub
    FROM ADE_VTAFIDET d
    JOIN ADE_VTAFI v ON v.VTE_DOCTO = d.VTD_IDDOCTO
    WHERE v.VTE_DOCTO IN (${placeholders.join(',')})
      AND UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) IN ('VA', 'PI', 'TTHP', 'MOI', 'HP')
  `, params);
  const map = new Map();
  for (const r of rows) {
    const k = facKey(r.orden, r.docto);
    if (!map.has(k)) map.set(k, []);
    const cl = String(r.cl || '').trim();
    const cant = Number(r.cant || 0);
    const sub = Number(r.sub || 0);
    const pu = Number(r.pu || 0);
    let amt = sub;
    if (['VA', 'MOI', 'TTHP'].includes(cl) && Math.abs(sub) < 0.001) amt = pu;
    if (Math.abs(amt) < 0.001) continue;
    map.get(k).push({ cl, amt, used: false });
  }
  return map;
}

function enrichComp479(row) {
  const hp = Number(row.hp || 0);
  const pi = Number(row.pi || 0);
  const va = Number(row.va || 0);
  const re = Number(row.re || 0);
  const tthp = Number(row.tthp || 0);
  const vaPu = Number(row.vaPu || 0);
  const moi = Number(row.moi || 0);
  row.sub479 = va + pi + vaPu + moi + tthp;
  row.allSub = hp + pi + va + re + tthp + vaPu + moi;
  return row;
}

async function loadDmsComponents(query, doctos) {
  if (!doctos.length) return new Map();
  const { params, placeholders } = inParams('d', doctos);
  const rows = await query(`
    SELECT
      v.VTE_DOCTO AS docto,
      LTRIM(RTRIM(v.VTE_REFERENCIA1)) AS orden,
      v.VTE_STATUS AS st,
      v.VTE_FECHDOCTO AS facFecha,
      v.VTE_TOTAL AS tot,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'HP' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS hp,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'PI' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS pi,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'VA' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS va,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'RE' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS re,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'TTHP' THEN d.VTD_PRECIOUNITARIO ELSE 0 END) AS tthp,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'VA'
        AND d.VTD_CANTIDAD = 0 THEN d.VTD_PRECIOUNITARIO ELSE 0 END) AS vaPu,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'MOI' THEN d.VTD_PRECIOUNITARIO ELSE 0 END) AS moi,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) IN ('HP','VA','PI') THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS moSub,
      UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS vin,
      o.ORE_FECHACIE AS cierre,
      LEFT(LTRIM(RTRIM(v.VTE_REFERENCIA1)), 1) AS letra
    FROM ADE_VTAFI v
    INNER JOIN ADE_VTAFIDET d ON d.VTD_IDDOCTO = v.VTE_DOCTO
    LEFT JOIN SER_ORDEN o ON LTRIM(RTRIM(v.VTE_REFERENCIA1)) = LTRIM(RTRIM(o.ORE_IDORDEN))
    WHERE v.VTE_STATUS IN ('I', 'C')
      AND v.VTE_TIPODOCTO LIKE 'S%'
      AND v.VTE_DOCTO IN (${placeholders.join(',')})
    GROUP BY v.VTE_DOCTO, v.VTE_REFERENCIA1, v.VTE_STATUS, v.VTE_FECHDOCTO, v.VTE_TOTAL,
      o.ORE_NUMSERIE, o.ORE_FECHACIE, o.ORE_IDORDEN
  `, params);
  const map = new Map();
  for (const r of rows) {
    map.set(facKey(r.orden, r.docto), enrichComp479(r));
  }
  return map;
}

function mergeFac(byFac, ln, comp, cuenta, amount) {
  const key = facKey(ln.orden, ln.docto);
  if (!byFac.has(key)) {
    byFac.set(key, {
      orden: ln.orden,
      docto: ln.docto,
      st: comp?.st || 'I',
      letra: comp?.letra || String(ln.orden || '').trim().charAt(0),
      vin: String(comp?.vin || '').trim().toUpperCase(),
      cierre: comp?.cierre,
      facFecha: comp?.facFecha,
      porCuenta: emptyPorCuenta(),
      neto: 0,
    });
  }
  const fac = byFac.get(key);
  fac.porCuenta[cuenta] += amount;
  fac.neto += amount;
}

function cloneReLines(reLineMap, key) {
  return (reLineMap.get(key) || []).map((r) => ({ ...r, used: false }));
}

function unusedReSignedSum(reLines, comp, tipoHint) {
  const stSign = comp?.st === 'C' ? -1 : 1;
  return (reLines || [])
    .filter((r) => !r.used)
    .reduce((acc, rl) => {
      const sub = Number(rl.sub);
      if (tipoHint === 'DVS') return acc - sub;
      if (tipoHint === 'VS') return acc + sub;
      return acc + sub * stSign;
    }, 0);
}

function processReFac(lines, reLineMap, comp, key) {
  const cpFacTot = lines.reduce((a, l) => a + Number(l.net), 0);
  const reLinesAll = reLineMap.get(key) || [];
  const reSubTot = reLinesAll.reduce((a, r) => a + Number(r.sub), 0);

  if (Math.abs(cpFacTot) < 1) {
    return {
      matched: lines.map((ln) => ({ ln, amt: ln.net })),
      unmatched: [],
      dms: cpFacTot,
    };
  }

  if (comp && reSubTot > 0) {
    const tol = Math.max(50, lines.length * 3);
    const targets = [
      reSubTot,
      -reSubTot,
      comp.st === 'C' ? -reSubTot : reSubTot,
    ];
    if (targets.some((t) => Math.abs(cpFacTot - t) < tol)) {
      return {
        matched: lines.map((ln) => ({ ln, amt: ln.net })),
        unmatched: [],
        dms: cpFacTot,
      };
    }
  }

  const reLines = cloneReLines(reLineMap, key);
  const matched = [];
  const unmatched = [];
  let dms = 0;

  for (const ln of lines) {
    const amt = matchReLine(ln, reLines, comp, 1);
    if (amt != null) {
      dms += amt;
      matched.push({ ln, amt });
    } else {
      unmatched.push(ln);
    }
  }

  if (unmatched.length) {
    const cpRem = unmatched.reduce((a, l) => a + Number(l.net), 0);
    const dvs = unmatched.every((l) => l.tipo === 'DVS');
    const vs = unmatched.every((l) => l.tipo === 'VS');
    const tipoHint = dvs ? 'DVS' : vs ? 'VS' : null;
    const reRem = unusedReSignedSum(reLines, comp, tipoHint);
    const tol = Math.max(5, unmatched.length * 2);
    if (Math.abs(cpRem - reRem) < tol) {
      dms += cpRem;
      for (const rl of reLines) {
        if (!rl.used) rl.used = true;
      }
      for (const ln of unmatched) {
        matched.push({ ln, amt: ln.net });
      }
      unmatched.length = 0;
    }
  }

  if (unmatched.length && comp && Number(comp.re) > 0) {
    const cpRem = unmatched.reduce((a, l) => a + Number(l.net), 0);
    dms += cpRem;
    for (const ln of unmatched) {
      matched.push({ ln, amt: ln.net });
    }
    unmatched.length = 0;
  }

  return { matched, unmatched, dms };
}

function clone479Lines(map479, key) {
  return (map479.get(key) || []).map((r) => ({ ...r, used: false }));
}

function process479Fac(lines, map479, comp) {
  const cpFacTot = lines.reduce((a, l) => a + Number(l.net), 0);
  if (Math.abs(cpFacTot) < 1) {
    return {
      matched: lines.map((ln) => ({ ln, amt: ln.net })),
      unmatched: [],
      dms: cpFacTot,
    };
  }
  const detLines = clone479Lines(map479, facKey(lines[0].orden, lines[0].docto));
  const matched = [];
  const unmatched = [];
  let dms = 0;
  const tol = 50;

  for (const ln of lines) {
    const hit = comp ? match479(ln, comp, detLines, tol) : null;
    if (hit) {
      dms += Number(ln.net);
      matched.push({ ln, amt: Number(ln.net) });
    } else {
      unmatched.push(ln);
    }
  }

  if (unmatched.length && comp) {
    const cpRem = unmatched.reduce((a, l) => a + Number(l.net), 0);
    dms += cpRem;
    for (const ln of unmatched) matched.push({ ln, amt: ln.net });
    unmatched.length = 0;
  }

  return { matched, unmatched, dms };
}

async function cuadreFromMovdet(query, fi, ff) {
  const { year, month } = monthFromRange(fi);
  const movByCuenta = {};
  const srvDoctos = new Set();

  for (const [cuenta, cfg] of Object.entries(CUENTAS)) {
    try {
      movByCuenta[cuenta] = await loadMovLines(query, year, month, cfg.like);
    } catch {
      movByCuenta[cuenta] = [];
    }
    for (const ln of movByCuenta[cuenta]) srvDoctos.add(ln.docto);
  }

  const doctos = [...srvDoctos];
  const dmsMap = await loadDmsComponents(query, doctos);
  const reLineMap = await loadReLines(query, doctos);
  const map479 = await load479Lines(query, doctos);

  const byFac = new Map();
  const totCp = emptyPorCuenta();
  const totDms = emptyPorCuenta();
  const stats = emptyPorCuenta();
  const unmatched = [];
  const vinsCp = new Set();
  const doctosCp = new Set();

  for (const [cuenta, cfg] of Object.entries(CUENTAS)) {
    if (cfg.re || cfg.is479) continue;
    for (const ln of movByCuenta[cuenta] || []) {
      totCp[cuenta] += Number(ln.net);
      doctosCp.add(ln.docto);
      const comp = dmsMap.get(facKey(ln.orden, ln.docto));
      if (comp?.vin) vinsCp.add(comp.vin);
      const hit = comp ? matchComponent(ln, comp, cfg.fields, cfg.tol) : null;
      if (!hit) {
        unmatched.push({ cuenta, ...ln, comp: comp ? 'sin match' : 'sin fac' });
        continue;
      }
      totDms[cuenta] += hit.amount;
      stats[cuenta] += 1;
      mergeFac(byFac, ln, comp, cuenta, hit.amount);
    }
  }

  const lines477ByFac = new Map();
  for (const ln of movByCuenta['0477'] || []) {
    const key = facKey(ln.orden, ln.docto);
    if (!lines477ByFac.has(key)) lines477ByFac.set(key, []);
    lines477ByFac.get(key).push(ln);
  }

  for (const [key, lines] of lines477ByFac) {
    for (const ln of lines) {
      totCp['0477'] += Number(ln.net);
      doctosCp.add(ln.docto);
    }
    const comp = dmsMap.get(key);
    if (comp?.vin) vinsCp.add(comp.vin);
    const { matched, unmatched: uFac, dms } = processReFac(lines, reLineMap, comp, key);
    totDms['0477'] += dms;
    stats['0477'] += matched.length;
    for (const { ln, amt } of matched) {
      mergeFac(byFac, ln, comp, '0477', amt);
    }
    for (const ln of uFac) {
      unmatched.push({ cuenta: '0477', ...ln, comp: comp ? 'sin match' : 'sin fac' });
    }
  }

  const lines479ByFac = new Map();
  for (const ln of movByCuenta['0479'] || []) {
    const key = facKey(ln.orden, ln.docto);
    if (!lines479ByFac.has(key)) lines479ByFac.set(key, []);
    lines479ByFac.get(key).push(ln);
  }

  for (const [key, lines] of lines479ByFac) {
    for (const ln of lines) {
      totCp['0479'] += Number(ln.net);
      doctosCp.add(ln.docto);
    }
    const comp = dmsMap.get(key);
    if (comp?.vin) vinsCp.add(comp.vin);
    const { matched, unmatched: uFac, dms } = process479Fac(lines, map479, comp);
    totDms['0479'] += dms;
    stats['0479'] += matched.length;
    for (const { ln, amt } of matched) {
      mergeFac(byFac, ln, comp, '0479', amt);
    }
    for (const ln of uFac) {
      unmatched.push({ cuenta: '0479', ...ln, comp: comp ? 'sin match' : 'sin fac' });
    }
  }

  return {
    byFac: [...byFac.values()].sort((a, b) => a.orden.localeCompare(b.orden) || a.docto.localeCompare(b.docto)),
    totCp,
    totDms,
    stats,
    unmatched,
    vinsCp: [...vinsCp].filter(Boolean).sort(),
    doctosCp: doctosCp.size,
  };
}

module.exports = {
  CUENTAS,
  emptyPorCuenta,
  cuadreFromMovdet,
  matchComponent,
  matchReLine,
};
