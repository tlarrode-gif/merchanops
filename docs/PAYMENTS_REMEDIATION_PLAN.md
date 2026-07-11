# Plan de remediación de pagos y concurrencia — MerchanOPS / MerchanLOGS

Fecha: 2026-07-10 · Alcance: auditoría integral de pagos, importaciones,
concurrencia, comunicación entre apps y preparación de backend/RLS.

## 1. Flujo actual (diagnóstico verificado en código)

### Cálculo de pagos: CUATRO implementaciones divergentes

| Sitio | Qué calcula | Problemas |
|---|---|---|
| `app/page.tsx` (`pPay`, `serviceTotal`, componente `Payments`) | Pagos de servicios y grandes campañas en la UI | `INCIDENT_FEE=8.56` propia; fecha de pago cae a `today()` si falta; reconstruye las líneas de campaña por su cuenta |
| `lib/payment-ledger.ts` | Líneas para el ledger/export | Otra copia de la tarifa; `fingerprint` incluye fecha+importe (identidad inestable → una corrección crea línea nueva en vez de corregir); fallback `new Date()` |
| `lib/payment-audit.ts` | Auditoría de pagos | Tercera copia de la tarifa |
| `app/grandes-campanas/isdin/page.tsx` (`calc`) | `payment_total` de vinilos ISDIN | **Ignora `revisit_count`** (paga 1 sola visita fallida aunque haya 3); **suma el importe original en "Resuelto - Pendiente colocador"** (prohibido); cuarta copia de la tarifa (`FAILED=8.56`) |
| `lib/isdin-billing.ts` | Facturación a cliente ISDIN (tarifas de venta, no la tarifa 8,56 de instalador) | Dominio distinto (ingresos), pero también inventa fechas con fallbacks |

### Persistencia
- Sin backend: el navegador escribe directo en Supabase (anon key, sin RLS).
- `logistics-store.ts` carga TODO el estado, lo muta y reescribe TODAS las
  tablas (`upsert` masivo + delete/reinsert de líneas): pisadas de concurrencia.
- Fallback silencioso a `localStorage`/semilla cuando Supabase falla.
- Reservas de stock: leer-modificar-escribir en cliente (carrera entre dos usuarios).

### Comunicación OPS↔LOGS
- `integration_events` existe pero se procesa en memoria del cliente y se
  marca completado sin garantía transaccional. Espejos con 3 escrituras sueltas.

## 2. Plan por fases

| Fase | Contenido | Archivos/migraciones clave | Estado |
|---|---|---|---|
| **1** | **Motor único de dominio de pagos + pruebas** (este commit) | `lib/payments/{money,constants,types,engine}.ts`, `tests/payments-engine.test.ts`, vitest en OPS; consumidores usan la constante/motor único | ✅ |
| 2 | Ledger idempotente persistente: tabla `payment_obligations` (clave estable, `currency`, céntimos, estados `calculado→revisado→cerrado/anulado` con CHECK de transición y trigger anti-reapertura), ajustes/anulaciones enlazados | `supabase/v8_0_payment_obligations.sql`, `lib/payments/ledger.ts` | ✅ |
| 3 | Backend transaccional: importar CSV (previsualización + confirmación atómica en RPC, hash de archivo, huella por fila), recalcular obligaciones (`syncObligations`), revisar/cerrar (`changeObligationStatus`) | `supabase/v8_1_import_runs.sql`, `lib/payments/import.ts` | ✅ (UI de importación pendiente de conectar) |
| 4 | Comandos logísticos atómicos y concurrencia: funciones SQL con `FOR UPDATE`, columna `version` en `logistics_stock`, movimiento+saldo en la misma transacción; reservas de LOGS cableadas al RPC | `supabase/v8_2_logistics_commands.sql`, `merchanlogs/services/atomic-commands.ts` | ✅ (cierre/envío de picking y retirada del guardado en bloque: pendientes con pruebas de equivalencia) |
| 5 | Inbox/outbox durable entre apps: `outbox_events`/`inbox_processed` con idempotency key, intentos, backoff, dead-letter; consumo con claim seguro (SKIP LOCKED) | `supabase/v8_3_outbox.sql`, `lib/outbox.ts` | ✅ (handlers de consumo por conectar) |
| 6 | Modo degradado solo-lectura + sin mezcla de semilla con datos reales + migración RLS documentada SIN activar (credenciales por defecto ya eliminadas y contraseñas hasheadas en la fase de seguridad previa) | `supabase/v9_0_rls_prepared.sql` (NO aplicada), `lib/logistics-store.ts` | ✅ (migración a Supabase Auth: pendiente) |
| 7 | Conciliación histórica dry-run: detecta revisitas omitidas, "Resuelto" con original cobrado y divergencias de importe; `apply` reutiliza el RPC idempotente (solo crea lo faltante, jamás toca cerradas) | `lib/payments/reconcile.ts` | ✅ |

