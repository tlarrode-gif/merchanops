# Auditoría MerchanOPS — julio 2026

Auditoría exigente de producto, arquitectura, lógica de negocio, UX/UI y QA sobre el estado actual
de `main` (tras las Fases 1–4). Cada hallazgo referencia el fichero y la línea aproximada donde ocurre.

Leyenda de prioridad: **[C] Crítica** · **[A] Alta** · **[M] Media** · **[B] Baja**
Esfuerzo: **E-bajo / E-medio / E-alto**

---

## 1. Resumen ejecutivo

MerchanOPS funciona y cubre mucho terreno (servicios, grandes campañas, ISDIN, llamadas, logística,
historial económico), pero **ha crecido por acumulación, no por diseño**. Los tres problemas de fondo:

1. **Tres modelos de "campaña" conviven** (`services.campaign` texto libre, `big_campaigns` legado,
   `grandes_campanas` nuevo) y cada uno calcula pagos por un camino distinto. Esto multiplica código,
   estados y riesgos de doble pago, y hace que "¿cuánto pagamos este mes?" tenga hasta cuatro
   respuestas distintas según la pantalla.
2. **La capa económica es append-only pero el origen es mutable sin control.** El Historial económico
   (Fase 3) es un buen paso —eventos inmutables, reversos, mes contable—, pero el fingerprint de cada
   evento incluye estado/fecha/importe del origen: si el origen cambia después de sincronizar, nace un
   **segundo evento activo para el mismo punto sin anular el primero**. Es el riesgo de doble pago más
   serio de la aplicación.
3. **Todo el control de acceso vive en el navegador.** RLS desactivado, contraseñas en texto plano que
   viajan al cliente, y funciones económicas (`revertEconomicEvent`, `addExtraEvent`) sin verificación
   de rol en la librería. Cualquier usuario con la anon key puede leer/escribir cualquier tabla.

Nada de esto exige un rediseño: exige **consolidar** (un solo modelo de campaña-acción-punto),
**cerrar** (bloqueo de periodos liquidados y de campañas cerradas) y **validar** (transiciones de
estado con requisitos). La UX necesita una pasada de orden —una sola navegación lateral— más que
nuevas pantallas.

**Veredicto**: apta para uso interno supervisado por administración; **no apta todavía** para operar
pagos reales a instaladores externos sin la lista de críticos del bloque 2 resuelta.

---

## 2. Problemas críticos detectados (hacer YA)

| # | Problema | Dónde | Riesgo |
|---|----------|-------|--------|
| C1 | **Doble evento de pago si el origen cambia tras sincronizar.** El fingerprint incluye fecha+importe+estado (`lib/economic-events.ts:88`, `:117`; `lib/payment-ledger.ts:131`, `:168`). Cambiar `importe` o `fecha_visita` de un punto completado y re-sincronizar crea un evento nuevo activo; el anterior no se revierte. | `syncEconomicEvents` + generadores | Pago duplicado del mismo punto. Silencioso: nadie ve el duplicado salvo que compare a mano. |
| C2 | **No existe cierre de mes ni de campaña.** `economic_events` no tiene estado "exportado/liquidado"; se puede revertir o añadir eventos a meses ya pagados y volver a exportar con cifras distintas. `updatePunto` (`lib/campanas.ts:489`) tampoco mira si la campaña está `completada/cancelada/archivada`: los puntos de una campaña archivada siguen siendo editables. | `lib/economic-events.ts`, `lib/campanas.ts` | Históricos que cambian después de pagados; imposible auditar "por qué se pagó X". |
| C3 | **Seguridad: control de acceso solo en cliente.** RLS desactivado en todas las tablas (todas las migraciones), `app_users.password` en texto plano y descargado al navegador (`lib/access-control.ts:90`), y las funciones sensibles no verifican rol en lib: `revertEconomicEvent`/`addExtraEvent` (`lib/economic-events.ts:238`, `:283`) confían en que la UI ya filtró. | Global | Cualquier usuario (o cualquiera con la anon key pública) puede leer contraseñas, crear eventos económicos o borrar campañas vía consola. |
| C4 | **ISDIN paga visita fallida en cancelaciones sin visita.** `calc()` y `buildPay()` devuelven `FAILED` (8,56 €) para todo `Cancelado` (`app/grandes-campanas/isdin/page.tsx:35`, `:46`), mientras facturación distingue correctamente "cancelación sin visita facturable" = 0 € (`lib/isdin-billing.ts`, rama `Cancelado`). | ISDIN pagos | Se paga al instalador por visitas que nunca ocurrieron; pagos ≠ facturación para el mismo hecho. |
| C5 | **Duplicados de puntos sin control en Grandes Campañas.** `puntos_venta_campana` no tiene unique por `(campana_id, codigo)`; reimportar el mismo Excel duplica todos los puntos (`lib/campanas.ts:443` inserta sin upsert). Cada duplicado completado = un pago más (C1 lo agrava). | Importador campañas | Doble pago masivo con un solo error humano (subir el archivo dos veces). |
| C6 | **Pago del módulo nuevo va al "gestor", no a un instalador.** `pagoEventsFromCampanaPuntos` paga a `gestor_id/gestor_nombre` (`lib/economic-events.ts:100`), que es un usuario interno de `app_users`; Servicios e ISDIN pagan a `workers`. Son dos poblaciones distintas con IDs incompatibles: los totales "por trabajador" del Historial económico mezclan gestores internos con instaladores externos. | `lib/economic-events.ts` | Nóminas/pagos a la persona equivocada; totales por instalador que no cuadran. |
| C7 | **Filtro de trabajador inyectable en PostgREST.** `query.or(\`worker_id.eq.${filters.worker},worker_name.eq.${filters.worker}\`)` (`lib/economic-events.ts:227`) interpola texto libre: un nombre con coma o paréntesis rompe el filtro o altera la consulta. | Historial económico | Filtro roto/eludible; con RLS futuro sería un bypass. |

