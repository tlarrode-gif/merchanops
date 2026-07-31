# MerchanOps · Módulo de RR.HH. — decisiones y modelo

*31 de julio de 2026. Este documento registra decisiones ya tomadas, no propuestas.*
*Contrato de tipos: `lib/rrhh/tipos.ts`. Lógica pura: `lib/rrhh/altas.ts` y `lib/rrhh/accesos.ts`.*
*Migraciones: `supabase/v10_4_rol_rrhh.sql` (rol), `v10_5_rrhh_catalogo.sql` (cadenas y centros),*
*`v10_6_rrhh_altas.sql` (contador, traza, altas y solicitudes de alta), `v10_7_rrhh_accesos.sql` (accesos),*
*`v10_8_rrhh_outbox_a3.sql` (los eventos nuevos no rompen la cola del outbox).*

---

## 1. Por qué existe el módulo y quién lo usa

### 1.1 El problema

Cada trabajo que se asigna a un trabajador —un punto de gran campaña, un servicio—
necesita dos cosas antes de que alguien pise la calle: que el trabajador esté **de alta**
esos días, y que tenga **acceso concedido** al centro donde va a trabajar. Hoy las dos
cosas se piden por WhatsApp y por correo, y las dos fallan por el mismo motivo:

- **Altas.** Nadie sabe, mirando una pantalla, si el trabajador ya está de alta esos días.
  Se piden altas duplicadas (el trabajador ya estaba cubierto por el alta 18832) y se
  piden altas tarde (el alta empieza el 28 y el trabajo empezó el 25). El coste de una
  duplicada es una imputación mal hecha; el de una tardía es trabajo sin cobertura.
- **Accesos.** Cada cadena tiene sus reglas: Alcampo tramita centro a centro, Media Markt
  de una vez para toda la cadena, y todas tienen un plazo de antelación distinto. Ese
  conocimiento vive en la cabeza de dos personas. Cuando no están, se pide fuera de plazo.

El módulo existe para que **ninguna de las dos cosas se calcule de memoria**. La regla que
ordena todo el diseño está en su propia leyenda:

> **Texto gris = automático del sistema** · **A3 y Estado = lo rellena RR.HH.**

Todo lo que se puede deducir de los datos, lo deduce el sistema y lo enseña en gris antes
de que nadie pulse nada. Solo dos columnas se teclean: el número de A3 y el estado.

### 1.2 Quién lo usa

| Perfil | Rol técnico | Qué hace en el módulo |
|---|---|---|
| **RR.HH.** | `rrhh` (rol dedicado) | Tramita: teclea el número de A3, cambia estados, concede o deniega accesos, mantiene el catálogo de cadenas y centros. Ámbito **nacional**, sin provincias. |
| **Gestoras** | `manager` con permiso `rrhh` | Solicitan: marcan los trabajos que van juntos y pulsan «Tramitar»; eligen centros y pulsan «Solicitar». No tramitan nada. |
| **Administración** | `admin` | Todo lo de RR.HH., por definición del rol. |

La separación se expresa en dos helpers, y la diferencia entre ambos es la frontera de
seguridad del módulo entero:

- `canManageRrhh()` / `merchan_is_rrhh()` → **el ROL**. Quien tramita.
- `canAccessModule(session, "rrhh")` / `merchan_can_rrhh()` → **el permiso**. Quien entra a
  solicitar. Como `defaultPermissions.rrhh = true`, eso incluye a todas las gestoras.

Confundirlos abre el catálogo de cadenas a cualquiera: si una gestora pudiera cambiar
`lead_time_dias`, cambiaría el plazo que el sistema calcula **para todo el mundo**.

### 1.3 Las tres pantallas

1. **`/rrhh/altas` — Altas laborales.** Trabajador → trabajos pendientes → marcar los que
   van juntos → el sistema dice en gris qué hace falta → «Tramitar». Debajo, la cola de altas.
2. **`/rrhh/accesos` — Accesos a centro.** Trabajador + cadena + fecha de trabajo → chips de
   centros → el sistema dice cuántos accesos salen y hasta cuándo hay plazo → «Solicitar».
3. **`/rrhh/cadenas` — Cadenas y centros.** El catálogo que alimenta a la anterior. Solo
   RR.HH. y administración (`rrhhManagerOnly` en `app/app-shell.tsx`).

---

## 2. Las seis decisiones

### 2.1 D1 — El origen de los trabajos es un enlace polimórfico

`origen_tipo` ∈ (`campana`, `campana_punto`, `servicio`) + `origen_id`.

**Por qué.** Un trabajo pendiente de alta nace hoy de tres sitios distintos y mañana de un
cuarto. Meter tres columnas FK anulables (`campana_id`, `punto_id`, `servicio_id`) obliga a
un CHECK de exclusividad, a tres JOIN en cada lectura y a una migración cada vez que
aparece un origen nuevo. El par `(origen_tipo, origen_id)` es el patrón que
`logistics_requests.source_type` ya usa en producción desde v8_2: se conoce, se sabe
consultar y no cuesta nada extender.

**Por qué se prioriza Grandes Campañas.** Es donde está el volumen (1.012 puntos frente a
247 servicios) y es donde el CECO y las horas/día son homogéneos por campaña, así que es el
origen que mejor se autocompleta. Los servicios entran por el mismo camino sin cambiar el modelo.

**Consecuencia.** No hay tabla de «trabajos pendientes». `TrabajoPendiente` se construye **en
memoria** a partir de `grandes_campanas` / `puntos_venta_campana` / `services`: la verdad de
la asignación vive allí, y duplicarla sería crear una segunda verdad que se desincroniza.

### 2.2 D2 — MerchanOps NO guarda datos personales

**No existen y no existirán** en esta base: DNI, NIE, NAF, NSS, IBAN, fecha de nacimiento,
domicilio. Viven **solo en A3**. En concreto: **no se crea ninguna tabla
`rrhh_datos_laborales`.**

De A3 se guarda únicamente lo que hace falta para saber si un trabajo está cubierto:
número de alta, tipo de contrato, fechas, CECO, horas/día, estado, y opcionalmente
`workers.a3_empleado_codigo` (un identificador, no un dato personal).

**Por qué.** Tres razones, por orden de peso:

