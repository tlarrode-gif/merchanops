# Plan detallado — P-13, Ola 3 y Ola 4

*29 de julio de 2026. Continuación de `AUDITORIA_TECNICA_2026-07-29.md`.*
*Todo lo que sigue está medido contra el repo y la base de producción, no estimado.*

---

## P-13 — El flujo de aprobación de pagos

### Qué hay y qué falta

El ledger **calcula** correctamente lo que se debe. Lo que no existe es el paso
de «calculado» a «pagado». Inventario real:

| Pieza | Dónde | Estado |
|---|---|---|
| Máquina de estados | `lib/payments/types.ts:16` | ✅ definida |
| Tabla `payment_obligations` + `payment_obligations_audit` | base | ✅ con triggers de inmutabilidad |
| RPC `change_payment_obligation_status` | base | ✅ con `p_expected_version` (bloqueo optimista) |
| RPC `create_payment_adjustment` | base | ✅ |
| `changeObligationStatus()` | `lib/payments/ledger.ts:92` | ⚠️ **0 llamadas** |
| `createAdjustment()` | `lib/payments/ledger.ts` | ⚠️ **0 llamadas** |
| Pantalla que liste y apruebe | — | ❌ **no existe** |

```
calculado ──> revisado ──> cerrado
    │            │            │
    └────────────┴────────────┴──> anulado
                 └──> calculado (devolver a revisión)
```

`cerrado` nunca vuelve a `calculado`: las correcciones van por ajuste o
anulación con motivo. Eso ya está impuesto en `OBLIGATION_TRANSITIONS` y en los
triggers, así que **la parte difícil e irreversible ya está hecha**. Falta la UI.

### Situación actual

**502 obligaciones, el 100 % en `calculado`.** Nunca se ha aprobado ni pagado
nada por sistema. Si los pagos se están haciendo (y se están haciendo: hay
instaladores cobrando), se hacen **fuera de MerchanOps**, probablemente en hoja
de cálculo. El ledger es hoy un cálculo que nadie consume.

Eso explica también por qué A-06 pasó desapercibido 18 días: nadie mira esta
tabla, porque no hay pantalla que la muestre.

### Qué habría que construir

Una pantalla `/pagos/obligaciones` con:

1. **Listado filtrable** por semana de pago, instalador, origen, estado e importe.
   Ya existe `listObligations()` en `lib/payments/ledger.ts`, sin usar.
2. **Selección múltiple** y transición en lote (`calculado → revisado`), que es
   el gesto real: «he revisado la semana 30 de Sara, adelante».
3. **Cierre** (`revisado → cerrado`) como acto contable explícito, con el actor
   registrado. Aquí es donde entra la decisión de negocio de abajo.
4. **Anulación con motivo obligatorio** y **ajustes** vía `createAdjustment()`,
   nunca edición directa del importe.
5. **Totales por instalador y semana**, que es como se paga en la práctica.

El bloqueo optimista ya está: `change_payment_obligation_status` acepta
`p_expected_version`, así que dos gestores tocando la misma línea no se pisan.
La UI solo tiene que propagar el `version` que leyó.

### Las decisiones que no me corresponden

1. **¿Un gestor puede aprobar los pagos de su propia zona?** Coherente con lo
   que ya decidiste para el volcado («son responsables de sus zonas y deben
   validar sus propios pagos») sería que sí hasta `revisado`. Pero *aprobar tu
   propio trabajo* y *cerrarlo contablemente* son cosas distintas.
2. **¿Hace falta segregación de funciones?** Lo habitual: el gestor revisa, y
   administración cierra. Con la RLS actual esto se expresa sin esfuerzo —
   `revisado` con `merchan_has_perm('pagos')`, `cerrado` con `merchan_is_admin()`.
3. **¿Qué produce el cierre?** ¿Solo marca la línea, o genera remesa / fichero
   para la gestoría? Esto cambia el alcance por completo.

**Esfuerzo:** la pantalla en sí, 2-3 días. La decisión 3 puede multiplicarlo.
**Riesgo de no hacerlo:** el ledger seguirá siendo un cálculo paralelo que nadie
concilia con lo que realmente se paga, y cada A-06 futuro tardará semanas en
verse.

---

## Ola 3

### M-03 — La lógica de importes, por triplicado (ya no cuádruple)

Con `lib/payment-audit.ts` eliminado quedan **tres** implementaciones vivas del
mismo cálculo, y **no son equivalentes**:

| | `app/page.tsx:35-45` | `lib/payment-ledger.ts` | `lib/payments/engine.ts` |
|---|---|---|---|
| Consumidor | Pestaña **Pagos** y Panel | *(auxiliar de `lines.ts`)* | **/historial-económico** e ISDIN |
| Unidad | **euros, coma flotante** | **euros, coma flotante** | **céntimos, enteros** |
| Dato ausente | `Number(x\|\|0)` → **0 silencioso** | ídem | **bloquea** (`centsOrBlock`) |
| Reporta problemas | no | no | sí (`EngineIssue`) |
| Estado del punto | `point_status \|\| status \|\| "Pendiente"` | `point_status` | `pointStatus` (lo fija el mapper) |

Tres divergencias con consecuencias reales:

1. **Euros en coma flotante contra céntimos enteros.** `pOriginal(p) + inc` suma
   floats; el motor suma enteros. En importes con decimales (8,56 € es la tarifa
   estándar) los totales pueden separarse por céntimos, y esos céntimos aparecen
   en un CSV que alguien cuadra a mano.
2. **El 0 silencioso.** `app/page.tsx` convierte un importe ausente en 0 y lo
   suma al total como si fuera un dato. El motor se niega y marca la obligación
   como bloqueada. Es decir: **la pestaña Pagos puede mostrar un total que el
   ledger considera impagable**, sin que nada avise.
3. **Columna de origen distinta.** `pStatus()` cae a la columna legada `status`
   cuando `point_status` está vacío; el motor solo mira `pointStatus`. Para filas
   antiguas los dos pueden clasificar el mismo punto de forma diferente.

**Esto no es teórico:** hoy `/historial-económico` y la pestaña Pagos calculan el
importe de un servicio con dos implementaciones distintas. Que coincidan es
suerte, no diseño.

**Plan de consolidación**
1. Extraer un `serviceTotalEur(service, points)` que envuelva
   `computeServiceObligations` y devuelva euros para presentación.
2. Sustituir en `app/page.tsx` `pPay`/`pointTotal`/`serviceTotal` por esa
   función. **Antes y después: exportar el CSV de Pagos del mismo periodo y
   comparar línea a línea.** Cualquier diferencia es un bug que ya existía.
3. Retirar de `lib/payment-ledger.ts` lo que quede duplicado.
4. Los 51 tests cubren el motor; la red de seguridad ya está puesta.

**Esfuerzo:** M. **Riesgo:** medio — cambia cifras visibles, y esa es
precisamente la razón para hacerlo con la comparación del paso 2.

### M-07 — `strict: false`

**Medido, y el resultado es contraintuitivo.** Sin caché incremental:

| Configuración | Errores |
|---|---|
| `strict: false` *(hoy)* | 0 |
| **`strict: true`** | **1** |
| `strictNullChecks: true` solo | 0 |
| `noImplicitAny: true` solo | 34 |

El único error de `strict: true` es:

```
app/page.tsx(142,825): error TS7053: Element implicitly has an 'any' type
because expression of type 'any' can't be used to index type
'Record<AppPermissionKey, boolean>'.
```

Es el `togglePermission(key:any)` de `UserEditor`: basta tipar el parámetro como
`AppPermissionKey` en vez de `any`.

Los 34 de `noImplicitAny` en solitario son en su mayoría de `tests/` (20 de 34)
y de tipo TS7011/TS7018 — anotaciones de retorno que la inferencia **sí** resuelve
cuando `strictNullChecks` está activo. De ahí la paradoja: **ir directo a
`strict: true` sale más barato que ir flag a flag.**

> Recomiendo verificarlo de nuevo al implementarlo. El resultado es lo bastante
> raro como para no fiarse de una sola medición, aunque la he repetido dos veces
> sin caché.

**Plan:** cambiar `"strict": false` → `true`, tipar ese parámetro, `tsc`, tests,
build. **Esfuerzo: S** (yo estimé «L» en el informe; me equivoqué por no medirlo).

Aparte, `target: "es5"` infla el bundle sin motivo — Next 14 no soporta
navegadores que lo necesiten. Subir a `es2020` es un cambio de una línea.

---

## Ola 4 — El ámbito de lectura de logística, de cara a MerchanLOGS

### El problema

Las 20 tablas de logística tienen `SELECT` con `merchan_has_profile()`: **basta
tener perfil para leerlo todo**. Sin provincia, sin campaña, sin nada. Hoy es
tolerable porque solo hay una aplicación y ocho usuarios; con MerchanLOGS
atacando la misma base deja de serlo.