---

## 3. Auditoría de lógica de pagos

### 3.1 Diagnóstico general

Hay **cuatro motores de cálculo** de pago conviviendo:

| Motor | Fichero | Paga por | Beneficiario |
|---|---|---|---|
| Servicios (`pPay`) | `app/page.tsx:43` y duplicado en `lib/payment-ledger.ts:79` | punto (fee / incident_fee / original+incident) u horas | `workers` |
| Campañas legado | `lib/payment-ledger.ts:138` (`big_campaign_points`) | punto con lógica incidencia | `workers` |
| Campañas nuevas | `lib/economic-events.ts:96` | punto completado × importe | `app_users` (gestor) ⚠ C6 |
| ISDIN | `app/grandes-campanas/isdin/page.tsx:35` (`calc`) y `:46` (`buildPay`) | estado del vinilo | `workers` |

La misma lógica de incidencias está **duplicada** entre `app/page.tsx` (funciones `pPay`, `isIncActive`…)
y `lib/payment-ledger.ts` (mismas funciones, reimplementadas). Ya han divergido una vez (la página usa
`payableFailedPointStatuses`, la lib su propia lista); divergirán más.

### 3.2 Hallazgos

- **[C] P-1 (=C1) Recalculo sin reconciliación.** Regla que falta: *máximo un evento activo de pago por
  `source_line_id`*. Al sincronizar, si existe un evento activo para el punto con distinto importe/fecha,
  debe generarse reverso automático + evento nuevo (o marcar "requiere revisión"), nunca dos activos.
- **[C] P-2 (=C4) Cancelado ISDIN.** El pago debe replicar la lógica de facturación: `Cancelado` solo paga
  visita fallida si existe `incident_payment_week` (hubo visita previa real).
- **[A] P-3 Fee mutado in situ en Servicios.** Al abrir incidencia, `updatePoint` sobrescribe `fee` con
  8,56 y guarda el original en `original_fee` (`app/page.tsx:74`). El importe "vivo" de un punto cambia de
  significado según el estado. Si alguien edita `fee` durante la incidencia, ese cambio se pierde al
  resolver (se restaura `original_fee + incident_fee`). Solución: nunca mutar `fee`; calcular el pagable
  siempre como función de (`fee`, estado, incidencia), como ya hace `pPay` — el patch de `fee` es redundante
  y peligroso.
