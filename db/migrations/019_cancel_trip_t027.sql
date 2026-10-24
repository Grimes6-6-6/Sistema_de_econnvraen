-- Finalizar viaje en curso a solicitud del usuario
UPDATE viajes
SET estado = 'COMPLETADO'
WHERE estado IN ('EN_CURSO', 'en_curso');