1. **Superficie de exposición.** La frontera real de MerchanOps es la RLS de Supabase, y hay
   ocho usuarios, dos aplicaciones (OPS y LOGS) y un cliente que corre entero en el
   navegador. Un IBAN detrás de una policy mal escrita es una brecha; un IBAN que no está
   en la base no lo es. La única defensa que no falla es no tener el dato.
2. **Duplicidad.** A3 ya es el sistema de nóminas. Copiar aquí el DNI crea dos verdades y
   la obligación de conciliarlas; lo que se necesita de A3 es el **número de alta**, no la
   ficha del trabajador.
3. **RGPD.** Minimización: no se recoge lo que no se usa. MerchanOps no calcula nóminas.

**Consecuencia operativa.** Se ha endurecido `REDACTED_KEYS` en `lib/domain-events.ts` con
las claves de datos personales, para que ni siquiera un payload de tránsito acabe escrito
en `sync_logs`. Si algún día alguien mete un DNI en un payload por error, el log guarda
`[redactado]`.

### 2.3 D3 — CECO y horas/día viven en `grandes_campanas`

Columnas nuevas `grandes_campanas.ceco` y `grandes_campanas.horas_dia`, heredadas por cada
línea de solicitud y **editables por línea**.

**Por qué.** Hoy el CECO de una gran campaña no está en ningún sitio: se hereda «de
memoria» y se teclea en cada imputación. Eso rompe la regla del texto gris —si el CECO hay
que teclearlo, la frase «2 imputaciones a 3005, 3136» no la puede escribir el sistema—.

**Por qué también por línea.** El CECO de la campaña es el valor **por defecto**, no un
dogma: una campaña puede imputar puntualmente a otro centro de coste. Heredar y permitir
corregir cubre el 95 % sin tecleo y el 5 % restante sin bloquear a nadie.

### 2.4 D4 — Los accesos son PUNTUALES

Un acceso es `(trabajador, centro, fecha de trabajo)`. **No hay acreditaciones con vigencia**,
ni renovaciones, ni caducidades que vigilar.

**Por qué.** Es lo que hacen las cadenas: se pide el acceso para un día concreto y ese día
se consume. Modelar vigencias obligaría a inventar reglas de renovación que ninguna cadena
ha comunicado, y a mantener un estado «vigente hasta» que nadie actualiza. Cuando una
cadena conceda acreditaciones anuales de verdad, se añade; hasta entonces, no.

**Lo que sí se vigila** es el desperdicio: un acceso concedido cuyo día de trabajo ya pasó
sin consumirse pasa a `concedido_no_consumido` (`esConcedidoNoConsumido()`). Quemar cupo de
una cadena tiene coste, y ese aviso es el que lo evita.

### 2.5 D5 — El rol `rrhh` es un rol dedicado, no un permiso más

`AppRole` = `admin` | `manager` | `almacen` | `rrhh`. Ya está en `lib/access-control.ts`
(`rrhhPermissions`, `isRrhhSession()`, `canManageRrhh()`) y en la base (v10_4).

**Por qué un rol y no solo un permiso.** Porque el perfil de RR.HH. es **excluyente**: no ve
panel, ni servicios, ni pagos, ni logística. Un permiso adicional sobre `manager` daría
acceso al módulo pero dejaría todo lo demás abierto. `rrhhPermissions` pone en `false` todo
menos `rrhh`, y `app-shell` oculta el Panel para este rol.

**Por qué `defaultPermissions.rrhh = true`.** Las gestoras son las que solicitan. Si el
permiso naciera en `false`, habría que activarlo a mano usuario por usuario y el módulo
nacería vacío de solicitudes. Las filas ya guardadas en `app_users` no traen la clave
`rrhh` en su `jsonb`, y el spread de `normalizeUser` les aplica el valor por defecto: la
herencia funciona sin migración de datos.

**La trampa que hereda de `almacen`.** RR.HH. es **nacional**: `provinces = '{}'`. Toda policy
que filtre por provincia evalúa `= ANY('{}')` = falso para todo. Sin una rama explícita del
ROL, RR.HH. entraría a su módulo y vería cero trabajadores, cero campañas y cero puntos.
De ahí la policy `rrhh_perfil_read` de v10_4, **solo de lectura** y **fuera** de las
`province_scope_all` (que son `FOR ALL`, y meterla dentro le habría regalado el DELETE).

### 2.6 D6 — A3 es manual desde el día uno, con columnas espejo

Las columnas `a3_numero`, `a3_canal`, `a3_estado`, `a3_last_sync_at`, `a3_sync_event_id` y
`a3_last_error` existen desde la primera migración. Hoy `a3_canal` vale siempre `manual`.

**Por qué.** No hay API de A3 disponible ni fecha para ella. Bloquear el módulo hasta que la
haya significa seguir con WhatsApp seis meses más. Pero añadir las columnas después obliga a
migrar filas históricas y a reescribir la UI. Se pagan ahora seis columnas vacías y el día
que llegue la API el único cambio es **quién las rellena**, no dónde están. Detalle completo
en el apartado 6.

---

## 3. Modelo de datos

Nombres exactos, en español, como el resto del esquema del módulo.

### 3.1 Catálogo — `cadenas` y `centros` (v10_5)

```
cadenas(id, nombre uk, modo_tramite ∈ ('centro','cadena'), lead_time_dias int default 0,
        contacto, email, instrucciones, activa, created_at, updated_at)

centros(id, cadena_id → cadenas ON DELETE RESTRICT, codigo, nombre,
        direccion, poblacion, provincia, codigo_postal, activo,
        created_at, updated_at, unique (cadena_id, codigo))
```

- `modo_tramite` y `lead_time_dias` son **los dos datos que hacen posible el texto gris** de
  accesos. Sin ellos habría que teclear cuántos accesos salen y hasta cuándo hay plazo.
- **Lectura**: cualquier perfil activo (una cadena es nacional; una gestora de Barcelona
  tiene que poder elegir «Alcampo»). **Escritura**: `merchan_is_rrhh()` o admin. Nunca
  `merchan_can_rrhh()`, que incluiría a todas las gestoras.
- `ON DELETE RESTRICT`: borrar una cadena con centros dejaría accesos históricos apuntando a
  la nada. Se **desactiva** (`activa = false`), no se borra.
- **Sin semilla.** «Alcampo», «Media Markt» y «El Corte Inglés» son ejemplos del diseño, no
  datos. Una semilla inventada produciría un «pedir antes del 29/07» falso que la gente se creería.

### 3.2 Columnas añadidas a tablas existentes