- **[A] P-4 Tarifa de incidencia hardcodeada por triplicado.** `8.56` en `app/page.tsx:18`,
  `lib/payment-ledger.ts:1` e `isdin/page.tsx:20` (`FAILED`). Debe ser una tarifa configurable (tabla
  `settings`) con vigencia por fecha; hoy un cambio de tarifa exige tocar 3 ficheros y rompería históricos.
- **[A] P-5 Revisitas asimétricas.** Facturación a cliente genera línea por revisita
  (`lib/isdin-billing.ts`, `Revisita adicional N`); pagos a instalador no pagan revisitas nunca
  (`buildPay` no mira `revisit_count`). Si es política (margen), documéntalo en pantalla; si no, es un
  impago sistemático. No hay flag "revisita facturable sí/no".
- **[A] P-6 Pagos sin beneficiario.** Punto de gran campaña completado con importe y sin gestor genera
  evento a "Sin gestor" (`lib/economic-events.ts:110`); ISDIN igual con "Sin instalador". Deben quedar en
  estado **pendiente de revisión**, no como evento activo exportable.
- **[A] P-7 Sin importes validados.** `puntos_venta_campana.importe numeric(10,2)` sin `check >= 0`;
  formularios aceptan negativos (`nueva/page.tsx:148` convierte con `Number()` sin validar). Un `-100`
  por error de teclado entra en KPIs y en pago. Solo `addExtraEvent` debería admitir negativos.
- **[A] P-8 "Pagado" es un estado manual desconectado.** `services.status = "Pagado"` se pone a mano y no
  crea ni exige evento económico; a la inversa, exportar pagos no marca nada como pagado. Dos fuentes de
  verdad que no se hablan.
- **[M] P-9 Cuatro totales distintos de "pagos ISDIN".** El listado calcula sobre filas visibles (oculta
  finalizados antiguos, `isdin/page.tsx:50`), el dashboard sobre "semana actual + backlog", la facturación
  sobre su propio filtro, y el Historial económico sobre el snapshot sincronizado. Ninguna pantalla avisa
  de qué alcance usa el número que muestra. Añadir en cada KPI el alcance ("sobre N filas filtradas").
- **[M] P-10 Semana como texto libre.** `payment_week` / `incident_payment_week` son strings editables a
  mano ("Semana 25 Mayo 2026", `isdin/page.tsx` Cell). Un typo ("Semana 25 mayo 2026") crea un grupo de
  pago nuevo. `weekRank` parsea con regex y devuelve null en silencio. La semana debería derivarse siempre
  de una fecha y mostrarse como etiqueta, nunca editarse como texto.
- **[M] P-11 Reverso pierde el rastro si falla a medias.** En `revertEconomicEvent`, si el insert del
  reverso funciona pero el update del original falla (`lib/economic-events.ts:266`), quedan reverso y
  original ambos "vivos" hasta reintento manual. Debería ser una RPC transaccional en Postgres.
- **[B] P-12 `mes_contable` del reverso = mes actual.** Correcto contablemente, pero el filtro de mes del
  Historial muestra el original en un mes y su reverso en otro sin indicación cruzada; añadir en la fila
  del original un enlace "revertido en 2026-08".

### 3.3 Casos de prueba de pagos (deben pasar antes de dar pagos por fiables)

1. **Instalador con 3 puntos completados, 1 cancelado y 1 revisita** → total = 3×importe; cancelado 0 €
   (si no hubo visita); revisita según política explícita. Hoy: ISDIN pagaría el cancelado (C4).
2. **Punto completado que cambia de importe (150→120) y se re-sincroniza** → neto 120 con reverso visible.
   Hoy: neto 270 (C1). **Test más importante de toda la app.**
3. **Punto que cambia de gestor/instalador después de completado y sincronizado** → el evento antiguo
   conserva el beneficiario original; el cambio no debe regenerar pago. Hoy: segundo evento al nuevo (C1).
4. **Reimportar el mismo Excel de puntos** → 0 puntos nuevos (upsert por código) o aviso bloqueante.
   Hoy: todo duplicado (C5).
5. **Campaña completada/archivada: editar un punto** → bloqueado con mensaje. Hoy: se puede.
6. **Mes exportado y cerrado: intentar revertir un evento de ese mes** → exige reapertura con motivo.
   Hoy: no existe el concepto.
