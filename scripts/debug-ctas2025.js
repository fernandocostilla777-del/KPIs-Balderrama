require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const samples = await query(`
    SELECT TOP 5 CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT, CTA_ACUMDET, CTA_NATURALEZA,
      CTA_SDOINICIAL, CTA_CARGO12, CTA_ABONO12
    FROM CON_CTAS012025
    WHERE CTA_GPOCONT = '110'
  `);
  console.log('110 sample:', JSON.stringify(samples, null, 2));

  const acum = await query(`
    SELECT CTA_ACUMDET, COUNT(*) c FROM CON_CTAS012025 GROUP BY CTA_ACUMDET
  `);
  console.log('ACUMDET counts:', acum);

  const bal110 = await query(`
    SELECT SUM(
      ISNULL(CTA_SDOINICIAL,0)
      + ISNULL(CTA_CARGO1,0)-ISNULL(CTA_ABONO1,0)
      + ISNULL(CTA_CARGO2,0)-ISNULL(CTA_ABONO2,0)
      + ISNULL(CTA_CARGO3,0)-ISNULL(CTA_ABONO3,0)
      + ISNULL(CTA_CARGO4,0)-ISNULL(CTA_ABONO4,0)
      + ISNULL(CTA_CARGO5,0)-ISNULL(CTA_ABONO5,0)
      + ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)
      + ISNULL(CTA_CARGO7,0)-ISNULL(CTA_ABONO7,0)
      + ISNULL(CTA_CARGO8,0)-ISNULL(CTA_ABONO8,0)
      + ISNULL(CTA_CARGO9,0)-ISNULL(CTA_ABONO9,0)
      + ISNULL(CTA_CARGO10,0)-ISNULL(CTA_ABONO10,0)
      + ISNULL(CTA_CARGO11,0)-ISNULL(CTA_ABONO11,0)
      + ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)
    ) AS saldo
    FROM CON_CTAS012025 WHERE CTA_GPOCONT = '110' AND CTA_ACUMDET = 'DET'
  `);
  console.log('Balance 110 DET:', bal110);

  const bal110all = await query(`
    SELECT SUM(
      ISNULL(CTA_SDOINICIAL,0)
      + ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)
    ) AS saldo
    FROM CON_CTAS012025 WHERE CTA_GPOCONT = '110'
  `);
  console.log('Balance 110 all:', bal110all);

  const count = await query(`SELECT COUNT(*) c FROM CON_CTAS012025`);
  console.log('Total rows:', count[0].c);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
