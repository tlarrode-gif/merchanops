# Estado real de las plataformas Merchanservis

**Fecha del análisis:** 3 de agosto de 2026
**Método:** lectura completa del código de los repositorios + verificación en vivo, en **solo lectura**, del proyecto Supabase compartido (`dptmswhwmqimijpfyndn`, PostgreSQL 17.6) mediante el catálogo de PostgreSQL, el listado de migraciones aplicadas y los *advisors* de seguridad. Se han ejecutado además `npm install`, `vitest`, `tsc --noEmit`, `next lint` y `npm audit` en ambos repos.
**Nada se ha modificado.** Este documento es el único fichero nuevo.

> **Cómo leer este informe.** Cada afirmación lleva su evidencia (fichero:línea, o consulta a la base). Donde el código no permite decidir, se dice explícitamente **[NO DETERMINABLE]** en vez de estimar. Los datos de la base son *un* indicio de uso, no una prueba de calidad: una tabla vacía puede significar "no se usa" o "se purgó", y cuando esa ambigüedad existe se señala.

---

## 0. Acceso a los repositorios (PASO 1)

| Repositorio | Estado | Último commit |
|---|---|---|
| `tlarrode-gif/merchanops` | ✅ Clonado | `e1e7ea7` — 31 jul 2026 15:01 +0200 — *"RR.HH.: que se pueda usar mas rapido que un Excel (#39)"* |
| `tlarrode-gif/merchanlogs` | ✅ Clonado | `e8b2486` — 31 jul 2026 10:13 +0200 — *"Merge PR #16: Confirmar la recepción de vinilos con la foto del palet"* |
| **MerchanGO** | ❌ **No existe** | — |

Sobre MerchanGO: el listado de repositorios de la cuenta devuelve exactamente tres: `merchanops`, `merchanlogs` y `tlarrode-gif/Merchan` (privado, último push **20 nov 2025**, sin relación aparente con MerchanGO). No hay ningún repositorio con ese nombre ni variante. Tampoco hay rastro de MerchanGO en el código de las otras dos plataformas: la búsqueda de `instalador` sí aparece (como maestro `workers` compartido), pero no hay ninguna app, ruta, tabla ni migración pensada para una aplicación móvil de instaladores. **MerchanGO está sin empezar, y confirmado desde el código.**

### Nota sobre el backend "Merchan Core"

La organización de Supabase tiene **un único proyecto**, y no se llama *Merchan Core*: se llama **`MerchanOPS`** (`dptmswhwmqimijpfyndn`, región `eu-west-1`, creado el **20 de mayo de 2026**). Las dos aplicaciones apuntan a él. Es decir, "Merchan Core" existe como concepto y como práctica —el esquema está claramente diseñado para ser compartido, con vistas puente y comandos RPC—, pero **no existe como proyecto separado**: LOGS escribe en la base que se creó para OPS. Esto tiene consecuencias reales que se detallan en §6 y §10.

---

## 1. MerchanOPS — inventario

### 1.1 Stack y ritmo

| Concepto | Valor | Evidencia |
|---|---|---|
| Framework | Next.js **14.2.23** (App Router) | `package.json` |
| React | 18.3.1 | `package.json` |
| Supabase JS | 2.48.1 | `package.json` |
| TypeScript | 5.7.2 | `package.json` |
| Tests | vitest ^4.1.10 | `package.json` |
| Hoja de cálculo | **xlsx 0.18.5** | `package.json` — ver §5.1, es un problema |
| Scripts | `dev`, `build`, `start`, `lint`, `test` — **no hay `typecheck`** | `package.json` |

**Ritmo de commits (últimos 3 meses):**

| Mes | Commits |
|---|---|
| mayo 2026 | 0 |
| junio 2026 | 3 |
| julio 2026 | **48** |
| agosto 2026 (hasta el día 3) | 0 |

Total en el repositorio: **51 commits**. El primero es del **30 de junio de 2026**.

> **Hallazgo (inesperado).** El proyecto Supabase se creó el **20 de mayo de 2026** y contiene datos operativos desde entonces, pero el historial de git empieza el **30 de junio**. Faltan ~6 semanas de historia. La explicación más probable es que el repositorio se reinicializó o se aplastó (*squash*) en esa fecha. No es un defecto de funcionamiento, pero significa que **no se puede hacer arqueología de código anterior a junio**: si algo del módulo de Servicios/ISDIN se comporta de forma rara, no hay commit que explique por qué. **[Confianza: alta en el hecho; media en la causa.]**

El trabajo se concentra en dos ráfagas de julio: 29–31 de julio (auditoría técnica, olas 3 y 4, grandes campañas, RR.HH.) y 11–14 de julio (pagos, RLS, roles). Es un patrón de sprints intensos, no de goteo continuo.

### 1.2 Mapa de rutas

23 rutas. Clasificación con su evidencia:

| Ruta | Estado | Evidencia |
|---|---|---|
| `/` (Panel + pestañas) | **PARCIAL** | `app/page.tsx` — 175 líneas físicas pero **72,5 KB**. Contiene Panel, Servicios, Calendario, Pagos, Clientes, Trabajadores, Usuarios y 3 formularios. Ver desglose abajo. |
| `/grandes-campanas` | COMPLETA | `app/grandes-campanas/page.tsx` — listado con filtros, KPIs y acciones; consume `fetchCampanasListado` (`lib/campanas.ts`). |
| `/grandes-campanas/nueva` | COMPLETA | `app/grandes-campanas/nueva/page.tsx:1-207` — formulario completo + importador CSV. |
| `/grandes-campanas/[id]` | **PARCIAL** | 894 líneas. Pestañas `puntos`, `gestores`, `incidencias`, `pagos` implementadas (`:670`, `:751`, `:774`, `:820`); pestañas **`documentos` e `historial` son STUB**: `app/grandes-campanas/[id]/page.tsx:854` renderiza literalmente *"Próximamente. Esta pestaña se activará cuando haya datos de…"*. No hay ningún código que produzca esos datos. |
| `/grandes-campanas/[id]/editar` | COMPLETA | `:1-153`, guarda con verificación de error. |
| `/grandes-campanas/[id]/asignacion` | COMPLETA | 455 líneas, asignación por provincia con paginación. |
| `/grandes-campanas/mi-zona` | COMPLETA | 78 líneas; vista de gestor, filtra por ámbito provincial. |
| `/grandes-campanas/isdin` | COMPLETA | 220 líneas (densas), tabla operativa de vinilos con edición en línea. |
| `/grandes-campanas/isdin/llamadas` | COMPLETA | 435 + 550 líneas (`ui.tsx`), flujo de llamada completo. |
| `/grandes-campanas/isdin/dashboard` | COMPLETA | 144 líneas, KPIs calculados. |
| `/grandes-campanas/isdin/facturacion` | COMPLETA | 100 líneas; bloqueada a administración por `canViewFinancials` además de por sidebar. Lógica en `lib/isdin-billing.ts`. |
| `/pagos/obligaciones` | COMPLETA (código) / **ÁMBAR (uso)** | `app/pagos/obligaciones/page.tsx` — transiciones con control de concurrencia por `version`. Pero en producción: **466 obligaciones en `calculado`, 36 en `revisado`, 0 en `cerrado`, 0 en `anulado`**. El último paso del flujo nunca se ha ejercitado. |
| `/historial-economico` | **PARCIAL** | 342 líneas, código completo y con reversos inmutables. Pero **`economic_events` tiene 0 filas en producción**, y `economic_month_closures` también 0. La sincronización es automática al abrir la pantalla para gestores (`:77`, `:99`) y por botón para administración. Cero filas significa que **la pantalla nunca ha llegado a ejecutarse con éxito en producción**, o que nadie la ha abierto. No se puede distinguir desde el código. **[NO DETERMINABLE cuál de las dos.]** |
| `/logistica` y `/logistica/[section]` | **PARCIAL por diseño** | `app/logistica/logistics-client.tsx:82` — *"este módulo es de SOLO CONSULTA"*. Los botones de acción (`Resolver incidencia`, `Pendiente producción`…, `:517`) llaman a `commit()`, que **no hace nada salvo abrir MerchanLOGS en otra pestaña** (`:85-89`). Funciona y está avisado en pantalla, pero son botones que mienten sobre lo que hacen. |
| `/logistica/solicitudes` | COMPLETA | 336 líneas; crea peticiones vía RPC transaccional. |
| `/configuracion/sincronizacion` | COMPLETA | Alias de `LogisticsClient section="sincronizacion"`. |
| `/configuracion/avisos` | COMPLETA | 180 líneas. |
| `/rrhh/altas` | COMPLETA | 1607 líneas en `altas-client.tsx`. Ver §3. |
| `/rrhh/accesos` | COMPLETA | 1034 líneas en `accesos-client.tsx`. |
| `/rrhh/cadenas` | COMPLETA | 742 líneas en `cadenas-client.tsx`. |
| `/auditoria-pagos` | Redirección | `app/auditoria-pagos/page.tsx:6` → `/historial-economico`. Correcto. |
| `/ui-preview` | **STUB / resto de desarrollo** | 94 líneas de catálogo visual con datos inventados. **Sin ninguna comprobación de sesión** (0 referencias a `getCurrentAppSession`). Está desplegado y es accesible por URL. |

**Desglose de `/` (la pestaña por pestaña):**

| Pestaña | Estado | Evidencia |
|---|---|---|
| Panel | COMPLETA | `app/page.tsx:109` |
| Servicios | COMPLETA | `:115` — filtros, edición, WhatsApp, duplicado, petición de material |
| **Calendario** | **PARCIAL** | `:120` — `CalendarByWorker` es **una sola línea de código**. Es un selector de mes y, por cada trabajador, las tarjetas de sus servicios de ese mes. **No hay rejilla de calendario, ni vista semanal, ni detección de solapes, ni arrastrar y soltar, ni capacidad**. Funciona, pero es una lista agrupada, no un calendario. |
| **Pagos** | **PARCIAL — con un defecto real** | `:123` — los pagos de servicio salen bien. Los de gran campaña salen de `big_campaign_points` / `big_campaigns`, que **tienen 0 filas**: los datos vivos están en `puntos_venta_campana` (15 filas) y `grandes_campanas` (1 fila). El propio código lo sabe: `lib/payments/campana-obligations.ts:12` dice *"legadas big_campaigns/big_campaign_points, vacías desde la migración"*. **Conclusión: la pestaña Pagos del Panel no muestra ningún pago de grandes campañas y nunca dirá que falta nada.** |
| Clientes / Trabajadores / Usuarios | COMPLETA | `:121`, `:122`, `:164` |