7. **Vinilo `Cancelado` sin `incident_payment_week`** → pago 0 €, facturación 0 €. Hoy: pago 8,56 €.
8. **Vinilo `Incidencia` → `Finalizado`** → pago = base + 8,56 en dos líneas con semanas distintas
   (funciona hoy, mantener como regresión).
9. **Punto completado sin gestor** → no exportable, cola de revisión. Hoy: evento "Sin gestor".
10. **Importe negativo en formulario de punto** → rechazado. Hoy: aceptado.
11. **Evento manual extra −50 € "descuento material"** → aceptado, visible como extra, trazado (funciona).
12. **Dos sincronizaciones seguidas sin cambios** → "Sin eventos nuevos" (funciona hoy; mantener).

---

## 4. Auditoría de acciones/campañas y estructura operativa

- **[C] E-1 Tres modelos de campaña.** `services.campaign` (texto libre, sin FK: un typo crea una
  "campaña" nueva a efectos de pagos y filtros), `big_campaigns` (legado, aún alimenta pagos vía
  `payment-ledger`), `grandes_campanas` (nuevo). Decidir: el nuevo módulo es el canónico; migrar datos de
  `big_campaigns` y congelar el legado (solo lectura); convertir `services.campaign` en select sobre
  catálogo. Sin esto, toda mejora se hace por triplicado. *(E-alto, pero es LA decisión estructural.)*
- **[A] E-2 El concepto "acción" no existe.** El pedido del negocio es campaña → acción → punto; hoy la
  "acción" está implícita (un `service` hace de acción de Servicios; en grandes campañas no hay nivel
  intermedio: todos los puntos cuelgan de la campaña). Si una campaña tiene oleadas (montaje/desmontaje),
  hoy se resuelve duplicando campañas. Introducir `acciones` (id, campana_id, tipo, fechas, tarifa_defecto)
  y colgar puntos de la acción es la evolución natural; corto plazo: al menos un campo `oleada/accion`
  filtrable en puntos.
- **[A] E-3 Estados de servicio: una lista lineal que mezcla tres dimensiones.** `serviceStatuses`
  (`app/page.tsx:21`) mezcla ejecución (Pendiente asignar → Reportado), material (Material
  pendiente/recibido, que además duplica `material_status` y `logistics_status` del propio servicio) y
  economía (Validado, Pagado). Un servicio "En ejecución" con material pendiente no se puede representar.
  Separar en: `estado_ejecucion`, `estado_material` (ya existe, ¡usarla!), `estado_economico`.
- **[A] E-4 Estados de punto nuevo módulo insuficientes.** Solo `pendiente|completado|incidencia|cancelado`
  (`v7_0:46`). Faltan los que operaciones usa a diario: `no_localizado`, `material_incorrecto`,
  `pospuesto`, y no hay obligación de `fecha_visita` al completar. La incidencia además vive duplicada:
  como estado del punto **y** como fila de `incidencias_campana` sin sincronía forzada (se puede tener
  punto `completado` con incidencia abierta — la auditoría de Servicios lo detecta, la de campañas nuevas no).
- **[M] E-5 `saveGestoresCampana` borra-e-inserta** (`lib/campanas.ts:306`): entre el delete y el insert,
  un fallo deja la campaña sin equipo; además `assigned_at` se reinicia siempre. Usar upsert diferencial.
- **[M] E-6 Duplicar servicio copia el estado económico limpio pero mantiene `worker_id`** y pone
  "Asignado" (`app/page.tsx:71`) — razonable — pero no avisa si el instalador ya no está activo.
- **[M] E-7 Preguntas operativas sin respuesta en una vista.** "¿Qué falta esta semana?" exige visitar
  Servicios + Campañas + ISDIN + Llamadas. Falta un **panel operativo transversal** (hoy el Panel de
  inicio solo cubre Servicios). Con los eventos y estados existentes se puede montar sin tocar datos.
- **[B] E-8 `campana_gestores.provincia` guarda solo la primera provincia del gestor**
  (`lib/campanas.ts:313`), dato engañoso si el gestor lleva varias.

---

## 5. Auditoría de estados y flujos