| Tabla | Columna | Para qué | Nota |
|---|---|---|---|
| `grandes_campanas` | `ceco text` | Heredado por cada línea de solicitud | D3 |
| `grandes_campanas` | `horas_dia numeric` | Ídem | D3 |
| `puntos_venta_campana` | `centro_id uuid → centros ON DELETE SET NULL` | Enlaza un punto con el centro real | **Nullable, sin migración del histórico**: los 1.012 puntos existentes se quedan como están y el enlace se puebla a medida que RR.HH. da de alta centros. Un punto sin centro simplemente no propone acceso automático. |
| `workers` | `a3_empleado_codigo text` | Casar el alta con A3 el día que exista la API | **Solo el identificador.** Ningún dato personal (D2). Lo sella el RPC, no una policy de UPDATE sobre `workers`. |

### 3.3 Altas reales — `rrhh_altas` (v10_6)

```
rrhh_altas(id, worker_id → workers ON DELETE CASCADE, numero_alta,
           tipo ∈ ('temporal','indefinido','fijo_discontinuo'),
           fecha_inicio not null, fecha_fin, ceco, horas_dia,
           estado ∈ ('vigente','ampliada','baja_pendiente','baja','anulada') default 'vigente',
           origen ∈ ('manual','solicitud','import') default 'manual',
           created_at, created_by → app_users, created_by_nombre, updated_at, version)
```

Es **el espejo de A3**, y contra esta tabla se calcula toda la cobertura
(`resolverCobertura()` en `lib/rrhh/altas.ts`). `fecha_fin` nula = alta abierta
(indefinida o sin fin conocido): cubre cualquier rango que empiece después de `fecha_inicio`.

`origen` distingue el alta que RR.HH. teclea a mano (`manual`), la que nace de una solicitud
tramitada (`solicitud`) y la que entrará por la API el día que exista (`import`).

### 3.4 Solicitudes de alta — `rrhh_solicitudes_alta` + `rrhh_solicitud_alta_lineas` (v10_6)

```
rrhh_solicitudes_alta(id, codigo uk not null, worker_id → workers, worker_nombre,
  fecha_inicio, fecha_fin, horas_dia,
  resolucion_sistema ∈ ('alta_nueva','cubierta','solape'), resolucion_detalle,
  alta_referencia_id → rrhh_altas ON DELETE SET NULL, alta_referencia_numero,
  estado ∈ (9 valores, ver 4.1) default 'pendiente',
  a3_numero, a3_canal ∈ ('manual','api') default 'manual', a3_estado,
  a3_last_sync_at, a3_sync_event_id, a3_last_error,
  alta_id → rrhh_altas ON DELETE SET NULL,
  solicitada_por → app_users ON DELETE SET NULL, solicitada_por_nombre,
  motivo, created_at, updated_at, version)

rrhh_solicitud_alta_lineas(id, solicitud_id → cabecera ON DELETE CASCADE,
  origen_tipo ∈ ('campana','campana_punto','servicio'), origen_id not null,
  campana, ceco, fecha_inicio, fecha_fin, horas_dia,
  unique (solicitud_id, origen_tipo, origen_id))
```

**Cabecera y líneas, no una fila plana**, porque el gesto del diseño es exactamente ese: se
marcan varios trabajos *que van juntos* y salen **un alta** y **N imputaciones**. La cabecera
lleva el rango envolvente (`rangoDeTrabajos()`); cada línea, su CECO y su campaña.

`resolucion_sistema` y `resolucion_detalle` guardan **lo que el sistema calculó en el momento
de solicitar** (el texto gris literal). No es cache: es prueba de por qué se pidió lo que se
pidió. La resolución se recalcula siempre en pantalla, pero la solicitud conserva la suya.

El `unique (solicitud_id, origen_tipo, origen_id)` impide que el mismo trabajo entre dos
veces en la misma solicitud por un doble clic.

### 3.5 Solicitudes de acceso — `rrhh_solicitudes_acceso` (v10_7)

```
rrhh_solicitudes_acceso(id, codigo uk not null, worker_id → workers, worker_nombre,
  cadena_id → cadenas ON DELETE RESTRICT, cadena_nombre,
  centro_id → centros ON DELETE SET NULL, centro_nombre,   -- centro_id NULL = "toda la cadena"
  fecha_trabajo date not null, fecha_limite date,
  origen_tipo, origen_id, trabajo,
  estado ∈ (7 valores, ver 4.2) default 'pendiente',
  solicitada_por → app_users ON DELETE SET NULL, solicitada_por_nombre,
  concedido_at, consumido_at, motivo, created_at, updated_at, version)
```

**Una fila por acceso real**, no por gesto del usuario. Marcar 3 chips en una cadena de modo
`centro` crea **3 filas**; marcar 4 chips en una de modo `cadena` crea **1 fila con
`centro_id` nulo**. La expansión la hace el RPC (`merchan_rrhh_solicitar_acceso`), no la UI:
así el número de accesos que se piden es el mismo lo pida quien lo pida.

`fecha_limite` se calcula al crear (`fecha_trabajo − lead_time_dias`) y se **congela**: si
RR.HH. cambia el `lead_time_dias` de la cadena mañana, las solicitudes ya hechas no cambian
de plazo retroactivamente.

### 3.6 Traza y numeración — `rrhh_eventos`, `rrhh_code_counters`

```
rrhh_eventos(id, entidad ∈ ('alta','acceso','catalogo'), entidad_id, evento,
             estado_anterior, estado_nuevo, motivo, actor_id, actor_nombre,
             payload jsonb, created_at)      -- append-only por trigger

rrhh_code_counters(scope pk, last_number int not null default 0, updated_at)
```

`rrhh_eventos` es **append-only por trigger**, no por convención: sin UPDATE ni DELETE, igual
que `payment_obligations_audit` (v8_0). Un cambio de estado que no se puede reconstruir no
sirve para nada cuando hay que explicar por qué se rechazó un alta.

`rrhh_code_counters` da los códigos `ALT-260731-001` y `ACC-260731-001` vía
`merchan_next_rrhh_code(p_tipo)`, con `scope` por tipo y día. Contador en base, no en cliente:
dos gestoras pulsando «Tramitar» a la vez no pueden generar el mismo código.

### 3.7 De dónde sale cada columna de «Cola de altas»

