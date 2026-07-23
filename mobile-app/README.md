# BALDERRAMA — App móvil (Ionic + Capacitor)

App móvil con diseño **Liquid Glass** basado en `stitch_liquid_glass_analytics/`, conectada directamente a BALDERRAMA Cloud API.

## Pantallas

| Tab | Origen Stitch | Datos API |
|-----|---------------|-----------|
| **Inicio** | `panel_de_control` | `GET /api/mobile/overview` |
| **Métricas** | `m_tricas_detalladas` | `GET /api/mobile/ventas` |
| **Perfil** | `perfil_de_usuario` | `GET /api/auth/me` |

## Requisitos

- Node.js 18+
- Cloud API desplegada y sincronizada
- `MOBILE_AUTH_USERS` y `MOBILE_AUTH_SECRET` configurados en Railway

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
│   └── tab3/          # Perfil
├── capacitor.config.ts
└── src/environments/  # apiUrl
```
