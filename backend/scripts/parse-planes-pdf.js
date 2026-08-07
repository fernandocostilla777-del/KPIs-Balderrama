/**
 * Parsea Planes Chevrolet MY26 → JSON (Guía Administración + Bono Toma a Cuenta).
 * Uso: node scripts/parse-planes-pdf.js [ruta.pdf]
 */
const fs = require('fs');
const path = require('path');
const {
  parsePlanesPdfFile,
  ACTIVE_JSON,
} = require('../src/services/planesChevroletParser');

async function main() {
  const pdfPath = path.resolve(process.argv[2] || path.join(__dirname, '../data/planes-chevrolet-ago-my26.pdf'));
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF no encontrado:', pdfPath);
    process.exit(1);
  }

  const payload = await parsePlanesPdfFile(pdfPath);
  fs.writeFileSync(ACTIVE_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload.stats, null, 2));
  console.log('vigencia', payload.vigencia);
  console.log('modelos', payload.catalog.modelos);
  console.log('OK →', ACTIVE_JSON);
  if (payload.stats.sinModelo) {
    console.log(`Advertencia: ${payload.stats.sinModelo} renglones sin modelo`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
