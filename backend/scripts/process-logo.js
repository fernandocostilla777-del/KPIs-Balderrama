const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '../.cursor-assets');
const publicDir = path.join(__dirname, '../public/img');
const outPng = path.join(publicDir, 'logo-autointel.png');

function findSource() {
  const cursorAssets = 'C:/Users/ABP-SDN-SI-221/.cursor/projects/c-Users-ABP-SDN-SI-221-Desktop-Prueba-Dashbord/assets';
  if (fs.existsSync(cursorAssets)) {
    const f = fs.readdirSync(cursorAssets).find((n) => n.endsWith('.png'));
    if (f) return path.join(cursorAssets, f);
  }
  return outPng;
}

async function main() {
  let PNG;
  try {
    PNG = require('pngjs').PNG;
  } catch {
    console.log('pngjs not installed, skipping PNG conversion');
    return;
  }

  const src = findSource();
  if (!fs.existsSync(src)) return;

  const buf = fs.readFileSync(src);
  const srcPng = PNG.sync.read(buf);
  const out = new PNG({ width: srcPng.width, height: srcPng.height });

  for (let y = 0; y < srcPng.height; y++) {
    for (let x = 0; x < srcPng.width; x++) {
      const idx = (srcPng.width * y + x) << 2;
      const r = srcPng.data[idx];
      const g = srcPng.data[idx + 1];
      const b = srcPng.data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 35) {
        out.data[idx] = 15;
        out.data[idx + 1] = 23;
        out.data[idx + 2] = 42;
        out.data[idx + 3] = 255;
      } else {
        out.data[idx + 3] = 0;
      }
    }
  }

  fs.writeFileSync(outPng, PNG.sync.write(out));
  console.log('PNG updated:', outPng, `${out.width}x${out.height}`);
}

main().catch(console.error);