### 1.3 Módulos de lógica y quién los consume

Los módulos de `lib/` con más consumidores (número de ficheros que los importan):

| Módulo | Consumidores | Observación |
|---|---|---|
| `lib/access-control.ts` (411 líneas) | 26 | Núcleo de sesión, roles y permisos. |
| `lib/supabase.ts` (10) | 21 | Cliente único. |
| `lib/campanas.ts` (927) | 17 | Grandes campañas. |
| `lib/payments/*` (11 ficheros, ~1.500 líneas) | — | Motor de pagos aislado y bien probado. |
| `lib/rrhh/*` (4 ficheros, ~1.900 líneas) | — | Módulo de RR.HH. |
| `lib/logistics.ts` (608) | 11 | Tipos y estado del módulo de consulta logística. |
| **`lib/outbox.ts` (139)** | **0** | **Código muerto completo.** Ver §1.6. |

### 1.4 Esquema de datos (tablas referenciadas desde el código)

**49 tablas y 7 vistas verificadas en vivo.** Todas las tablas y RPCs referenciadas desde el código **existen**. No hay ninguna consulta a una tabla inexistente. Este es un resultado limpio y merece decirse.

Tablas con filas y actividad reciente (fecha del registro más nuevo):

| Tabla | Filas | Último dato | Lectura |
|---|---|---|---|
| `points` | 482 | 30 jul | Operativa viva |
| `isdin_calls` | 474 | **3 ago** | **En uso hoy mismo** |
| `isdin_vinyls` | 475 | — | Operativa viva |
| `payment_obligations` | 502 | 29 jul | 466 `calculado`, 36 `revisado`, **0 `cerrado`** |
| `payment_obligations_audit` | 539 | — | Auditoría funcionando |
| `services` | 262 | 30 jul | Operativa viva |
| `logistics_material_requirements` | 133 | 30 jul | Puente OPS→LOGS vivo |
| `logistics_audit_log` | 251 | — | |
| `integration_events` | 148 | — | |
| `cadenas` | 34 | 31 jul | RR.HH. sembrado |
| `puntos_venta_campana` | 15 | 30 jul | Gran campaña real |
| `outbox_events` | 20 | **3 ago** | Todos `completado` |
| `rrhh_solicitud_alta_lineas` | 30 | **3 ago** | **RR.HH. en uso hoy** |

Tablas **vacías** referenciadas desde código vivo (esto es lo relevante):

| Tabla | Filas | Qué significa |
|---|---|---|
| `economic_events` | **0** | El Historial económico nunca ha registrado nada. |
| `economic_month_closures` | **0** | Nunca se ha cerrado un mes. |
| `payment_ledger` | 0 | Superada por `payment_obligations`; `lib/payment-ledger.ts` sigue viva pero apunta a una tabla vacía. |
| `payment_audit_log` | 0 | Ídem. |
| `big_campaigns` / `big_campaign_points` | **0 / 0** | Legado. Leídas todavía desde `app/page.tsx:123` y `app/historial-economico/page.tsx:112-113`. |
| `logistics_requests` / `logistics_request_lines` | **0 / 0** | **Ver §6: es el hallazgo más incómodo del informe.** |
| `logistics_incidents` | 0 | Ninguna incidencia logística registrada en la base. |
| `logistics_pending_arrivals` | 0 | |
| `logistics_entry_lines` | 0 | Aunque hay 5 `logistics_entries`. |
| `isdin_billing_audit` | 0 | Los triggers existen; no se han disparado. |
| `attachments` | 0 | Sin uso. |
| `logistics_request_code_counters` | 0 | Creada el 30 jul (v10_3); ninguna petición desde entonces. |

**Migraciones: el punto más frágil de todo el sistema.**

- **55 migraciones aplicadas** en producción, según el registro de Supabase.
- El repositorio de OPS versiona **51 ficheros `.sql`**.
- **21 ficheros del repo NO están en el registro de aplicadas**: `schema.sql`, `v2_migration`, `v3_migration`, `v3_6_1`, `v3_6_2`, `v3_7`, `v3_7_1`, `v3_7_3`, `v3_8`, `v3_8_1`, `v4_0`, `v4_1`, `v5_0`…`v5_3`, `v6_0`…`v6_2`, `v9_0_rls_prepared`. Los objetos que crean **sí existen** en la base, así que casi con seguridad se aplicaron a mano antes de que se empezara a usar el registro (el registro empieza en `v7_0`, 3 de julio). Es ruido documental, no un fallo. **[Confianza: alta.]**
- **7 migraciones aplicadas en producción NO tienen fichero en ningún repositorio**: `v8_4b_drop_old_sync_overload`, `v9_1b_bootstrap_returns_error`, `v9_1c_pbkdf2_fast`, `v8_6b_outbox_search_path`, `v8_7b_isdin_vin_upsert`, `v9_11b_campanas_visibles_para_almacen`, `v9_11c_campanas_solo_escape_almacen`. **Esto sí es un fallo.** Son parches en caliente sobre funciones de autenticación, de política RLS y del outbox, y su código fuente solo existe dentro de la base de datos. **La base de producción no se puede reconstruir desde los repositorios.** (Otras 10 migraciones sin fichero en OPS —las vistas y las políticas de logística— sí están documentadas, pero en el **otro** repositorio: `merchanlogs/supabase/migraciones-aplicadas/00…03`.)

### 1.5 Autenticación, roles y permisos

**Arquitectura real:** no hay `middleware.ts`, no hay rutas de API, no hay comprobación en servidor. **Todo el frontend es cliente, y la única barrera real es la RLS de PostgreSQL.** Esto está bien entendido y bien documentado en el código (`lib/request-access.ts:16` lo dice explícitamente en LOGS). No es un descuido: es una decisión, y la RLS la sostiene.

**Cómo funciona el login** (`lib/access-control.ts:236-283`):
1. `rpc merchan_auth_bootstrap` verifica la contraseña **en el servidor** (PBKDF2 contra `app_users`, con limitación de intentos en servidor).
2. `supabase.auth.signInWithPassword` obtiene el JWT real.
3. `rpc merchan_auth_whoami` devuelve el perfil **sin el hash de contraseña**.

El hash nunca sale de la base: `APP_USER_COLUMNS` (`:29`) lo excluye explícitamente. Correcto.

**Roles:** `admin`, `manager`, `manager` (gestor), `almacen`, `rrhh` (`:8`). Cada uno con matriz de permisos fija en código (`:37-88`) y espejo en la base (`merchan_is_admin`, `merchan_is_rrhh`, `merchan_is_almacen`, `merchan_has_perm`).

**Estado de la RLS: excelente.** Las **59 tablas tienen RLS activada**. 56 tienen políticas; las 3 sin política (`auth_login_attempts`, `logistics_request_code_counters`, `rrhh_code_counters`) son correctas: son tablas internas a las que solo se llega por funciones `SECURITY DEFINER`, y sin política el acceso directo queda denegado. Los *advisors* de Supabase las marcan como INFO, no como problema.

**Dónde NO se comprueba:**

1. **`/ui-preview`** — ruta pública sin comprobación de sesión. Solo expone el sistema visual con datos inventados: **no hay fuga de datos**, pero es una ruta de desarrollo desplegada en producción.
2. **Las páginas `/rrhh/*/page.tsx` no comprueban nada** (0 referencias), pero es correcto: son cascarones de `Suspense` y el guardián vive en los `-client.tsx` correspondientes (5-6 referencias cada uno).
3. **`normalizeUser` degrada roles desconocidos a `manager`** (`lib/access-control.ts:92-95`). El propio comentario lo avisa: *"si un rol nuevo no se añade AQUÍ, el usuario se degrada en silencio a gestor y `saveInternalUsers` reescribe esa degradación en la base"*. Es decir: **un fallo de coordinación entre código y base no solo concede permisos de gestor a quien no debería, sino que además lo persiste**. Es una trampa conocida y no desactivada.
4. **`saveInternalUsers` escribe usuario por usuario sin transacción** (`:200-218`). Si falla a mitad, la lista queda en un estado híbrido. El código lanza el error (no hay éxito silencioso), pero no revierte.

**Advertencias del *advisor* de seguridad de Supabase (verificadas en vivo):**

- `logistics_request_lines` tiene una política `UPDATE` con `WITH CHECK (true)` — la parte `USING` sí restringe, pero un `UPDATE` puede reescribir la fila a cualquier valor que ya no cumpla la condición. **Riesgo real, aunque de explotación limitada.**
- 4 funciones `SECURITY DEFINER` ejecutables por `anon` (sin sesión): `merchan_auth_bootstrap` (correcto: es el login), `merchan_can_logistics_write`, `merchan_owns_request` y `merchan_stamp_campaign_picking`. Las tres últimas **no deberían ser accesibles sin sesión**.
- **Protección contra contraseñas filtradas (HaveIBeenPwned) desactivada** en Supabase Auth.

### 1.6 Deuda técnica

**TODO/FIXME/HACK:** cero. No hay ni un solo marcador de deuda en el código. (Los aciertos de `grep` son la palabra "TODOS" en castellano.) Esto es inusual y hay que interpretarlo con cuidado: **no significa que no haya deuda, significa que la deuda no está marcada** y por tanto no es rastreable con herramientas.

**Código muerto:**

