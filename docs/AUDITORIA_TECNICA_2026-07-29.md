# Auditoría técnica independiente — MerchanOps

**Fecha:** 29 de julio de 2026
**Alcance:** repositorio completo (`31d1475`) + base de datos Supabase `MerchanOPS` (`dptmswhwmqimijpfyndn`, PG 17.6) verificada en vivo, en modo solo lectura.
**Método:** lectura de las 128 fuentes versionadas, consulta directa del catálogo de PostgreSQL (`pg_policies`, `pg_class`, `pg_proc`, `information_schema`), *advisors* de seguridad de Supabase, y ejecución de `tsc --noEmit`, `next lint`, `vitest`, `madge`, `depcheck` y `ts-prune`.
> **⚠️ Este documento tiene una adenda.** La §7 (al final) recoge qué se ha
> remediado, qué se ha descartado y **cuatro hallazgos de este informe que
> resultaron ser incorrectos o estar sobredimensionados** al ir a implementarlos.
> En caso de conflicto, manda la §7.

---

## 1. Resumen ejecutivo

MerchanOps está **mejor construido de lo que su reputación sugiere en la capa de datos y peor de lo que parece en la capa de aplicación**. La RLS está activa en las 48 tablas, el rol `anon` no tiene un solo *grant* (ni de tabla ni de columna), el hash de contraseña es ilegible por REST, las funciones de policy son `SECURITY DEFINER` con `search_path` fijado y comprueban `active is true`. No hay claves filtradas ni uso de `service_role` en cliente. Los 51 tests pasan, `tsc` está limpio y no hay dependencias circulares.

El problema no es la ausencia de control: es que **el control tiene un agujero concreto y cuantificable**, y que el módulo más antiguo de la aplicación (`app/page.tsx`) no comprueba si sus escrituras han llegado a la base.

Los cinco riesgos más graves:

1. **CRÍTICO — 364 puntos de servicio (13.466,66 €) legibles y modificables por cualquier usuario autenticado.** El patrón `province IS NULL` de las policies convierte el 79 % de la tabla `points` en datos globales, cruzando las 12 provincias.
2. **ALTO — 9 mutaciones descartan el error de Supabase** después de haber pintado el cambio en pantalla: si la RLS rechaza la escritura, la UI dice «Guardado» y el dato se pierde al recargar.
3. **ALTO — `isdin_vinyls.vinyl` no tiene índice único y ya hay un duplicado real (`VIN-31552`).** El espejo llamada→vinilo escribe en las dos filas y la sincronización pierde una de ellas.
4. **ALTO — la pestaña Pagos lee dos tablas vacías** (`big_campaigns`, `big_campaign_points`: 0 filas) mientras el modelo vivo (`puntos_venta_campana`: 1.012 filas) queda fuera. El KPI «Grandes campañas» es estructuralmente 0.
5. **MEDIO — restricciones que solo existen en la UI:** `economic_events` y `payment_obligations` son accesibles por cualquier gestor con permiso `pagos`, aunque las pantallas correspondientes sean admin-only.

De cara a **Merchan Core**, el modelo de permisos es reutilizable tal cual salvo por dos cosas: el patrón `province IS NULL` (que MerchanLOGS heredaría) y el hecho de que las 20 tablas de logística se leen con `merchan_has_profile()`, sin ningún ámbito.

---

## 2. Tabla de hallazgos

