-- v9_6: correo electronico del trabajador
-- Anade el campo email a la ficha de trabajador (Catalogos > Trabajadores).
-- Idempotente: seguro de re-ejecutar. No toca RLS (workers ya esta cubierto por
-- province_scope_all en v9_3).

alter table workers add column if not exists email text;