- **[A] F-1 Ninguna transición está validada.** Todos los selects de estado permiten cualquier salto
  (ISDIN `Cell` status, campañas `updatePunto`, servicios `updateService`). Mínimos exigibles:
  completar ⇒ fecha; incidencia ⇒ comentario; cancelado tras visita ⇒ marca de visita previa;
  volver de `Finalizado` a `Nuevo` ⇒ confirmación con aviso de impacto en pagos ya sincronizados.
- **[A] F-2 ISDIN `Resuelto - Pendiente colocador`** nombra dos cosas a la vez (resuelta la llamada,
  pendiente la ejecución) y paga como visita fallida. Renombrar a `Pospuesto - pendiente recolocación`
  y documentar en el badge que devenga 8,56 €.
- **[M] F-3 Estados espejo llamada/vinilo** (`Incidencia llamada`, `call_status`) se sincronizan por
  código frágil (`mergeCallsWithVinyls`); ya hubo un bug de VINs duplicados. Falta un test de regresión.
- **[M] F-4 Flujo incidencia campañas nuevas** no reabre el punto: se puede resolver la incidencia
  (`setIncidenciaEstado`) sin tocar el estado del punto y viceversa. Regla: resolver incidencia pregunta
  el estado final del punto; cambiar el punto a completado exige resolver sus incidencias.
- **[B] F-5 `restoreCampana` siempre restaura a `pausada`** aunque se archivara desde `completada`.
  Guardar `estado_anterior` al archivar.

---

## 6. Auditoría de UX/UI general

Lo bueno: los módulos nuevos (Grandes Campañas, Historial, asignación) tienen jerarquía clara, cards
consistentes y feedback correcto. Lo que lastra:

- **[A] U-1 Doble/triple navegación** (detalle en bloque 7). Es el problema nº1 percibido y es real.
- **[A] U-2 Guardado por tecla en ISDIN.** Cada `onChange` de los inputs de comentarios/observaciones
  dispara `updateItem` → un UPDATE a Supabase **por pulsación** (`isdin/page.tsx` Cell), con riesgo de
  escrituras fuera de orden y rendimiento pésimo en tablas largas. Cambiar a guardado en `onBlur` +
  debounce. *(E-bajo, impacto alto.)*
- **[A] U-3 Confirmaciones destructivas débiles.** Borrar vinilo/punto/servicio/cliente usa
  `confirm()` nativo sin resumen de impacto; en cambio borrar campaña (nuevo módulo) tiene modal con
  impacto y escritura del nombre. Unificar al patrón bueno. Borrar un vinilo con pagos ya sincronizados
  deja eventos económicos huérfanos sin aviso.
- **[M] U-4 Dos lenguajes visuales.** Módulo campañas usa tokens `gc-*` (Inter, granate/dorado); el
  resto usa slate/Tailwind crudo. Decidir un sistema y aplicarlo gradualmente (los tokens gc son mejores).
- **[M] U-5 Feedback efímero.** `saved()` muestra 1,2 s y desaparece; errores de Supabase se muestran en
  el mismo toast que los éxitos, sin distinción de color en varios sitios. Errores deben persistir hasta
  cierre manual.
- **[M] U-6 Estados vacíos y carga desiguales.** "Cargando..." como texto plano en ISDIN vs skeletons
  en ninguna parte; estados vacíos buenos en campañas, inexistentes en Home/pagos.
- **[B] U-7 Títulos con versión interna** ("ISDIN · Vinilos V3.9.1") expuestos al usuario.
- **[B] U-8 Iconografía inconsistente** (lucide en casi todo, emojis/flechas de texto "←" en varios headers).

---

## 7. Propuesta de navegación (lateral única + top bar mínima)

**Diagnóstico**: hoy hay (1) `MainNav` superior global, (2) tabs internos del Home (Panel/Servicios/
Calendario/Clientes/Trabajadores/Pagos/Usuarios) que son en la práctica otra app dentro de la app,
(3) subnav ISDIN del layout, y (4) botones de navegación repetidos dentro de los headers de página
(el header de ISDIN Vinilos vuelve a enlazar Dashboard/Llamadas/Facturación que ya están en el subnav).
Cuatro sistemas para un solo usuario.

**Arquitectura recomendada** (sin rediseño, reordenando lo existente):

