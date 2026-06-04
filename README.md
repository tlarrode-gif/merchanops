# MerchanOps

Aplicación web para gestionar servicios de trade marketing: clientes, CECO, trabajadores, campañas, puntos, materiales, comunicación y pagos.

## Estado

Primera versión funcional preparada para Next.js + Supabase + Vercel.

## Puesta en marcha rápida

1. Crea las tablas en Supabase usando `supabase/schema.sql`.
2. Ejecuta las migraciones de `supabase/` en orden de versión, especialmente `v2_migration.sql`, `v3_7_1_big_campaigns.sql`, `v3_7_isdin_module.sql` y `v3_8_1_isdin_billing_regularizations.sql`.
3. Copia `.env.example` como `.env.local`.
4. Rellena tus claves públicas de Supabase.
5. Ejecuta `npm install`.
6. Ejecuta `npm run dev`.

## Publicación

Conecta este repositorio en Vercel y añade las variables de entorno indicadas en `.env.example`.