- **`lib/outbox.ts` (139 líneas) — 0 importadores.** Módulo entero muerto. Implementa el consumo del outbox (`outbox_claim`, `outbox_complete`, `outbox_fail`) desde el navegador. Nadie lo llama. Ver §6.
- **63 símbolos exportados que solo se usan dentro de su propio fichero.** Los bloques mayores: `lib/logistics-sync.ts` (10 funciones, incluidas `upsertMaterialRequirement`, `createCampaignLogisticsRequest`, `cancelSourceLogistics`), `lib/isdin-calls.ts` (7), `lib/logistics-actions.ts` (6 de las 7 funciones del fichero: `updateEntry`, `closeEntryLogically`, `updatePicking`, `cancelPicking`, `updateShipping`, `cancelShipping` — el fichero entero es prácticamente API sin cliente), `lib/payments/*` (7).
- **`lib/logistics-store.ts:118 insertNewMovements`** — sin llamantes, confirmado también desde el lado de LOGS (`merchanlogs/supabase/migraciones-aplicadas/01_endurecer_escritura_logistics.sql:20`, que lo verificó antes de endurecer políticas).
- **`saveLogisticsState`** (`lib/logistics-store.ts:379`) es una función que solo existe para lanzar una excepción. Es deliberado y está documentado (evita una regresión silenciosa). Bien hecho, pero es peso muerto.

**Duplicación y estilo:**

- **Estilo de código comprimido en las pantallas grandes.** `app/page.tsx`: 175 líneas físicas, 72,5 KB, línea más larga **5.995 caracteres**, 34 líneas de más de 500. `app/grandes-campanas/isdin/page.tsx`: línea más larga **12.190 caracteres**. `app/grandes-campanas/isdin/facturacion/page.tsx`: 7.285. `app/grandes-campanas/isdin/dashboard/page.tsx`: 5.445. **Esto no es un detalle estético: hace imposible el `git blame` útil, convierte cualquier conflicto de fusión en una reescritura, y es la razón por la que cambiar algo del Panel es caro.** Es la deuda más cara de MerchanOPS y no aparece en ninguna métrica de calidad porque los tests pasan y el linter está contento.
- 8 ficheros CSS separados por módulo (`panel-visual.css`, `campaigns-visual.css`, `payments-visual.css`, `people-visual.css`, `services-visual.css`, `forms-visual.css`, `calendar-visual.css`, `responsive-visual.css`, `grandes-campanas-visual.css`, `isdin-*.css`) conviviendo con Tailwind y con `components/ui/merchan-*` (el sistema visual de `/ui-preview`, que **casi nadie usa**: `merchan-card`, `merchan-form`, `merchan-layout` y `merchan-status` solo los importa `/ui-preview`). Hay al menos tres sistemas visuales conviviendo.

**Dependencias sin usar:** ninguna. Las 6 dependencias de producción se usan todas.

### 1.7 Tests y CI

| Concepto | Estado |
|---|---|
| Tests | **17 ficheros, 263 pruebas, todas verdes** (2,8 s) |
| Qué cubren | **Exclusivamente `lib/`**: motor de pagos (7 ficheros), campañas (4), RR.HH. (4), ISDIN facturación, modo degradado, códigos de logística |
| Qué NO cubren | **Cero pruebas de páginas o componentes.** Ni una sola línea de `app/` o `components/` está bajo test. Tampoco hay pruebas de extremo a extremo, ni de las políticas RLS. |
| `tsc --noEmit` | ✅ Pasa (ejecutado a mano; **no hay script `typecheck`** y nada lo ejecuta automáticamente) |
| `next lint` | ✅ 2 avisos (`react-hooks/exhaustive-deps` en `app/page.tsx:139` y `facturacion/page.tsx:44`) |
| **CI** | ❌ **NO EXISTE.** No hay directorio `.github/`. Nada verifica nada antes de fusionar. |
| Lockfile | ❌ `package-lock.json` está en `.gitignore`. **Los builds no son reproducibles.** |

**`npm audit --omit=dev`: 5 vulnerabilidades (1 crítica, 2 altas, 2 bajas).**
- `next@14.2.23`: ~21 avisos acumulados (SSRF en *rewrites*, envenenamiento de caché, XSS con nonces CSP, DoS…). Corregir exige subir a Next 16 — cambio mayor.
- `xlsx@0.18.5`: **Prototype Pollution** (GHSA-4r6h-8v6p-xvw6) y **ReDoS** (GHSA-5pgg-2g8v-p4x9), **"No fix available"** en npm. SheetJS abandonó npm; la versión corregida solo se distribuye desde su propio CDN. Y `xlsx` se usa justo donde más duele: **el importador de puntos de campaña, que procesa ficheros Excel que envía el cliente** (`lib/csv-parser.ts`, `components/grandes-campanas/importador-csv.tsx`). **MerchanLOGS ya resolvió esto** sustituyendo `xlsx` por `fflate` + un lector propio (`merchanlogs/lib/xlsx.ts`, 251 líneas). OPS no.

---

## 2. MerchanLOGS — inventario

### 2.1 Stack y ritmo

| Concepto | Valor |
|---|---|
| Framework | Next.js **^14.2.35** (App Router) |
| Supabase JS | ^2.58.0 |
| IA | **@anthropic-ai/sdk ^0.115.0** — dos rutas de servidor |
| ZIP/XLSX | `fflate ^0.8.3` + lector propio (`lib/xlsx.ts`) |
| Tests | vitest ^2.1.8 |
| Scripts | `dev`, `build`, `start`, `lint`, **`typecheck`**, `test`, `test:watch` |

**Ritmo:** **57 commits, todos en julio de 2026** (repo creado el 7 de julio). Cero en mayo y junio. Es un proyecto de **25 días**. Nada en agosto.

### 2.2 Mapa de rutas

25 rutas (23 páginas + 2 rutas de API).

| Ruta | Estado | Evidencia |
|---|---|---|
| `/` (dashboard) | COMPLETA | `app/page.tsx`, 309 líneas. **Sin comprobación de permiso** (0 referencias a `can()`), aunque la RLS lo cubre en modo Supabase. |
| `/materiales` | COMPLETA | 831 líneas; catálogo por familias con paginación (se rehizo el 30 jul por crecimiento sin freno). |
| `/piezas` | COMPLETA | 327 líneas; trazabilidad unitaria de piezas VIN + confirmación por foto del palet. |
| `/entradas` | COMPLETA | 352 líneas; alta manual **y** desde foto de albarán. |
| `/llegadas` | COMPLETA | 435 líneas; sube el Excel del cliente sin reformatear. |
| `/movimientos` | COMPLETA | 190 líneas; bitácora inmutable. |
| `/peticiones` | COMPLETA | 496 líneas; bandeja del almacén, "Aceptar y generar picking" en 1 clic. |
| `/picking` | COMPLETA | 357 líneas; maestro-detalle. |
| `/picking/[id]` | COMPLETA | 255 líneas. |
| `/picking/[id]/print` | COMPLETA | 118 líneas. **Sin comprobación de permiso** — protegida solo por RLS. |
| `/picking/movil` | COMPLETA | 326 líneas; checklist táctil para almacén. |
| `/envios` | COMPLETA | 274 líneas. |
| `/incidencias` | COMPLETA | 327 líneas; sincronizadas con OPS. |
| `/campanas` | COMPLETA | 391 líneas. |
| `/servicios` | COMPLETA | 410 líneas; lectura de OPS. |
| `/clientes` | COMPLETA (solo lectura, por diseño) | 220 líneas — *"El maestro es de MerchanOPS: aquí se lee, no se escribe"*. Se retiraron los botones que el backend rechazaba. |
| `/instaladores` | COMPLETA | 268 líneas; *readiness* calculado. |
| `/reproducciones` | COMPLETA | 173 líneas; derivada de incidencias reales. |
| `/insights` | COMPLETA | 176 líneas; todo calculado sobre datos reales, sin nada inventado. |
| **`/importaciones`** | **PARCIAL** | 277 líneas. La colección `importBatches` está en `LOCAL_ONLY` (`services/supabase-adapter.ts:1769`): **en modo Supabase el historial de importaciones se guarda solo en el `localStorage` del navegador**. Cambias de máquina y desaparece. |
| **`/configuracion`** | **PARCIAL** | 184 líneas. Las reglas de alerta se guardan en `localStorage` y **no las ejecuta nadie**: `app/configuracion/page.tsx:6` — *"La ejecucion automatica de las reglas llegara con el backend de notificaciones"*. Es un panel de interruptores que no encienden nada. |
| **`/proveedores`** | **STUB funcional** | 142 líneas. Agrega por el campo de texto `proveedor` de las entradas. `app/proveedores/page.tsx:138`: *"**Próximamente**: maestro de proveedores con SLA, homologación y asignación de materiales (requiere tabla propia en el backend compartido)"*. No hay tabla de proveedores en Merchan Core. |
| `/estado` | COMPLETA (diagnóstico) | 140 líneas. **Sin comprobación de sesión.** Expone la URL del proyecto Supabase, si la clave anónima está definida (enmascarada: `:101`) y **los mensajes de error exactos de 7 consultas** contra tablas clave. La clave anónima es pública por diseño, pero los mensajes de error de PostgreSQL sí dan información estructural a quien no ha iniciado sesión. |
| `/api/albaranes/extraer` | COMPLETA | 257 líneas. Ver §2.5. |
| `/api/piezas/verificar` | COMPLETA | 348 líneas. Ver §2.5. |

### 2.3 Módulos de lógica

Arquitectura limpia de tres capas: `app/` (pantallas) → `services/` (dominio, 24 ficheros) → `services/adapter.ts` (contrato) → `local-adapter` | `supabase-adapter`. Los tipos viven en `types/` (640 líneas de entidades). Es **notablemente mejor estructurado que OPS**.

Piezas clave: `services/supabase-adapter.ts` (1.865 líneas, el mayor), `services/picking.service.ts` (742), `services/imports.service.ts` (485), `services/material-catalog.service.ts` (419), `services/albaran-intake.service.ts` (384), `services/arrivals.service.ts` (380).

**Superficie de escritura acotada explícitamente** (`services/supabase-adapter.ts:1747-1780`): solo 11 colecciones tienen escritor. `OPS_MASTERS` (`clients`, `campaigns`, `services`, `users`, `installers`) lanza excepción si se intenta escribir. Esta separación de propiedad de datos está bien hecha y es lo que hace viable compartir base.

### 2.4 Esquema de datos