| Columna del diseño | Origen | Quién lo escribe |
|---|---|---|
| **Sol.** | `rrhh_solicitudes_alta.codigo` — `ALT-AAMMDD-NNN` de `merchan_next_rrhh_code('alta')` | Sistema |
| **Gestora** | `solicitada_por_nombre`, sellado por el RPC desde `app_users` con el `auth.uid()` de la sesión | Sistema (no es un campo de formulario) |
| **A3** | `a3_numero` | **RR.HH. a mano** (fase 2: el adaptador) |
| **Trabajador** | `worker_nombre`, denormalizado al solicitar; `worker_id` es la verdad | Sistema |
| **CECO** | `rrhh_solicitud_alta_lineas.ceco`, agrupados → «3005, 3136» (`imputacionesPorCeco()`) | Sistema (heredado de `grandes_campanas.ceco`, D3), corregible por línea |
| **Campaña** | `rrhh_solicitud_alta_lineas.campana` | Sistema |
| **FI→FF** | `fecha_inicio` / `fecha_fin` de la cabecera = rango envolvente de las líneas (`rangoDeTrabajos()`) | Sistema |
| **Horas** | `horas_dia` | Sistema (heredado, D3), corregible por línea |
| **Estado** | `estado` (`EstadoSolicitudAlta`) | **RR.HH.**; el sistema solo propone el inicial (`estadoSugerido()`) |

Las dos únicas columnas con fondo en el diseño —**A3** y **Estado**— son exactamente las dos
que no calcula el sistema. Eso no es casualidad: es la leyenda.

### 3.8 De dónde sale cada columna de la tabla de accesos

| Columna del diseño | Origen | Quién lo escribe |
|---|---|---|
| **Sol.** | `codigo` — `ACC-AAMMDD-NNN` | Sistema |
| **Gestora** | `solicitada_por_nombre`, sellado por el RPC | Sistema |
| **Trabajador** | `worker_nombre` (`worker_id` es la verdad) | Sistema |
| **Cadena** | `cadena_nombre` (`cadena_id` es la verdad) | Sistema |
| **Centro** | `centro_nombre`; **`centro_id IS NULL` se pinta «toda la cadena»** | Sistema, según `modo_tramite` |
| **Trabajo** | `trabajo`, con `origen_tipo` + `origen_id` detrás (D1) | Sistema |
| **Estado** | `estado` (`EstadoSolicitudAcceso`) | **RR.HH.**; el inicial lo pone `estadoInicialAcceso()` |

---

## 4. Máquinas de estados

Las transiciones están escritas **tres veces y dicen lo mismo**: `transicionesSolicitudAlta`
/ `transicionesSolicitudAcceso` en `lib/rrhh/tipos.ts` (la UI), los helpers
`puedeTransicionar()` / `puedeTransicionarAcceso()` (la lógica), y el trigger guardián de la
base. **La UI propone; la base decide.** Si aparece un estado nuevo, se añade en los tres sitios.

### 4.1 Altas

```
                 ┌──> se_solapa ─────┐
                 │                   │
   (crear) ──> pendiente ──> ya_alta_indefinida ──> solo_imputacion ──> tramitada ──> baja_pendiente
                 │                                        ▲                ▲              │
                 └──> alta_online ────────────────────────┘────────────────┘──────────────┘
                 │
                 └──> rechazada / cancelada          (terminales, con motivo obligatorio)
```

| Desde | Hacia | Quién puede provocarla |
|---|---|---|
| *(crear)* | `pendiente` / `se_solapa` / `ya_alta_indefinida` | **Gestora o RR.HH.**, vía `merchan_rrhh_solicitar_alta`. El estado inicial **no se elige**: sale de la resolución calculada (`alta_nueva` → `pendiente`, `solape` → `se_solapa`, `cubierta` → `ya_alta_indefinida`), y el RPC **rechaza** cualquier otro. `solo_imputacion` es ya una decisión de RR.HH.: se aplica después, con `merchan_rrhh_resolver_alta`. |
| `pendiente` | `tramitada`, `alta_online`, `se_solapa`, `ya_alta_indefinida`, `solo_imputacion` | **Solo RR.HH. o admin** (`merchan_rrhh_resolver_alta`, gate `merchan_is_rrhh()`) |
| `se_solapa` | `tramitada`, `alta_online`, `solo_imputacion` | Solo RR.HH. o admin |
| `ya_alta_indefinida` | `solo_imputacion`, `tramitada` | Solo RR.HH. o admin |
| `solo_imputacion` | `tramitada` | Solo RR.HH. o admin |
| `tramitada` | `baja_pendiente` | Solo RR.HH. o admin |
| `alta_online` | `tramitada`, `baja_pendiente` | Solo RR.HH. o admin |
| `baja_pendiente` | `tramitada` | Solo RR.HH. o admin |
| *cualquier estado abierto* | `rechazada` | Solo RR.HH. o admin. **Motivo obligatorio.** |
| *cualquier estado abierto* | `cancelada` | RR.HH., admin, **o la gestora que la solicitó mientras siga abierta**. **Motivo obligatorio.** |
| `rechazada`, `cancelada` | — | **Nadie.** Terminales. Un error se corrige con una solicitud nueva, no reabriendo la vieja. |

Notas de la máquina:

- **`tramitada` es la única puerta a un alta real.** `merchan_rrhh_resolver_alta` es lo que
  crea la fila en `rrhh_altas` (`origen = 'solicitud'`) y la enlaza en `alta_id`. Nadie
  inserta en `rrhh_altas` desde la UI.
- **Estados abiertos** (`estadosSolicitudAltaAbiertos`): `pendiente`, `se_solapa`,
  `ya_alta_indefinida`, `solo_imputacion`, `baja_pendiente`. Son los que RR.HH. ve en su cola.
- **Nada se cierra en negativo sin explicación**: `estadosSolicitudAltaConMotivo` =
  `['rechazada','cancelada']`, y el RPC rechaza la llamada sin `motivo`.
- **Bloqueo optimista**: `version` viaja en el payload del RPC. Dos personas resolviendo la
  misma solicitud a la vez → la segunda falla, no pisa a la primera. Mismo patrón que
  `change_payment_obligation_status` (v8_0).
- **Pendiente de conciliar antes de aplicar v10_6**: `estadoSugerido()` (`lib/rrhh/altas.ts`)
  propone `solo_imputacion` cuando el alta que cubre el rango es **temporal**, y ese valor el
  RPC no lo admite al crear. Manda la base: o la UI deja de proponerlo al solicitar, o el RPC
  lo acepta como cuarto estado inicial. Hoy son dos reglas distintas para el mismo caso.

