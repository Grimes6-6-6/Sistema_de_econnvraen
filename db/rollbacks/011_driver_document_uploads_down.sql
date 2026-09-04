ALTER TABLE documentos_operativos
  DROP CONSTRAINT IF EXISTS documentos_archivo_check,
  DROP CONSTRAINT IF EXISTS documentos_origen_check,
  DROP CONSTRAINT IF EXISTS documentos_estado_check;

UPDATE documentos_operativos
SET estado = 'OBSERVADO',
    observacion = COALESCE(
      observacion,
      'Documento pendiente al revertir el flujo de revisión'
    )
WHERE estado = 'PENDIENTE';

ALTER TABLE documentos_operativos
  ADD CONSTRAINT documentos_estado_check
    CHECK (estado IN ('VIGENTE', 'POR_VENCER', 'VENCIDO', 'OBSERVADO'));

DROP INDEX IF EXISTS documentos_alertas_idx;

ALTER TABLE documentos_operativos
  DROP COLUMN IF EXISTS revisado_at,
  DROP COLUMN IF EXISTS revisado_por,
  DROP COLUMN IF EXISTS archivo_contenido,
  DROP COLUMN IF EXISTS archivo_sha256,
  DROP COLUMN IF EXISTS archivo_tamano,
  DROP COLUMN IF EXISTS archivo_mime,
  DROP COLUMN IF EXISTS archivo_nombre,
  DROP COLUMN IF EXISTS origen_registro;