| ID | Sev. | Área | Hallazgo | Evidencia | Impacto | Corrección propuesta | Esf. |
|---|---|---|---|---|---|---|---|
| **C-01** | **CRÍTICO** | Permisos / RLS | La policy `points.province_scope_all` incluye `province IS NULL`, y **364 de 458 filas (79 %) tienen `province` a NULL**. Como la policy es `FOR ALL`, cualquier usuario autenticado con perfil las **lee y las escribe**, sea cual sea su provincia. | Policy verificada en `pg_policies`; origen en `supabase/v9_3_rls_role_province.sql`. Datos: 364 filas, **13.466,66 €** en `fee`, repartidas en **12 provincias** (Asturias 115, Zaragoza 89, Alicante 31, Valencia 31, Huesca 25, Lleida 22, Sevilla 20, Córdoba 10, Castellón 8, Almería 8, Jaén 4, Teruel 1). | Un gestor de Sevilla puede leer los importes de Asturias y **modificar el `fee` de cualquier punto**. La UI no lo muestra (`app/page.tsx:59` filtra por servicio), pero una llamada directa a `/rest/v1/points` con su propio JWT lo devuelve. | Rellenar `province` en los 364 puntos desde `services.province` (el dato existe: el JOIN lo resuelve al 100 %), añadir `NOT NULL` + *default* por trigger desde el servicio padre, y **quitar la rama `province IS NULL`** de las 7 policies que la usan. | M |
| **A-01** | ALTO | Funcional | 9 mutaciones aplican el cambio en estado local y luego lanzan `await supabase...` **sin capturar `error`**, anunciando éxito incondicionalmente. | `app/page.tsx:63` (updateClient), `:64` (delClient), `:66` (updateWorker), `:67` (delWorker), `:70` (updateService), `:71` (updateServiceFull), `:72` (updatePoint), `:76` (delPoint), `:77` (delService). Contraste: `:62`, `:65`, `:68`, `:75` sí lo comprueban. | Pérdida silenciosa de datos. Con RLS activa un rechazo de policy es indistinguible del éxito: `saved("Guardado")` se muestra igual. Afecta a cambios de estado de servicio, importes de punto y borrados. | Capturar `error` en las 9, revertir el estado optimista y mostrar el mensaje en rojo. El patrón correcto ya existe en `app/grandes-campanas/isdin/llamadas/page.tsx:218-260` (`persistCall` con *rollback*). | M |
| **A-02** | ALTO | Integridad ISDIN | `isdin_calls.vin` tiene índice **único** (`idx_isdin_calls_vin_unique`); `isdin_vinyls.vinyl` solo tiene índice **no único** (`idx_isdin_vinyls_vinyl`). Ya existe un duplicado en producción: **`VIN-31552` ×2**. | Índices verificados en `pg_index`. Conteos: 475 vinilos → 474 llamadas (la diferencia es exactamente el duplicado). Dedup en `lib/isdin-calls.ts:228`; espejo en `app/grandes-campanas/isdin/llamadas/page.tsx:274`. | Dos efectos reales: (a) `mergeCallsWithVinyls` se queda con «la última» de las dos filas, así que **una farmacia nunca genera llamada**; (b) `syncCallToVinylMirror` hace `.update(mirror).eq("vinyl", call.vin)` y **escribe el estado de llamada en los dos vinilos**, contaminando el que no corresponde. | Resolver el duplicado `VIN-31552` con negocio, crear `UNIQUE (vinyl)` en `isdin_vinyls`, y hacer el espejo por `id` en vez de por `vinyl`. | M |
| **A-03** | ALTO | Datos / Funcional | La pestaña Pagos consulta `big_campaign_points` y `big_campaigns`, que tienen **0 filas**. El modelo vivo de campañas es `grandes_campanas` (4) / `puntos_venta_campana` (**1.012**). | `app/page.tsx:100` (`buildBigCampaignPaymentRow`, `.from("big_campaign_points")`, `.from("big_campaigns")`). Conteos verificados en la base. | El KPI «Grandes campañas» de la pantalla de Pagos vale siempre 0 y el export CSV omite por completo la facturación de grandes campañas. No es un fallo intermitente: es estructural. | Decidir con negocio si Pagos debe consumir `puntos_venta_campana` (y entonces reescribir la consulta) o si esa vista queda deprecada en favor de `/historial-economico`. Ver **P-3** en preguntas abiertas. | M |
| **A-04** | ALTO | Refresco | `Payments` carga las campañas en un `useEffect(..., [])` que **nunca se vuelve a ejecutar**. No hay revalidación tras ninguna mutación de servicio o punto. | `app/page.tsx:100`. | Tras validar un servicio o cambiar el importe de un punto, los totales de Pagos siguen mostrando el valor anterior hasta recargar la página entera. Riesgo de decisiones de pago sobre cifras obsoletas. | Extraer la carga a una función y llamarla desde `refresh()`, o dependerla de `services`. | S |
| **M-01** | MEDIO | Permisos | `app_users` tiene `SELECT ... USING (true)` para todo `authenticated`. | Policy `users_read` en `pg_policies`. | Cualquier gestor puede enumerar los 8 usuarios con su `role`, `permissions`, `provinces` y `auth_user_id`. **Mitigado**: los *grants* de columna de `authenticated` excluyen `password`, y `merchan_auth_whoami` hace `to_jsonb(u) - 'password'`. No hay fuga de credenciales, sí de organigrama. | Restringir a `merchan_is_admin() OR id = merchan_my_app_user_id()`. Comprobar antes que ninguna pantalla dependa de listar usuarios ajenos. | S |
| **M-02** | MEDIO | Seguridad por ocultación | La UI restringe `/historial-economico` y `/configuracion/avisos` a admin (`canViewFinancials`), pero en servidor `economic_events`, `economic_month_closures` e `import_run*` solo exigen `merchan_has_perm('pagos')`, y `outbox_events` solo `merchan_can_logistics()`. | UI: `lib/access-control.ts:318-320`, guards verificados en cada `page.tsx`. Servidor: policies `eco_scope`, `cierres_read`, `pagos_only`, `logistica_write`. | Un gestor con permiso `pagos` puede leer y escribir el registro económico por API aunque no vea la pantalla. Es el caso de libro de «restricción solo en la UI». | Alinear: si el registro económico es admin-only, añadir `merchan_is_admin()` a esas policies. Si no, abrir la UI. Decidir cuál de las dos es la intención. | S |
| **M-03** | MEDIO | Incoherencia | La lógica de importe de un punto/servicio está implementada **cuatro veces con reglas distintas**. | `app/page.tsx:41-45` (`pPay`/`pointTotal`/`serviceTotal`, inline), `lib/payment-audit.ts:60-90`, `lib/payment-ledger.ts:96`, `lib/payments/engine.ts`. | Divergencia de importes entre Panel, Pagos, Historial económico y el motor de obligaciones. Dos de las cuatro copias (`payment-audit`, parte de `payment-ledger`) están además muertas (ver B-01), lo que enmascara el problema. | Consolidar en `lib/payments/engine.ts` (es el único con tests: 51 pasan) y borrar el resto. | L |
| **M-04** | MEDIO | Rendimiento | 46 usos de `select("*")` frente a solo 4 `.limit()`. | Recuento sobre `app/ lib/ components/`. Ejemplos: `app/grandes-campanas/isdin/facturacion/page.tsx:35` (`isdin_vinyls`, 475 filas), `lib/logistics-store.ts` (20 tablas completas en cada carga). | Hoy es asumible (la tabla mayor es `puntos_venta_campana` con 1.012 filas), pero `logistics-store` descarga 20 tablas enteras en cada render de Logística. Escala mal y empeora cuando MerchanLOGS empiece a escribir. | Proyectar columnas y paginar donde el volumen crezca. No urgente. | M |
| **M-05** | MEDIO | Integridad ISDIN | La deduplicación de vinilos usa la cadena `vinyl` **sin normalizar** (`Map` sobre `v.vinyl` tal cual). | `lib/isdin-calls.ts:228`. | Latente, no activo: hoy los datos están limpios (0 filas con espacios, 0 con minúsculas, 0 huérfanas en ninguna dirección). Un import futuro con ` vin-31552 ` crearía un registro paralelo en vez de casar. | Normalizar con `trim().toUpperCase()` en el `Map` y en el espejo. Es barato y elimina toda una clase de fallo. | S |
| **M-06** | MEDIO | Rutas | `/logistica/[section]` acepta **cualquier** cadena sin lista blanca. | `app/logistica/[section]/page.tsx:4-9`. | `/logistica/loquesea` renderiza `LogisticsClient` con `section` inválido. No es un fallo de seguridad (`logistics-client.tsx:44` cae a `"panel"`), pero produce URLs sin sentido indexables y un *breadcrumb* basura. | Validar contra la lista de `modules` y devolver `notFound()`. | S |
| **M-07** | MEDIO | Calidad | `"strict": false` en `tsconfig.json` y **75 anotaciones `: any`**. `target: "es5"`. | `tsconfig.json:8`; recuento sobre `app/ lib/ components/`. Positivo: **0** `@ts-ignore` / `@ts-expect-error`. | Con `strict:false` los `null` no se comprueban, que es justo la clase de fallo que aparece en A-01 y en el manejo de `error`. `es5` infla el bundle sin necesidad (Next 14 no soporta navegadores tan antiguos). | Activar `strict` por fases, empezando por `strictNullChecks` en `lib/payments/`. Subir `target` a `es2020`. | L |
| **M-08** | MEDIO | Operación | Hay **1 evento de outbox en `dead_letter`** en producción (y 10 completados). | Conteo en `outbox_events`. | Un evento de integración no entregado. La pantalla `/configuracion/avisos` existe justamente para esto, pero es admin-only y nadie parece haberlo atendido. | Revisar el evento concreto y decidir reintento o descarte. | S |
| **M-09** | MEDIO | Pagos | Las **489 obligaciones de pago están todas en estado `calculado`**; ninguna ha avanzado. `payment_ledger` y `economic_events` están **vacías** (0 filas). | Conteos por `status` en `payment_obligations`; `count(*)` en las otras dos. | El *pipeline* de pagos se ha ejecutado (hay 1 `import_run` y 489 obligaciones) pero nunca ha progresado a aprobado/pagado. O el flujo está incompleto, o nadie lo usa. Determina si `/historial-economico` es funcionalidad real o andamiaje. | Confirmar con negocio (**P-4**). | S |
| **B-01** | BAJO | Código muerto | Tres módulos de `lib/` **sin un solo import** en todo el repo. | `lib/payment-audit.ts` (108 L), `lib/payments/reconcile.ts` (132 L), `lib/outbox.ts` (139 L). Verificado por búsqueda de `@/lib/...` en `app/ lib/ components/` y confirmado por `ts-prune`. | 379 líneas muertas. `payment-audit.ts` es además una de las cuatro copias de M-03, y **el brief de partida lo daba como módulo activo**. | Ver §4. `outbox.ts` requiere confirmación previa (las RPC `outbox_*` sí se usan desde otros sitios). | S |
| **B-02** | BAJO | Rutas huérfanas | `/ui-preview` **no recibe ningún enlace** y es el único consumidor de los 4 componentes de `components/ui/`. | Barrido de `href=`, `location.assign(`, `router.push(` sobre todo el repo: `/ui-preview` no aparece. `components/ui/*` solo importados desde `app/ui-preview/page.tsx:4-7`. | Catálogo visual accesible en producción escribiendo la URL. Sin datos reales (todos los `onChange` son `() => {}`), así que no filtra nada. | Decidir si es herramienta interna que se conserva o se retira. | S |
| **B-03** | BAJO | Assets | `public/isdin-operational-view.js` (5.461 B) **sin ninguna referencia**. | Búsqueda de la cadena `isdin-operational-view` en `app/ lib/ components/ tailwind.config.ts` y CSS: 0 resultados fuera del propio nombre de fichero CSS homónimo. | Se sirve públicamente sin que nada lo cargue. | Eliminar tras confirmar que no lo inyecta nada externo. | S |
| **B-04** | BAJO | Configuración | `NEXT_PUBLIC_MERCHANLOGS_URL` se usa en código pero **no está declarada en `.env.example`**, y cae a una URL de producción *hardcodeada*. | `app/logistica/logistics-client.tsx:27` y `app/logistica/solicitudes/solicitudes-logistica-client.tsx:65`, ambos con *fallback* `"https://merchanlogs.vercel.app"`. | Un despliegue nuevo apunta silenciosamente a la MerchanLOGS de producción. Relevante justo ahora que se separa Merchan Core. | Declararla en `.env.example` y quitar el *fallback* (o dejarlo vacío y avisar). | S |
| **B-05** | BAJO | Exports muertos | Exports públicos nunca consumidos. | `ts-prune`: `canViewGlobalDashboards` (`access-control.ts:322`), `provinciasParaSesion` / `normalizeProvincia` (`campanas.ts:716,721`), `CALLS_DO_NOT_GENERATE_PAYMENTS` (`isdin-calls.ts:99`), 6 funciones de `logistics-actions.ts`, `createCampaignLogisticsRequest` / `cancelSourceLogistics` (`logistics-sync.ts:320,444`), `changeObligationStatus` (`payments/ledger.ts:92`), `assertObligationCents` / `formatCents` (`payments/money.ts:41,71`), `OBLIGATION_TRANSITIONS` (`payments/types.ts:16`), `CURRENCY` (`payments/constants.ts:15`). | Ruido. Algunos (`OBLIGATION_TRANSITIONS`, `changeObligationStatus`) sugieren funcionalidad de pagos a medio construir, coherente con M-09. | Ver §4: unos son borrables, otros son la punta de una funcionalidad inacabada. | M |
| **B-06** | BAJO | Dependencias | `depcheck` marca `@types/react-dom`, `autoprefixer` y `postcss` como no usadas. | Salida de `depcheck`. | **Son falsos positivos.** `postcss` y `autoprefixer` los consume `postcss.config.js`; `@types/react-dom` lo usa el compilador. `package.json` no tiene ninguna dependencia realmente sobrante. | Ninguna acción. Se documenta para que nadie las borre en una limpieza futura. | — |
| **B-07** | BAJO | Auth | *Leaked password protection* desactivada en Supabase Auth. | *Advisor* de seguridad de Supabase. | Se admiten contraseñas presentes en filtraciones conocidas. Con 8 usuarios internos el riesgo es bajo, pero el coste de activarlo es cero. | Activar en el panel de Supabase Auth. | S |

