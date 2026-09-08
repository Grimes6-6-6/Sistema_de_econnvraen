-- Alertas derivadas de los documentos vigentes; lectura independiente por usuario.
CREATE TABLE IF NOT EXISTS notificaciones_lecturas (
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  clave TEXT NOT NULL CHECK (clave ~ '^[a-f0-9]{64}$'),
  leida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_usuario, clave)
);
