// No necesitas dotenv si Railway ya maneja las variables de entorno
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ---------------- DATABASE POSTGRES ----------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------- Inicializar Base de Datos ----------------
async function initDatabase() {
  try {
    await pool.query("SELECT NOW()");
    console.log("✅ Conectado a Postgres correctamente");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        rut TEXT NOT NULL,
        phone TEXT NOT NULL,
        professional TEXT NOT NULL,
        datetime TIMESTAMP NOT NULL,
        meet_link TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS availability (
        id BIGSERIAL PRIMARY KEY,
        doctor TEXT NOT NULL,
        date DATE NOT NULL,
        hour TEXT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id BIGSERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      );
    `);

    console.log("✅ Tablas inicializadas correctamente");
  } catch (err) {
    console.error("❌ Error al inicializar la base de datos:", err.message);
    process.exit(1);
  }
}

// ---------------- GOOGLE CONFIG ----------------
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
];

let oAuth2Client;

function initGoogleClient() {
  const credentials = require(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = credentials.web;

  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (process.env.GOOGLE_TOKEN) {
    const tokens = JSON.parse(process.env.GOOGLE_TOKEN);
    oAuth2Client.setCredentials(tokens);
    console.log("✅ Token cargado desde variable de entorno");
  } else {
    console.log("⚠️ GOOGLE_TOKEN no configurado — autoriza visitando /auth");
  }
}

// ---------------- Nodemailer con OAuth2 ----------------
async function createTransporter() {
  if (!oAuth2Client) throw new Error("❌ OAuth2 no inicializado");
  const accessToken = await oAuth2Client.getAccessToken();

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: "saludparachile@gmail.com",
      clientId: oAuth2Client._clientId,
      clientSecret: oAuth2Client._clientSecret,
      refreshToken: oAuth2Client.credentials.refresh_token,
      accessToken: accessToken.token,
    },
  });
}

// ---------------- RUTAS GOOGLE ----------------
app.get("/auth", (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("❌ Falta el parámetro 'code'.");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    console.log("✅ Token obtenido, configúralo como GOOGLE_TOKEN en la variable de entorno:");
    console.log(JSON.stringify(tokens));
    res.send("✅ Autenticación completada. Copia el token mostrado en la consola a GOOGLE_TOKEN.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al procesar la autenticación.");
  }
});

// ---------------- API PRINCIPAL ----------------

// Obtener reservas
app.get("/api/bookings", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM bookings ORDER BY datetime ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener reservas" });
  }
});

// Crear reserva + evento Google Meet + correo
app.post("/api/bookings", async (req, res) => {
  const { name, email, rut, phone, datetime, professional } = req.body;
  if (!name || !email || !rut || !phone || !datetime || !professional)
    return res.status(400).json({ error: "Faltan datos obligatorios" });

  try {
    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
    const start = new Date(datetime);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const event = {
      summary: `Consulta con ${professional}`,
      description: `Consulta online con ${name}`,
      start: { dateTime: start.toISOString(), timeZone: "America/Santiago" },
      end: { dateTime: end.toISOString(), timeZone: "America/Santiago" },
      attendees: [{ email }],
      conferenceData: {
        createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: "all",
    });

    const meetLink = response.data.hangoutLink;

    const insert = await pool.query(
      `INSERT INTO bookings(name,email,rut,phone,professional,datetime,meet_link) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, email, rut, phone, professional, datetime, meetLink]
    );

    const transporter = await createTransporter();
    await transporter.sendMail({
      from: '"Salud Para Chile" <saludparachile@gmail.com>',
      to: email,
      subject: `Reserva confirmada con ${professional}`,
      html: `<p>Hola ${name},</p>
             <p>Tu reserva con ${professional} ha sido confirmada para <strong>${datetime}</strong>.</p>
             <p>Accede a la reunión de Google Meet usando este enlace:</p>
             <a href="${meetLink}" target="_blank">${meetLink}</a>
             <p>Gracias por confiar en nosotros.</p>`,
    });

    res.json({ success: true, booking: insert.rows[0], meetLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la reunión o enviar el correo." });
  }
});

// ---------------- Disponibilidad ----------------
app.get("/api/admin/availability", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM availability ORDER BY doctor,date,hour ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener disponibilidad" });
  }
});

app.post("/api/admin/availability", async (req, res) => {
  const { doctor, date, hours } = req.body;

  try {
    await pool.query("DELETE FROM availability WHERE doctor=$1 AND date=$2", [doctor, date]);
    for (const hour of hours) {
      if (hour) await pool.query("INSERT INTO availability(doctor,date,hour) VALUES($1,$2,$3)", [doctor, date, hour]);
    }
    res.json({ message: "Disponibilidad actualizada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar disponibilidad" });
  }
});

// ---------------- DOCTORS ----------------
app.post("/api/admin/add-doctor", async (req, res) => {
  const { doctor } = req.body;
  if (!doctor) return res.status(400).json({ error: "Falta el nombre del doctor" });

  try {
    await pool.query("INSERT INTO doctors(name) VALUES($1) ON CONFLICT DO NOTHING", [doctor]);
    res.json({ success: true, message: `Doctor ${doctor} agregado correctamente` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al agregar doctor" });
  }
});

app.post("/api/admin/delete-doctor", async (req, res) => {
  const { doctor } = req.body;
  if (!doctor) return res.status(400).json({ error: "Falta el nombre del doctor" });

  try {
    await pool.query("DELETE FROM availability WHERE doctor=$1", [doctor]);
    await pool.query("DELETE FROM doctors WHERE name=$1", [doctor]);
    res.json({ success: true, message: `Doctor ${doctor} eliminado` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar doctor" });
  }
});

// ---------------- ELIMINAR RESERVA ----------------
app.delete("/api/bookings/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM bookings WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar reserva" });
  }
});

// ---------------- HTML ----------------
app.get("/", (req, res) => res.sendFile("public/index.html", { root: process.cwd() }));
app.get("/admin/bookings", (req, res) => res.sendFile("public/admin.html", { root: process.cwd() }));

// ---------------- INICIALIZACIÓN ----------------
async function initServer() {
  await initDatabase();
  initGoogleClient();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
}

initServer();