## 3. Reglas de negocio codificadas en el motor (fase 1)

- Tarifa única: `FAILED_VISIT_FEE_CENTS = 856` (8,56 €) en
  `lib/payments/constants.ts`. **Ningún otro fichero puede declararla.**
- Importes en **céntimos enteros**; redondeo **half-up** documentado en
  `lib/payments/money.ts`; importes no finitos/negativos → error de
  validación, jamás `0` silencioso.
- ISDIN: `Incidencia`/`Resuelto - Pendiente colocador` pagan SOLO
  `visitas_fallidas × 8,56` (sin importe original); `Finalizado` paga
  `original + visitas × 8,56`; `Incidencia llamada`/`Nuevo` pagan 0;
  `Cancelado` paga las visitas solo si hubo visita real
  (`incident_payment_week`). Normalización documentada: un estado de visita
  fallida implica al menos 1 visita aunque `revisit_count` esté a 0.
- Identidad estable de obligación (sin importe/fecha/estado en la clave):
  `isdin:<vin>:failed_visit:<n>`, `isdin:<vin>:installation`,
  `servicio:<id>:{points|hours}`, `gran_campana:<pointId>:{installation|failed_visit:<n>}`.
- Fecha de evento ausente → la obligación se genera **bloqueada**
  (`missing_event_date`), nunca se sustituye por `today()`.
- Servicios sin `validated_at` → no pagables (motivo explícito).

## 3b. Fase 2 — resultado (aplicada el 2026-07-10)

Migración `v8_0_payment_obligations` aplicada al proyecto compartido. Crea:

- `payment_obligations`: clave única estable, importes `bigint` en céntimos,
  `currency='EUR'` forzado por CHECK, `event_date` opcional (NULL bloquea:
  jamás fecha inventada), `period` generado, estados con transiciones
  vigiladas por trigger (`cerrado` inmutable salvo anulación con motivo;
  `anulado` intocable; DELETE prohibido; `version` autoincremental para
  control optimista), ajustes/anulaciones con `kind` propio, importes
  negativos SOLO en ajustes, y enlace obligatorio a la obligación original.
- `payment_obligations_audit`: inmutable (trigger bloquea UPDATE/DELETE),
  registra actor, acción, valor anterior/nuevo, motivo, correlation/event id.
- RPCs transaccionales: `sync_payment_obligations` (upsert idempotente que
  NUNCA toca líneas revisadas/cerradas: devuelve divergencias de
  conciliación), `change_payment_obligation_status` (transiciones + versión
  esperada → error claro de concurrencia) y `create_payment_adjustment`.

**Verificado EN VIVO contra la base real** (transacción revertida, sin
rastro): 2ª pasada idéntica = 0 inserciones; subir 2→3 visitas = 1 inserción
exacta; reabrir una cerrada → bloqueado; recalcular con otro importe sobre
cerrada → intacta + divergencia; DELETE → bloqueado; versión obsoleta →
conflicto de concurrencia; ajuste negativo enlazado → ok; anular sin motivo
→ bloqueado; auditoría con 6 entradas e inmutable.

Cliente TS: `lib/payments/ledger.ts` (solo RPCs, jamás escritura directa ni
estado completo; errores clasificados validation/concurrency/transient/
permanent; sin conexión → error transitorio, nunca "guardado" simulado).

## 3c. Fase 3 — resultado (aplicada el 2026-07-10)

Migración `v8_1_import_runs` aplicada. Crea `import_runs` (usuario, fecha,
archivo, hash SHA-256 con UNIQUE por origen, filas correctas/rechazadas,
errores, obligaciones creadas/actualizadas, divergencias, correlation id) e
`import_run_rows` (huella estable por fila = identidad natural, UNIQUE por
ejecución) — ambas INMUTABLES por trigger — y el RPC atómico
`confirm_import_run`: sincroniza el ledger y registra la ejecución EN LA
MISMA transacción.

