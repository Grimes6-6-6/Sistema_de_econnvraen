CREATE OR REPLACE FUNCTION enforce_trip_agency_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  route_agency INTEGER;
  vehicle_agency INTEGER;
  driver_agency INTEGER;
BEGIN
  SELECT
    route.id_agencia_origen,
    vehicle.id_agencia_base,
    driver.id_agencia_base
  INTO route_agency, vehicle_agency, driver_agency
  FROM rutas route
  CROSS JOIN vehiculos vehicle
  CROSS JOIN conductores driver
  WHERE route.id_ruta = NEW.id_ruta
    AND vehicle.id_vehiculo = NEW.id_vehiculo
    AND driver.id_conductor = NEW.id_conductor;

  IF NOT FOUND
     OR NEW.id_agencia <> route_agency
     OR NEW.id_agencia <> vehicle_agency
     OR NEW.id_agencia <> driver_agency THEN
    RAISE EXCEPTION 'El viaje contiene recursos de agencias diferentes.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS viajes_agencia_consistente ON viajes;
CREATE TRIGGER viajes_agencia_consistente
BEFORE INSERT OR UPDATE OF id_agencia, id_ruta, id_vehiculo, id_conductor
ON viajes
FOR EACH ROW
EXECUTE FUNCTION enforce_trip_agency_consistency();

CREATE OR REPLACE FUNCTION enforce_ticket_agency_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  trip_agency INTEGER;
BEGIN
  SELECT id_agencia
  INTO trip_agency
  FROM viajes
  WHERE id_viaje = NEW.id_viaje;

  IF NOT FOUND OR NEW.id_agencia_venta <> trip_agency THEN
    RAISE EXCEPTION 'El boleto no pertenece a la agencia del viaje.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boletos_agencia_consistente ON boletos;
CREATE TRIGGER boletos_agencia_consistente
BEFORE INSERT OR UPDATE OF id_agencia_venta, id_viaje
ON boletos
FOR EACH ROW
EXECUTE FUNCTION enforce_ticket_agency_consistency();

CREATE OR REPLACE FUNCTION enforce_parcel_agency_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  trip_agency INTEGER;
BEGIN
  SELECT id_agencia
  INTO trip_agency
  FROM viajes
  WHERE id_viaje = NEW.id_viaje;

  IF NOT FOUND OR NEW.id_agencia_registro <> trip_agency THEN
    RAISE EXCEPTION 'La encomienda no pertenece a la agencia del viaje.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS encomiendas_agencia_consistente ON encomiendas;
CREATE TRIGGER encomiendas_agencia_consistente
BEFORE INSERT OR UPDATE OF id_agencia_registro, id_viaje
ON encomiendas
FOR EACH ROW
EXECUTE FUNCTION enforce_parcel_agency_consistency();

CREATE OR REPLACE FUNCTION enforce_pickup_assignment_agency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id_usuario_asignado IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM usuarios user_account
       JOIN conductores driver
         ON driver.id_persona = user_account.id_persona
       JOIN usuarios_agencias membership
         ON membership.id_usuario = user_account.id_usuario
        AND membership.id_agencia = NEW.id_agencia
        AND membership.estado = 'ACTIVO'
       WHERE user_account.id_usuario = NEW.id_usuario_asignado
         AND user_account.estado = 'ACTIVO'
         AND driver.id_agencia_base = NEW.id_agencia
         AND driver.habilitado = TRUE
     ) THEN
    RAISE EXCEPTION 'El conductor asignado pertenece a otra agencia.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recojos_asignacion_agencia_consistente
  ON solicitudes_recojo;
CREATE TRIGGER recojos_asignacion_agencia_consistente
BEFORE INSERT OR UPDATE OF id_agencia, id_usuario_asignado
ON solicitudes_recojo
FOR EACH ROW
EXECUTE FUNCTION enforce_pickup_assignment_agency();

CREATE OR REPLACE FUNCTION enforce_session_agency_access()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_role VARCHAR(30);
BEGIN
  SELECT role.nombre
  INTO user_role
  FROM usuarios user_account
  JOIN roles role ON role.id_rol = user_account.id_rol
  WHERE user_account.id_usuario = NEW.id_usuario
    AND user_account.estado = 'ACTIVO';

  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1
       FROM agencias agency
       WHERE agency.id_agencia = NEW.id_agencia_activa
         AND agency.estado = 'ACTIVA'
     )
     OR (
       user_role <> 'SUPER_ADMIN'
       AND NOT EXISTS (
         SELECT 1
         FROM usuarios_agencias membership
         WHERE membership.id_usuario = NEW.id_usuario
           AND membership.id_agencia = NEW.id_agencia_activa
           AND membership.estado = 'ACTIVO'
       )
     ) THEN
    RAISE EXCEPTION 'El usuario no tiene acceso a la agencia de la sesión.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE sesiones
  ALTER COLUMN id_agencia_activa SET NOT NULL;

DROP TRIGGER IF EXISTS sesiones_acceso_agencia_consistente ON sesiones;
CREATE TRIGGER sesiones_acceso_agencia_consistente
BEFORE INSERT OR UPDATE OF id_usuario, id_agencia_activa
ON sesiones
FOR EACH ROW
EXECUTE FUNCTION enforce_session_agency_access();