**Resultado del instrumental** (crudo, antes de interpretación): `tsc --noEmit` → **0 errores**. `vitest` → **51/51 tests pasan** en 7 ficheros. `madge --circular` → **0 ciclos**. `next lint` → **2 warnings**, ambos `react-hooks/exhaustive-deps` (`app/page.tsx:116`, `app/grandes-campanas/isdin/facturacion/page.tsx:44`). `depcheck` → 3 falsos positivos (B-06). `ts-prune` → 46 entradas, de las cuales ~20 son `export default` de páginas (falsos positivos por la convención de Next.js) y el resto está en B-01/B-05.

---

## 3. Matriz de permisos (rol × recurso × operación)

Roles **reales en código y en datos**: `admin` (1 usuario), `manager` (6), `almacen` (1). Definidos en `lib/access-control.ts:8`; no existen roles «trabajador» ni «cliente» — los trabajadores son filas de `workers` sin login. `manager` se modula con 6 permisos booleanos (`servicios`, `isdin`, `calendario`, `pagos`, `logistica`, `usuarios`), y `usuarios` se fuerza a `false` para no-admin en `lib/access-control.ts:69`.

Leyenda: **✅ correcto** (UI y RLS coherentes) · **🟠 solo UI** (la UI restringe, el servidor no) · **🔴 sin control** (abierto a cualquier autenticado) · **❔ desconocido**.