**Verificado en vivo** (transacción revertida): confirmación ok; reimportar
el mismo hash → `duplicada` sin re-aplicar; un fallo intermedio (obligación
inválida en el lote) revierte TODO — cero runs y cero obligaciones parciales
(escenario 11); registro de importaciones inmutable.

Capa TS `lib/payments/import.ts`: previsualización sin tocar la base
(columnas obligatorias, estados del vocabulario, importes vía parser
estricto — inválido = fila rechazada, jamás 0; sin inventar nombres/fechas/
estados; VIN duplicado en archivo detectado; payload minimizado sin
teléfonos ni comentarios), huellas SHA-256 de archivo y de fila (identidad,
no importe), y confirmación vía RPC. Un Finalizado con importe queda
incluido en pagos conforme a las reglas (fechas ausentes → bloqueado).

Pendiente de fase 3: conectar la pantalla de importación ISDIN al nuevo
pipeline (hoy sigue el flujo legado en paralelo).

## 3d. Fase 4 — resultado (aplicada el 2026-07-10)

Migración `v8_2_logistics_commands` aplicada: columna `version` en
`logistics_stock` (trigger autoincremental) y seis comandos atómicos con
`SELECT … FOR UPDATE`: `logistics_reserve_stock` (valida cantidad finita
>0, disponibilidad y versión esperada; movimiento+saldo en la misma
transacción), `logistics_release_reservation`, `logistics_close_picking`
(prohíbe cerrar con líneas pendientes; descuenta lo preparado y libera
reservas), `logistics_ship_picking` (solo pickings preparados, un envío por
picking), `logistics_confirm_delivery` (update condicional: la segunda
confirmación falla) y `logistics_reject_request` (motivo obligatorio,
libera reservas y cierra pickings activos).

**Verificado en vivo** (transacción revertida): sobre-reserva bloqueada
(escenario 12: la serialización FOR UPDATE hace imposible el stock
negativo), cantidad 0 rechazada, conflicto de versión detectado, cierre con
pendientes bloqueado, envío prematuro bloqueado, cierre descuenta 10→6 y
libera reserva, doble entrega bloqueada, rechazo libera reserva y marca
rechazada (escenario 13).

Cableado en LOGS: `reserveStock`/`releaseReservation` usan los RPC en modo
Supabase (`merchanlogs/services/atomic-commands.ts`). Pendiente de fase 4:
migrar cierre/envío de picking de LOGS y el guardado en bloque de OPS a los
comandos (requiere pruebas de equivalencia del flujo completo).

## 3e. Fase 5 — resultado (aplicada el 2026-07-10)

Migración `v8_3_outbox` aplicada: `outbox_events` (event_id único, tipo,
versión de esquema, app origen, payload, estado, intentos/max, próximo
intento, último error, claimed_by, fechas) e `inbox_processed` (PK
event_id+consumer: efectivamente-una-vez por consumidor). RPCs:
`outbox_publish` (idempotente), `outbox_claim` (FOR UPDATE SKIP LOCKED —
sin doble reclamo entre consumidores), `outbox_complete` (inbox + estado en
la misma transacción; duplicado → alreadyProcessed) y `outbox_fail`
(backoff exponencial 30s·2^n, dead_letter al agotar intentos). Los comandos
de la fase 4 (envío, entrega, rechazo) publican su evento EN LA MISMA
transacción que el cambio de dominio.

**Verificado en vivo** (transacción revertida): publicación duplicada = 1
fila; claim marca procesando+intentos y un segundo consumidor no re-reclama;
complete escribe inbox y completa; evento repetido reconocido como duplicado
(escenario 14: no re-crea incidencias); backoff y dead-letter correctos;
el comando de dominio publica su evento en la misma transacción.

Cliente TS: `lib/outbox.ts` (`publishEvent`, `processOutbox` con validación
de tipo/versión/payload, duplicados contados, fallos a `outbox_fail`; jamás
completa antes de aplicar efectos; sin conexión → error, no simulación).
Pendiente: conectar los handlers concretos de cada app (espejos y
sincronizaciones actuales) al consumidor.

## 3f. Fases 6 y 7 — resultado (2026-07-10)

