# Despliegue e actualización en servidor

**Objetivo:** instalar el dashboard una vez en el servidor y, en adelante, **pasar solo los cambios** (código/datos modificados), sin volver a copiar todo el proyecto ni `node_modules`.

---

## 1. Instalación inicial (solo una vez)

En la PC de desarrollo se generaron (o se pueden regenerar):

| Archivo | Contenido |
|---------|-----------|
| `dashboard-deploy.zip` | Código sin `node_modules`, `.git`, `.angular`, mockups Stitch |
| `dashboard-data.zip` | `backend/data` (usuarios, SQLite CRM, Excel, etc.) |

### En el servidor

1. Instalar **Node.js 18+** (LTS).
2. Descomprimir `dashboard-deploy.zip` en una carpeta fija, p. ej. `C:\Apps\KPIs-Balderrama`.
3. Descomprimir `dashboard-data.zip` dentro de `backend\data`.
4. Copiar `backend\.env` (credenciales SQL, auth, etc.) — **no va en el zip**.
5. Verificar que el servidor tenga **acceso de red a SQL Server** (`DB_HOST:1433`).
6. Instalar dependencias y arrancar:

```powershell
cd C:\Apps\KPIs-Balderrama
npm run install:all
npm start
```

| Servicio | URL |
|----------|-----|
| UI | http://localhost:5173 (o IP LAN del servidor) |
| API | http://localhost:3000/api |

---

## 2. Actualizaciones posteriores (solo cambios)

**No** vuelvas a copiar el proyecto completo. Genera un paquete de **delta** en la PC de desarrollo y aplícalo en el servidor.

### Opción A — Script recomendado (por fecha o por Git)

En la PC de desarrollo, desde la raíz del repo:

```powershell
# Cambios desde una fecha (ej. última vez que actualizaste el servidor)
.\scripts\pack-server-update.ps1 -Since "2026-07-22"

# O desde el último commit ya desplegado
.\scripts\pack-server-update.ps1 -SinceCommit "abc1234"
```

Salida típica en el Escritorio:

- `dashboard-update-YYYYMMDD-HHMM.zip` → solo archivos de código/datos tocados
- `dashboard-update-YYYYMMDD-HHMM.txt` → lista de archivos incluidos

### Opción B — Manual con Git

```powershell
# Lista de archivos cambiados desde el commit desplegado
git diff --name-only <commit-desplegado> HEAD

# Empaquetar esos paths (sin node_modules / .env)
```

### Qué SÍ suele ir en un update

- `backend/src/**`, `backend/server.js`, `backend/package.json`
- `frontend/public/**`, `frontend/server.js`, `frontend/package.json`
- `package.json` de la raíz (si cambió)
- Archivos de `backend/data/**` **solo si** cambiaste usuarios, CRM, Excel, etc.

### Qué NO copiar en cada update

| Excluir | Motivo |
|---------|--------|
| `node_modules/` | Se regenera con `npm install` solo si cambió `package.json` |
| `.git/`, `.angular/` | No necesarios para ejecutar |
| `backend/.env` | Secretos del servidor; no sobrescribir a ciegas |
| Mockups `stitch_*` | Diseño, no runtime |

---

## 3. Aplicar el update en el servidor

1. Detener el dashboard (`Ctrl+C` o detener el servicio/PM2).
2. Descomprimir `dashboard-update-*.zip` **sobre** la carpeta del proyecto (sobrescribe solo esos archivos).
3. Si el update incluye `package.json` / `package-lock.json`:

```powershell
npm run install:all
```

4. Si **no** cambió ningún `package.json`, **no** hace falta reinstalar.
5. Arrancar de nuevo:

```powershell
npm start
```

6. Anotar en un control interno la fecha/commit desplegado (para el próximo `-Since` / `-SinceCommit`).

---

## 4. Cuándo sí conviene un zip completo otra vez

- Primera instalación en un servidor nuevo
- Se corrompió la carpeta del servidor
- Cambios masivos en dependencias o estructura del monorepo

Para el día a día: **solo el paquete de update**.

---

## 5. Checklist rápido

**Instalación inicial**

- [ ] Node.js 18+
- [ ] `dashboard-deploy.zip` + `dashboard-data.zip`
- [ ] `backend/.env` con SQL alcanzable
- [ ] `npm run install:all` + `npm start`

**Cada actualización**

- [ ] Generar `dashboard-update-*.zip` en desarrollo
- [ ] Copiar al servidor y descomprimir encima
- [ ] `npm run install:all` solo si cambió algún `package.json`
- [ ] Reiniciar `npm start`
- [ ] Guardar fecha/commit desplegado

---

## 6. Relación con otros documentos

- Arranque local y módulos: [README.md](./README.md)
- Detalle funcional/APIs: [DOCUMENTACION.md](./DOCUMENTACION.md)
- Nube Railway (`cloud-api`): [cloud-api/DEPLOY_RAILWAY.md](./cloud-api/DEPLOY_RAILWAY.md)