LOGS toca 16 tablas y **5 vistas** (`logistics_work_queue`, `logistics_vin_stock`, `logistics_isdin_intake`, `logistics_campaign_catalog`, `logistics_material_catalog`). **Todas existen**, todas con `security_invoker = true` (no eluden la RLS de las tablas base) — verificado en el catálogo.

Sus 4 migraciones están versionadas en `supabase/migraciones-aplicadas/` con cabeceras que documentan qué se aplicó, contra qué commit de OPS se verificó, y cómo revertirlo. **Es la mejor práctica de todo el conjunto.**

### 2.5 Autenticación y las rutas que cuestan dinero

**Las dos rutas de IA están correctamente protegidas.** Verificado en el código, no solo en el comentario:
- `app/api/albaranes/extraer/route.ts:184` y `app/api/piezas/verificar/route.ts:196`: `verifySession(request.headers.get("authorization"))` → 401 si falla.
- `verifySession` (`:156` / `:168`) valida el token contra `/auth/v1/user` de Supabase **antes** de llamar a Anthropic.
- La clave `ANTHROPIC_API_KEY` **no** lleva prefijo `NEXT_PUBLIC_`: no llega al navegador.
- Límite de imagen 6 MB, tipos permitidos restringidos, máximo 250 códigos esperados por foto.
- El diseño de la verificación de piezas es sólido: **no es OCR abierto**. Se manda la lista cerrada de códigos esperados y se filtra la respuesta contra esa lista en el servidor (`:23-27`), así que un código inventado no puede colarse. Y nunca marca nada como faltante.

**Lo que falta en esas rutas:**
- **No hay comprobación de rol ni de permiso**, solo de sesión válida. Cualquier usuario de `app_users` con sesión —incluido el perfil `rrhh`, que no tiene nada que ver con el almacén— puede gastar llamadas de pago.
- **No hay limitación de frecuencia.** Un usuario legítimo (o su navegador en bucle) puede lanzar peticiones sin tope. El `.env.example` recomienda poner un límite de gasto en la consola de Anthropic, lo cual es una mitigación externa, no un control.
- Modelo usado: `claude-opus-5` en ambas (`:208` y `:249`). Es el modelo más caro de la familia para una tarea de lectura de etiquetas. **[No es un defecto: puede ser una decisión de precisión deliberada. Pero es un coste por foto que conviene tener medido.]**

**Roles:** `ROLE_FROM_DB` (`services/supabase-adapter.ts:572`) mapea `admin|administracion|almacen|manager|gestor`. **`rrhh` no está**, y eso está bien resuelto: un rol desconocido cae en `gestor` para poder listarlo, pero `modulePermissions` queda en `{}` (`:614`) y `can()` (`lib/permissions.ts:137`) exige que el módulo esté concedido, así que **no puede hacer nada**. Falla cerrado, a propósito, y el comentario lo explica. Bien.

### 2.6 Deuda técnica

**TODO/FIXME/HACK:** cero (mismos falsos positivos con "TODO" en castellano).

**Código muerto:** el mismo barrido que en OPS **no encuentra nada** en `lib/`, `services/`, `data/`, `types/` ni `components/`. Limpio.

**Dependencias sin usar:** ninguna.

**Fase 2 declarada (ubicaciones, clasificación, recogidas) — verificación:**
- **Ubicaciones en almacén: NO EMPEZADO.** Existe un campo `location` de **texto libre** en el material (`app/materiales/page.tsx:463`, `types/entities.ts:200`) que se muestra en picking (`app/picking/page.tsx:302`), en el móvil (`app/picking/movil/page.tsx:177`) y en la hoja impresa (`print/page.tsx:105`). Pero **no hay tabla de ubicaciones, ni zonas, ni pasillos, ni baldas, ni validación, ni asignación**. Es una cadena de texto que alguien escribe a mano. Los movimientos tienen `fromLocation`/`toLocation` (`services/stock.service.ts:37-38`) pero solo se rellenan con los literales `"almacen"` (`entries.service.ts:79`, `picking.service.ts:630`).
- **Sistema de clasificación: NO EMPEZADO.** Cero coincidencias de `clasificaci*` en todo el repositorio.
- **Peticiones de recogida: NO EMPEZADO.** Cero coincidencias. La palabra "recogida" solo aparece como participio en el picking móvil ("línea recogida").

### 2.7 Tests y CI

| Concepto | Estado |
|---|---|
| Tests | **18 ficheros, 187 pruebas, todas verdes** (3,2 s) |
| Qué cubren | `services/` y `lib/`: picking, stock, llegadas y su *parser*, importaciones ISDIN, catálogo de materiales, verificación de piezas, adaptador Supabase, espejo a OPS, **concordancia con OPS**, permisos, acceso a peticiones, cierre y envío atómicos |
| Qué NO cubren | Páginas y componentes (igual que OPS). Tampoco las dos rutas de API de IA. Ni pruebas de extremo a extremo. |
| `typecheck` | ✅ Pasa, **y existe como script** |
| `lint` | ✅ **0 avisos** |
| **CI** | ✅ **`.github/workflows/ci.yml`** — lint → typecheck → test → build, en `push` a `main` y en todos los PR, con cancelación de ejecuciones obsoletas y caché de npm. Bien pensado. |
| Lockfile | ❌ También ignorado. El propio CI lo documenta y usa `npm install` en vez de `npm ci`. |

`npm audit --omit=dev`: **2 vulnerabilidades altas** (next 14.2.35 y postcss transitivo). **Sin `xlsx`.** Está claramente mejor que OPS.

---

## 3. MerchanGO — inventario

No hay nada que inventariar. Confirmado desde el código: cero rutas, cero tablas, cero migraciones, cero menciones. Las cuatro capacidades previstas (parte de trabajo desde móvil, fotos del punto de venta, verificación de imágenes con IA, incidencias) **no existen en ninguna de las dos plataformas**, con **una excepción importante y muy favorable**:

> **La verificación de imágenes con IA ya está construida y funcionando en MerchanLOGS.** `app/api/piezas/verificar/route.ts` (348 líneas) y `app/api/albaranes/extraer/route.ts` (257 líneas) resuelven exactamente el problema difícil de MerchanGO: subir una foto desde el móvil, extraer estructura fiable, no inventar datos, y dejar la confirmación en manos de una persona. El patrón de vocabulario cerrado (`:23-27`) es directamente reutilizable para "verificar que la foto del punto de venta corresponde al vinilo instalado". **Esto quita del camino crítico de MerchanGO lo que parecía su mayor riesgo técnico.**

---

## 4. Contraste con el plan (PASO 3)

### 4.1 MerchanOPS

| Lo que dices | Veredicto | Confianza | Evidencia |
|---|---|---|---|
| **Capa de seguridad — cerrada** | **CASI. Ámbar.** | **Alta** | RLS activa en las 59 tablas, login verificado en servidor con PBKDF2, hash nunca expuesto al navegador, limitación de intentos, roles con espejo en la base. Es un trabajo serio. **Pero quedan 4 cabos sueltos verificados en vivo**: (a) `logistics_request_lines` con `UPDATE … WITH CHECK (true)`; (b) 3 funciones `SECURITY DEFINER` ejecutables sin sesión; (c) protección de contraseñas filtradas desactivada; (d) `xlsx@0.18.5` con *prototype pollution* sin parche, en el importador de ficheros del cliente. |
| **Grandes campañas — cerrada** | **CASI. Ámbar.** | **Alta** | El módulo está construido y en uso. **Pero** las pestañas *Documentos* e *Historial de cambios* del detalle son STUB explícito (`[id]/page.tsx:854`). |
| **Validación de pagos — cerrada** | **NO. Ámbar oscuro.** | **Alta** | El motor está bien hecho y bien probado (11 ficheros, ~120 de las 263 pruebas), la pantalla de aprobación existe y controla concurrencia. **Pero en producción hay 0 obligaciones en estado `cerrado`** y `economic_events` está a 0. Un circuito de pagos con el último paso sin ejercitar **no está validado**, está construido. Son cosas distintas. |
| **UX y calendario — cerrada** | **NO. Rojo en calendario.** | **Alta** | La UX general sí ha mejorado (sidebar única, migas de pan, `app-shell.tsx`). **El calendario no.** `CalendarByWorker` es **una línea de código** (`app/page.tsx:120`): un selector de mes y tarjetas agrupadas por trabajador. Sin rejilla, sin semana, sin solapes, sin capacidad, sin arrastrar. Y sobreviven **tres sistemas visuales** en paralelo (Tailwind + 10 CSS por módulo + `components/ui/merchan-*` que solo usa `/ui-preview`). |
| **Facturación — pendiente** | **NO: está hecha.** | **Alta** | `/grandes-campanas/isdin/facturacion` es funcional y completa: tarifas, líneas por estado, regularizaciones con anulación motivada y auditada por *triggers* (v8_5), exportación a CSV, bloqueo a administración. La lógica está extraída a `lib/isdin-billing.ts` (147 líneas) y compartida con el Historial económico. **Lo que falta no es la facturación de ISDIN: es la facturación de las demás campañas.** |
| **RR.HH. — sin empezar** | **NO: está construido y en uso HOY.** | **Muy alta** | 3 pantallas (**3.383 líneas** entre los tres clientes), 4 módulos de lógica (~1.900 líneas), **6 migraciones** (v10_4 a v10_9), un rol dedicado con su matriz, **9 funciones RPC** de RR.HH. en producción, bitácora inmutable por *triggers*, 4 ficheros de pruebas. Y sobre todo: **la base tiene actividad de RR.HH. de hoy mismo, 3 de agosto a las 06:29–06:31** (2 solicitudes de alta, 2 resoluciones, 1 solicitud de acceso; `outbox_events`). Cubre exactamente lo que describes: código A3, CECO, campaña, FI/FF, horas, y accesos por cadena y centro. **Falta una sola pieza, y es la que importa: la salida hacia A3.** Ver §5.2. |
| **Promotores — sin empezar** | **CORRECTO.** | **Muy alta** | **Cero coincidencias** de `promotor` en código, SQL, migraciones y documentación de ambos repositorios. |

### 4.2 MerchanLOGS

