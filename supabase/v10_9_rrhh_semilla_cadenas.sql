-- v10_9 · Semilla del catálogo de cadenas: que "Accesos a centro" nazca viva.
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-31 (34 cadenas).
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- Medido hoy en producción: 0 cadenas y 0 centros.
--
-- Eso significa que quien abre "Accesos a centro" se encuentra una pantalla
-- MUERTA: no puede pedir un solo acceso hasta haber tecleado a mano, una por
-- una, todas las cadenas de distribución de España con su modo de trámite y su
-- plazo. Y hasta que no existe la cadena, el "texto gris" que justifica toda la
-- pantalla —«Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes
-- del 29/07»— no puede calcularse, porque `modo_tramite` y `lead_time_dias`
-- salen de `cadenas` (v10_5) y no hay ninguna fila.
--
-- v10_5 decidió NO sembrar (su decisión (d)): el argumento era que unos plazos
-- inventados producirían un "pedir antes del 29/07" falso que la gente se
-- creería. El argumento sigue siendo bueno, pero el precio resultó peor que el
-- riesgo: la pantalla no arranca, y el módulo entero parece más lento que un
-- Excel justamente en el primer clic. Se corrige aquí.
--
-- ============================================================================
-- DECISIÓN
-- ============================================================================
-- a) Se siembran SOLO CADENAS, con `modo_tramite` y `lead_time_dias` de
--    ARRANQUE. Son VALORES DE PARTIDA RAZONABLES, NO datos verificados con
--    cada cadena: RR.HH. los corrige desde la pantalla "Cadenas y centros" en
--    cuanto conozca el plazo real, y esa corrección es la que manda.
--
-- b) IDEMPOTENTE Y SIN PISAR A RR.HH.: `on conflict (nombre) do nothing`.
--    Nunca `do update`. Si mañana RR.HH. pone el plazo de Carrefour en 7 días y
--    alguien reaplica esta migración, Carrefour SIGUE en 7. Reaplicarla solo
--    puede añadir cadenas que falten, jamás devolver ninguna a "fábrica".
--
-- c) NO SE SIEMBRA NINGÚN CENTRO. Un centro es una dirección, un código de
--    tienda y una población concretos: eso no se sabe, se inventaría, y un
--    centro inventado es peor que ninguno porque alguien pediría un acceso
--    para una tienda que no existe. Los centros entran por dos vías legítimas:
--    los da de alta RR.HH. desde la pantalla, o llegan enlazados desde los
--    puntos de campaña (`puntos_venta_campana.centro_id`, v10_5). Además, una
--    cadena sin centros ya es útil el primer día: si `modo_tramite = 'cadena'`
--    la solicitud se pide con `centro_id` NULL y no necesita centro ninguno.
--
-- d) Todas nacen `activa = true` (el default). La cadena que esta empresa no
--    trabaje se retira con `activa = false` desde la pantalla; no se borra,
--    porque los accesos históricos la referencian (v10_5, ON DELETE RESTRICT).
--
-- e) Esta migración escribe en `cadenas`, cuya RLS solo deja escribir a admin o
--    al ROL rrhh (v10_5). Se aplica con el rol de migración (postgres /
--    service_role), que no pasa por RLS. No se toca ninguna policy.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- 1. La pantalla ya tiene de dónde tirar
--   select count(*) from public.cadenas;                     -- 34
--   select nombre, modo_tramite, lead_time_dias
--     from public.cadenas order by nombre;
--
--   -- 2. Es idempotente: reaplicar el fichero entero no duplica nada
--   --    (vuelve a dar 34, no 68)
--
--   -- 3. NO pisa a RR.HH.: simular la corrección y reaplicar
--   update public.cadenas set lead_time_dias = 7 where nombre = 'Carrefour';
--   -- ...reaplicar esta migración...
--   select lead_time_dias from public.cadenas where nombre = 'Carrefour'; -- 7, no 3
--
--   -- 4. Ningún centro inventado
--   select count(*) from public.centros;                     -- 0
--
--   -- 5. Desde la app, con sesión de gestora: el desplegable de cadenas ya
--   --    trae filas y el "texto gris" calcula plazo sin teclear nada.
--
-- ROLLBACK (seguro: no borra nada que tenga datos colgando):
--   delete from public.cadenas c
--    where c.nombre in (
--            'Alcampo','Carrefour','El Corte Inglés','Media Markt','Makro',
--            'Eroski','Lidl','Aldi','Dia','Mercadona','Leroy Merlin','Ikea',
--            'Consum','Alimerka','Hipercor','Supercor','Ahorramas','Gadis',
--            'Caprabo','Condis','BM Supermercados','Froiz','Bonpreu',
--            'Covirán','Bricomart','Bricodepôt','Worten','Fnac','Decathlon',
--            'Conforama','Primor','Druni','Douglas','Arenal Perfumerías')
--      and not exists (select 1 from public.centros ce
--                       where ce.cadena_id = c.id)
--      and not exists (select 1 from public.rrhh_solicitudes_acceso a
--                       where a.cadena_id = c.id);
--
--   Las dos cláusulas `not exists` son el punto entero del rollback: una cadena
--   a la que RR.HH. ya le colgó centros, o sobre la que ya hay accesos pedidos,
--   NO es "semilla" — es dato de la casa y se queda. (Las dos FK son ON DELETE
--   RESTRICT, así que sin los filtros el delete no borraría de más: fallaría
--   entero. Preferimos que revierta lo revertible y respete lo demás.)
--   Si `rrhh_solicitudes_acceso` (v10_7) no existiera, quitar ese segundo
--   `not exists`.
--
--   Ojo: una cadena a la que RR.HH. solo le cambió el plazo, sin centros ni
--   accesos todavía, SÍ se borra — desde la base no se distingue de la fila de
--   semilla. Es aceptable porque revertir esto significa retirar el catálogo
--   entero; si solo sobra alguna cadena, lo correcto no es el rollback sino
--   ponerle `activa = false` desde la pantalla.

