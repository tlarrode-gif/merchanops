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

**La próxima migración empieza en `v10_2`.** No reutilices `v9_*`.

## `v9_11b` y `v9_11c` sin fichero

Se aplicaron directamente sobre la base durante la sesión y nunca se
escribieron como fichero. Su efecto está en producción y es el que describe el
propio nombre: dejar visibles las campañas para el rol `almacen` y limitar ese
escape. Si hace falta reconstruirlas, el contenido se puede recuperar del
registro de migraciones del proyecto.
