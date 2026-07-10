# Auditoría de comunicación bidireccional MerchanOPS ↔ MerchanLOGS

Fecha: 2026-07-10 · Alcance: los 3 grupos de material de OPS (Servicios,
Grandes Campañas, ISDIN) y el retorno de estado logístico desde LOGS.

## Arquitectura de la integración

Ambas apps comparten el mismo proyecto Supabase. El "pegamento" es la tabla
`logistics_material_requirements` (necesidades de material): cada origen
(servicio, punto de campaña, vinilo ISDIN) genera una necesidad con
`source_type`/`source_id`, y las necesidades se agrupan en peticiones
(`logistics_requests`) que LOGS gestiona (picking → envío → entrega).

```
Servicios ───┐                                        ┌── tarjetas Servicios
Campañas  ───┼→ necesidades → peticiones → LOGS ──────┼── píldoras ISDIN
ISDIN     ───┘   (requirements)  (requests)  (espejo) └── píldoras Campañas
```

## Resultado de la auditoría por grupo

| Grupo | OPS → LOGS (pedir material) | LOGS → OPS (estado de vuelta) |
|---|---|---|
| **Servicios** | ✅ Botón "Solicitar material" (evento idempotente) | ✅ espejo en `services.logistics_*` |
| **ISDIN** | ✅ Sincronización automática por vinilo | ✅ espejo en `isdin_vinyls.logistics_*` |
| **Grandes Campañas** | ❌ **No existía** → **implementado en esta auditoría** | ❌ → ✅ píldora por punto (implementado) |

## Fallas detectadas y su resolución

1. **Grandes Campañas sin petición de material** (crítica, resuelta).
   Existía el puente de cierre (`syncPuntoCompletadoConLogistica` consume la
   necesidad al completar un punto) pero nada la creaba. Implementado:
   - `createCampaignLogisticsRequest` (lib/logistics-sync.ts): crea una
     necesidad por punto (`source_type: "campaign"`, `source_id` = punto, de
     modo que el puente de cierre existente funciona sin cambios) y agrupa
     todas las líneas en UNA petición logística. Idempotente.
   - UI en el detalle de campaña: botón por punto (panel expandido) + botón
     masivo "Solicitar material (N sin petición)". **El masivo respeta el
     ámbito del gestor**: opera sobre `puntos` ya filtrados por
     `filterPuntosBySession`, así que cada gestor solo pide material de sus
     puntos. Mini-formulario editable (material, cantidad por punto, notas).
   - Visibilidad: píldora "Logística: <estado>" por punto, enlazada a la
     solicitud, y "Ver petición logística" cuando ya existe.

2. **El estado logístico volvía a OPS con retraso** (media, resuelta).
   Las columnas-espejo (`services.logistics_*`, `isdin_vinyls.logistics_*`) y
   las necesidades solo se refrescaban cuando alguien guardaba algo en el
   módulo de logística de OPS. Ahora **LOGS actualiza el espejo al instante**
   (`services/ops-mirror.ts` en MerchanLOGS) cuando cambia el estado de una
   petición, crea un picking o un envío:
   - Actualiza `logistics_material_requirements` (status/picking_id/
     shipment_id; jamás reabre necesidades `consumida`/`cancelada`).
   - Actualiza SOLO columnas de lista blanca en `services` e `isdin_vinyls`
     (estado, material_status, ids de picking/envío, blocked, last_sync_at).
     Los datos maestros siguen siendo intocables; hay tests que fijan las
     listas blancas y el vocabulario contra los CHECK reales del DB.
   - Best-effort: un fallo del espejo no rompe la operación de LOGS; el
     reverse-sync de OPS lo corrige en su siguiente pasada (son idempotentes
     entre sí porque escriben los mismos valores derivados).

3. **Riesgo de pisado por guardado en bloque de OPS** (baja, documentada).
   `saveLogisticsState` de OPS reescribe el estado completo (borra y reinserta
   líneas). Si un usuario de OPS mantiene datos viejos cargados mientras LOGS
   escribe, el guardado de OPS puede pisar ese cambio. Mitigado en la práctica
   porque cada flujo de OPS recarga justo antes de guardar (ventana de
   milisegundos) y porque el espejo de LOGS re-alinea las necesidades. La
   solución definitiva (escrituras por fila en OPS) queda como mejora futura si
   el equipo crece.

## Invariantes que protegen la integración (con tests)

- LOGS jamás escribe datos maestros (clients/campañas/services/usuarios);
  el espejo solo toca columnas `logistics_*`/`material_status` de lista blanca.
- Todo vocabulario escrito respeta los CHECK constraints reales del DB
  (tests en `merchanlogs/tests/supabase-adapter.test.ts` y `tests/ops-mirror.test.ts`).
- Los ids los genera la base; los movimientos de stock son inmutables;
  `reset()` de LOGS está bloqueado para siempre.
- La petición de campaña es idempotente (evento + upsert de necesidades):
  repetir el clic no duplica.

## Cómo probar el flujo completo (Grandes Campañas)

1. Abre una campaña → pestaña Puntos → botón "Solicitar material (N sin
   petición)" (o expande un punto → "Solicitar material").
2. Ajusta material/cantidad/notas → Enviar. Aparece el código LOG-2026-XXXX.
3. La petición es visible en OPS → Logística → Solicitudes y en MerchanLOGS →
   Peticiones. Cada punto muestra su píldora "Logística: …".
4. Al avanzarla en LOGS (preparar picking, enviar), la píldora del punto y las
   tarjetas de OPS se actualizan al momento.
5. Al marcar el punto como "completado" en la campaña, su necesidad se cierra
   automáticamente (puente existente, ahora con datos que cerrar).
