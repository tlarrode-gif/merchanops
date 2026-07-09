# Auditoría de seguridad — MerchanOPS

Fecha: 2026-07-09 · Alcance: código de la app + proyecto Supabase `MerchanOPS` (dptmswhwmqimijpfyndn)

## 1. Correcciones aplicadas en esta iteración

| # | Hallazgo | Corrección |
|---|----------|-----------|
| 1 | **Contraseñas en texto plano** en `app_users` y en `localStorage`; el login comparaba texto plano en el cliente | Hashing **PBKDF2-SHA256** (150k iteraciones, salt por usuario) en `lib/password.ts`. Migración transparente: al hacer login con una contraseña legada en claro, se re-guarda hasheada. Todos los guardados nuevos hashean siempre. |
| 2 | **Credenciales por defecto hardcodeadas** (`admin/admin123`, `gestorN/gestor123`) en `lib/access-control.ts` y en `supabase/v6_0_internal_users_permissions.sql` | Eliminadas del código y del SQL. Para instalaciones nuevas, la contraseña inicial del admin sale de `NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD` (`.env`) o se genera aleatoria (se muestra una única vez por consola). Los gestores nacen inactivos con contraseña aleatoria. |
| 3 | **Sin límite de intentos de login** | Rate limiting: **5 intentos fallidos por usuario cada 15 minutos** (`lib/rate-limit.ts`), aplicado en `loginAppUser`. Nota: al no existir API routes, el límite se aplica en cliente (ver §3.2). |
| 4 | **Inyección de fórmulas CSV** (celdas que empiezan por `=`, `+`, `-`, `@` se ejecutan como fórmula al abrir el export en Excel) | `csvSafeCell()` en `lib/sanitize.ts`, aplicado a los 4 exportadores CSV (historial económico, dashboard ISDIN, llamadas ISDIN, campañas). |
| 5 | El editor de usuarios **mostraba la contraseña almacenada** en el formulario | El campo ahora es `type="password"`, arranca vacío y "en blanco = mantener la actual". |
| 6 | Sin normalización de entradas | `sanitizeText`/`sanitizeIdentifier` (control chars fuera, longitud acotada) aplicado a usuario/nombre visible. XSS en render lo cubre React (JSX escapa); el único sink `document.write` del informe ISDIN ya escapaba con `esc()` (verificado). |

Escaneo de secretos: **no hay claves API, tokens ni credenciales de servicio en el código** (los únicos secretos eran las contraseñas por defecto del punto 2). Las claves de Supabase entran por variables de entorno (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`).

## 2. Vulnerabilidad CRÍTICA pendiente: RLS desactivado (requiere decisión)

Las **39 tablas** del proyecto Supabase tienen **Row Level Security desactivado** (confirmado por el linter de Supabase, nivel ERROR). Cualquiera que extraiga la `anon key` del bundle del navegador (es pública por diseño) puede **leer y modificar toda la base**: pagos, facturación ISDIN, y la propia `app_users` (el linter marca además `app_users.password` como *sensitive column exposed* — mitigado en parte porque ahora se guardan hashes, no contraseñas).

**No se ha activado RLS automáticamente a propósito**: la app usa la anon key sin Supabase Auth, así que activar RLS sin políticas dejaría la aplicación **sin acceso a nada** (rota en producción). La secuencia correcta es:

1. Migrar la autenticación interna a **Supabase Auth** (los usuarios de `app_users` pasan a `auth.users`; el rol/provincias a un perfil).
2. Definir políticas RLS por tabla según rol (admin todo; gestor solo sus provincias; lectura/escritura según módulo).
3. Activar RLS tabla a tabla (el SQL de activación está abajo).
4. Beneficio adicional: Supabase Auth trae **rate limiting de servidor** en login/registro de serie, sustituyendo al limitador de cliente actual.

<details><summary>SQL de activación de RLS (ejecutar SOLO tras definir políticas)</summary>

```sql
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.big_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.big_campaign_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isdin_vinyls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isdin_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isdin_billing_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isdin_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_pickings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_picking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_pending_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_material_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_vins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grandes_campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campana_gestores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_venta_campana ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidencias_campana ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campana_columnas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.economic_month_closures ENABLE ROW LEVEL SECURITY;
```
</details>

## 3. Otras vulnerabilidades restantes (por prioridad)

### 3.1 Autenticación 100 % en cliente (ALTA)
Toda la lógica de login, permisos y filtrado por provincia corre en el navegador. Con la anon key, un atacante ignora la pantalla de login y consulta la base directamente (ver §2). Los permisos de la UI son de **usabilidad**, no de seguridad, hasta que exista RLS + Supabase Auth. El hashing aplicado protege las credenciales en reposo, pero el navegador sigue descargando los hashes para comparar.

### 3.2 Rate limiting solo en cliente (MEDIA)
Sin API routes ni servidor propio, el límite de 5 intentos/15 min se aplica en el navegador (localStorage): frena la fuerza bruta casual y de usuarios legítimos, pero un atacante puede saltárselo llamando a Supabase directamente. La mitigación real llega con Supabase Auth (límites de servidor) — misma raíz que §2.

### 3.3 Dependencias con CVEs (MEDIA-ALTA)
`npm audit`: **8 vulnerabilidades (1 crítica, 4 altas)**.
- `next@14.2.23` — crítica (SSRF en middleware, cache poisoning, exposición en dev server…). Subir a Next 14.2.35+ o 15/16 (breaking).
- `xlsx@0.18.5` — alta (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9), **sin fix publicado en npm**; riesgo real porque la app importa ficheros Excel del usuario. Alternativas: `exceljs` o la build oficial de SheetJS CDN.
- `@supabase/supabase-js@2.48.1` — baja (auth-js path routing). Subir a 2.110+.
- `glob`/`postcss` vía toolchain (solo build/lint).

### 3.4 Linter de Supabase (MEDIA)
- Vistas `v_campana_kpis` y `v_campanas_listado` con `SECURITY DEFINER` (saltan RLS del consultante; revisar al activar RLS).
- Funciones `set_isdin_calls_updated_at` y `prevent_logistics_movement_mutation` con `search_path` mutable (fijar `SET search_path = ''`).

### 3.5 Sesión sin expiración ni firma (BAJA-MEDIA)
La sesión es un JSON en localStorage sin caducidad ni integridad: cualquier script con acceso al origen puede fabricarla. De nuevo, se resuelve con Supabase Auth (JWT con expiración).

## 4. Recomendación

El paquete aplicado (hashing, sin credenciales en repo, rate limit, anti-CSV-injection, sanitización) elimina lo corregible **sin romper producción**. El salto de seguridad real es uno solo: **migrar a Supabase Auth y activar RLS con políticas por rol/provincia** — resuelve §2, §3.1, §3.2 y §3.5 de raíz. Se recomienda planificarlo como fase propia antes de dar acceso a más usuarios.