**Fase 6.** `saveLogisticsState` lanza error claro en modo degradado (Supabase
configurado pero caído): la app queda de SOLO LECTURA y jamás anuncia como
guardado lo que fue a localStorage (test escenario 15). La carga remota ya no
mezcla datos semilla con tablas reales vacías. `supabase/v9_0_rls_prepared.sql`
documenta la RLS por tabla, el orden de activación, el rollback y la
exposición actual — NO se aplica hasta migrar a Supabase Auth (las
credenciales por defecto y las contraseñas en claro se eliminaron en la fase
de seguridad previa: hashing scrypt + rate limiting).

**Fase 7.** `lib/payments/reconcile.ts`: informe dry-run que compara el
ledger con el motor (revisitas omitidas, "Resuelto" con original cobrado,
divergencias sobre cerradas → ajuste/anulación, nunca edición) y `apply` vía
`sync_payment_obligations` (solo crea lo faltante). **Dry-run EN VIVO sobre
los 471 vinilos reales**: 43 obligaciones de visita fallida esperadas
(368,08 € a 8,56 €), 447 instalaciones esperadas, ledger aún vacío (la
población inicial es exactamente lo que creará `apply`), 3 "Resuelto -
Pendiente colocador" activos vigilados, 0 con revisit_count>1 declarado —
coherente con el bug corregido (nadie incrementaba el contador).

## 3g. Validación post-revisión (2026-07-10): guardado en bloque — RESUELTO (2026-07-11)

**Resolución C2 (2026-07-11):** `saveLogisticsState` está RETIRADO — la función
lanza error siempre (test) y ninguna ruta de producción la invoca. Las 7 rutas
del inventario quedaron así:
- `app/page.tsx requestMaterial` → rpc `create_logistics_request_service` (v8_7,
  transaccional, idempotente, verificado en vivo).
- `app/page.tsx updateService` (cambio de instalador) → rpc `sync_logistics_installer`.
- `app/grandes-campanas/[id]` (material de campaña) → rpc `create_logistics_request_campaign`.
- `isdin/page.tsx` y `isdin/llamadas` → rpc `sync_isdin_vinyl_requests` (lote,
  idempotente por versión) + rpc `create_logistics_incident_ops`.
- `logistics-client.tsx` y `solicitudes-logistica-client.tsx` → el módulo
  Logística de OPS es de **SOLO CONSULTA** (decisión de producto del usuario):
  los botones de acción abren la pantalla equivalente de MerchanLOGS
  (`NEXT_PUBLIC_MERCHANLOGS_URL`), que opera con los comandos atómicos de v8_2.
Con esto desaparece el escenario de pisada OPS↔LOGS: solo hay UN escritor por
operación y cada comando es una transacción.

Inventario original del hallazgo (histórico):

El revisor exigió comprobar qué rutas de producción siguen invocando
`saveLogisticsState` (reescritura del agregado completo en múltiples tablas).
Inventario verificado por grep — **7 rutas de producción siguen usando el
mecanismo antiguo**, por lo que el hallazgo de concurrencia NO puede darse
por resuelto aunque exista la alternativa atómica:

| Ruta de producción | Uso |
|---|---|
| `app/logistica/logistics-client.tsx:68` | **Toda acción del módulo Logística de OPS** (mutación genérica load→mutate→save). La más crítica: reescribe todas las tablas en cada acción |
| `app/logistica/solicitudes/solicitudes-logistica-client.tsx:67` | Gestión de solicitudes (aceptar/reservar) |
| `app/page.tsx` `requestMaterial` | Botón "Solicitar material" de Servicios |
| `app/page.tsx` `updateService` | Cambio de instalador (sync a logística) |
| `app/grandes-campanas/[id]/page.tsx:276` | Solicitud de material de campaña |
| `app/grandes-campanas/isdin/page.tsx` `syncLogisticsVinyls` | Auto-sync de vinilos ISDIN |
| `app/grandes-campanas/isdin/llamadas/page.tsx:129` | Sync de llamadas |

Mitigaciones vigentes que ACOTAN (no eliminan) el riesgo: cada ruta recarga
el estado justo antes de guardar (ventana de milisegundos); las reservas de
stock de LOGS ya van por RPC atómico; el modo degradado impide el fallback
silencioso; los movimientos usan insert-only. El riesgo residual real es la
pisada de líneas de picking/petición si un usuario de LOGS escribe entre la
carga y el guardado de OPS.

