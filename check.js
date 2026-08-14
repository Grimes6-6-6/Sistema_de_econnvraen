const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const client = new Client({
  connectionString: process.env.POSTGRES_URL,
});

async function check() {
  await client.connect();
  const c = await client.query("SELECT * FROM conductores");
  console.log("Conductores:", c.rows);
  const v = await client.query("SELECT id_viaje, id_conductor, codigo, estado FROM viajes");
  console.log("Viajes:", v.rows);
  await client.end();
}
check();
