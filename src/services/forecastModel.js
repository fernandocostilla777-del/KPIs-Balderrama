/**
 * Modelo de pronóstico de ventas (regresión lineal múltiple).
 * Features: tendencia, estacionalidad (sin/cos), lags y media móvil.
 * Inspirado en notebooks típicos de forecasting de ventas automotrices.
 */

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function transpose(matrix) {
  return matrix[0].map((_, c) => matrix.map((row) => row[c]));
}

function matMul(a, b) {
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;
  const out = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = a[i][k];
      for (let j = 0; j < cols; j++) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];

    const div = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= div;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row[n]);
}

function olsFit(X, y) {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const Xty = matMul(Xt, y.map((v) => [v])).map((row) => row[0]);
  const beta = solveLinearSystem(XtX, Xty);
  if (!beta) return null;
  return beta;
}

function buildFeatures(series, index) {
  const units = series.map((r) => r.units);
  const month = series[index].mo;
  const lag = (n) => (index - n >= 0 ? units[index - n] : units[0] || 0);
  const roll = (n) => {
    const start = Math.max(0, index - n);
    return mean(units.slice(start, index));
  };

  return [
    1,
    index,
    Math.sin((2 * Math.PI * month) / 12),
    Math.cos((2 * Math.PI * month) / 12),
    lag(1),
    lag(2),
    lag(3),
    lag(12),
    roll(3) || lag(1),
    roll(6) || lag(1),
  ];
}

const FEATURE_NAMES = [
  'intercepto',
  'tendencia',
  'estacionalidad_sin',
  'estacionalidad_cos',
  'lag_1m',
  'lag_2m',
  'lag_3m',
  'lag_12m',
  'media_movil_3m',
  'media_movil_6m',
];

function nextMonth(yr, mo) {
  if (mo === 12) return { yr: yr + 1, mo: 1 };
  return { yr, mo: mo + 1 };
}

