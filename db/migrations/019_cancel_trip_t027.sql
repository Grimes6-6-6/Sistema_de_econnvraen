-- Finalizar viajes en curso o programados para liberar recursos
UPDATE viajes
SET estado = 'COMPLETADO'
WHERE estado IN ('EN_CURSO', 'en_curso', 'PROGRAMADO', 'programado');
