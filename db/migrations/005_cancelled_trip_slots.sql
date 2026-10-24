-- Keep cancelled trips as history without reserving their departure slot.
ALTER TABLE viajes
  DROP CONSTRAINT IF EXISTS viajes_vehiculo_salida_unique,
  DROP CONSTRAINT IF EXISTS viajes_conductor_salida_unique;

CREATE UNIQUE INDEX IF NOT EXISTS viajes_vehiculo_salida_activo_unique
  ON viajes (id_vehiculo, fecha_hora_salida)
  WHERE estado IN ('PROGRAMADO', 'EN_CURSO');

CREATE UNIQUE INDEX IF NOT EXISTS viajes_conductor_salida_activo_unique
  ON viajes (id_conductor, fecha_hora_salida)
  WHERE estado IN ('PROGRAMADO', 'EN_CURSO');
