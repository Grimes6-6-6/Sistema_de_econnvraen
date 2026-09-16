-- Mantiene los permisos persistidos alineados con la matriz que aplica la API.
-- La autorización efectiva sigue estando en el servidor; este catálogo evita
-- que la información de roles de la base quede desactualizada o ambigua.
-- También crea el catálogo completo durante el bootstrap, antes del seed.
INSERT INTO roles (nombre, descripcion, permisos)
VALUES
  (
    'SUPER_ADMIN',
    'Administración global de todas las agencias',
    '["data:view", "agency:switch", "agency:manage", "user:manage", "user:manage-super", "audit:view", "backup:manage", "reports:agency", "reports:global", "cash:today-view", "ticket:sell", "ticket:cancel-request", "ticket:cancel-approve", "dni:lookup", "parcel:create", "parcel:status-manage", "trip:view", "trip:manage", "trip:status-manage", "pickup:create", "pickup:assign", "pickup:status-manage", "fleet:view", "fleet:manage", "incident:view", "incident:create", "driver:self-manage", "gps:publish", "config:manage"]'::jsonb
  ),
  (
    'ADMINISTRADOR',
    'Administración de sus agencias asignadas',
    '["data:view", "agency:switch", "user:manage", "reports:agency", "cash:today-view", "ticket:sell", "ticket:cancel-request", "ticket:cancel-approve", "dni:lookup", "parcel:create", "parcel:status-manage", "trip:view", "trip:manage", "trip:status-manage", "pickup:create", "pickup:assign", "pickup:status-manage", "fleet:view", "fleet:manage", "incident:view", "incident:create"]'::jsonb
  ),
  (
    'OPERADOR',
    'Ventas, encomiendas, viajes y recojos',
    '["data:view", "agency:switch", "cash:today-view", "ticket:sell", "ticket:cancel-request", "dni:lookup", "parcel:create", "trip:view", "pickup:create", "incident:view"]'::jsonb
  ),
  (
    'CONDUCTOR',
    'Manifiestos y entregas de sus viajes',
    '["data:view", "agency:switch", "parcel:status-manage", "trip:view", "trip:status-manage", "pickup:status-manage", "incident:view", "incident:create", "driver:self-manage", "gps:publish"]'::jsonb
  )
ON CONFLICT (nombre) DO UPDATE
SET descripcion = EXCLUDED.descripcion,
    permisos = EXCLUDED.permisos;