### 4.2 Accesos

```
   (crear) ──> pendiente ──────> solicitado ──> concedido ──> concedido_no_consumido
                    │                 │             │                  │
   (crear) ──> fuera_de_plazo ────────┘             └──────────────────┘  (ida y vuelta)
                    │                 │
                    └─────────────────┴──> denegado / cancelado   (terminales, con motivo)
```

| Desde | Hacia | Quién puede provocarla |
|---|---|---|
| *(crear)* | `pendiente` o `fuera_de_plazo` | **Gestora o RR.HH.**, vía `merchan_rrhh_solicitar_acceso`. Lo decide `estadoInicialAcceso()` comparando `fecha_limite` con hoy: **el propio día límite sigue estando en plazo.** |
| `pendiente` / `fuera_de_plazo` | `solicitado` | Solo RR.HH. o admin — «ya lo he pedido a la cadena» |
| `pendiente` / `fuera_de_plazo` / `solicitado` | `concedido` | Solo RR.HH. o admin. Sella `concedido_at`. |
| `concedido` | `concedido_no_consumido` | Solo RR.HH. o admin. **El sistema lo propone** (`esConcedidoNoConsumido()`: concedido, día pasado, `consumido_at` nulo); RR.HH. lo confirma. |
| `concedido_no_consumido` | `concedido` | Solo RR.HH. o admin — vuelta atrás si el acceso sí se usó |
| *cualquier estado abierto* | `denegado` | Solo RR.HH. o admin. **Motivo obligatorio.** |
| *cualquier estado abierto* | `cancelado` | RR.HH., admin, o la gestora que lo solicitó. **Motivo obligatorio.** |
| `denegado`, `cancelado` | — | **Nadie.** Terminales. |

`fuera_de_plazo` **es un estado real de la base, no un adorno de pantalla**: RR.HH. lo ve en
su cola y decide si aun así lo pide. Un aviso que solo vive en el navegador no llega a quien
tiene que actuar.

### 4.3 La superficie de escritura: seis RPC y nada más

Ninguna pantalla hace `insert` ni `update` directo sobre las tablas de RR.HH. Todo pasa por
RPC `SECURITY DEFINER` con `search_path = ''`, firma `jsonb → jsonb`:

| RPC | Qué hace | Gate |
|---|---|---|
| `merchan_rrhh_solicitar_alta(p_payload)` | Cabecera + líneas, código `ALT-AAMMDD-NNN`. Devuelve `{solicitud_id, codigo}` | `merchan_can_rrhh()` |
| `merchan_rrhh_resolver_alta(p_payload)` | Cambia estado / `a3_numero` / crea el alta real. Exige motivo al rechazar o cancelar | `merchan_is_rrhh()` |
| `merchan_rrhh_registrar_alta(p_payload)` | Alta real de A3 dada de alta a mano. Único camino que toca `workers.a3_empleado_codigo` | `merchan_is_rrhh()` |
| `merchan_rrhh_solicitar_acceso(p_payload)` | Expande N centros según `modo_tramite`, código `ACC-AAMMDD-NNN`. Devuelve `{creadas:[{id,codigo}]}` | `merchan_can_rrhh()` |
| `merchan_rrhh_resolver_acceso(p_payload)` | Concede / deniega / marca no consumido. Exige motivo en negativo | `merchan_is_rrhh()` |
| `merchan_next_rrhh_code(p_tipo)` | `'alta'` \| `'acceso'` → `ALT-260731-001` / `ACC-260731-001` | Interno |

Que la expansión de centros, el sellado de la gestora, el cálculo del código y la validación
de transición vivan **en la base y no en el cliente** es lo que hace que la RLS sea la
frontera de verdad y no una segunda opinión.

---

## 5. Integración con A3

### 5.1 Fase 1 — hoy: manual, con las columnas ya puestas

RR.HH. da el alta en A3 por su vía de siempre y teclea el número que A3 devuelve en la
columna **A3** de la cola. Eso escribe `a3_numero` y deja `a3_canal = 'manual'`.

Las seis columnas espejo existen desde la primera migración y **hoy cinco están vacías a
propósito**:

| Columna | Fase 1 (hoy) | Fase 2 (API) |
|---|---|---|
| `a3_numero` | Lo teclea RR.HH. | Lo escribe el adaptador con la respuesta de A3 |
| `a3_canal` | Siempre `'manual'` | `'api'` |
| `a3_estado` | Vacía | Estado que devuelve A3 |
| `a3_last_sync_at` | Vacía | Sello del último intento |
| `a3_sync_event_id` | Vacía | `event_id` del outbox que la produjo → **idempotencia** |
| `a3_last_error` | Vacía | Último error, **visible en pantalla**, nunca tragado |

El día que llegue la API **el esquema no cambia y la UI tampoco**: cambia quién rellena las
columnas. La columna A3 pasa de editable a solo lectura cuando `a3_canal = 'api'`.

### 5.2 Fase 2 — el adaptador

**Forma: una Edge Function de Supabase con `service_role` que consume el outbox.** No un
consumidor `pg_cron` dentro de la base como `db-notifier` (v8_6), porque A3 es una llamada
HTTP a un tercero: dentro de una transacción de Postgres, una llamada externa lenta o caída
bloquea la transacción. Fuera, no.

**Los eventos ya se publican hoy.** v10_6 y v10_7 emiten cuatro tipos por `outbox_publish`,
en la misma transacción que el dato:

| Evento | Lo publica |
|---|---|
| `rrhh_alta.solicitada` | `merchan_rrhh_solicitar_alta` |
| `rrhh_alta.resuelta` | `merchan_rrhh_resolver_alta` |
| `rrhh_acceso.solicitado` | `merchan_rrhh_solicitar_acceso` |
| `rrhh_acceso.resuelto` | `merchan_rrhh_resolver_acceso` |

v10_8 declara las dos familias `rrhh_alta.*` y `rrhh_acceso.*` **ajenas a `db-notifier`** (que
solo genera notificaciones de logística), por prefijo y no una a una. Sin eso, la primera
solicitud tramitada empezaría a fallar cada minuto hasta agotar reintentos y caer en
dead-letter, exactamente como le pasó a `logistics.picking_shipped` en v10_0.

El camino completo cuando llegue la API:

1. El RPC publica en `outbox_events` **en la misma transacción** que el cambio de estado. Si
   el UPDATE hace commit, el evento existe; si hace rollback, no. No hay «se cambió el estado
   pero no se avisó». Esta parte **ya está hecha**.
2. La Edge Function reclama con el `lease` multiconsumidor de v10_1 bajo el nombre
   **`a3-adapter`**, llama a A3, y escribe el resultado con un RPC propio.
3. El resultado va a las columnas `a3_*` de la solicitud. Un error queda en `a3_last_error`
   y **se ve en la cola**; no existe el fallo silencioso.

**Tres reglas que no son negociables:**

- **Registrar `'a3-adapter'` en `outbox_consumers` SOLO cuando el adaptador exista y consuma.**
  El comentario de la tabla lo dice: un evento solo se marca completado cuando **todos** los
  consumidores habilitados lo han procesado. Registrar el consumidor antes de tenerlo deja
  todos los eventos del outbox —incluidos los de logística— colgados en `pendiente`
  indefinidamente. Es un pie de bala con efecto en un módulo que no es el nuestro. Por eso
  v10_8 **no** lo registra, y ese `insert` es literalmente el primer paso de la fase 2:

  ```sql
  insert into public.outbox_consumers (consumer, descripcion)
  values ('a3-adapter', 'Adaptador de A3 (Edge Function, service_role)')
  on conflict (consumer) do nothing;
  ```
- **Handler idempotente.** El `event_id` del outbox es determinista; el adaptador guarda el
  que procesó en `a3_sync_event_id` y **descarta el reproceso del mismo evento**. Un
  reintento, un doble disparo o un redeploy no pueden crear dos altas en A3. Una alta
  duplicada en A3 es un problema de nóminas, no de software.
- **El payload del outbox lleva SOLO identificadores.** Lo que se publica hoy es exactamente
  eso: `solicitud_id` / `acceso_id`, `worker_id`, `cadena_id`, `centro_id`, `codigo`,
  `estado`, `version` y las fechas de la propia solicitud. **Nunca** el nombre del
  trabajador, ni el de la gestora, ni nada que se parezca a un dato personal. Motivo:
  `outbox_events` tiene policy de SELECT con `merchan_has_profile()`
  (v9_11) — **cualquier perfil activo lee la tabla entera**, incluidas las gestoras y
  MerchanLOGS. El adaptador corre con `service_role` y puede leer los datos que necesite de
  las tablas; el evento solo tiene que decirle **cuál** mirar. Esto es D2 aplicado al
  transporte: lo que no viaja, no se filtra.

### 5.3 Lo que el adaptador NO hará

No dará de baja en A3, no modificará datos del trabajador y no leerá la ficha personal.
Su superficie es: **crear un alta, ampliar un alta, consultar su estado**. Todo lo demás
sigue siendo trabajo de RR.HH. en A3.

---

## 6. Fuera del alcance de esta primera entrega

### 6.1 La solicitud automática al asignar — **fase siguiente, ya decidida**

Hoy la gestora entra en `/rrhh/altas`, elige al trabajador y marca sus trabajos. **El objetivo
es que no tenga que entrar**: que asignar un instalador a un servicio o a un punto de gran
campaña **dispare la solicitud sola**.

El diseño acordado para cuando se aborde:

- El disparador es **el evento de asignación**, no un cron que barre tablas buscando huecos.
  Ya existe la pieza: `servicio.instalador_cambiado` en `lib/domain-events.ts`, y el patrón
  de publicación transaccional por trigger de v8_6.
- Al asignar, el sistema calcula la cobertura con la misma `resolverCobertura()` que usa la
  pantalla —**la lógica no se duplica**— y solo crea la solicitud si la resolución es
  `alta_nueva` o `solape`. Si el trabajador ya está cubierto, no molesta a nadie.
- La solicitud automática nace con la misma `resolucion_sistema` y `resolucion_detalle`, y
  con `solicitada_por` = quien hizo la asignación. La cola de RR.HH. no distingue entre una
  solicitud automática y una manual, porque para RR.HH. es el mismo trabajo.
- El acceso a centro se dispara igual, cuando el punto asignado tiene `centro_id` (de ahí
  que la columna exista ya, D1/3.2).

**Por qué no ahora.** Automatizar un flujo que nadie ha usado todavía es automatizar una
suposición. Primero se usan las dos pantallas a mano el tiempo suficiente para saber qué
proporción de asignaciones genera alta de verdad; después se automatiza. Al revés, el
riesgo es inundar la cola de RR.HH. de solicitudes que había que descartar.

### 6.2 Lo demás que queda fuera, y por qué

| Fuera de alcance | Motivo |
|---|---|
| Acreditaciones con vigencia / renovaciones | D4: las cadenas trabajan por día concreto |
| Bajas automáticas al terminar el trabajo | La baja es un acto laboral con consecuencias; `baja_pendiente` avisa, RR.HH. decide |
| Cualquier dato personal, en cualquier forma | D2, sin excepciones |
| Nóminas, coste laboral, informes de horas | Es A3. MerchanOps no calcula nóminas |
| Semilla de cadenas reales | 3.1: un plazo inventado es peor que ningún plazo |
| Alta masiva por importación | `rrhh_altas.origen = 'import'` está previsto en el CHECK; no hay UI ni la habrá en esta entrega |

---

## 7. Verificación antes de dar por buena la migración

**La regla, aprendida en la Ola 4: nada se da por bueno probándolo con `admin`.** El rol admin
pasa por la primera rama de casi todas las policies y verde con admin no demuestra
absolutamente nada. Hay que crear un usuario **real** con `role = 'rrhh'`, entrar con **su**
usuario y contraseña —para que Supabase Auth emita **su** JWT— y ejecutar lo de abajo con esa
sesión. Lo mismo con una gestora real.

### 7.1 Con la sesión de un usuario `rrhh` REAL (JWT propio, no `service_role`, no admin)

**Que VE lo que necesita** (la trampa del ámbito nacional, 2.5):

```sql
select count(*) from workers;               -- todos (hoy 25). Si sale 0, falta la rama del ROL
select count(*) from services;              -- todos (hoy 247)
select count(*) from grandes_campanas;      -- todas (hoy 4)
select count(*) from puntos_venta_campana;  -- todos (hoy 1.012)
select count(*) from cadenas;               -- el catálogo entero
```

**Que NO puede escribir donde no debe** (la policy de lectura es solo de lectura):

