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
| 3 | Backend transaccional (Route Handlers/Server Actions + funciones SQL `SECURITY DEFINER`): importar CSV (staging+confirm en transacción, hash de archivo, huella por fila), recalcular obligaciones, revisar/cerrar periodo | `app/api/payments/*`, `supabase/v8_1_import_runs.sql` | pendiente |
| 4 | Comandos logísticos atómicos y concurrencia: funciones SQL (`reserve_stock`, `release_reservation`, `close_picking`, `create_shipment`…) con `SELECT … FOR UPDATE`, columna `version`, movimiento+saldo en la misma transacción; retirar el guardado en bloque | `supabase/v8_2_logistics_commands.sql`, cambios en `logistics-store` y adapter LOGS | pendiente |
| 5 | Inbox/outbox durable entre apps: `outbox_events`/`inbox_processed` con idempotency key, intentos, backoff, dead-letter; consumo con claim seguro | `supabase/v8_3_outbox.sql` | pendiente |
| 6 | Autenticación real (Supabase Auth) + migración RLS documentada SIN activar; modo degradado solo-lectura al fallar Supabase | `supabase/v9_0_rls_prepared.sql` (no aplicada) | pendiente |
| 7 | Conciliación histórica: herramienta dry-run que detecta revisitas omitidas, "Resuelto" con importe original cobrado, finalizados con 1 sola visita; crea SOLO las obligaciones faltantes con trazabilidad | `scripts/reconcile-payments.ts` | pendiente |

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

## 4. Riesgos abiertos (hasta completar fases 2-7)

- Las escrituras siguen saliendo del navegador con anon key y sin RLS.
- El ledger persistente aún usa fingerprints inestables (fase 2 lo sustituye).
- El guardado en bloque de logística sigue vigente (fase 4).
- El fallback local silencioso sigue activo (fase 6).

La tarifa por visita fallida **sigue siendo 8,56 €** en todo el sistema.