Plan de retirada (siguiente iteración, con pruebas de equivalencia):
1. `logistics-client.tsx` y `solicitudes-logistica-client.tsx`: sustituir la
   mutación genérica por comandos específicos (aceptar+reservar ya existe
   como `logistics_reserve_stock`; faltan RPC para el resto de acciones).
2. `requestMaterial`/campañas/ISDIN: crear RPC `create_logistics_request`
   (necesidad+petición+líneas en una transacción) y publicar el evento
   outbox en la misma.
3. Retirar `saveLogisticsState` y dejar `loadLogisticsState` solo-lectura.

## 3h. Segunda revisión externa (2026-07-10): estado de los 11 hallazgos

| # | Hallazgo | Estado |
|---|---|---|
| C1 | Autenticación eludible (rol en localStorage, hashes al navegador, LOGS arranca admin) | 🟢 RESUELTO (código; queda 1 paso operativo): (1) login REAL con Supabase Auth en OPS y LOGS manteniendo usuarios/contraseñas de app_users — rpc `merchan_auth_bootstrap` verifica PBKDF2 EN EL SERVIDOR (implementación SQL validada contra un vector WebCrypto), crea/sincroniza el usuario en auth.users (confirmado, con identidad email, bcrypt verificado en vivo) y aplica rate limiting DE SERVIDOR (5 fallos/15 min, persistente); (2) el navegador ya NO descarga hashes en ninguna de las dos apps (perfil vía `merchan_auth_whoami` sin password; selects con columnas explícitas); (3) LOGS exige login (pantalla propia; sin selector de usuario en modo supabase) y OPS invalida la sesión local si no hay JWT detrás; (4) migración v9_1 APLICADA y verificada en vivo (5 escenarios, transacción revertida). (5) v9_2 APLICADA (2026-07-11, tras confirmar el usuario el login en producción): RLS activa en 47/47 tablas con política solo-autenticados + revocación total de privilegios de anon sobre tablas/vistas/secuencias (incl. default privileges); verificado en vivo que anon no lee nada y authenticated opera. La anon key sin sesión ya NO puede leer ni escribir. Refinado por rol/provincia: fase futura |
| C2 | Guardado logístico global activo (7 rutas) | ✅ RESUELTO (2026-07-11): `saveLogisticsState` retirado (lanza error, test); las peticiones de material de Servicios/Campañas/ISDIN usan los comandos transaccionales de v8_7 (verificados en vivo con rollback: idempotencia, agrupación por campaña, cambio de instalador con avisos, vinilos por versión, incidencias con pendiente de llegada); el módulo Logística de OPS pasa a SOLO CONSULTA con enlaces a MerchanLOGS (decisión del usuario). Detalle en §3g |
| C3 | Historial económico sigue en payment-ledger legado / dos registros paralelos | 🟢 RESUELTO (núcleo): el Historial económico calcula sus líneas con el MOTOR ÚNICO (`lib/payments/lines.ts`): fingerprint = clave estable de obligación (sin fecha/importe → una corrección actualiza el mismo evento en vez de crear uno paralelo), fechas ausentes bloquean con issue visible, importes inválidos bloquean. Builders legados congelados @deprecated sin consumidores. Nota: `economic_events` sigue existiendo como tabla del Historial; ahora se alimenta del mismo motor que el ledger, eliminando la divergencia de cálculo. La unificación física de ambas tablas queda como mejora futura |
| A4 | Bajar revisit_count no generaba divergencia | ✅ RESUELTO: `sync_payment_obligations` acepta ámbito y devuelve `missing_in_recalc` (v8_4, verificado en vivo); la conciliación también detecta sobrantes (`obsolete_obligation`, test) |
| A5 | Importación transaccional sin conectar a UI | ✅ RESUELTO (2026-07-11): la carga masiva ISDIN es un flujo en DOS pasos — 1) validar (previewIsdinImport: filas rechazadas con motivo visible, importes inválidos jamás 0, duplicados de VIN detectados) y 2) confirmar — que mantiene el upsert descriptivo idempotente de vinilos (los estados existentes se conservan) y registra la importación con `confirm_import_run` (archivo + hash SHA-256 + huella por fila; reimportar el mismo archivo devuelve 'duplicada' sin re-aplicar), sincronizando EN LA MISMA transacción las obligaciones de los VIN NUEVOS con el ledger. Las obligaciones de vinilos existentes no salen del archivo: las gobierna la conciliación desde la base (A4) |
| A6 | Outbox sin consumidores, sin lease, efectos antes de inbox | ✅ RESUELTO (v8_4 + v8_6, APLICADAS y verificadas en vivo): lease vencido recuperable; publicación por TRIGGER (misma transacción que el dato: peticiones creadas/rechazadas, envíos, incidencias, stock bajo mínimo con event_id determinista) y consumidor 'db-notifier' en pg_cron cada minuto que genera logistics_notifications idempotentes — efectos + inbox + completado en UNA transacción (exactamente-una-vez real, sin depender de navegadores abiertos). Tipos desconocidos van a reintentos/dead-letter visibles. Verificado: sin duplicados al reprocesar ni al cruzar el mínimo dos veces; cron.job_run_details 'succeeded'. El cliente TS processOutbox queda para futuros consumidores de app (handlers idempotentes obligatorios, documentado) |
| A7 | Facturación ISDIN: UI optimista, errores ignorados, borrado físico de regularizaciones | ✅ RESUELTO: (1) toda escritura comprueba `error`/fila devuelta antes de anunciar éxito; fallo ⇒ mensaje rojo persistente y reversión en pantalla (tarifas, edición VIN, regularizaciones); (2) desaparece el borrado físico: anulación con motivo obligatorio, irreversible, excluida de totales/exports/historial económico (test); (3) migración v8_5 (APLICADA y verificada en vivo con transacción revertida): trigger prohíbe DELETE y mutar campos económicos de regularizaciones, y auditoría inmutable `isdin_billing_audit` por triggers — tarifas (actor `updated_by`), regularizaciones (crear/anular, actor `created_by`/`annulled_by`) y edición de columnas de facturación de vinilos (diff de columnas) |
| A8 | LOGS: cierre/envío/entrega multi-operación en cliente | ✅ RESUELTO (2026-07-11): v8_8 APLICADA — logistics_close_picking acepta el flujo LOGS (estado 'preparado') con idempotencia dura via cerrado_at (segundo cierre rechazado, stock intacto; verificado en vivo con líneas listas+faltantes: física y reservas exactas, envío no duplicable, entrega una sola vez). LOGS: closePickingBatch delega TODO el efecto de stock en el RPC (sin releaseReservation/applyStockDelta en cliente = sin doble descuento), createShipmentFromPicking usa logistics_ship_picking (sin envío paralelo) y la entrega usa logistics_confirm_delivery. Efectos de dominio sin stock (piezas unitarias, campos del envío) siguen en el servicio. Pruebas de equivalencia en LOGS (tests/atomic-close-ship.test.ts): en modo atómico el cliente NO muta stock y no crea envíos paralelos; el modo local conserva el flujo anterior (suite previa). 43/43 |
| A9 | LOGS arranca en modo local sin advertencia | ✅ RESUELTO: banner rojo bloqueante permanente cuando NEXT_PUBLIC_DATA_SOURCE ≠ supabase |
| M10 | Motor silencia importes inválidos en puntos | ✅ RESUELTO: blockedReasons de cada punto se propagan a la obligación (bloqueada, no pagable) + tests |
| M11 | Payloads completos a sync_logs | ✅ RESUELTO: `redactLogPayload` en domain-events (teléfonos, direcciones, comentarios → redactados; arrays resumidos) |

Verificación tras los fixes: OPS 44/44, LOGS 40/40, lint y build en verde en ambos; A4/A6 verificados en vivo contra la base real (transacción revertida).

## 4. Riesgos abiertos

- ~~Escrituras con anon key sin identidad~~ → RESUELTO: Supabase Auth + RLS activa (v9_1/v9_2).
- ~~Guardado en bloque de logística~~ → RESUELTO: retirado (C2, v8_7 + OPS Logística solo consulta).
- ~~Fallback local silencioso~~ → RESUELTO: modo degradado + retirada del guardado en bloque.
- Refinado de RLS por rol/provincia pendiente (hoy: cualquier usuario autenticado accede a todas las tablas).
- Los 11 hallazgos de la segunda revisión están CERRADOS (2026-07-11).

La tarifa por visita fallida **sigue siendo 8,56 €** en todo el sistema.