| Lo que dices | Veredicto | Confianza | Evidencia |
|---|---|---|---|
| **Inventario / stock — MVP** | **CORRECTO, y por encima de MVP.** | Alta | `/materiales` (831 líneas, catálogo por familias paginado), `/piezas` (trazabilidad unitaria), `stock.service.ts` (230), reserva/liberación por RPC con control de versión. |
| **Peticiones internas — MVP** | **CORRECTO en código. Ámbar en uso.** | **Alta** | `/peticiones` (496 líneas) con "Aceptar y generar picking" en 1 clic, y `lib/request-access.ts` con reglas de propiedad bien pensadas. **Pero `logistics_requests` tiene 0 filas en producción.** Ver §6. |
| **Movimientos — MVP** | **CORRECTO.** | Alta | `/movimientos` (190 líneas), bitácora inmutable protegida por *trigger* (`prevent_logistics_movement_mutation`). 13 filas en producción, la última del 12 de julio. |
| **Peticiones de envío — MVP** | **CORRECTO en código. Rojo en uso.** | Alta | `/envios` (274 líneas), `shipments.service.ts` (158), RPC `logistics_ship_picking`. **1 sola fila en `logistics_shipments`.** |
| **Incidencias sincronizadas con OPS — MVP** | **CORRECTO en código. Rojo en uso.** | Alta | `/incidencias` (327 líneas), `incidents.service.ts`, `ops-mirror.ts` (215) con pruebas de concordancia. **`logistics_incidents` tiene 0 filas.** El único evento de incidencia del outbox es del **12 de julio**. |
| **Picking — MVP** | **CORRECTO, y es lo más maduro.** | **Muy alta** | `/picking`, `/picking/[id]`, `/picking/[id]/print`, `/picking/movil`; `picking.service.ts` (742 líneas). En producción: **5 pickings, 110 líneas de picking**. Es la única parte de LOGS con volumen real. |
| **Fase 2: ubicaciones en almacén** | **SIN EMPEZAR** (confirmado) | **Muy alta** | Solo un campo `location` de texto libre. Sin tabla, sin zonas, sin validación. |
| **Fase 2: sistema de clasificación** | **SIN EMPEZAR** (confirmado) | **Muy alta** | Cero coincidencias. |
| **Fase 2: peticiones de recogida** | **SIN EMPEZAR** (confirmado) | **Muy alta** | Cero coincidencias. |

**Lo que NO estaba en tu lista y sí existe en LOGS** (7 pantallas completas no mencionadas): `/llegadas` (435 líneas, sube el Excel del cliente sin reformatear), `/entradas` con lectura de albarán por foto e IA, `/campanas`, `/servicios`, `/instaladores` con *readiness* calculado, `/reproducciones`, `/insights`. **MerchanLOGS ha avanzado bastante más allá del MVP que crees tener.**

### 4.3 MerchanGO

**CORRECTO: sin empezar.** Con el matiz de §3: la verificación de imágenes con IA ya está resuelta en LOGS y es reutilizable.

---

## 5. Semáforo por módulo (PASO 4a)

### MerchanOPS

| Módulo | Semáforo | Evidencia en una línea |
|---|---|---|
| Autenticación y sesión | 🟢 | Login verificado en servidor (PBKDF2 + JWT), hash nunca sale de la base — `lib/access-control.ts:236-283`, `APP_USER_COLUMNS:29`. |
| RLS y aislamiento por provincia | 🟢 | 59/59 tablas con RLS; las 3 sin política son internas de RPC — verificado en `pg_policies`. |
| Endurecimiento de seguridad restante | 🟡 | `logistics_request_lines` con `WITH CHECK (true)`; 3 funciones `SECURITY DEFINER` abiertas a `anon`; HIBP desactivado — *advisors* de Supabase. |
| Servicios y puntos | 🟢 | 262 servicios y 482 puntos vivos, último del 30 jul. |
| ISDIN (vinilos, llamadas, KPIs) | 🟢 | 475 vinilos, 474 llamadas, **actividad del 3 de agosto**. |
| ISDIN · Facturación | 🟢 | Completa, con regularizaciones anulables y auditadas — `isdin-billing.ts`, v8_5. |
| Grandes campañas | 🟡 | Funciona; pestañas Documentos e Historial son STUB — `[id]/page.tsx:854`. |
| Motor de pagos (cálculo) | 🟢 | 11 módulos, ~120 pruebas verdes, 502 obligaciones calculadas. |
| Aprobación de pagos (circuito) | 🟡 | **0 obligaciones en `cerrado`**; el último paso nunca se ha ejecutado. |
| Historial económico | 🔴 | **`economic_events` = 0 filas.** El registro contable no existe en producción. |
| Pagos de gran campaña en el Panel | 🔴 | `app/page.tsx:123` lee `big_campaign_points` (**0 filas**); los datos vivos están en `puntos_venta_campana`. |
| Calendario | 🔴 | Una línea de código: lista agrupada por trabajador, sin rejilla ni solapes — `app/page.tsx:120`. |
| Logística (consulta) | 🟡 | Solo lectura por diseño; los botones de acción abren LOGS en vez de actuar — `logistics-client.tsx:85`. |
| RR.HH. — altas y accesos | 🟢 | 3.383 líneas de UI, 6 migraciones, 9 RPC, actividad del 3 de agosto. |
| RR.HH. → A3 | 🔴 | **El adaptador no existe**; los eventos se marcan "ajeno a db-notifier" y mueren — v10_8:51, `inbox_processed`. |
| Promotores | ⚫ Sin empezar | Cero coincidencias. |
| Facturación no-ISDIN | ⚫ Sin empezar | No hay ninguna ruta ni módulo. |
| Tests | 🟡 | 263 verdes, pero **cero cobertura de `app/` y `components/`**. |
| CI | 🔴 | **No existe `.github/`.** Nada valida nada. |
| Trazabilidad de migraciones | 🔴 | **7 migraciones en producción sin fichero en ningún repo.** |
| Dependencias | 🔴 | 1 crítica + 2 altas; `xlsx@0.18.5` **sin parche disponible**, en el importador de ficheros del cliente. |
| Mantenibilidad del código de pantallas | 🔴 | Líneas de hasta **12.190 caracteres**; `app/page.tsx` con 72,5 KB en 175 líneas. |

### MerchanLOGS

| Módulo | Semáforo | Evidencia en una línea |
|---|---|---|
| Arquitectura (capas + adaptador) | 🟢 | `app/` → `services/` → `adapter` → local\|supabase; propiedad de datos explícita — `supabase-adapter.ts:1769-1780`. |
| Inventario y stock | 🟢 | `/materiales` 831 líneas paginadas, `/piezas` con trazabilidad unitaria; 17 materiales, 16 filas de stock. |
| Picking | 🟢 | 4 pantallas + `picking.service.ts` (742); **5 pickings y 110 líneas reales**. |
| Peticiones internas | 🟡 | Código completo con reglas de propiedad; **`logistics_requests` = 0 filas**. |
| Movimientos | 🟢 | Bitácora inmutable por *trigger*; 13 filas. |
| Envíos | 🟡 | Código completo; **1 fila** en producción. |
| Incidencias sincronizadas con OPS | 🟡 | Código y pruebas de concordancia; **0 filas**; último evento del 12 jul. |
| Llegadas previstas | 🟢 | 435 líneas, sube el Excel del cliente tal cual; 1 lote / 19 líneas reales. |
| Lectura de albarán por foto (IA) | 🟢 | Ruta protegida, clave en servidor, límites y esquema estricto. |
| Verificación de piezas por foto (IA) | 🟢 | Vocabulario cerrado, filtrado en servidor, nunca marca faltantes. |
| Coste/abuso de las rutas de IA | 🟡 | Sesión sí, **rol y limitación de frecuencia no**; modelo `claude-opus-5` por foto. |
| Importaciones | 🟡 | `importBatches` es `LOCAL_ONLY`: el historial vive solo en el navegador. |
| Configuración (reglas de alerta) | 🟡 | Interruptores en `localStorage` que **nadie ejecuta** — `configuracion/page.tsx:6`. |
| Proveedores | 🔴 | STUB declarado; no hay tabla de proveedores en Merchan Core — `proveedores/page.tsx:138`. |
| Página `/estado` | 🟡 | Sin sesión: expone URL del proyecto y errores exactos de 7 consultas. |
| Ubicaciones en almacén (fase 2) | ⚫ Sin empezar | Solo texto libre. |
| Clasificación (fase 2) | ⚫ Sin empezar | Cero coincidencias. |
| Peticiones de recogida (fase 2) | ⚫ Sin empezar | Cero coincidencias. |
| Tests | 🟡 | 187 verdes incl. concordancia con OPS; sin cobertura de páginas ni de las rutas de IA. |
| CI | 🟢 | lint + tipos + tests + build en cada PR — `.github/workflows/ci.yml`. |
| Dependencias | 🟡 | 2 altas (next/postcss); **sin `xlsx`** — ya migrado a `fflate`. |
| Trazabilidad de migraciones | 🟢 | 4 ficheros con verificación previa contra OPS y plan de reversión. |

### MerchanGO

| Módulo | Semáforo |
|---|---|
| Todo | ⚫ **Sin empezar** (repositorio inexistente) |

---

## 6. Bloqueantes reales, por impacto (PASO 4b)

### B-1 · 🔴 El circuito de peticiones OPS→LOGS no está pasando por la base

**El hallazgo más incómodo del informe, y el que menos esperaba encontrar.**

Los hechos, todos verificados:
- `outbox_events` contiene **10 eventos `logistics_request.created` emitidos por `merchanops`**, el último del **30 de julio a las 12:00**, todos con resultado `{"notification": "request_received"}`.
- `logistics_requests` tiene **0 filas**. `logistics_request_lines`: **0 filas**.
- `logistics_request_code_counters` (creada el 30 de julio por v10_3, precisamente para que borrar peticiones no reutilice códigos): **0 filas**.
- En cambio `logistics_material_requirements` tiene **133 filas** con datos del 30 de julio, y `logistics_picking_lines` **110**.

Solo hay dos explicaciones posibles, y **desde el código no se puede decidir cuál es** — necesitas mirar tú:

- **(a)** Las peticiones se crearon y **se borraron después** (limpieza manual, prueba de la migración v10_3, o purga). El contador a 0 apoya esto: se creó el 30 de julio y nada lo ha incrementado desde entonces.
- **(b)** Las peticiones **nunca llegan a persistirse**, y todo el flujo real está pasando por `logistics_material_requirements` + picking directo, saltándose la capa de peticiones.

**Por qué es bloqueante en cualquiera de los dos casos:** *"peticiones internas"* es una de las cinco capas que das por cerradas en el MVP piloto de LOGS. Si es (a), el piloto no ha vuelto a usar el flujo desde el 30 de julio y no hay evidencia de que funcione tras v10_3. Si es (b), la capa entera es teórica. Y la RPC `merchan_next_request_code` **nunca se ha ejecutado en producción**, así que el formato trazable de códigos que se construyó el 30 de julio **está sin probar contra datos reales**.

**Cómo salir de dudas en 5 minutos:** crea una petición desde OPS (`/logistica/solicitudes`) y comprueba si aparece fila en `logistics_requests` y si el contador sube. Es la primera cosa que haría.

---

### B-2 · 🔴 RR.HH. no tiene salida: las altas no llegan a A3

Verificado punto por punto:
- Los eventos se publican correctamente: `rrhh_alta.solicitada`, `rrhh_alta.resuelta`, `rrhh_acceso.solicitado`, los últimos **de hoy a las 06:29–06:31**.
- El único consumidor registrado es `db-notifier` (`outbox_consumers`, 1 fila), un `pg_cron` cada minuto (`cron.job` id 1, activo).
- `inbox_processed` muestra que **cada evento de RR.HH. se cierra con `{"reason": "tipo ajeno a db-notifier", "skipped": true}`**.
- La migración lo documenta sin rodeos: `supabase/v10_8_rrhh_outbox_a3.sql:51` — ***"El adaptador de A3 NO EXISTE"***.

La decisión de no registrar `a3-adapter` hasta que exista es **correcta y bien razonada** (registrarlo dejaría toda la cola atascada, incluida la de logística que sí funciona). Pero el efecto neto es este: **el módulo de RR.HH. funciona perfectamente hasta el borde del sistema y ahí se para**. Alguien sigue tecleando las altas en A3 a mano. El módulo ahorra el Excel, no el tecleo final.

Es el bloqueante de mayor valor de negocio del informe: el trabajo caro (modelo, pantallas, roles, trazabilidad) **ya está pagado**, y falta la pieza barata que lo convierte en ahorro real.

---

### B-3 · 🔴 El Historial económico no ha registrado nunca nada

`economic_events` = **0 filas**. `economic_month_closures` = **0 filas**. El código está completo, es idempotente, tiene reversos inmutables y la RLS lo permite (`eco_scope`, `ALL` para quien tenga permiso `pagos`). La sincronización es automática al abrir la pantalla para gestores (`historial-economico/page.tsx:77`).

Que esté a 0 significa una de dos cosas —**y no se puede saber cuál desde el código**—: nadie ha abierto nunca esa pantalla en producción, o la sincronización falla en silencio para todos. Lo segundo es improbable (el código muestra el error en rojo, `:143`), pero no descartable.

**Sin `economic_events` no hay registro contable, no se puede cerrar un mes, y "validación de pagos" no puede darse por cerrada.**

---

### B-4 · 🔴 La base de producción no se puede reconstruir desde los repositorios

**7 migraciones aplicadas cuyo código fuente solo existe dentro de la base**: `v8_4b_drop_old_sync_overload`, `v9_1b_bootstrap_returns_error`, `v9_1c_pbkdf2_fast`, `v8_6b_outbox_search_path`, `v8_7b_isdin_vin_upsert`, `v9_11b_campanas_visibles_para_almacen`, `v9_11c_campanas_solo_escape_almacen`.

No son cosméticas: tocan el *bootstrap* de autenticación, el rendimiento del PBKDF2, el `search_path` del outbox y dos políticas RLS de visibilidad de campañas. Si mañana necesitas un entorno de pruebas, o pierdes el proyecto, **el sistema no se levanta desde git**. Y como no hay entorno de pruebas, cada migración se aplica directamente a producción.

---

### B-5 · 🟠 MerchanOPS no tiene ninguna verificación automática

No existe `.github/`. Ni linter, ni tipos, ni tests, ni build antes de fusionar. La calidad depende enteramente de que te acuerdes de ejecutarlo a mano. Y no hay script `typecheck`, así que ni siquiera está a un comando de distancia.

**El agravante:** MerchanOPS es la plataforma **en uso real** (262 servicios, 502 obligaciones, 475 vinilos), y es la que **no** tiene red de seguridad. MerchanLOGS, que está en piloto, sí la tiene. Está exactamente al revés de lo que convendría.

---

### B-6 · 🟠 `xlsx@0.18.5` sin parche, en la puerta de entrada de ficheros del cliente

*Prototype Pollution* (GHSA-4r6h-8v6p-xvw6) y ReDoS (GHSA-5pgg-2g8v-p4x9), **"No fix available"** en npm porque SheetJS dejó el registro. Se usa en `lib/csv-parser.ts` y `components/grandes-campanas/importador-csv.tsx`, es decir, **procesando los Excel que manda el cliente**. Es exactamente el vector para el que se escribió el aviso.

**Ya tienes la solución escrita**: `merchanlogs/lib/xlsx.ts` (251 líneas sobre `fflate`) hace el trabajo sin la dependencia. Es portar, no inventar.

---

### B-7 · 🟠 El calendario no es un calendario

`app/page.tsx:120`. Una línea. Sin rejilla, sin semana, sin solapes, sin capacidad por trabajador (aunque `Worker.capacity` y `active_hours` existen en el modelo y no se usan para nada aquí). Darlo por cerrado bloquea cualquier conversación sobre planificación de carga.

---

### B-8 · 🟡 Los pagos de gran campaña no aparecen en el Panel

`app/page.tsx:123` lee `big_campaign_points`/`big_campaigns` (0 filas) en vez de `puntos_venta_campana`/`grandes_campanas` (15 y 1). El propio código admite que esas tablas están vacías (`lib/payments/campana-obligations.ts:12`). **La pestaña no da error: muestra menos y calla.** Ese es el tipo de fallo que tarda meses en detectarse.

(El Historial económico **sí** lee las tablas vivas, `historial-economico/page.tsx:118` — allí las tablas legadas se consultan de más, pero no falta información.)

---

### B-9 · 🟡 Tres cabos de seguridad concretos

1. `logistics_request_lines`, política `logistica_update`: `WITH CHECK (true)`. La cláusula `USING` restringe qué filas se pueden tocar, pero no a qué valores se pueden reescribir.
2. `merchan_can_logistics_write()`, `merchan_owns_request()` y `merchan_stamp_campaign_picking()` son `SECURITY DEFINER` **ejecutables por `anon`**, sin sesión. La cuarta, `merchan_auth_bootstrap`, sí debe serlo.
3. Protección contra contraseñas filtradas (HaveIBeenPwned) **desactivada** en Supabase Auth. Es un interruptor en la consola.

---

### B-10 · 🟡 Las pantallas de OPS son muy caras de tocar

Líneas de hasta **12.190 caracteres**; `app/page.tsx` con 72,5 KB en 175 líneas físicas. No rompe nada hoy, pero **es el multiplicador de coste de todo lo demás**: cualquier estimación sobre el Panel, ISDIN o la facturación hay que inflarla por esto. Y hace que las herramientas normales (`git blame`, revisión de diferencias, fusión) dejen de servir.

---

### B-11 · 🟡 Builds no reproducibles en ambos repos

`package-lock.json` está en `.gitignore` en los dos. Un `npm install` hoy y otro dentro de tres meses instalan árboles distintos. En LOGS el CI lo documenta y lo asume; en OPS ni siquiera hay CI que lo note.

---

## 7. Estimaciones (PASO 4c)

**Base de cálculo:** una persona (tú), media jornada sobre esto. **1 día = ~4 horas efectivas.** Las cifras incluyen el sobrecoste de tocar el código comprimido de OPS donde aplica (B-10). Están pensadas para ser **conservadoras**: prefiero pasarme a que te falte.

**No son un calendario.** Es esfuerzo, no fechas.

### 7.1 Cerrar lo que ya está casi hecho

| Trabajo | Desarrollo | Pruebas | Despliegue | Total |
|---|---:|---:|---:|---:|
| **Adaptador A3 para RR.HH.** (B-2) — registrar `a3-adapter`, escribir el consumidor, mapear alta→A3, reintentos y cola de fallidos. **Depende de si A3 tiene API.** | 6–10 d | 3 d | 1 d | **10–14 d** |
| ↳ *Variante sin API de A3*: exportación a CSV/Excel con el formato exacto de importación de A3 | 2 d | 1 d | 0,5 d | **3,5 d** |
| **Diagnosticar y cerrar el circuito de peticiones** (B-1) — reproducir, decidir entre (a) y (b), corregir, probar el contador de códigos con datos reales | 1 d (diag.) + 2–5 d | 2 d | 0,5 d | **5,5–8,5 d** |
| **Poner en marcha el Historial económico** (B-3) — reproducir con datos reales, verificar la sincronización, cerrar un mes de prueba, corregir lo que salga | 2 d | 2 d | 0,5 d | **4,5 d** |
| **Cerrar el circuito de aprobación de pagos** — llevar obligaciones reales a `cerrado`, verificar conciliación y auditoría | 1 d | 2 d | 0,5 d | **3,5 d** |
| **Corregir los pagos de gran campaña del Panel** (B-8) — repuntar a `puntos_venta_campana` | 1,5 d | 1 d | 0,5 d | **3 d** |
| **Pestañas Documentos e Historial de campaña** (`[id]/page.tsx:854`) — requiere decidir modelo de documentos y almacenamiento | 4 d | 1,5 d | 0,5 d | **6 d** |
| | | | | **~33–40 d** |

### 7.2 Higiene técnica (no es opcional: reduce el coste de todo lo demás)

