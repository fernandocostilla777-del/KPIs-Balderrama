/**
 * Cuadre julio vs montos objetivo Contpaq.
 * Delega en cuadra-hyp-por-dinero (todas nomenclaturas, sub sin IVA, fac HyP).
 */
require('dotenv').config();

const FI = process.argv[2] || '2026-07-01';
const FF = process.argv[3] || '2026-07-31';

process.argv[2] = FI;
process.argv[3] = FF;

require('./cuadra-hyp-por-dinero.js');
