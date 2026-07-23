const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  if (!stored.includes(':')) return password === stored;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = Buffer.from(test, 'hex');
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

function getEncKey() {
  const secret = process.env.AUTH_SECRET || 'cambiar-en-produccion-balderrama';
  return crypto.scryptSync(secret, 'balderrama-pwd-reveal-v1', 32);
}

/** Cifrado reversible solo para revelación por Administración. */
function encryptPassword(password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptPassword(payload) {
  if (!payload || typeof payload !== 'string' || !payload.includes(':')) return null;
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncKey(),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  encryptPassword,
  decryptPassword,
};