| Trabajo | Desarrollo | Pruebas | Despliegue | Total |
|---|---:|---:|---:|---:|
| **CI en MerchanOPS** (B-5) — copiar `ci.yml` de LOGS, añadir script `typecheck`, arreglar lo que salte | 1 d | 0,5 d | 0,5 d | **2 d** |
| **Recuperar las 7 migraciones huérfanas** (B-4) — extraer con `pg_get_functiondef`/`pg_policies`, versionarlas, verificar que reproducen | 2 d | 1 d | 0,5 d | **3,5 d** |
| **Sustituir `xlsx` en OPS** (B-6) — portar `merchanlogs/lib/xlsx.ts`, adaptar `csv-parser` e importador | 2 d | 1,5 d | 0,5 d | **4 d** |
| **Los 3 cabos de seguridad** (B-9) — `WITH CHECK`, revocar `EXECUTE` a `anon`, activar HIBP | 1 d | 1 d | 0,5 d | **2,5 d** |
| **Versionar lockfiles** en ambos repos (B-11) | 0,5 d | 0,5 d | 0,5 d | **1,5 d** |
| **Limitar frecuencia y rol en las rutas de IA de LOGS** | 1,5 d | 1 d | 0,5 d | **3 d** |
| **Retirar `/ui-preview` o protegerla** | 0,5 d | — | 0,5 d | **1 d** |
| **Limpiar código muerto** (`lib/outbox.ts`, `logistics-actions.ts`, 63 exportaciones) | 2 d | 1 d | 0,5 d | **3,5 d** |
| | | | | **~21 d** |

### 7.3 MerchanOPS — lo que falta de verdad

| Trabajo | Desarrollo | Pruebas | Despliegue | Total |
|---|---:|---:|---:|---:|
| **Calendario de verdad** (B-7) — rejilla mes/semana, agrupación por trabajador, detección de solapes, capacidad, arrastrar y soltar | 8–12 d | 3 d | 1 d | **12–16 d** |
| **Facturación no-ISDIN** — generalizar `isdin-billing.ts` a un modelo de tarifas por cliente/campaña. *Alcance sin definir: si incluye emisión de facturas, numeración fiscal o series, multiplica.* | 8–14 d | 4 d | 1 d | **13–19 d** ⚠️ |
| **Módulo de promotores** — **[NO ESTIMABLE]**. No hay ni una línea, ni una tabla, ni un documento de requisitos. Sin saber qué es un promotor en tu operación (¿un tipo de trabajador?, ¿un maestro aparte?, ¿con jerarquía?, ¿con su propio circuito de pagos?), cualquier número sería inventado. **Necesita medio día de definición antes de poder estimarse.** | — | — | — | **?** |
| **Refactorizar `app/page.tsx`** (B-10) — separar las 10 pestañas en ficheros, con formato normal. Alto riesgo: **sin tests de página que protejan el cambio** | 6–9 d | 4 d | 1 d | **11–14 d** ⚠️ |

### 7.4 MerchanLOGS — fase 2

| Trabajo | Desarrollo | Pruebas | Despliegue | Total |
|---|---:|---:|---:|---:|
| **Ubicaciones en almacén** — tabla en Merchan Core (zona/pasillo/balda/hueco), migración de los `location` de texto libre existentes, asignación, mapa, integración con picking y con la hoja impresa | 8–11 d | 3 d | 1,5 d | **12,5–15,5 d** |
| **Sistema de clasificación** — **[PARCIALMENTE ESTIMABLE]**. No hay nada en código y "clasificación" admite lecturas muy distintas (ABC por rotación, familias —que ya existen en el catálogo—, criticidad, taxonomía de cliente). *Suponiendo ABC por rotación sobre `logistics_stock_movements`*: | 4–6 d | 2 d | 1 d | **7–9 d** ⚠️ |
| **Peticiones de recogida** — flujo inverso al de envío: tabla, estados, pantalla, integración con incidencias y con el retorno de material | 6–8 d | 3 d | 1 d | **10–12 d** |
| **Maestro de proveedores** (cierra el STUB de `/proveedores`) — tabla en Merchan Core, SLA, homologación, vínculo con entradas | 4–5 d | 2 d | 1 d | **7–8 d** |
| **Ejecutar las reglas de alerta de `/configuracion`** — llevarlas de `localStorage` a la base y ejecutarlas (`pg_cron` + `logistics_notifications`) | 3–4 d | 2 d | 1 d | **6–7 d** |
| **Persistir el historial de importaciones** — sacar `importBatches` de `LOCAL_ONLY` | 2 d | 1 d | 0,5 d | **3,5 d** |

### 7.5 MerchanGO — desde cero

**Aviso importante:** esto es lo más incierto del informe. No hay repositorio, no hay decisiones tomadas (¿PWA o nativa?, ¿trabaja sin conexión?, ¿los instaladores tienen usuario en `app_users` o entran con un enlace?), y estas son las tres preguntas que más mueven el número. **Tómalo como orden de magnitud, no como estimación.**

| Trabajo | Desarrollo | Pruebas | Despliegue | Total |
|---|---:|---:|---:|---:|
| Cimientos (repo, CI, autenticación de instaladores, esqueleto móvil, RLS para el nuevo rol) | 6–8 d | 3 d | 2 d | **11–13 d** |
| Parte de trabajo desde móvil (lista de puntos, estados, horas, firma) | 8–10 d | 4 d | 1 d | **13–15 d** |
| Fotos del punto de venta (captura, reescalado, subida, Storage, permisos) | 5–7 d | 3 d | 1 d | **9–11 d** |
| **Verificación de imágenes con IA** — *reducido por reutilizar el patrón de `merchanlogs/app/api/piezas/verificar`* | 4–6 d | 3 d | 1 d | **8–10 d** |
| Incidencias desde móvil (integradas con las de OPS/LOGS) | 5–6 d | 2 d | 1 d | **8–9 d** |
| Funcionamiento sin conexión — **[NO ESTIMABLE sin decidir si es requisito]**. Si un instalador entra en una farmacia sin cobertura y tiene que reportar, esto no es opcional y **suma 10–15 días él solo**. | — | — | — | **?** |
| | | | | **~49–58 d** (+ sin conexión) |

### 7.6 Resumen

| Bloque | Días (media jornada) |
|---|---:|
| Cerrar lo casi hecho (§7.1) | 33–40 |
| Higiene técnica (§7.2) | ~21 |
| OPS pendiente real, sin promotores (§7.3) | 36–49 |
| LOGS fase 2 + huecos (§7.4) | 46–55 |
| MerchanGO (§7.5) | 49–58 |
| **Total con número** | **185–223 días de media jornada** |
| Módulo de promotores | **sin estimar** |
| Funcionamiento sin conexión en GO | **sin estimar** (+10–15 si se confirma) |

**Un aviso sobre este total.** 185–223 días de media jornada son ~9–11 meses de trabajo a 5 días por semana. Quedan **5 meses** hasta diciembre de 2026. **El alcance completo no cabe**, y esa es una conclusión del diagnóstico, no una opinión sobre prioridades. Lo que entra y lo que no es tu decisión y es el objeto del retroplanning; aquí solo dejo dicho que la resta no da.

---

## 8. Dependencias entre plataformas (PASO 4d)

### 8.1 Lo que LOGS no puede avanzar sin OPS / Merchan Core

| Trabajo de LOGS | Bloqueado por | Por qué |
|---|---|---|
| **Ubicaciones en almacén** (fase 2) | **Merchan Core: tabla nueva** | Hay que crear la tabla en la base de OPS. LOGS **no puede desplegarla solo**: no tiene proyecto propio y sus migraciones se aplican al proyecto `MerchanOPS`. Cada migración de LOGS es un cambio en la base de producción de OPS. |
| **Peticiones de recogida** | **Merchan Core: tabla + RPC** | Ídem. Además necesita casar con los estados de incidencia de OPS. |
| **Maestro de proveedores** | **Merchan Core: tabla** | Declarado en el propio código: `proveedores/page.tsx:138` — *"requiere tabla propia en el backend compartido"*. |
| **Reglas de alerta ejecutables** | **Merchan Core: tabla + `pg_cron`** | El único `pg_cron` que existe es `outbox-db-notifier`, propiedad de OPS. Añadir otro toca la infraestructura de OPS. |
| **Cerrar la capa de peticiones** | **OPS: B-1 resuelto** | Quien crea las peticiones es OPS (`create_logistics_request_service`/`_campaign`). Si el circuito no persiste, LOGS no tiene qué gestionar. |
| **Que las incidencias de LOGS sirvan de algo** | **OPS: consumo del retorno** | LOGS escribe bien (`ops-mirror.ts`, con pruebas de concordancia). Pero el evento `logistics.picking_shipped` que emite LOGS se marca **"tipo ajeno a db-notifier"** en `inbox_processed`: **nadie lo procesa**. |
| **Clasificación ABC** | **Datos, no código** | Necesita histórico de movimientos. Hay **13 filas**, la última del 12 de julio. Con ese volumen cualquier clasificación por rotación es ruido. Bloqueado por **uso**, no por desarrollo. |

### 8.2 Lo que MerchanGO no puede avanzar sin OPS / LOGS

| Trabajo de GO | Bloqueado por | Por qué |
|---|---|---|
| **Autenticación de instaladores** | **OPS: `app_users` + RLS** | Hoy los instaladores son filas de `workers` (26), **no usuarios**. `app_users` tiene 10 filas y 4 roles (`admin`, `manager`, `almacen`, `rrhh`). Hace falta un **rol nuevo** con su matriz y **políticas RLS en las 59 tablas** que lo contemplen. Y hay una trampa esperando: `normalizeUser` degrada roles desconocidos a `manager` **y lo persiste** (`access-control.ts:92`), y LOGS ya tiene su propio mapa de roles (`supabase-adapter.ts:572`). **Un rol nuevo hay que darlo de alta en tres sitios a la vez o se rompe algo.** Es la dependencia más peligrosa de todo el informe. |
| **Parte de trabajo desde móvil** | **OPS: modelo de puntos** | El instalador reporta sobre `points` (482) y `puntos_venta_campana` (15) — **dos modelos distintos** de "punto" según venga de Servicios o de Gran Campaña, con estados distintos. GO tendría que hablar los dos, o unificarlos primero. |
| **Fotos del punto de venta** | **Merchan Core: Storage + `attachments`** | La tabla `attachments` existe y tiene **0 filas**; no hay ningún *bucket* de Storage en uso en ninguna de las dos apps. Toda la capa de ficheros está por montar. |
| **Verificación de imágenes con IA** | **Nada. 🟢** | **Ya resuelto en LOGS.** El patrón de vocabulario cerrado es directamente reutilizable. |
| **Incidencias desde móvil** | **OPS: `create_logistics_incident_ops` + LOGS** | La RPC existe y funciona. Pero `logistics_incidents` tiene **0 filas** y el circuito de incidencias LOGS↔OPS no está ejercitado (B-1). GO entraría a un circuito no probado. |
| **Pagos al instalador desde el parte** | **OPS: B-3 y aprobación de pagos** | Sin `economic_events` y sin obligaciones que lleguen a `cerrado`, un parte validado en GO no tiene dónde aterrizar. |