| Recurso | Operación | admin | manager (con permiso) | manager (sin permiso) | almacen | Nota |
|---|---|---|---|---|---|---|
| `app_users` | R | ✅ | 🟠 lee todo | 🟠 lee todo | 🟠 lee todo | M-01. `password` no legible (grants de columna) |
| `app_users` | C/U/D | ✅ | ✅ denegado | ✅ denegado | ✅ denegado | `merchan_is_admin()` |
| `clients` | R | ✅ | ✅ | ✅ | ✅ | `merchan_has_profile()` — catálogo compartido, aceptable |
| `clients` | C/U/D | ✅ | ✅ denegado | ✅ denegado | ✅ denegado | admin-only |
| `workers` | C/R/U/D | ✅ | ✅ por provincia | ✅ por provincia | ✅ por provincia | 0 filas con provincia nula |
| `services` | C/R/U/D | ✅ | ✅ por provincia | ✅ por provincia | ✅ por provincia | 0 filas con provincia nula |
| **`points`** | **C/R/U/D** | ✅ | **🔴 364/458 filas** | **🔴 364/458 filas** | **🔴 364/458 filas** | **C-01 — 13.466,66 € expuestos** |
| `worker_addresses` | C/R/U/D | ✅ | 🟠 vía `EXISTS(workers)` | 🟠 | 🟠 | El `EXISTS` no filtra por provincia; hereda el ámbito de `workers` de forma laxa |
| `grandes_campanas` | R | ✅ | ✅ por puntos/provincia/autoría | ✅ | 🟠 `merchan_is_almacen()` lo abre entero | Rama explícita para almacén |
| `grandes_campanas` | C/U/D | ✅ | ✅ denegado | ✅ denegado | ✅ denegado | admin-only |
| `puntos_venta_campana` | C/R/U/D | ✅ | ✅ por provincia | ✅ por provincia | ✅ por provincia | 0/1.012 con provincia nula |
| `campana_gestores` | R | ✅ | ✅ por provincia o autoría | ✅ | ✅ | |
| `campana_gestores` | C/U/D | ✅ | ✅ denegado | ✅ denegado | ✅ denegado | |
| `campana_columnas` | R / CUD | ✅ | ✅ / denegado | ✅ / denegado | ✅ / denegado | |
| `incidencias_campana` | C/R/U/D | ✅ | 🟠 vía `EXISTS(puntos)` | 🟠 | 🟠 | El `EXISTS` no comprueba que el punto esté en el ámbito del usuario |
| `isdin_vinyls` | C/R/U/D | ✅ | ✅ por provincia (perm. `isdin` **no** se comprueba) | 🟠 sin permiso `isdin` sigue accediendo | 🟠 | La RLS usa `merchan_has_profile()`, no `merchan_has_perm('isdin')` |
| `isdin_calls` | C/R/U/D | ✅ | ✅ por provincia (íd.) | 🟠 íd. | 🟠 | Íd. |
| `isdin_billing_*` | C/R/U/D | ✅ | ✅ denegado | ✅ denegado | ✅ denegado | `admin_only`, coherente con `canViewFinancials` |
| `payment_obligations` | C/R/U/D | ✅ | 🟠 perm. `pagos`, UI admin-only | ✅ denegado | ✅ denegado | M-02 |
| `payment_ledger` / `payment_audit_log` | C/R/U/D | ✅ | 🟠 perm. `pagos` + provincia | ✅ denegado | ✅ denegado | Tablas vacías hoy |
| `economic_events` | C/R/U/D | ✅ | **🟠 perm. `pagos` + provincia, UI admin-only** | ✅ denegado | ✅ denegado | **M-02 — el caso más claro** |
| `economic_month_closures` | R / CUD | ✅ | 🟠 perm. `pagos` / denegado | ✅ denegado | ✅ denegado | Cierre contable sí es admin-only en servidor |
| `import_runs` / `import_run_rows` | C/R/U/D | ✅ | 🟠 perm. `pagos` | ✅ denegado | ✅ denegado | |
| `logistics_*` (16 tablas) | R | ✅ | 🔴 `merchan_has_profile()` — **sin ámbito** | 🔴 | 🔴 | Cualquier perfil lee todo el almacén |
| `logistics_*` (16 tablas) | C/U/D | ✅ | ✅ perm. `logistica` | ✅ denegado | ✅ rol `almacen` | Escritura sí está bien controlada |
| `outbox_events`, `integration_events`, `sync_logs`, `inbox_processed` | R / CUD | ✅ | 🔴 lectura sin ámbito / ✅ escritura con `logistica` | 🔴 / denegado | 🔴 / ✅ | |
| `auth_login_attempts` | — | ✅ denegado | ✅ denegado | ✅ denegado | ✅ denegado | RLS sin policies = *deny all*. **Correcto e intencionado** |
| **`anon`** (sin login) | **todo** | — | — | — | — | **✅ cero *grants* de tabla y de columna. Nada accesible.** |

