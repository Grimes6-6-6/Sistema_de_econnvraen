ALTER TABLE documentos_operativos
  DROP CONSTRAINT IF EXISTS documentos_tipo_check;

UPDATE documentos_operativos
SET tipo_documento = 'OTRO',
    numero = LEFT(CONCAT('DNI-', id_documento, '-', numero), 60),
    observacion = LEFT(
      CONCAT('DNI · ', COALESCE(observacion, 'Documento de identidad')),
      300
    )
WHERE tipo_documento = 'DNI';

ALTER TABLE documentos_operativos
  ADD CONSTRAINT documentos_tipo_check CHECK (
    tipo_documento IN (
      'LICENCIA', 'SOAT', 'CITV', 'TUC', 'TARJETA_PROPIEDAD',
      'ANTECEDENTES', 'SALUD', 'OTRO'
    )
  );

DROP INDEX IF EXISTS conductores_identidad_estado_idx;

ALTER TABLE conductores
  DROP CONSTRAINT IF EXISTS conductores_identidad_estado_check,
  DROP COLUMN IF EXISTS identidad_verificada_at,
  DROP COLUMN IF EXISTS identidad_verificada_por,
  DROP COLUMN IF EXISTS identidad_observacion,
  DROP COLUMN IF EXISTS identidad_estado;