```
┌────────────┬──────────────────────────────────────────┐
│  SIDEBAR   │  TOP BAR: breadcrumb · buscador global   │
│  (global)  │  (VIN/punto/campaña) · usuario/rol/salir │
│            ├──────────────────────────────────────────┤
│ Panel      │                                          │
│ Campañas   │   CONTENIDO                              │
│ Servicios  │   - tabs internos del módulo             │
│ ISDIN    ▾ │   - filtros pegados al contenido         │
│  · Vinilos │   - acciones primarias arriba-derecha    │
│  · Llamadas│                                          │
│  · KPIs    │                                          │
│  · Factur. │                                          │
│ Logística  │                                          │
│ Económico ▾│                                          │
│  · Historial                                          │
│  · Exportes│                                          │
│ Catálogos ▾│  (Clientes · Trabajadores · Provincias)  │
│ Config   ▾ │  (Usuarios · Sincronización · Tarifas)   │
└────────────┴──────────────────────────────────────────┘
```

Reglas:
1. **Un solo menú lateral global**, colapsable, con secciones expandibles (ISDIN, Económico, Catálogos).
   Se elimina `MainNav` superior y el subnav del layout ISDIN (la expansión lateral lo sustituye).
2. **El Home deja de ser un contenedor de tabs**: Panel, Servicios, Calendario, Clientes, Trabajadores,
   Pagos y Usuarios pasan a ser entradas del lateral (rutas propias o `?tab=` como hoy, da igual al
   principio — lo importante es que el usuario tenga UNA lista de sitios).
3. **Top bar solo con**: breadcrumb (Campañas / ISDIN Verano / Punto X), buscador global (VIN, farmacia,
   punto, campaña — hoy no existe y se echa de menos), y usuario+rol+provincias+salir. Nada de enlaces
   de sección.
4. **Dentro del contenido**: tabs del módulo (como las del detalle de campaña), filtros y acciones.
   Los headers de página pierden sus botones-enlace duplicados.
5. **Rol visible siempre**: el gestor debe ver "Gestor · Valencia, Castellón" fijo en la top bar; hoy
   solo aparece en textos sueltos.

Esfuerzo: E-medio (es mover, no crear). Es el quick-win estructural de UX más rentable.

---

## 8. Auditoría específica Vinilos ISDIN

Con la Fase 4 (paginación, panel de detalle, agrupación) la base es correcta. Lo que falta:

- **[A] I-1 Guardado por tecla** (=U-2). Prioridad uno de esta pantalla.
- **[A] I-2 Carga masiva frágil.** Pegado de texto con 20 columnas posicionales separadas por `;`
  (`parseRows`, `isdin/page.tsx:41`): una columna corrida y se importa todo mal (y `n()` convierte texto
  a 0 sin avisar). Reutilizar el importador de campañas (preview + validación + mapeo de columnas de la
  Fase 2) también aquí. Mientras tanto: vista previa de las 5 primeras filas parseadas antes de confirmar.
- **[A] I-3 Sin validación de medidas.** Alto/ancho aceptan 0, negativos o invertidos; no hay contraste
  con la medida esperada de la campaña ("STANDARD 120 x 150" está en el nombre de campaña y no se usa).
  Avisar si alto×ancho no casa con el tipo (standard vs medida) o si alto>ancho cuando el patrón de la
  campaña es horizontal.
- **[M] I-4 Orden de columnas por defecto no operativo.** Las 24 columnas visibles mezclan crítico
  (estado, instalador, semana) con secundario (alto, ancho, CP) al mismo nivel. Propuesta por defecto:
  Farmacia · VIN · Estado · Instalador · Semana actual · Próx. visita · Provincia · Observaciones ISDIN ·
  Andamio · resto oculto (el selector de columnas ya existe; solo cambiar `defaultVisible`).
- **[M] I-5 Filtros sin presets operativos.** Los chips de semana/estado están bien, pero las preguntas
  frecuentes necesitan un clic: añadir chips-preset "Pendientes de asignar" (sin instalador),
  "Con andamio", "Con observaciones cliente", "Bloqueados por llamada", "Listos para pago".
- **[M] I-6 Estado de material invisible.** El pill de logística existe pero no es filtrable; "¿qué
  vinilos están bloqueados por material?" no se puede responder. Añadir filtro por `logistics_status`.
