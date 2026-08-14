require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

async function initDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("No DATABASE_URL found in .env.local");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    console.log("Creando tablas con esquema compatible...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehiculos (
        id_vehiculo SERIAL PRIMARY KEY,
        placa VARCHAR(20) UNIQUE NOT NULL,
        marca VARCHAR(50),
        modelo VARCHAR(50),
        capacidad INT,
        estado VARCHAR(20) DEFAULT 'ACTIVO'
      );

      CREATE TABLE IF NOT EXISTS conductores (
        id_conductor SERIAL PRIMARY KEY,
        id_usuario INT REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        licencia VARCHAR(50),
        categoria VARCHAR(20),
        fecha_vencimiento DATE,
        estado VARCHAR(20) DEFAULT 'ACTIVO'
      );

      CREATE TABLE IF NOT EXISTS viajes (
        id_viaje SERIAL PRIMARY KEY,
        codigo VARCHAR(20) UNIQUE NOT NULL,
        origen VARCHAR(100) NOT NULL,
        destino VARCHAR(100) NOT NULL,
        fecha DATE NOT NULL,
        hora_salida TIME NOT NULL,
        hora_llegada TIME,
        id_conductor INT REFERENCES conductores(id_conductor),
        id_vehiculo INT REFERENCES vehiculos(id_vehiculo),
        estado VARCHAR(30) DEFAULT 'EN_RUTA'
      );

      CREATE TABLE IF NOT EXISTS pasajeros (
        id_pasajero SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        documento VARCHAR(20) UNIQUE NOT NULL,
        telefono VARCHAR(20)
      );

      CREATE TABLE IF NOT EXISTS reservas (
        id_reserva SERIAL PRIMARY KEY,
        id_viaje INT REFERENCES viajes(id_viaje) ON DELETE CASCADE,
        id_pasajero INT REFERENCES pasajeros(id_pasajero),
        asiento VARCHAR(10),
        estado VARCHAR(20) DEFAULT 'EMBARCADO'
      );

      CREATE TABLE IF NOT EXISTS encomiendas (
        id_encomienda SERIAL PRIMARY KEY,
        codigo VARCHAR(30) UNIQUE NOT NULL,
        id_viaje INT REFERENCES viajes(id_viaje) ON DELETE CASCADE,
        remitente VARCHAR(150),
        destinatario VARCHAR(150),
        descripcion TEXT,
        cantidad INT DEFAULT 1,
        estado VARCHAR(30) DEFAULT 'EN_RUTA'
      );

      CREATE TABLE IF NOT EXISTS incidencias (
        id_incidencia SERIAL PRIMARY KEY,
        id_viaje INT REFERENCES viajes(id_viaje) ON DELETE CASCADE,
        id_conductor INT REFERENCES conductores(id_conductor),
        tipo VARCHAR(50),
        descripcion TEXT,
        ubicacion VARCHAR(150),
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        estado VARCHAR(20) DEFAULT 'REPORTADO'
      );

      CREATE TABLE IF NOT EXISTS notificaciones (
        id_notificacion SERIAL PRIMARY KEY,
        id_usuario INT REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        titulo VARCHAR(150),
        mensaje TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        leida BOOLEAN DEFAULT false
      );
    `);

    console.log("Tablas creadas. Insertando datos reales de prueba...");

    // Encontrar al usuario conductor1
    const usersRes = await pool.query("SELECT id_usuario FROM usuarios WHERE username = 'conductor1' LIMIT 1;");
    if (usersRes.rows.length === 0) {
      console.log("No se encontro el usuario 'conductor1'.");
      process.exit(1);
    }
    const userId = usersRes.rows[0].id_usuario;

    // Conductor
    let driverRes = await pool.query("SELECT id_conductor FROM conductores WHERE id_usuario = $1", [userId]);
    let driverId;
    if (driverRes.rows.length === 0) {
      const insertDriver = await pool.query(
        "INSERT INTO conductores (id_usuario, licencia, categoria, fecha_vencimiento) VALUES ($1, 'QW123456', 'AIIB', '2028-12-31') RETURNING id_conductor",
        [userId]
      );
      driverId = insertDriver.rows[0].id_conductor;
    } else {
      driverId = driverRes.rows[0].id_conductor;
    }

    // Vehiculo
    let vehRes = await pool.query("SELECT id_vehiculo FROM vehiculos WHERE placa = 'ABC-123'");
    let vehId;
    if (vehRes.rows.length === 0) {
      const insertVeh = await pool.query(
        "INSERT INTO vehiculos (placa, marca, modelo, capacidad) VALUES ('ABC-123', 'Mercedes-Benz', 'Sprinter', 35) RETURNING id_vehiculo"
      );
      vehId = insertVeh.rows[0].id_vehiculo;
    } else {
      vehId = vehRes.rows[0].id_vehiculo;
    }

    // Viaje
    let tripRes = await pool.query("SELECT id_viaje FROM viajes WHERE codigo = 'V-AYAQ-01'");
    let tripId;
    if (tripRes.rows.length === 0) {
      const insertTrip = await pool.query(
        "INSERT INTO viajes (codigo, origen, destino, fecha, hora_salida, id_conductor, id_vehiculo, estado) VALUES ('V-AYAQ-01', 'Ayacucho', 'Lima', CURRENT_DATE, '08:00', $1, $2, 'EN_RUTA') RETURNING id_viaje",
        [driverId, vehId]
      );
      tripId = insertTrip.rows[0].id_viaje;
      
      // Insertar Pasajeros y Reservas reales
      await pool.query("INSERT INTO pasajeros (nombre, documento) VALUES ('Carlos Ramirez', '71234567')");
      await pool.query("INSERT INTO reservas (id_viaje, id_pasajero, asiento) VALUES ($1, (SELECT id_pasajero FROM pasajeros WHERE documento = '71234567'), '1A')", [tripId]);
      
      await pool.query("INSERT INTO encomiendas (codigo, id_viaje, remitente, destinatario, descripcion) VALUES ('ENC-001', $1, 'Maria Lopez', 'Juan Perez', 'Caja de herramientas')", [tripId]);
    } else {
      tripId = tripRes.rows[0].id_viaje;
    }

    console.log("¡Base de datos real inicializada con éxito!");
  } catch (err) {
    console.error("Error inicializando DB:", err);
  } finally {
    await pool.end();
  }
}

initDb();