function monthLabel(yr, mo) {
  const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${names[mo - 1]} ${yr}`;
}

/**
 * @param {Array<{yr:number, mo:number, units:number}>} history ordenado ASC
 * @param {number} horizon meses a pronosticar
 */
function forecastSales(history, horizon = 6) {
  if (!history?.length) {
    return {
      history: [],
      forecast: [],
      metrics: { mape: null, mae: null, rmse: null, r2: null, trainSize: 0 },
      model: { name: 'OLS estacional + lags', features: FEATURE_NAMES, coefficients: [] },
    };
  }

  const series = history.map((r) => ({
    yr: Number(r.yr),
    mo: Number(r.mo),
    units: Number(r.units) || 0,
    key: `${r.yr}-${String(r.mo).padStart(2, '0')}`,
    label: monthLabel(Number(r.yr), Number(r.mo)),
  }));

  // Excluir mes incompleto actual si tiene muy pocas ventas vs media reciente
  let trainSeries = [...series];
  let incompleteMonth = null;
  if (trainSeries.length >= 4) {
    const last = trainSeries[trainSeries.length - 1];
    const recentMean = mean(trainSeries.slice(-4, -1).map((r) => r.units));
    if (recentMean > 0 && last.units < recentMean * 0.25) {
      incompleteMonth = { ...last };
      trainSeries = trainSeries.slice(0, -1);
    }
  }

  const minIndex = 12;
  if (trainSeries.length <= minIndex + 3) {
    // Fallback: media estacional simple
    const byMonth = Array.from({ length: 13 }, () => []);
    trainSeries.forEach((r) => byMonth[r.mo].push(r.units));
    const seasonal = byMonth.map((arr) => (arr.length ? mean(arr) : mean(trainSeries.map((r) => r.units))));
    const overall = mean(trainSeries.map((r) => r.units));
    let cursor = trainSeries[trainSeries.length - 1];
    const forecast = [];
    for (let h = 0; h < horizon; h++) {
      cursor = nextMonth(cursor.yr, cursor.mo);
      const pred = Math.max(0, Math.round(seasonal[cursor.mo] || overall));
      forecast.push({
        yr: cursor.yr,
        mo: cursor.mo,
        key: `${cursor.yr}-${String(cursor.mo).padStart(2, '0')}`,
        label: monthLabel(cursor.yr, cursor.mo),
        units: pred,
        low: Math.max(0, Math.round(pred * 0.8)),
        high: Math.round(pred * 1.2),
      });
    }
    const lastComplete = trainSeries[trainSeries.length - 1];
    return {
      history: trainSeries,
      incompleteMonth,
      lastCompleteMonth: lastComplete
        ? { yr: lastComplete.yr, mo: lastComplete.mo, units: lastComplete.units, label: monthLabel(lastComplete.yr, lastComplete.mo) }
        : null,
      forecast,
      metrics: { mape: null, mae: null, rmse: null, r2: null, trainSize: trainSeries.length },
      model: { name: 'Media estacional (fallback)', features: ['mes'], coefficients: [] },
    };
  }

  const X = [];
  const y = [];
  for (let i = minIndex; i < trainSeries.length; i++) {
    X.push(buildFeatures(trainSeries, i));
    y.push(trainSeries[i].units);
  }

  // Holdout últimos 3 puntos para métricas
  const holdout = Math.min(3, Math.floor(X.length / 4));
  const Xtrain = X.slice(0, X.length - holdout);
  const ytrain = y.slice(0, y.length - holdout);
  const Xtest = X.slice(X.length - holdout);
  const ytest = y.slice(y.length - holdout);

  let beta = olsFit(Xtrain, ytrain);
  if (!beta) beta = olsFit(X, y);
  if (!beta) {
    throw new Error('No se pudo ajustar el modelo de pronóstico.');
  }

  const predictRow = (features) => {
    let p = 0;
    for (let i = 0; i < features.length; i++) p += beta[i] * features[i];
    return Math.max(0, p);
  };

  const residuals = [];
  for (let i = 0; i < Xtrain.length; i++) {
    residuals.push(ytrain[i] - predictRow(Xtrain[i]));
  }
  const residualStd = std(residuals) || mean(ytrain) * 0.15;

  let mape = null;
  let mae = null;
  let rmse = null;
  let r2 = null;
  if (Xtest.length) {
    const preds = Xtest.map(predictRow);
    const absErr = preds.map((p, i) => Math.abs(p - ytest[i]));
    mae = mean(absErr);
    rmse = Math.sqrt(mean(preds.map((p, i) => (p - ytest[i]) ** 2)));
    const mapeVals = preds
      .map((p, i) => (ytest[i] > 0 ? Math.abs(p - ytest[i]) / ytest[i] : null))
      .filter((v) => v !== null);
    mape = mapeVals.length ? mean(mapeVals) * 100 : null;
    const yMean = mean(ytest);
    const ssTot = ytest.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const ssRes = preds.reduce((s, p, i) => s + (ytest[i] - p) ** 2, 0);
    r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  }

  // Reajustar con todos los datos disponibles
  beta = olsFit(X, y) || beta;

  const work = trainSeries.map((r) => ({ ...r }));
  const forecast = [];
  for (let h = 0; h < horizon; h++) {
    const last = work[work.length - 1];
    const nxt = nextMonth(last.yr, last.mo);
    work.push({ yr: nxt.yr, mo: nxt.mo, units: 0 });
    const idx = work.length - 1;
    const features = buildFeatures(work, idx);
    const pred = predictRow(features);
    const units = Math.max(0, Math.round(pred));
    work[idx].units = units;
    forecast.push({
      yr: nxt.yr,
      mo: nxt.mo,
      key: `${nxt.yr}-${String(nxt.mo).padStart(2, '0')}`,
      label: monthLabel(nxt.yr, nxt.mo),
      units,
      low: Math.max(0, Math.round(pred - 1.28 * residualStd)),
      high: Math.round(pred + 1.28 * residualStd),
    });
  }

  const fitted = trainSeries.map((r, i) => {
    if (i < minIndex) return { ...r, fitted: null };
    return { ...r, fitted: Math.round(predictRow(buildFeatures(trainSeries, i))) };
  });

  const lastComplete = trainSeries[trainSeries.length - 1];

  return {
    history: fitted,
    incompleteMonth,
    lastCompleteMonth: lastComplete
      ? {
          yr: lastComplete.yr,
          mo: lastComplete.mo,
          units: lastComplete.units,
          label: monthLabel(lastComplete.yr, lastComplete.mo),
        }
      : null,
    forecast,
    metrics: {
      mape: mape !== null ? Math.round(mape * 10) / 10 : null,
      mae: mae !== null ? Math.round(mae * 10) / 10 : null,
      rmse: rmse !== null ? Math.round(rmse * 10) / 10 : null,
      r2: r2 !== null ? Math.round(r2 * 1000) / 1000 : null,
      trainSize: trainSeries.length,
      residualStd: Math.round(residualStd * 10) / 10,
    },
    model: {
      name: 'Regresión lineal múltiple (tendencia + estacionalidad + lags)',
      features: FEATURE_NAMES,
      coefficients: FEATURE_NAMES.map((name, i) => ({
        name,
        value: Math.round((beta[i] || 0) * 1000) / 1000,
      })),
    },
  };
}

module.exports = { forecastSales, monthLabel };