- **[M] I-7 Sin fotos/reporte.** El cierre (`Finalizado`) no exige ni enlaza evidencia. Aunque el reporte
  llegue por WhatsApp, un campo `report_url/report_ok` marcado al validar daría el mínimo de control
  ("finalizado sin reporte" auditable).
- **[B] I-8 Separación de datos en el panel de detalle** ya implementada (Fase 4); añadir bloque
  "Económico" (líneas de pago del vinilo calculadas con `buildPay`) para que operaciones vea qué
  devengará cada estado antes de cambiarlo.
- **[B] I-9 Export**: el CSV exporta todas las columnas visibles + fijas; añadir preset "export para
  pagos" y "export para cliente" (columnas distintas) en lugar de un único export.

---

## 9. Validaciones necesarias (checklist de implementación)

**Bloqueantes (impiden guardar):**
1. Completar punto/vinilo sin fecha de ejecución.
2. Importe de punto negativo o no numérico (permitir 0 con aviso).
3. Punto `completado` con incidencia abierta (o resolución automática guiada).
4. Cambiar datos económicos (importe, estado pagable) de puntos cuya campaña esté
   `completada/cancelada/archivada` o cuyo mes esté cerrado.
5. Reimportación con códigos ya existentes en la campaña (ofrecer: omitir / actualizar / cancelar).
6. Semana de pago sin formato válido (derivarla de fecha, no de texto).

**Avisos (permiten guardar con confirmación):**
7. Completado sin importe (¿es 0 € de verdad?).
8. Sin instalador/gestor en estado pagable.
9. Medidas incoherentes con el tipo de vinilo (I-3).
10. Provincia del punto fuera de las provincias de la campaña.
11. CP que no casa con la provincia (tabla prefijo-CP → provincia; hoy nada lo valida).
12. Instalador asignado con provincia distinta a la del punto.
13. Duplicado blando: misma farmacia+dirección+campaña.

**Trazabilidad:**
14. Todo cambio de estado/importe/beneficiario escribe en un `change_log` (quién, cuándo, antes,
    después). La tabla `payment_audit_log` de v6.2 ya existe y está sin uso — reutilizarla generalizada.

---

## 10. Casos de prueba recomendados (además de los de pagos §3.3)

- Gestor de Valencia entra a: campaña multi-provincia (ve solo sus KPIs), Historial (solo pagos suyos),
  dashboard ISDIN (solo su provincia), URL directa de facturación (bloqueado). — *Regresión de permisos.*
- Importar Excel de 10.000 filas: tiempo de análisis, avisos correctos, importación por lotes reanuda
  tras fallo a mitad (hoy redirige con `importados=` parcial — verificar que el reintento no duplica: **hoy duplicaría**, C5).
- Dos pestañas abiertas editando el mismo vinilo (last-write-wins silencioso hoy — al menos detectar
  `updated_at` distinto y avisar).
- Cambiar instalador de servicio con puntos ya finalizados → los eventos históricos no cambian de
  beneficiario.
- Semana con acento/typo en import ISDIN → no crea grupo nuevo (tras P-10).
- Usuario desactivado con puntos asignados → aviso en asignación y en pagos.
- Modo local (sin Supabase) → cada pantalla dice claramente que es local; sincronizar después no duplica.

## 11. Lista priorizada de tareas

