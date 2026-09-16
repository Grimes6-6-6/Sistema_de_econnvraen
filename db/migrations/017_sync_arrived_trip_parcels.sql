-- Encomiendas de viajes ya completados deben reflejar la llegada al destino.
-- No se marcan como ENTREGADAS: esa confirmación corresponde al destinatario.
WITH arrived AS (
  UPDATE encomiendas
  SET estado = 'EN_DESTINO', updated_at = NOW()
  WHERE estado = 'EN_TRANSITO'
    AND id_viaje IN (
      SELECT id_viaje
      FROM viajes
      WHERE estado = 'COMPLETADO'
    )
  RETURNING id_encomienda, id_viaje
)
INSERT INTO tracking_encomiendas (
  id_encomienda,
  estado,
  ubicacion,
  fecha_hora,
  observacion
)
SELECT
  arrived.id_encomienda,
  'EN_DESTINO',
  'Agencia de destino',
  COALESCE(trip.fecha_hora_llegada, NOW()),
  'Sincronización de llegada del viaje completado.'
FROM arrived
JOIN viajes trip ON trip.id_viaje = arrived.id_viaje;
