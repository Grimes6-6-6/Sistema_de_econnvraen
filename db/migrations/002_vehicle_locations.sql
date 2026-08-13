CREATE TABLE IF NOT EXISTS ubicaciones_vehiculos (
  id_conductor INTEGER PRIMARY KEY
    REFERENCES conductores(id_conductor) ON DELETE CASCADE,
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  accuracy_m NUMERIC(9,2) NOT NULL,
  speed_kmh NUMERIC(6,2),
  heading NUMERIC(6,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ubicaciones_latitude_check
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT ubicaciones_longitude_check
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT ubicaciones_accuracy_check
    CHECK (accuracy_m BETWEEN 0 AND 100000),
  CONSTRAINT ubicaciones_speed_check
    CHECK (speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 300),
  CONSTRAINT ubicaciones_heading_check
    CHECK (heading IS NULL OR heading BETWEEN 0 AND 360)
);

CREATE INDEX IF NOT EXISTS ubicaciones_vehiculos_active_idx
  ON ubicaciones_vehiculos (is_active, updated_at DESC);
