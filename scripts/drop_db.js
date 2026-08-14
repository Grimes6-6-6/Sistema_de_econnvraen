require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`
  DROP TABLE IF EXISTS notificaciones CASCADE;
  DROP TABLE IF EXISTS incidencias CASCADE;
  DROP TABLE IF EXISTS encomiendas CASCADE;
  DROP TABLE IF EXISTS reservas CASCADE;
  DROP TABLE IF EXISTS pasajeros CASCADE;
  DROP TABLE IF EXISTS viajes CASCADE;
  DROP TABLE IF EXISTS conductores CASCADE;
  DROP TABLE IF EXISTS vehiculos CASCADE;
`).then(() => {
  console.log("Tablas borradas.");
  pool.end();
});