-- ---------------------------------------------------------------------------
-- Semilla de cadenas
-- ---------------------------------------------------------------------------
-- Las catorce primeras son las del diseño y las grandes de distribución. El
-- resto son las habituales del sector de trade marketing en España (gran
-- consumo, electro, bricolaje y perfumería, esta última por el trabajo de
-- ISDIN). Se agrupan por comentario solo para poder leerlas; para la base son
-- una sola lista.
--
-- Criterio de los valores de arranque, para que se entienda de dónde salen y
-- se puedan discutir:
--   · modo_tramite = 'centro' cuando el permiso lo autoriza cada tienda (gran
--     superficie de alimentación, donde manda el jefe de sala).
--   · modo_tramite = 'cadena' cuando existe un interlocutor único nacional o de
--     central y una sola solicitud cubre todas las tiendas.
--   · lead_time_dias = días de antelación con los que se pide. 0 = se puede
--     pedir el mismo día del trabajo.
-- INSISTIMOS: son valores de arranque. RR.HH. los corrige desde la pantalla
-- "Cadenas y centros" y su corrección sobrevive a reaplicar esta migración.
with semilla (nombre, modo_tramite, lead_time_dias) as (
  values
    -- Las del diseño y la gran distribución
    ('Alcampo',             'centro', 2),
    ('Carrefour',           'centro', 3),
    ('El Corte Inglés',     'centro', 4),
    ('Media Markt',         'cadena', 0),
    ('Makro',               'cadena', 1),
    ('Eroski',              'cadena', 2),
    ('Lidl',                'cadena', 2),
    ('Aldi',                'cadena', 2),
    ('Dia',                 'centro', 2),
    ('Mercadona',           'centro', 5),
    ('Leroy Merlin',        'centro', 3),
    ('Ikea',                'cadena', 3),
    ('Consum',              'centro', 2),
    ('Alimerka',            'centro', 2),
    -- Gran consumo, resto de enseñas habituales
    ('Hipercor',            'centro', 4),
    ('Supercor',            'centro', 4),
    ('Ahorramas',           'centro', 2),
    ('Gadis',               'centro', 2),
    ('Caprabo',             'centro', 2),
    ('Condis',              'centro', 2),
    ('BM Supermercados',    'centro', 2),
    ('Froiz',               'centro', 2),
    ('Bonpreu',             'centro', 2),
    ('Covirán',             'cadena', 2),
    -- Electro y bricolaje
    ('Bricomart',           'centro', 3),
    ('Bricodepôt',          'centro', 3),
    ('Worten',              'cadena', 2),
    ('Fnac',                'cadena', 2),
    ('Decathlon',           'centro', 2),
    ('Conforama',           'cadena', 3),
    -- Perfumería y parafarmacia
    ('Primor',              'cadena', 2),
    ('Druni',               'cadena', 2),
    ('Douglas',             'cadena', 2),
    ('Arenal Perfumerías',  'cadena', 2)
)
insert into public.cadenas (nombre, modo_tramite, lead_time_dias)
select s.nombre, s.modo_tramite, s.lead_time_dias
  from semilla s
on conflict (nombre) do nothing;
-- `do nothing`, NUNCA `do update`: ver decisión (b) de la cabecera.
