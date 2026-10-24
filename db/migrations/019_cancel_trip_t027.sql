-- Cancelar viaje T027 que quedó en estado EN_CURSO a solicitud de administración
UPDATE viajes
SET estado = 'CANCELADO',
    motivo_cancelacion = 'Cancelación solicitada por administración',
    updated_at = NOW()
WHERE id_viaje = 27 AND estado = 'EN_CURSO';

UPDATE boletos
SET estado = 'ANULADO',
    anulado_at = NOW(),
    motivo_anulacion = 'Cancelación de viaje T027',
    nota_credito_estado = 'PENDIENTE'
WHERE id_viaje = 27 AND estado = 'ACTIVO';
