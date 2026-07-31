# Orden real de las migraciones

El orden que manda es el **registro de la base** (`supabase_migrations.schema_migrations`),
que va por marca de tiempo. Los nombres de fichero son etiquetas, no el orden.

## Aviso: `v9_8` y `v9_9` existen DOS VECES

El 29 de julio de 2026 dos sesiones trabajaron en paralelo sobre el mismo
proyecto y ambas numeraron a partir de `v9_8`. Las cuatro migraciones están
aplicadas y **el nombre de cada fichero coincide con el del registro**, así que
no se han renombrado: hacerlo rompería esa correspondencia.

| Aplicada | Nombre en el registro | Fichero |
|---|---|---|
| 06:59 | `v9_8_rls_initplan_performance` | `v9_8_rls_initplan_performance.sql` |
| 07:22 | `v9_9_security_hardening` | `v9_9_security_hardening.sql` |
| 07:24 | `v9_10_lock_rpc_surface` | `v9_10_lock_rpc_surface.sql` |
| 07:39 | `v9_11_rls_scope_by_province` | `v9_11_rls_scope_by_province.sql` |
| 07:40 | `v9_11b_campanas_visibles_para_almacen` | **sin fichero** (ver abajo) |
| 07:40 | `v9_11c_campanas_solo_escape_almacen` | **sin fichero** (ver abajo) |
| 09:17 | `v9_8_rls_points_via_service` | `v9_8_rls_points_via_service.sql` |
| 11:02 | `v9_9_ola4_almacen_y_gate_logistica` | `v9_9_ola4_almacen_y_gate_logistica.sql` |
| 11:04 | `v10_0_outbox_tipos_ajenos` | `v10_0_outbox_tipos_ajenos.sql` |
| 11:12 | `v10_1_outbox_multiconsumidor` | `v10_1_outbox_multiconsumidor.sql` |

**La próxima migración empieza en `v10_9`.** No reutilices `v9_*` ni `v10_2`–`v10_8`.

## Módulo de RR.HH. (`v10_4` – `v10_8`): PENDIENTES DE APLICAR

Estas cinco **no están aplicadas** al proyecto `dptmswhwmqimijpfyndn`. Se
aplican **en este orden**, porque cada una depende de la anterior: `v10_5`
necesita `merchan_is_rrhh()` de `v10_4`, `v10_7` necesita la tabla `cadenas` de
`v10_5` y el contador de códigos de `v10_6`, y `v10_8` arregla el consumidor del
outbox para los eventos que publican `v10_6` y `v10_7`.

| Fichero | Qué hace |
|---|---|
| `v10_4_rol_rrhh.sql` | El rol `rrhh` entra en el CHECK de `app_users`. Helpers `merchan_is_rrhh()` (el ROL, quien tramita) y `merchan_can_rrhh()` (la puerta del módulo, que **incluye a todas las gestoras**). Rama de lectura para el perfil de RR.HH. en `workers`, `services`, `points`, `grandes_campanas` y `puntos_venta_campana`, que si no vería cero filas por no tener provincias. `workers.a3_empleado_codigo`. |
| `v10_5_rrhh_catalogo.sql` | Catálogo `cadenas` (modo de trámite y plazo) y `centros`. Lectura para cualquier perfil, escritura solo admin o rol `rrhh`. `grandes_campanas.ceco` y `.horas_dia`; `puntos_venta_campana.centro_id`. Sin semilla. |
| `v10_6_rrhh_altas.sql` | `rrhh_altas`, `rrhh_solicitudes_alta`, `rrhh_solicitud_alta_lineas`, `rrhh_eventos` (append-only), `rrhh_code_counters` y `merchan_next_rrhh_code()`. RPC `merchan_rrhh_solicitar_alta`, `merchan_rrhh_resolver_alta` y `merchan_rrhh_registrar_alta`. Guardián de transiciones, motivo obligatorio en negativo y bloqueo optimista. |
| `v10_7_rrhh_accesos.sql` | `rrhh_solicitudes_acceso`. RPC `merchan_rrhh_solicitar_acceso` (expande según `cadenas.modo_tramite` y calcula `fecha_limite`) y `merchan_rrhh_resolver_acceso`. |
| `v10_8_rrhh_outbox_a3.sql` | `outbox_process_db_notifier` deja de mandar a dead-letter las familias `rrhh_alta.*` y `rrhh_acceso.*`. **No** registra `a3-adapter` en `outbox_consumers`: el adaptador no existe y registrarlo dejaría toda la cola pendiente para siempre (ver la cabecera del fichero). |

Cada fichero lleva en su cabecera el problema, la decisión, cómo verificarlo y
su ROLLBACK. Las cinco son idempotentes y se han validado ejecutándolas dos
veces seguidas sobre un PostgreSQL limpio con el esquema del proyecto.

## `v9_11b` y `v9_11c` sin fichero

Se aplicaron directamente sobre la base durante la sesión y nunca se
escribieron como fichero. Su efecto está en producción y es el que describe el
propio nombre: dejar visibles las campañas para el rol `almacen` y limitar ese
escape. Si hace falta reconstruirlas, el contenido se puede recuperar del
registro de migraciones del proyecto.