| Prio | Tarea | Esf. | Ref |
|---|---|---|---|
| C | Reconciliación 1-evento-activo-por-punto en sync (reverso automático) | M | C1 |
| C | Cierre de mes contable (marcar exportado; bloquear reversos/altas sin reapertura) | M | C2 |
| C | Bloquear edición de puntos en campañas cerradas/archivadas | B | C2 |
| C | Arreglar pago de Cancelado ISDIN (paridad con facturación) | B | C4 |
| C | Upsert/dedupe por código en importación de puntos | B-M | C5 |
| C | Decidir beneficiario del módulo nuevo (instalador vs gestor) y unificar poblaciones | M | C6 |
| C | Sanitizar filtro worker (usar `.eq`/`.in` parametrizado, no `.or` interpolado) | B | C7 |
| C | Plan de seguridad: hash de contraseñas + Supabase Auth + RLS (por fases) | A | C3 |
| A | Guardado onBlur/debounce en ISDIN | B | U-2 |
| A | Validaciones bloqueantes 1–6 del §9 | M | — |
| A | Unificar navegación (sidebar única, §7) | M | U-1 |
| A | Deduplicar lógica pagos página↔lib (una sola fuente en `lib/payment-ledger`) | B | P-3 |
| A | Tarifa incidencia configurable | B | P-4 |
| A | Política de revisitas explícita (flag facturable/pagable) | B | P-5 |
| A | Cola "pagos pendientes de revisión" (sin beneficiario, sin fecha) | M | P-6 |
| M | Estados de punto ampliados + transiciones validadas | M | E-4/F-1 |
| M | Panel operativo transversal semanal | M | E-7 |
| M | Presets de filtro ISDIN + columnas por defecto operativas | B | I-4/I-5 |
| M | Importador con preview en ISDIN | M | I-2 |
| M | change_log generalizado sobre payment_audit_log | M | §9.14 |
| B | Pulidos U-4..U-8, I-8, I-9, F-5, E-8 | B | — |

## 12. Quick wins de UX/UI (una tarde cada uno)

1. onBlur en inputs ISDIN (U-2).
2. Columnas por defecto operativas en ISDIN (I-4).
3. Chips-preset "Sin instalador / Con andamio / Bloqueado llamada / Listo para pago" (I-5).
4. Alcance visible junto a cada KPI de dinero ("sobre 214 filas filtradas").
5. Toasts: error persistente y rojo, éxito efímero y verde, en todos los módulos.
6. Quitar botones-enlace duplicados de los headers ISDIN (el subnav ya existe).
7. Rol y provincias fijos en la barra superior.
8. Quitar "V3.9.1" del título.

## 13. Riesgos si no se corrige

- **Económico directo**: C1+C5 pueden producir pagos duplicados difíciles de detectar (mismo punto, dos
  fingerprints válidos). C4 paga visitas inexistentes en cada cancelación temprana ISDIN.
- **Confianza**: cuatro cifras distintas de "pagos" según pantalla (P-9) minan la credibilidad del
  Historial económico justo cuando empieza.
- **Legal/seguridad**: contraseñas en claro accesibles desde el navegador (C3) es incidente de datos
  esperando fecha.
- **Escalado**: cada módulo nuevo sobre tres modelos de campaña triplica el coste de mantenimiento (E-1).

## 14. Roadmap recomendado

- **Sprint 1 (estabilizar pagos)**: C1, C2, C4, C5, C7, P-6, P-7 + tests §3.3 automatizados o guionizados.
- **Sprint 2 (seguridad + orden)**: C3 fase 1 (hash + no descargar passwords), C6, navegación única §7,
  U-2/U-3, validaciones §9 bloqueantes.
- **Sprint 3 (consolidación)**: E-1 (modelo único de campaña, congelar legado), E-3/E-4 estados,
  change_log, cierre de mes con UI.
- **Sprint 4 (operativa fina)**: panel transversal, presets ISDIN, importador ISDIN con preview,
  política de revisitas, RLS completo con Supabase Auth.

## 15. Checklist final para considerar MerchanOPS estable

- [ ] Un punto = como máximo un evento de pago activo, demostrable con test.
- [ ] Mes contable se cierra y lo cerrado es inmutable sin reapertura trazada.
- [ ] Campaña cerrada/archivada = solo lectura operativa.
- [ ] Reimportar un archivo no duplica puntos.
- [ ] Pagos ISDIN = facturación ISDIN en reglas de cancelación/incidencia (con margen documentado).
- [ ] Un solo beneficiario tipado (instalador) en todos los motores de pago.
- [ ] Ninguna contraseña legible desde el cliente; escrituras económicas verificadas en servidor.
- [ ] Toda cifra de dinero en pantalla declara su alcance.
- [ ] Navegación: una lateral global + top bar (breadcrumb, buscador, usuario).
- [ ] Cambios de estado con requisitos (fecha, comentario, resolución de incidencias).
- [ ] change_log consultable: quién cambió qué importe/estado y cuándo.
- [ ] Los 12 casos de prueba de §3.3 y los de §10 pasan.