```sql
delete from workers where false;            -- 0 filas, sin error de permiso
update workers set phone = phone;           -- 0 filas afectadas
delete from puntos_venta_campana where false;
```

**Que SÍ mantiene su catálogo:**

```sql
insert into cadenas (nombre, modo_tramite, lead_time_dias) values ('Prueba','centro',2);  -- OK
update cadenas set lead_time_dias = 3 where nombre = 'Prueba';                            -- 1 fila
insert into centros (cadena_id, nombre) select id, 'Centro prueba' from cadenas where nombre='Prueba';
delete from cadenas where nombre = 'Prueba';   -- falla con 23503 si tiene centros: es lo correcto
```

**Que los RPC de tramitación le responden:** resolver una solicitud, teclear un `a3_numero`,
conceder un acceso. Y que **exigen motivo**: `merchan_rrhh_resolver_alta` a `rechazada` sin
`motivo` tiene que **fallar**, no aceptar en silencio.

**Que el módulo es lo único que ve:** en la aplicación, sin Panel, sin Servicios, sin Pagos,
sin Logística; y entrando por URL directa a `/pagos` o `/logistica/stock`, **bloqueado**
(no basta con que el menú no lo enseñe).

### 7.2 Con la sesión de una gestora REAL

- **Entra al módulo** (`defaultPermissions.rrhh = true`) y **puede solicitar**: `merchan_rrhh_solicitar_alta`
  y `merchan_rrhh_solicitar_acceso` responden OK.
- **No puede tramitar**: `merchan_rrhh_resolver_alta` y `merchan_rrhh_resolver_acceso` tienen
  que **fallar** con su JWT.
- **No toca el catálogo**: `insert into cadenas ...` → **42501**. `select count(*) from cadenas`
  → OK (necesita leerlo para elegir cadena).
- **`/rrhh/cadenas` por URL directa**: bloqueado (`rrhhManagerOnly`).
- **Su ámbito provincial no ha cambiado**: `select count(*) from puntos_venta_campana` devuelve
  **lo mismo que antes** de aplicar la migración. Si ese número sube, una policy nueva ha
  ensanchado la visibilidad de las gestoras y hay que revertir.

### 7.3 Comprobaciones de integridad

- **Códigos.** Dos solicitudes seguidas dan `ALT-260731-001` y `ALT-260731-002`, sin huecos ni
  repetidos. Idealmente, dos sesiones a la vez.
- **Expansión de centros.** 3 chips en cadena `modo_tramite='centro'` → **3 filas**. 4 chips en
  `modo_tramite='cadena'` → **1 fila con `centro_id` nulo**. Contado en la tabla, no en pantalla.
- **Transiciones.** Un salto prohibido (`rechazada` → `tramitada`) tiene que fallar **en la base**,
  no solo estar ausente del desplegable.
- **`version`.** Leer una solicitud, resolverla desde dos pestañas con el mismo `version`: la
  segunda falla.
- **`rrhh_eventos`.** Después de cada cambio hay una fila con `estado_anterior`, `estado_nuevo`
  y actor. Un `update` o un `delete` sobre esa tabla tiene que fallar.
- **Sin datos personales.** `select * from rrhh_altas limit 1` y `select * from rrhh_solicitudes_alta limit 1`:
  ninguna columna que se parezca a DNI, NAF, IBAN, fecha de nacimiento o domicilio (D2).
- **Sin regresiones.** `npx vitest run` y `npx tsc --noEmit` en verde, y el resto de módulos
  (Pagos, Logística, ISDIN) funcionando con una gestora: v10_4 reescribe policies existentes
  y hay que confirmar que las dejó **idénticas**.

---

## 8. Revisión adversarial previa a la entrega

Antes de cerrar la rama se revisó el módulo entero con dos lentes independientes (coherencia entre
capas TypeScript ↔ RPC ↔ RLS, y control de acceso). Salieron **diez hallazgos**; ocho se
corrigieron y se verificaron uno a uno contra un PostgreSQL desechable con el esqueleto del
proyecto (tablas, helpers y policies reales), aplicando las cinco migraciones dos veces seguidas
para confirmar que siguen siendo idempotentes.

| # | Defecto | Corrección | Dónde |
|---|---|---|---|
| 1 | El módulo quedaba **abierto en la interfaz y cerrado en la base**: `normalizeUser` da `rrhh:true` por defecto en el cliente, pero el jsonb real de las gestoras ya creadas no tiene la clave, así que `merchan_can_rrhh()` devolvía false y cada acción moría con un 42501 | Backfill de `permissions` en la propia migración (admin y gestores a true, almacén a false) | `v10_4` §2.b |
| 2 | Una cobertura por alta **temporal** se etiquetaba «Ya de alta indef.» | El estado de nacimiento se deriva del **tipo** del alta referenciada: indefinida → `ya_alta_indefinida`, temporal o fija discontinua → `solo_imputacion` | `v10_6` RPC solicitar + `altas-client.tsx` |
| 3 | Al pasar a «Tramitada» **no se creaba el alta real**, así que el sistema nunca aprendía y volvía a proponer «alta nueva» para siempre | Modal «Tramitar en A3» que crea el alta (`crear_alta`) o amplía la referenciada antes de mover el estado | `altas-client.tsx` |
| 4 | **Ampliar un alta podía acortarla**: un trabajo que solapa por la izquierda recortaba la cobertura por detrás | Bandera `ampliar: true` = extender, nunca recortar. Acortar a mano sigue siendo posible sin la bandera | `v10_6` RPC registrar |
| 5 | Una solicitud **rechazada o cancelada escondía su trabajo para siempre** (las líneas no se borran nunca) | `merchan_rrhh_origenes_solicitados()` descuenta las solicitudes muertas | `v10_6` §4.3 + `datos.ts` |
| 6 | La deduplicación era **ciega a lo que pidió otra gestora** (su RLS no le deja ver líneas ajenas), y se duplicaban solicitudes | El mismo RPC `SECURITY DEFINER` contesta por todas las solicitudes del trabajador | `v10_6` §4.3 + `datos.ts` |
| 7 | Las RPC de solicitud son `SECURITY DEFINER` y **no comprobaban la provincia**: una gestora podía pedir el alta de un trabajador de otra zona | `merchan_rrhh_worker_en_ambito()` en las dos RPC de solicitud | `v10_6` §1.b, `v10_7` |
| 8 | El **generador de códigos** estaba publicado a `authenticated`, lo que dejaba leer y quemar el contador que la tabla blinda con RLS | `revoke execute` a `authenticated`, como `merchan_next_request_code` (v10_3) | `v10_6` §1 |
| 9 | El **número de A3 no se podía borrar**: un `coalesce` conservaba el valor viejo y la pantalla decía «guardado» | Se distingue clave ausente («no lo toques») de `null` («bórralo») | `v10_6` RPC resolver |
| 10 | El perfil `rrhh` podía **escribir y borrar** filas con provincia nula de `workers`, `services`, `points` y `puntos_venta_campana` | Ese rol sale de la rama de escritura de `province_scope_all`; su acceso es de solo lectura (`rrhh_perfil_read`) | `v10_4` §4 |

