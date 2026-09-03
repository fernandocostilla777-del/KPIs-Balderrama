# Objetivos mensuales

Aplicación Next.js para importar el PDF mensual de objetivos comerciales y
comparar sus metas contra `/api/objetivos-resultados`.

## Ejecutar

```bash
# Desde la raíz del repositorio
npm run objetivos
```

Abre `http://localhost:3002`. El proxy interno conecta con:

```env
DASHBOARD_API_URL=http://127.0.0.1:3000
```

## Flujo mensual

1. Presiona **Cargar PDF mensual**.
2. El parser detecta mes, año, metas, tabla diaria, BDC y líneas de producto.
3. El mes queda almacenado en el navegador y aparece en el selector.
4. El tablero consulta los resultados reales para el mismo periodo.

La plantilla de Agosto 2026 está incluida como referencia inicial. Market share,
Essentials y TAC/certificaciones se muestran como pendientes mientras no exista
una fuente de resultados en el backend.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
