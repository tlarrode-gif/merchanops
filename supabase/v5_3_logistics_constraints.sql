-- V5.3 Ajustes defensivos para sincronización logística real.
-- Amplía tipos de incidencia y evita que estados nuevos fallen por checks antiguos.

alter table logistics_incidents drop constraint if exists logistics_incidents_tipo_check;
alter table logistics_incidents add constraint logistics_incidents_tipo_check
check (tipo in (
  'sin_picking',
  'medidas',
  'danado',
  'incorrecto',
  'falta',
  'exceso',
  'perdida',
  'entrega_fallida',
  'defecto_produccion',
  'material_no_recibido',
  'medidas_incorrectas',
  'material_danado',
  'vin_equivocado',
  'instalacion_no_realizada',
  'farmacia_cerrada',
  'escaparate_cambiado',
  'material_sobrante'
));