**Protección de rutas.** No existe `middleware.ts` ni ningún `route.ts` (0 en todo el repo). Las 21 rutas son alcanzables directamente por URL. La comprobación de sesión vive **exclusivamente en cliente**: `app/app-shell.tsx:119` oculta la navegación y cada página repite su propio *guard*. Barrido página a página: **todas las pantallas con datos tienen guard**. `app/logistica/page.tsx`, `[section]`, `solicitudes/` y `configuracion/sincronizacion` no lo tienen en el fichero de ruta, pero delegan en `LogisticsClient` / `SolicitudesLogisticaClient`, que sí comprueban `canAccessModule(session, "logistica")`. `auditoria-pagos` es solo un `redirect()`. La cobertura es correcta *dado el modelo*; el modelo es el que no tiene segunda línea de defensa.

**IDOR.** `/grandes-campanas/[id]` no valida pertenencia en cliente, pero la RLS de `grandes_campanas` y `puntos_venta_campana` resuelve el acceso en servidor: manipular el `id` devuelve una campaña vacía, no datos ajenos. **No hay IDOR explotable** en esa ruta. La excepción es C-01, que no necesita manipular ningún id.

**Credenciales.** Cero apariciones de `service_role` en el repositorio. `.env` y `.env.local` están en `.gitignore`. Las tres variables `NEXT_PUBLIC_` son legítimamente públicas (URL, anon key) salvo `NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD`, que solo se usa en el sembrado de instalaciones nuevas (`lib/access-control.ts:91`) y **queda expuesta en el bundle del navegador si se define**. Hoy la base tiene 8 usuarios, así que el camino de sembrado no se ejecuta; conviene retirarla igualmente.

**Perspectiva Merchan Core / MerchanLOGS.** Tres puntos que se rompen o quedan laxos al compartir base:
1. **C-01 se propaga.** El patrón `province IS NULL` está en 7 policies. MerchanLOGS lo heredaría tal cual y ampliaría la superficie.
2. **Las 20 tablas de logística se leen con `merchan_has_profile()`**, sin ámbito alguno. Es precisamente la superficie que MerchanLOGS va a usar más, y hoy cualquier gestor de OPS ve todo el almacén.
3. **El rol `almacen` ya está preparado** (`merchan_is_almacen()`, `v9_5_role_almacen.sql`, 1 usuario real) y tiene una rama explícita en `grandes_campanas`. La base para separar está puesta; falta el ámbito de lectura.

---

## 4. Lista de eliminación candidata

### Seguro eliminar (demostrado sin referencias)

| Elemento | Prueba |
|---|---|
| `lib/payment-audit.ts` (108 L) | 0 imports de `@/lib/payment-audit` en `app/ lib/ components/`. Confirmado por `ts-prune` (3 exports muertos). Su lógica está duplicada en `lib/payments/engine.ts`, que sí tiene tests. |
| `lib/payments/reconcile.ts` (132 L) | 0 imports. `ts-prune` marca `reconcileIsdin`. `buildReconcileReport` solo lo usa el propio fichero. |
| `public/isdin-operational-view.js` (5.461 B) | 0 referencias a la cadena `isdin-operational-view` fuera del CSS homónimo. No se inyecta desde ningún `<script>`. |
| `lib/access-control.ts:322` `canViewGlobalDashboards` | 0 llamadas. Duplica `canViewFinancials` línea por línea. |
| `lib/campanas.ts:716,721` `provinciasParaSesion`, `normalizeProvincia` | 0 llamadas. `normalizeProvince` de `lib/provinces.ts` es la versión viva. |
| `lib/payments/constants.ts:15` `CURRENCY` | 0 llamadas. |

### Eliminar tras confirmar