### 8.1 Segunda pasada: las dos lentes que faltaban

La revisión se completó después con las dos lentes que se habían quedado sin ejecutar
(aritmética de fechas y experiencia de las pantallas). Salieron **dos defectos más**, los dos
corregidos y con prueba de regresión:

| # | Defecto | Corrección |
|---|---|---|
| 11 | **`hoyISO()` contaba los días en UTC, no en España.** En horario de verano el país va dos horas por delante, así que entre las 00:00 y las 02:00 `toISOString()` devolvía todavía la fecha de ayer. A las 00:30 del 1 de agosto, un plazo que vencía el 31 de julio se pintaba como «pedir antes del 31/07» en lugar de «plazo vencido» — justo el aviso que la pantalla existe para dar. Peor aún: la base **sí** lo calculaba bien (`now() at time zone 'Europe/Madrid'`, v10_7:360), así que la solicitud nacía `fuera_de_plazo` después de que la pantalla dijera lo contrario. | `hoyISO()` devuelve el día civil en `Europe/Madrid`. Cliente y base dicen ya lo mismo. Cinco casos nuevos en `tests/rrhh-accesos.test.ts`, y la aserción de `tests/rrhh-altas.test.ts` que codificaba el comportamiento antiguo se actualizó al criterio correcto. |
| 12 | **`cargarCentros()` no descartaba respuestas obsoletas.** Saltando deprisa de una cadena a otra, la respuesta de la primera podía llegar después que la de la segunda y pintar los centros de A bajo la cabecera de B. Las pantallas de altas y de accesos ya se protegían de esta carrera; el catálogo, no. | Contador de peticiones: solo manda la última lanzada. |

Lo que se revisó y **no** dio problemas: los bordes del cálculo de cobertura (alta contigua que no
es solape, alta abierta, cobertura exacta por los dos extremos, altas anuladas y de baja, elección
entre varias altas candidatas), la aritmética de plazos cruzando fin de mes, fin de año y año
bisiesto, y los seis textos literales del diseño. Están fijados en `tests/rrhh-bordes.test.ts`
(23 casos) para que nadie los rompa sin enterarse. En las pantallas: ningún `catch` vacío, ninguna
promesa suelta, sesión leída siempre en `useEffect` (sin desajuste de hidratación), tablas con
`overflow-auto`, ningún botón de solo icono sin texto y recarga tras cada escritura.

### 8.2 Tercera pasada: auditoría de recorrido completo

Última revisión antes de entregar, ejecutando el módulo **entero** contra un PostgreSQL limpio con
el esqueleto del proyecto: catálogo creado por RR.HH. → gestora rechazada al escribirlo → solicitud
de alta con dos líneas → gestora rechazada al tramitar → RR.HH. tramita con número de A3 y alta real
en una transacción → el sistema deja de ofrecer ese trabajo → accesos por centro (2 → 2) y por
cadena (1 → 1 sin centro) → plazo vencido → denegar sin motivo bloqueado → conceder sella
`concedido_at` → outbox sin datos personales → notificador con 0 a dead-letter → bitácora inmutable
→ RLS activa en las ocho tablas. Un defecto más:

| # | Defecto | Corrección |
|---|---|---|
| 13 | **La bitácora no registraba quién cambió un estado.** Los tres triggers de UPDATE (`solicitud.estado`, `solicitud.a3`, `alta.modificada`, `acceso.estado`) omitían `actor_nombre` de la lista de columnas, así que el evento más importante —el cambio de estado— se guardaba con el nombre en blanco, mientras otro evento de la misma transacción sí lo llevaba. `actor_id` sí estaba, pero la tabla promete en su propio comentario responder a «¿quién dijo que este trabajador ya estaba de alta?», y con el nombre nulo no lo respondía de un vistazo. | Se añade `actor_nombre` a los tres `insert`, resuelto desde `app_users` con el id del actor. Verificado: `solicitud.estado` y `acceso.estado` registran ya nombre y motivo. |

Comprobado además y **sin hallazgos**: la capa de datos (claves de payload de las cinco RPC contra
sus contratos, incluido `acceso_id` —que no es `solicitud_id`—), el flujo del modal «Tramitar en
A3», los trabajos sin fechas (texto de aviso y botón «Tramitar» deshabilitado), los límites de los
campos numéricos, las policies del catálogo, y `v10_8` (familias `rrhh_*` declaradas ajenas por
prefijo, sin registrar `a3-adapter`). Se corrigió también un comentario que decía lo contrario de
lo que hace el código: al **crear** un alta, una fecha de fin vacía hereda la de la solicitud; solo
al **ampliar** deja el alta abierta (el texto de ayuda del campo ya lo decía bien).

Las cinco migraciones se aplicaron **dos veces sobre una base recién creada** después de todas las
correcciones: idempotencia intacta.

### 8.3 Lo que queda abierto

- **El bloqueo optimista de `rrhh_altas` no está cableado desde la cola.** `listarAltas()` ya lee
  la columna `version` y `PayloadRegistrarAlta` la acepta, pero el modal de tramitación todavía no
  la envía al ampliar. El daño real —que una ampliación recortase un alta sin avisar— lo evita ya
  la bandera `ampliar`; lo que queda es que dos personas de RR.HH. ampliando el mismo alta a la vez
  se pisen sin conflicto. Cablearlo es pasar `version` en la llamada.
- **Las pantallas no se han ejecutado nunca contra una base real.** Todo lo verificado hasta aquí
  es tipos, pruebas unitarias, y SQL contra un PostgreSQL desechable con el esqueleto del proyecto.
  Falta la prueba de humo de §7 con un usuario `rrhh` de verdad.