### Por qué no es un `find & replace`

Medido sobre el esquema: **solo 2 de las 20 tablas tienen columna de provincia.**

| Grupo | Tablas | Cómo se acota |
|---|---|---|
| **A — Directamente acotables** (2) | `logistics_requests`, `logistics_material_requirements` | Tienen `province`. Mismo patrón que `services`. |
| **B — Acotables por cadena** (9) | `logistics_entries`, `logistics_entry_lines`, `logistics_incidents`, `logistics_pending_arrivals`, `logistics_picking_lines`, `logistics_pickings`, `logistics_request_lines`, `logistics_shipments`, `logistics_vins` | Vía `campana_id`, `vin_id`, `installer_id` o `request_id`. Requiere `EXISTS` con join. |
| **C — Globales por naturaleza** (9) | `logistics_materials`, `logistics_stock`, `logistics_stock_movements`, `logistics_notifications`, `logistics_audit_log`, `sync_logs`, `integration_events`, `outbox_events`, `inbox_processed` | **Acotarlas por provincia no tiene sentido.** El catálogo de materiales y el stock del almacén central son únicos. |

Ese reparto es el hallazgo de fondo: **el modelo logístico es de almacén, no de
territorio**. Forzar una provincia donde no la hay produciría o bien tablas
inservibles o bien `EXISTS` en cascada que destrozan el rendimiento.

### Propuesta

**Grupo A** — replicar el patrón de `services`, ya probado:
```sql
merchan_is_admin() OR merchan_is_almacen()
  OR (merchan_has_profile()
      AND merchan_norm_province(province) = ANY(merchan_province_scope()::text[]))
```

**Grupo B** — acotar por el padre, con `EXISTS` explícito (no confiar en la RLS
anidada, misma cautela que en `v9_8`). Ejemplo para `logistics_picking_lines`:
```sql
merchan_is_admin() OR merchan_is_almacen()
  OR EXISTS (SELECT 1 FROM logistics_pickings p
             WHERE p.id = logistics_picking_lines.picking_id
               AND <predicado del grupo A o B sobre p>)
```
Requiere índice en cada FK usada. Verificar el plan con `EXPLAIN` antes y después.

**Grupo C** — **dejarlas como están**, pero cambiando el gate de
`merchan_has_profile()` a `merchan_can_logistics()` también en lectura. Hoy
cualquier gestor lee el log de auditoría del almacén aunque no tenga el módulo
de logística. No es territorial: es de módulo.

**El rol `almacen` atraviesa todo.** Ya existe (`merchan_is_almacen()`, 1 usuario
real) y por definición no tiene provincias: opera el almacén central. Debe ver
todo el grupo B y C. Eso ya está contemplado arriba.

### La pregunta que ordena la Ola 4

**¿Con qué identidad entra MerchanLOGS?**

- **Como `authenticated` con usuarios de `app_users` (rol `almacen`)** — es lo
  que sugiere el estado actual: el rol existe, `merchan_is_almacen()` existe,
  hay un usuario real, y `grandes_campanas` ya tiene una rama explícita para él.
  Con esto, lo de arriba es suficiente y **no hace falta nada más**.
- **Como `service_role`** — se salta la RLS entera. Entonces toda esta Ola es
  irrelevante para LOGS pero **imprescindible** para OPS, porque el riesgo pasa
  a ser que un bug de LOGS escriba donde no debe sin ninguna red.

Mi recomendación es la primera: mantener una sola identidad y una sola frontera
de seguridad. El coste de la segunda es que la RLS deja de ser la frontera y
pasas a confiar en el código de dos aplicaciones.

### Orden sugerido

1. Decidir la identidad de MerchanLOGS. **Bloquea todo lo demás.**
2. Grupo C (cambio de gate) — barato, sin joins, efecto inmediato.
3. Grupo A — patrón conocido.
4. Grupo B — el trabajo real; índices y `EXPLAIN` obligatorios.
5. Probar con un JWT de cada rol (`admin`, `manager`, `almacen`) que cada uno ve
   exactamente lo que debe. La simulación gestor a gestor que hice para C-01
   sirve de plantilla.

**Esfuerzo:** L. **Riesgo:** alto si se hace a ciegas, bajo si cada policy se
verifica antes de aplicarla contra los datos reales, como en `v9_8`.