| Elemento | Qué falta comprobar |
|---|---|
| `lib/outbox.ts` (139 L) | Sin imports en el repo, **pero** las RPC `outbox_publish` / `outbox_claim` / `outbox_complete` / `outbox_fail` sí se llaman desde otros ficheros, y hay 11 filas reales en `outbox_events`. Confirmar que MerchanLOGS no importe este módulo antes de tocarlo. |
| 6 exports de `lib/logistics-actions.ts` (`updateEntry`, `closeEntryLogically`, `updatePicking`, `cancelPicking`, `updateShipping`, `cancelShipping`) | El fichero sí se importa (desde `solicitudes-logistica-client.tsx`), pero solo se usan 2 de sus 8 exports. Verificar si son la API prevista para MerchanLOGS. |
| `createCampaignLogisticsRequest`, `cancelSourceLogistics` (`logistics-sync.ts:320,444`) | Sin llamadas, pero la RPC `create_logistics_request_campaign` existe en la base. Funcionalidad probablemente a medio conectar. |
| `changeObligationStatus` (`payments/ledger.ts:92`), `OBLIGATION_TRANSITIONS` (`payments/types.ts:16`), `assertObligationCents`, `formatCents` | Coherentes con M-09: las 489 obligaciones están todas en `calculado`. Esto **no es código muerto, es funcionalidad inacabada**. No borrar sin decidir el futuro del flujo de pagos. |
| `/ui-preview` + los 4 `components/ui/*` | Sin enlaces entrantes. Confirmar si es herramienta de diseño que el equipo usa a mano. |
| `app/auditoria-pagos/page.tsx` | Solo un `redirect()`. Conservar mientras existan marcadores antiguos; retirar cuando se decida. |

### No tocar

- **Todas las tablas de auditoría que el código no lee:** `payment_audit_log`, `payment_obligations_audit`, `isdin_billing_audit`, `import_run_rows`, `attachments`, `auth_login_attempts`. Las escriben triggers (`payment_obligations_audit_write`, `isdin_billing_adjustments_audit`, …) y son *append-only* por diseño. Que el front no las lea es lo esperado.
- **`payment_ledger`** (0 filas): tiene policy, tiene tabla de auditoría asociada y `lib/payment-ledger.ts` sí se importa desde 3 sitios.
- **`big_campaigns` / `big_campaign_points`**: vacías, pero **el código las lee** (A-03). Resolver A-03 antes de plantearse nada sobre ellas.
- **`@types/react-dom`, `autoprefixer`, `postcss`**: falsos positivos de `depcheck` (B-06).
- **Las 26 migraciones de `supabase/`**: son el historial. No se tocan.
- **Ninguna columna de Supabase**, hasta tener el esquema previsto de MerchanLOGS.

---

## 5. Plan de remediación en olas

### Ola 1 — Seguridad y permisos

1. **C-01, paso 1 (dato).** `UPDATE points SET province = s.province FROM services s WHERE s.id = points.service_id AND points.province IS NULL`. El JOIN cubre las 364 filas al 100 %.
   *Probar:* `select count(*) from points where province is null` → 0. Que un gestor de una provincia siga viendo exactamente sus puntos en `/?tab=servicios`.
2. **C-01, paso 2 (esquema).** Trigger que herede `province` del servicio padre en `INSERT`, y después `NOT NULL`.
   *Probar:* alta de servicio con puntos desde `/?tab=nuevo-servicio`; comprobar que los puntos nacen con provincia.
3. **C-01, paso 3 (policy).** Quitar la rama `province IS NULL` de las 7 policies que la usan. Hacerlo **después** de 1 y 2, nunca antes: al revés se deja a los gestores sin acceso a sus propios puntos.
   *Probar:* con el JWT de un gestor, `GET /rest/v1/points?select=*` debe devolver solo su provincia.
4. **M-02.** Decidir y alinear el ámbito de `economic_events` y `payment_obligations` (admin-only o abierto a `pagos`).
   *Probar:* con JWT de gestor con permiso `pagos`, comprobar el resultado esperado en ambas tablas.
5. **M-01.** Restringir el `SELECT` de `app_users`.
   *Probar:* la pantalla `/?tab=usuarios` sigue funcionando para admin; un gestor solo se ve a sí mismo.
6. **B-07.** Activar *leaked password protection*.
7. **B-04.** Declarar `NEXT_PUBLIC_MERCHANLOGS_URL` y retirar `NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD` del bundle.

### Ola 2 — Funcionalidad rota

1. **A-01.** Capturar el error en las 9 mutaciones de `app/page.tsx`, con *rollback*, replicando el patrón de `persistCall`.
   *Probar:* forzar un rechazo de RLS (gestor editando fuera de su provincia) y comprobar que sale mensaje rojo y la fila revierte.
   *Nota de orden:* hacerlo **después** de la Ola 1 tiene una ventaja: si se hiciera antes, C-01 estaría enmascarando fallos que ahora sí aflorarán.
2. **A-02.** Resolver `VIN-31552`, crear `UNIQUE (vinyl)` en `isdin_vinyls`, y cambiar el espejo a `.eq("id", ...)`.
   *Probar:* 475 vinilos → 475 llamadas. Cambiar el estado de una llamada y verificar que solo se actualiza su vinilo.
3. **A-04.** Revalidar Pagos tras cada mutación.
   *Probar:* validar un servicio y ver el total de Pagos cambiar sin recargar.
4. **A-03.** Decidir el destino de `big_campaigns` (ver P-3) y reescribir o retirar la consulta.
   *Probar:* el KPI «Grandes campañas» refleja `puntos_venta_campana`, o la sección desaparece.
