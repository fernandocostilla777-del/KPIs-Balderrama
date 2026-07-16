/**
 * Sincroniza usuarios del piloto en backend/data/users.json
 * Uso: node backend/scripts/seed-piloto-users.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { createUser, updateUser, listUsers } = require('../src/auth/users');
const { findUser } = require('../src/auth/userStore');

const PILOT_USERS = [
  { username: 'admin', password: 'Admin2026!', role: 'administracion', label: 'TI / Administración' },
  { username: 'gerente.general', password: 'GgBalderrama2026!', role: 'direccion', label: 'Gerente general (PPTO)' },
  { username: 'direccion', password: 'Direccion2026!', role: 'direccion', label: 'Dirección' },
  { username: 'contraloria', password: 'Contraloria2026!', role: 'contabilidad', label: 'Contraloría (EEFF)' },
  { username: 'contabilidad', password: 'Conta2026!', role: 'contabilidad', label: 'Contabilidad operativa' },
  { username: 'gerencia', password: 'Comercial2026!', role: 'gerencia_comercial', label: 'Gerencia comercial' },
  { username: 'comercial', password: 'Comercial2026!', role: 'gerencia_comercial', label: 'Analista comercial' },
];

function sync() {
  const results = [];
  for (const u of PILOT_USERS) {
    const existing = findUser(u.username);
    if (!existing) {
      const created = createUser({
        username: u.username,
        password: u.password,
        role: u.role,
      });
      results.push({ action: 'created', ...created, label: u.label });
      continue;
    }
    const updated = updateUser(u.username, {
      password: u.password,
      role: u.role,
      active: true,
    });
    results.push({ action: 'updated', ...updated, label: u.label });
  }

  console.log('Usuarios piloto sincronizados:\n');
  for (const r of results) {
    console.log(`  [${r.action}] ${r.username.padEnd(18)} ${r.roleLabel.padEnd(22)} ${r.label}`);
  }
  console.log('\nTotal en store:', listUsers().length);
  console.log('Detalle y contraseñas: PILOTO_USUARIOS.md');
}

sync();
