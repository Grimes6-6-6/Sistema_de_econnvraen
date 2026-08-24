ALTER TABLE ubicaciones_vehiculos
  ADD COLUMN IF NOT EXISTS id_viaje INTEGER
    REFERENCES viajes(id_viaje) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;

UPDATE ubicaciones_vehiculos
SET captured_at = updated_at
WHERE captured_at IS NULL;

ALTER TABLE ubicaciones_vehiculos
  ALTER COLUMN captured_at SET DEFAULT NOW(),
  ALTER COLUMN captured_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ubicaciones_vehiculos_request_uidx
  ON ubicaciones_vehiculos (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ubicaciones_vehiculos_trip_idx
  ON ubicaciones_vehiculos (id_viaje, captured_at DESC)
  WHERE id_viaje IS NOT NULL;

CREATE TABLE IF NOT EXISTS historial_ubicaciones_vehiculos (
  id_ubicacion BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  id_conductor INTEGER NOT NULL
    REFERENCES conductores(id_conductor) ON DELETE CASCADE,
  id_viaje INTEGER NOT NULL
    REFERENCES viajes(id_viaje) ON DELETE CASCADE,
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  accuracy_m NUMERIC(9,2) NOT NULL,
  speed_kmh NUMERIC(6,2),
  heading NUMERIC(6,2),
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  CONSTRAINT gps_history_latitude_check
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT gps_history_longitude_check
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT gps_history_accuracy_check
    CHECK (accuracy_m BETWEEN 0 AND 5000),
  CONSTRAINT gps_history_speed_check
    CHECK (speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 300),
  CONSTRAINT gps_history_heading_check
    CHECK (heading IS NULL OR heading BETWEEN 0 AND 360),
  CONSTRAINT gps_history_capture_time_check
    CHECK (captured_at <= received_at + INTERVAL '1 minute')
);

CREATE INDEX IF NOT EXISTS gps_history_trip_time_idx
  ON historial_ubicaciones_vehiculos (id_viaje, captured_at DESC);

CREATE INDEX IF NOT EXISTS gps_history_driver_time_idx
  ON historial_ubicaciones_vehiculos (id_conductor, captured_at DESC);