5. **M-08.** Atender el evento en `dead_letter`.
6. **M-05, M-06.** Normalizar el `vin` en la deduplicación; lista blanca en `[section]`.

### Ola 3 — Limpieza de código

1. Borrar el bloque «seguro eliminar» de §4 (6 elementos, ~250 líneas + 1 asset).
2. **M-03.** Consolidar el cálculo de importes en `lib/payments/engine.ts` y eliminar las copias.
   *Probar:* los 51 tests siguen verdes; contrastar el total de Pagos antes y después sobre el mismo periodo.
3. Resolver el bloque «eliminar tras confirmar» según las respuestas a §6.
4. **M-07.** `strictNullChecks` en `lib/payments/` primero; subir `target` a `es2020`.
   *Probar:* `tsc --noEmit` limpio en cada paso.
5. Los 2 *warnings* de `next lint`.

### Ola 4 — Preparación de Merchan Core

1. **Ámbito de lectura en logística.** Sustituir `merchan_has_profile()` por un predicado con ámbito real en las 20 tablas `logistics_*` / `sync_logs` / `integration_events` / `outbox_events`. Es el mayor trabajo pendiente para separar OPS de LOGS.
2. **Contrato de rol.** Documentar qué puede hacer `almacen` y decidir si MerchanLOGS entra como `authenticated` con usuarios de `app_users` o con `service_role` (ver P-5). Cambia por completo el diseño de las policies.
3. **Auditar `merchan_has_perm`** sobre los permisos que hoy la RLS ignora: `isdin_vinyls` e `isdin_calls` se protegen por provincia pero **no** comprueban el permiso `isdin`, mientras la UI sí lo hace.
4. **Fijar el ámbito del outbox** antes de que dos aplicaciones escriban en él. Ya hay un `dead_letter` con un solo productor.
5. **Contrato de columnas.** No borrar ninguna columna hasta tener el esquema previsto de MerchanLOGS.

---

## 6. Preguntas abiertas

- **P-1.** ¿Confirmas que `dptmswhwmqimijpfyndn` (MerchanOPS) es el proyecto de producción que sirve Vercel? Todos los conteos de este informe salen de ahí.
- **P-2.** Los **364 puntos sin provincia** (C-01): ¿es residuo de una carga antigua o hay un flujo vivo que los sigue creando así? `app/page.tsx:68` y `:75` sí rellenan `province` desde el servicio, luego apunta a datos históricos — conviene confirmarlo antes de poner el `NOT NULL`.
- **P-3.** `big_campaigns` / `big_campaign_points` están vacías pero la pestaña Pagos las lee (A-03). ¿Se abandonaron en favor de `grandes_campanas`, o hay un flujo previsto que aún debe alimentarlas?
- **P-4.** Las **489 obligaciones están todas en `calculado`** y `payment_ledger` / `economic_events` están vacías (M-09). ¿El flujo de pagos está en uso real, en pruebas, o abandonado a medias? Determina si el bloque de `payments/` se termina o se retira.
- **P-5.** **MerchanLOGS: ¿con qué rol atacará la base?** ¿`authenticated` con usuarios de `app_users` (rol `almacen`), o `service_role` desde su propio backend? Es la decisión que condiciona toda la Ola 4.
- **P-6.** El duplicado **`VIN-31552`**: ¿son dos farmacias distintas con el mismo código o una fila repetida? Determina si se fusiona o se renumera.
- **P-7.** ¿`/ui-preview` es una herramienta que el equipo usa, o resto de una migración visual?
- **P-8.** ¿Quieres que la Ola 1 se implemente en este mismo branch, o prefieres un branch por ola?

---

## 7. Adenda — remediación aplicada y correcciones al informe

*29 de julio de 2026, misma sesión. Esta sección prevalece sobre lo anterior.*

### 7.1 Decisión de negocio recibida

Se pidió expresamente **no tocar los 364 puntos sin provincia**. Se respeta: no
se ha modificado ni una fila. El `UPDATE` de datos y el `NOT NULL` propuestos en
la Ola 1 quedan **cancelados**, no aplazados.

### 7.2 Investigación de los 364 puntos (cierra P-2)

Son **residuo histórico**, no un flujo vivo. El corte es limpio al día:

| Mes | Sin provincia | Con provincia |
|---|---|---|
| 2026-05 | 241 | 0 |
| 2026-06 | 123 | 0 |
| 2026-07 | 0 | 99 |

Último punto sin provincia: `2026-06-26 11:32`. Primero con provincia:
`2026-07-02 07:11`. Causa raíz identificada en git: el commit **`fae7516`
(2026-06-30)** añadió `province` al tipo `Point` de `app/page.tsx` —antes el
campo no existía en la aplicación, aunque la columna sí estaba en la base— y
creó `addServiceScoped`, que propaga la provincia del servicio al punto. El
flujo lleva arreglado desde entonces.

Reparto por estado del servicio padre: **Validado 223 pts / 6.559,90 €**
(validados pero *no pagados*), Pagado 140 / 6.891,76 €, Asignado 1 / 15,00 €.
Recuperabilidad: **364/364** desde el servicio padre; 0 huérfanos, 0 provincias
no normalizables.

### 7.3 C-01 — RESUELTO sin tocar datos

Migración **`supabase/v9_8_rls_points_via_service.sql`**, aplicada a producción.
La policy `points.province_scope_all` ya no lee `points.province`: deriva la
provincia del **servicio padre** mediante `EXISTS` explícito.

Verificado gestor a gestor **antes** de aplicar. La partición territorial real
hace que toda la actividad caiga hoy en la zona de un solo gestor:

| Gestor | Servicios visibles | Puntos en la app | Puntos por API (antes → después) |
|---|---|---|---|
| Kilian, Lara, Lidia, Marc, Yima | 0 | 0 | **364 → 0** |
| Mai | 252 | 463 | 463 → 463 |

Como `app/page.tsx:59` solo carga puntos de servicios ya visibles
(`.in("service_id", serviceIds)`), **la UI es idéntica antes y después**: lo
único que cambia es lo que devuelve una llamada directa a `/rest/v1/points`.
Post-aplicación: 463 filas, 364 sin provincia, suma de `fee` sin alterar.

### 7.4 Correcciones a hallazgos de este mismo informe

Cuatro afirmaciones de las §2–§4 no resistieron la implementación:

| ID | Qué decía el informe | Qué es cierto |
|---|---|---|
| **M-02** | «La UI restringe `/historial-economico` a admin mientras `economic_events` solo exige `pagos`» | **Incorrecto.** El guard real es `canAccessModule(session, "pagos")` (`app/historial-economico/page.tsx:196`), que coincide exactamente con la RLS. Solo la acción de *sincronizar* es admin (`:77`). **UI y servidor están alineados; no había nada que arreglar.** El único caso genuino que queda es `/configuracion/avisos` (admin en UI) sobre `outbox_events` y `payment_obligations`, y **no debe tocarse**: `outbox_events` lo necesitará MerchanLOGS, y `payment_obligations` lo lee la página ISDIN (`lib/payments/import.ts` ← `app/grandes-campanas/isdin/page.tsx`, guard `isdin`). |
| **M-01** | «Restringir `app_users` a `admin OR self`» | **Inaplicable tal como se propuso.** `/grandes-campanas/[id]/asignacion` —abierta a cualquier gestor con permiso `servicios`— llama a `loadInternalUsers()` y necesita `id`, `display_name`, `active` y `provinces` **de otros gestores** para poblar el desplegable de asignación (`asignacion/page.tsx:57,64-67`). La restricción dejaría ese desplegable con un solo nombre. **No aplicada.** La vía correcta es una vista `v_app_users_basic` con solo esas cuatro columnas y migrar la página a ella. Queda pendiente. |
| **B-01** | «`lib/payments/reconcile.ts` sin importadores → seguro eliminar» | **Falso.** `tests/payments-reconcile.test.ts:8` importa `buildReconcileReport`. `ts-prune` solo marcaba `reconcileIsdin`, que sí está sin usar. **El fichero se conserva.** Lección: `ts-prune` reporta por *export*, no por fichero. |
| **A-04** | «Los totales de Pagos no se revalidan tras una mutación» | **Sobredimensionado.** Las líneas de servicio derivan del prop `services`, que sí es reactivo; solo el bloque de grandes campañas se carga una vez (`useEffect(...,[])`). Como ese bloque lee las tablas vacías de A-03 y se ha decidido dejar A-03 como está, el efecto práctico hoy es **nulo**. No se toca. |

### 7.5 Cambios de código aplicados

| ID | Cambio | Fichero |
|---|---|---|
| **A-01** | Las 9 mutaciones que descartaban `error` ahora lo capturan, **revierten el estado optimista** y muestran el fallo. Ya no se anuncia «Guardado» sobre una escritura rechazada. | `app/page.tsx` — `updateClient`, `delClient`, `updateWorker`, `delWorker`, `updateService`, `updateServiceFull`, `updatePoint`, `delPoint`, `delService` |
| **A-02** | El espejo llamada→vinilo se direcciona por clave primaria (`isdin_vinyl_id`) en vez de por `vinyl`, con respaldo al VIN solo para filas legadas sin vínculo. Deja de escribir en las dos filas del duplicado `VIN-31552`. | `app/grandes-campanas/isdin/llamadas/page.tsx` |
| **M-05** | Nueva `normalizeVin()`; la deduplicación y el emparejamiento llamada↔vinilo usan la clave canónica (`trim` + mayúsculas). No cambia ningún emparejamiento actual: cierra la puerta a que un import futuro los rompa. | `lib/isdin-calls.ts` |
| **M-06** | Lista blanca de secciones y `notFound()` para el resto. | `app/logistica/[section]/page.tsx` |
| **B-04** | `NEXT_PUBLIC_MERCHANLOGS_URL` declarada, con aviso del *fallback* a producción. Aviso añadido sobre `NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD` (queda incrustada en el bundle). | `.env.example` |
| **B-01/B-05** | Eliminados: `lib/payment-audit.ts`, `public/isdin-operational-view.js`, `canViewGlobalDashboards`, `provinciasParaSesion`, `normalizeProvincia`, `CURRENCY`. | varios |

**Verificación:** `tsc --noEmit` → 0 errores. `vitest` → 51/51. `next lint` → los
mismos 2 *warnings* preexistentes. `next build` → las 20 rutas compilan.

### 7.6 Pendiente

- **A-02 (índice único).** `CREATE UNIQUE INDEX` sobre `isdin_vinyls.vinyl` **no
  se ha aplicado**: fallaría con el duplicado `VIN-31552` presente, y resolverlo
  implica borrar o fusionar una fila. Bloqueado por **P-6**. El arreglo de código
  ya protege del efecto principal, pero nada impide que aparezcan más duplicados.
- **M-01.** Vista `v_app_users_basic` + migrar la página de asignación.
- **B-07.** *Leaked password protection* — ajuste del panel de Supabase Auth, no
  hay SQL que lo haga.
- **A-03, M-08, M-03, M-07** y la **Ola 4** completa siguen abiertos.
- **P-3 respondida:** se deja `big_campaigns` como está (deuda documentada).