### 8.3 La dependencia estructural que no aparece en ninguna lista

**No hay entorno de pruebas.** Un solo proyecto Supabase, que es producción. No hay ramas de base de datos (`list_branches` vacío). Con dos aplicaciones escribiendo y una tercera en camino, esto significa que **cada migración de cualquier plataforma se aplica en caliente sobre los datos reales de las otras dos**.

MerchanLOGS lo ha compensado con disciplina —sus 4 migraciones documentan contra qué commit de OPS se verificaron y cómo revertirlas—, y eso ha funcionado hasta ahora. **Pero es disciplina personal, no un mecanismo.** Cuando entre una tercera plataforma que necesita un rol nuevo tocando políticas de 59 tablas, la disciplina no va a bastar.

---

## 9. Riesgos técnicos (PASO 4e)

Lo que he encontrado y que, por la forma en que planteas el plan, probablemente no esperabas.

### R-1 · Estás dando por cerradas capas cuyo último paso nunca se ha ejecutado

El patrón se repite tres veces: **pagos** (466 en `calculado`, 0 en `cerrado`), **historial económico** (0 filas), **RR.HH.→A3** (eventos que mueren en el outbox). En los tres casos el código está bien escrito, probado y desplegado. **Y en los tres el circuito nunca ha llegado al final en producción.**

El riesgo no es que esté mal hecho: es que **"construido" y "validado" se han estado contando como lo mismo**, y el retroplanning lo heredaría. Los últimos pasos de un circuito son donde aparecen los problemas de datos reales, y ninguno de esos tres los ha visto todavía.

### R-2 · RR.HH. está mucho más avanzado de lo que crees, y esto cambia el plan

Lo dabas por "sin empezar". Son **3.383 líneas de interfaz, ~1.900 de lógica, 6 migraciones, 9 RPC, un rol dedicado, bitácora inmutable, 4 ficheros de pruebas** — y actividad en la base **de hoy mismo**. Está a **una pieza** (el adaptador de A3) de dar valor real.

Es el mejor hallazgo del informe: si el retroplanning reservaba semanas para "empezar RR.HH.", ese presupuesto está libre. Pero también es una señal de aviso: **has perdido el rastro de lo que has construido**, y eso pasa cuando 48 de 51 commits caen en un solo mes.

### R-3 · La plataforma en uso real es la que no tiene red de seguridad

MerchanOPS: 262 servicios, 502 obligaciones, 475 vinilos, actividad hoy. **Sin CI, sin script de tipos, sin tests de pantalla, con 1 vulnerabilidad crítica sin parche disponible.**
MerchanLOGS: en piloto. **Con CI completo, 0 avisos de linter, sin `xlsx`, migraciones documentadas.**

Está invertido. Y no es casualidad: LOGS se construyó después y con mejores prácticas desde el día uno. **Lo bueno es que el patrón a copiar ya existe en tu propia casa** — `ci.yml` es un fichero, no un proyecto.

### R-4 · Un rol nuevo hay que declararlo en tres sitios o algo se rompe en silencio

Esto es lo que más me preocupa de cara a MerchanGO. Al añadir un rol hay que tocar:
1. `merchanops/lib/access-control.ts:92` — si no, `normalizeUser` lo degrada a `manager`, **le da permisos de gestor y persiste la degradación en la base** (`saveInternalUsers`).
2. `merchanlogs/services/supabase-adapter.ts:572` — aquí sí falla cerrado, correctamente.
3. Las **políticas RLS de 59 tablas** — el propio código lo documenta como lección aprendida: `access-control.ts:73` dice que el rol `rrhh` es de ámbito nacional y *"toda policy que filtre por provincia necesita una rama explícita para este rol (lección del rol `almacen`, v9_9_ola4)"*. **Ya os ha mordido una vez.**

Un instalador que entre en MerchanGO y acabe con permisos de gestor sobre todas las provincias es un escenario alcanzable con un solo olvido.

### R-5 · Fallos que no dan error

Tres, todos verificados, y todos del mismo tipo: el sistema muestra menos de lo que hay y no avisa.
- **Pagos de gran campaña en el Panel** (B-8): lee tablas vacías, enseña 0, no dice nada.
- **Historial económico**: sincroniza de tablas correctas, pero si nadie abre la pantalla no hay registro contable y **nada lo señala**.
- **Eventos del outbox marcados "ajeno"**: se cierran como `completado`. Desde fuera, una cola sana. En realidad, eventos que nadie procesa.

Los tres son la peor clase de fallo: **los descubres cuando alguien echa de menos un número, no cuando ocurren.**

### R-6 · El código comprimido de OPS es un multiplicador de coste oculto

Líneas de 12.190 caracteres. `app/page.tsx` con 72,5 KB en 175 líneas. **Todas las herramientas normales dejan de funcionar**: `git blame` no localiza nada, una revisión de diferencias es ilegible, cualquier conflicto de fusión es una reescritura a mano.

No aparece en ninguna métrica (tipos verdes, linter contento, 263 pruebas pasando), pero **es la razón de que tocar el Panel sea caro**. Cualquier estimación sobre `app/page.tsx`, ISDIN o facturación arrastra esta penalización, y el refactor que la quitaría cuesta 11–14 días y **no tiene tests de página que lo protejan**.

### R-7 · Faltan 6 semanas de historia y 7 migraciones

La base es del 20 de mayo; el primer commit, del 30 de junio. **Ese mes y medio de decisiones no está en ninguna parte.** Y hay 7 migraciones en producción cuyo código solo existe dentro de la base (B-4), tocando autenticación, políticas RLS y el outbox.

Efecto combinado: **no puedes reconstruir el sistema desde git, y no puedes averiguar por qué algo se hizo así**. Con dos apps en marcha y una tercera prevista, es la clase de deuda que solo se nota el día en que hace falta.

### R-8 · "Merchan Core" no existe como tal

El proyecto se llama `MerchanOPS` y se creó para OPS. LOGS escribe encima. GO escribiría encima también. El esquema **sí** está bien diseñado como núcleo compartido (vistas puente con `security_invoker`, comandos RPC transaccionales, propiedad de datos explícita, registro de consumidores del outbox), pero la **infraestructura** no lo está: un solo proyecto, sin entorno de pruebas, sin ramas, con `pg_cron` propiedad de OPS y sin separación de despliegue entre plataformas.

Hoy funciona por disciplina. Con una tercera plataforma, la disciplina deja de escalar.

### R-9 · Coste variable sin control en las rutas de IA de LOGS

`claude-opus-5` por foto, en dos rutas, **con sesión pero sin rol ni limitación de frecuencia**. Cualquier usuario autenticado —incluido el perfil `rrhh`, que no pinta nada en el almacén— puede lanzarlas en bucle. La mitigación documentada es poner un límite de gasto en la consola de Anthropic (`.env.example`), que es un tope, no un control.

En piloto es irrelevante. Con el almacén usándolo a diario y GO añadiendo fotos de punto de venta, es una partida de coste que **hoy no está medida ni acotada en el código**.

### R-10 · Volumen real por debajo de lo que sugiere el nombre "piloto"

En LOGS: `logistics_requests` **0**, `logistics_incidents` **0**, `logistics_shipments` **1**, `logistics_stock_movements` **13** (el último del 12 de julio), `logistics_entry_lines` **0**. Lo único con volumen es picking (5 pickings, 110 líneas) y llegadas (1 lote, 19 líneas).

**El piloto ha ejercitado picking y poco más.** Eso significa que las cinco capas del MVP no han recibido el mismo castigo, y que **el riesgo de sorpresas al escalar no está distribuido por igual**: picking probablemente aguante, y peticiones / incidencias / envíos son en la práctica código sin rodar.

---

## 10. Cierre

Tres cosas, en orden de importancia:

1. **Tienes más construido de lo que crees, y menos validado de lo que crees.** RR.HH. está prácticamente hecho (y en uso hoy); facturación de ISDIN está hecha; LOGS ha pasado su MVP con siete pantallas que no aparecen en tu lista. En cambio, tres capas que das por cerradas —pagos, historial económico, RR.HH.→A3— nunca han completado su último paso en producción.

2. **El cuello de botella no es el código de las funcionalidades: es la infraestructura compartida.** Un solo proyecto Supabase sin entorno de pruebas, 7 migraciones irreproducibles, sin CI en la plataforma que está en producción, y un modelo de roles que hay que declarar en tres sitios a la vez. Los ~21 días de §7.2 no añaden ni una funcionalidad, pero **sin ellos las estimaciones del resto del informe no son fiables**, y MerchanGO —que necesita un rol nuevo tocando políticas de 59 tablas— es exactamente el trabajo que peor tolera esa fragilidad.

3. **El alcance completo no cabe hasta diciembre.** 185–223 días de media jornada frente a ~5 meses disponibles, y con dos partidas todavía sin estimar (promotores, funcionamiento sin conexión en GO). Priorizar es tuyo; lo que este diagnóstico deja establecido es que **la resta no da**, y que conviene decidirlo antes de escribir el calendario y no durante.

---

*Informe generado sobre `merchanops@e1e7ea7` y `merchanlogs@e8b2486`, contrastado con el proyecto Supabase `dptmswhwmqimijpfyndn` en modo solo lectura. No se ha modificado ningún fichero de código, ninguna tabla ni ninguna configuración.*
