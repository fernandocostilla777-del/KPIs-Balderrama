# BALDERRAMA — App móvil (Ionic + Capacitor)

App móvil con diseño **Liquid Glass** basado en `stitch_liquid_glass_analytics/`, conectada directamente a BALDERRAMA Cloud API.

## Pantallas

| Tab | Datos API | Notas |
|-----|-----------|-------|
| **Inicio** | `GET /api/mobile/overview` | Solo roles con página `dashboard` |
| **Métricas** | `GET /api/mobile/metrics/:section` | Secciones filtradas por rol |
| **360** | `GET /api/mobile/metrics/seguimiento` | Gerencia / Dirección / Admin |
| **IA** | `POST /api/mobile/ai/chat` | Respuestas ultra-resumidas según rol |
| **Perfil** | `GET /api/auth/me` | Usuario, páginas y tools |

### Roles → alcance del asistente

| Rol | Tools IA |
|-----|----------|
| `administracion` / `direccion` | resumen, ventas, inventario, postventa, contabilidad, pronóstico, 360 |
| `gerencia_comercial` | ventas, pronóstico, seguimiento 360 |
| `contabilidad` | contabilidad |

Requiere `OPENAI_API_KEY` en Railway (cloud-api). Los datos son del **sync en la nube**, no SQL en vivo.

## Requisitos

- Node.js 18+
- Cloud API desplegada y sincronizada
- `MOBILE_AUTH_USERS` y `MOBILE_AUTH_SECRET` configurados en Railway

**Login:** mismos usuarios del dashboard web (admin, dirección, etc.). El backend local sincroniza el dominio `auth` a Cloud API; si aún no hay sync, puede usarse el fallback `MOBILE_AUTH_USERS`.

## Configuración

Edita `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://kpis-balderrama-production.up.railway.app',
};
```

La misma URL funciona en navegador, emulador y dispositivo físico.

## Desarrollo (navegador)

```bash
cd mobile-app
npm install
npm start
```

Abre http://localhost:8100 e inicia sesión con un usuario de `MOBILE_AUTH_USERS`.

## Build Android / iOS (Capacitor)

```bash
cd mobile-app
npm run build
npx cap add android    # solo la primera vez
npx cap sync
npx cap open android
```

Para iOS (Mac):

```bash
npx cap add ios
npx cap sync
npx cap open ios
```

## Diseño Liquid Glass

Colores y tipografía definidos en:

- `stitch_liquid_glass_analytics/liquid_analytics/DESIGN.md`
- `src/theme/variables.scss`
- `src/global.scss`

## Notas

- La app guarda un token de sesión firmado y lo envía como `Authorization: Bearer`.
- La clave `CLOUD_SYNC_API_KEY` nunca se incluye en el APK.
- CORS para Ionic y Capacitor está configurado en `cloud-api/server.js`.
- **No despliegues esta app en Railway** — Railway es solo para `cloud-api` + PostgreSQL.

## Estructura

```
mobile-app/
├── src/app/
│   ├── core/          # Auth, API, guards
│   ├── pages/login/   # Login
│   ├── tab1/          # Panel de control
│   ├── tab2/          # Métricas
│   ├── tab3/          # Perfil
│   ├── tab4/          # Seguimiento 360
│   └── tab5/          # Asistente IA (resumen por rol)
├── capacitor.config.ts
└── src/environments/  # apiUrl
```
