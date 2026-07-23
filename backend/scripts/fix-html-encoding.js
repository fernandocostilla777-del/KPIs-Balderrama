const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../frontend/public');
const files = fs.readdirSync(root).filter((f) => f.endsWith('.html'));

// Corrupted sequences (U+FFFD + leftover control bytes from broken UTF-8)
const FFFD = '\uFFFD';
const MINUS_CORRUPT = FFFD + FFFD + '\u0019'; // was − or → used as minus
const ARROW_CORRUPT = FFFD + ' ' + '\u0019'; // was →
const EM_CORRUPT = FFFD + '\u001d'; // was —
const EN_CORRUPT = FFFD + '\u001c'; // was – (also Ó in Órdenes)
const TIMES_CORRUPT = FFFD + '\u0014'; // was ×

function fixFile(file) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  // Goal stepper: use Material icons (reliable, no encoding issues)
  s = s.replace(
    /(<button type="button" class="goal-step-btn"[^>]*data-dir="-1"[^>]*>)[\s\S]*?(<\/button>)/g,
    '$1<span class="material-symbols-outlined" aria-hidden="true">remove</span>$2'
  );
  s = s.replace(
    /(<button type="button" class="goal-step-btn"[^>]*data-dir="1"[^>]*>)\+?(<\/button>)/g,
    '$1<span class="material-symbols-outlined" aria-hidden="true">add</span>$2'
  );

  // Accented words that lost the first letter
  s = s.split(FFFD + 'altimos').join('Últimos');
  s = s.split(FFFD + 'altimo').join('Último');
  // Prefer lowercase mid-sentence; titles get Ó via explicit patterns below
  s = s.split('ó' + EN_CORRUPT + 'rdenes').join('órdenes');
  s = s.split('Ó' + EN_CORRUPT + 'rdenes').join('Órdenes');
  s = s.split(EN_CORRUPT + 'rdenes').join('Órdenes');
  s = s.split(EN_CORRUPT + 'rden').join('Órden');
  s = s.split('ÓÓrdenes').join('Órdenes');
  s = s.split('óÓrdenes').join('órdenes');

  // Symbols (order matters)
  s = s.split(MINUS_CORRUPT).join('−');
  s = s.split(ARROW_CORRUPT).join('→');
  s = s.split(TIMES_CORRUPT).join('×');
  s = s.split(EM_CORRUPT).join('—');
  s = s.split(EN_CORRUPT).join('–');

  // Leftover ellipsis / diamond junk
  s = s.replace(/plan piso[^\s<.]*/g, (m) =>
    m.startsWith('plan piso') ? 'plan piso…' : m
  );

  // Any stray replacement chars
  s = s.split(FFFD).join('');

  // Words that lost accent after stripping FFFD alone
  s = s.replace(/\baltimos 30 días/g, 'Últimos 30 días');
  s = s.replace(/\baltimo trimestre/g, 'Último trimestre');
  s = s.replace(/\baltimo mes real/g, 'Último mes real');
  s = s.replace(/\baltimos 12 meses/g, 'Últimos 12 meses');
  s = s.replace(/>rdenes</g, '>Órdenes<');
  s = s.replace(/Solo rdenes/g, 'Solo órdenes');
  s = s.replace(/Control de rdenes/g, 'Control de órdenes');
  s = s.replace(/\brdenes por/g, 'Órdenes por');
  s = s.replace(/\brdenes críticas/g, 'Órdenes críticas');
  s = s.replace(/<th>rdenes<\/th>/g, '<th>Órdenes</th>');

  if (s !== before) {
    fs.writeFileSync(p, s, { encoding: 'utf8' });
    return true;
  }
  return false;
}

let n = 0;
for (const f of files) {
  if (fixFile(f)) {
    console.log('FIXED', f);
    n += 1;
  } else {
    console.log('ok', f);
  }
}
console.log('done', n);
