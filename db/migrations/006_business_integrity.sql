ALTER TABLE vehiculos
  DROP CONSTRAINT IF EXISTS vehiculos_capacidad_check;

ALTER TABLE vehiculos
  ADD CONSTRAINT vehiculos_capacidad_check CHECK (capacidad = 4);

ALTER TABLE boletos
  DROP CONSTRAINT IF EXISTS boletos_asiento_check;

ALTER TABLE boletos
  ADD CONSTRAINT boletos_asiento_check CHECK (asiento BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS motivo_anulacion VARCHAR(300),
  ADD COLUMN IF NOT EXISTS nota_credito_estado VARCHAR(20);

ALTER TABLE boletos
  DROP CONSTRAINT IF EXISTS boletos_nota_credito_check;

ALTER TABLE boletos
  ADD CONSTRAINT boletos_nota_credito_check
    CHECK (
      nota_credito_estado IS NULL
      OR nota_credito_estado IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA')
    );

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS motivo_cancelacion VARCHAR(300);

ALTER TABLE solicitudes_recojo
  DROP CONSTRAINT IF EXISTS recojos_estado_check;

ALTER TABLE solicitudes_recojo
  ADD CONSTRAINT recojos_estado_check
    CHECK (
      estado IN ('PENDIENTE', 'ASIGNADO', 'EN_CAMINO', 'COMPLETADO', 'CANCELADO')
    );

CREATE OR REPLACE FUNCTION enforce_parcel_tracking_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_state VARCHAR(25);
BEGIN
  SELECT estado
  INTO previous_state
  FROM tracking_encomiendas
  WHERE id_encomienda = NEW.id_encomienda
  ORDER BY fecha_hora DESC, id_tracking DESC
  LIMIT 1;

  IF previous_state IS NULL AND NEW.estado <> 'REGISTRADO' THEN
    RAISE EXCEPTION 'El primer estado de una encomienda debe ser REGISTRADO.';
  ELSIF previous_state = 'REGISTRADO'
    AND NEW.estado NOT IN ('RECOJO_DOMICILIO', 'EN_TRANSITO') THEN
    RAISE EXCEPTION 'Transición de encomienda no permitida.';
  ELSIF previous_state = 'RECOJO_DOMICILIO' AND NEW.estado <> 'EN_TRANSITO' THEN
    RAISE EXCEPTION 'Transición de encomienda no permitida.';
  ELSIF previous_state = 'EN_TRANSITO' AND NEW.estado <> 'EN_DESTINO' THEN
    RAISE EXCEPTION 'Transición de encomienda no permitida.';
  ELSIF previous_state = 'EN_DESTINO' AND NEW.estado <> 'ENTREGADO' THEN
    RAISE EXCEPTION 'Transición de encomienda no permitida.';
  ELSIF previous_state = 'ENTREGADO' THEN
    RAISE EXCEPTION 'Una encomienda entregada no puede cambiar de estado.';
  END IF;

  IF NEW.estado = 'ENTREGADO'
    AND COALESCE(NEW.evidencia ->> 'signature', '') NOT LIKE 'data:image/png;base64,%'
  THEN
    RAISE EXCEPTION 'La entrega requiere una firma válida.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tracking_transition_guard ON tracking_encomiendas;
CREATE TRIGGER tracking_transition_guard
BEFORE INSERT ON tracking_encomiendas
FOR EACH ROW
EXECUTE FUNCTION enforce_parcel_tracking_transition();
