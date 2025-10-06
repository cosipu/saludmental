// --- Login de médicos ---
const doctorUsers = require("./doctorUsers");

app.post("/api/doctor-login", (req, res) => {
  const { name, password } = req.body;
  const user = doctorUsers.find(u => u.name === name && u.password === password);
  if (user) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "Credenciales incorrectas" });
  }
});

// Cargar variables de entorno desde .env si existe (útil para desarrollo local)
require('dotenv').config();
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
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:ksYDeYsPSAUnIzDFirRVtXRuOPHtkdXI@switchback.proxy.rlwy.net:36049/railway',
  ssl: { rejectUnauthorized: false },
});

// ---------------- Inicializar Base de Datos ----------------
async function initDatabase() {
  try {
    console.log("🔄 Probando conexión a la base de datos...");
    const res = await pool.query("SELECT NOW()");
    console.log("✅ Conectado a Postgres correctamente:", res.rows[0]);

    console.log("🔄 Creando tablas si no existen...");
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
    console.error("❌ Error al inicializar la base de datos:", err);
    throw err; // Terminar si falla la DB
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
  try {
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
  } catch (err) {
    console.error("❌ Error al inicializar Google OAuth:", err);
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
    console.error("❌ Error al procesar la autenticación:", err);
    res.status(500).send("Error al procesar la autenticación.");
  }
});

// ---------------- API PRINCIPAL ----------------
app.get("/api/bookings", async (req, res) => {
  try {
    // Seleccionar todos los campos relevantes para el admin
    const result = await pool.query(`
      SELECT id, name, email, rut, phone, professional, to_char(datetime, 'YYYY-MM-DD"T"HH24:MI') as datetime, meet_link
      FROM bookings
      ORDER BY datetime ASC
    `);
    res.json(result.rows || []);
  } catch (err) {
    console.error("❌ Error al obtener reservas:", err);
    res.status(500).json({ error: "Error al obtener reservas", details: err.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  const { name, email, rut, phone, datetime, professional } = req.body;
  if (!name || !email || !rut || !phone || !datetime || !professional)
    return res.status(400).json({ error: "Faltan datos obligatorios" });

  try {
    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    // datetime viene como 'YYYY-MM-DDTHH:mm:00' (hora local Chile)
    // Guardar en la base de datos exactamente como lo selecciona el usuario
    // Calcular hora final sumando 30 minutos
    function addMinutesToTimeStr(dateTimeStr, minutes) {
      // dateTimeStr: 'YYYY-MM-DDTHH:mm' o 'YYYY-MM-DDTHH:mm:00'
      let [datePart, timePart] = dateTimeStr.split('T');
      if (!timePart) return dateTimeStr; // fallback
      let [hour, minute] = timePart.split(':');
      hour = parseInt(hour, 10);
      minute = parseInt(minute, 10);
      let totalMinutes = hour * 60 + minute + minutes;
      let newHour = Math.floor(totalMinutes / 60);
      let newMinute = totalMinutes % 60;
      // Ajustar día si pasa de las 24h
      let dateObj = new Date(datePart);
      if (newHour >= 24) {
        dateObj.setDate(dateObj.getDate() + Math.floor(newHour / 24));
        newHour = newHour % 24;
      }
      const pad = n => n.toString().padStart(2, '0');
      return `${dateObj.getFullYear()}-${pad(dateObj.getMonth()+1)}-${pad(dateObj.getDate())}T${pad(newHour)}:${pad(newMinute)}:00`;
    }
    // Asegurar formato correcto para startDateTime
    const startDateTime = datetime.length === 16 ? datetime + ':00' : datetime;
    const endDateTime = addMinutesToTimeStr(startDateTime, 30);

    const event = {
      summary: `Consulta con ${professional}`,
      description: `Consulta online con ${name}`,
      start: { dateTime: startDateTime, timeZone: "America/Santiago" },
      end: { dateTime: endDateTime, timeZone: "America/Santiago" },
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

    // Guardar la hora local seleccionada (no UTC)
    const insert = await pool.query(
      `INSERT INTO bookings(name,email,rut,phone,professional,datetime,meet_link) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, email, rut, phone, professional, startDateTime, meetLink]
    );

    // Responder primero al usuario
    res.json({ success: true, booking: insert.rows[0], meetLink });

    // Enviar correo en segundo plano
    (async () => {
      try {
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
        console.log(`✅ Correo enviado a ${email}`);
      } catch (err) {
        console.error("❌ Error al enviar correo en segundo plano:", err);
      }
    })();
  } catch (err) {
    console.error("❌ Error al crear la reunión o enviar el correo:", err);
    res.status(500).json({ error: "Error al crear la reunión o enviar el correo.", details: err.message });
  }
});

// ---------------- Disponibilidad ----------------
app.get("/api/admin/availability", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM availability ORDER BY doctor,date,hour ASC");
    res.json(result.rows || []);
  } catch (err) {
    console.error("❌ Error al obtener disponibilidad:", err);
    res.status(500).json({ error: "Error al obtener disponibilidad", details: err.message });
  }
});

app.post("/api/admin/availability", async (req, res) => {
  const { doctor, date, hours } = req.body;
  if (!doctor || !date || !Array.isArray(hours)) return res.status(400).json({ error: "Datos inválidos" });

  try {
    await pool.query("DELETE FROM availability WHERE doctor=$1 AND date=$2", [doctor.trim(), date]);
    for (const hour of hours) {
      if (hour && hour.trim()) await pool.query("INSERT INTO availability(doctor,date,hour) VALUES($1,$2,$3)", [doctor.trim(), date, hour.trim()]);
    }
    res.json({ message: "Disponibilidad actualizada" });
  } catch (err) {
    console.error("❌ Error al actualizar disponibilidad:", err);
    res.status(500).json({ error: "Error al actualizar disponibilidad", details: err.message });
  }
});

// ---------------- DOCTORS ----------------
app.post("/api/admin/add-doctor", async (req, res) => {
  const { doctor } = req.body;
  if (!doctor || !doctor.trim()) return res.status(400).json({ error: "Falta el nombre del doctor" });

  try {
    const result = await pool.query("INSERT INTO doctors(name) VALUES($1) ON CONFLICT DO NOTHING RETURNING *", [doctor.trim()]);
    res.json({ success: true, message: `Doctor ${doctor.trim()} agregado correctamente`, doctor: result.rows[0] || null });
  } catch (err) {
    console.error("❌ Error al agregar doctor:", err);
    res.status(500).json({ error: "Error al agregar doctor", details: err.message });
  }
});

app.post("/api/admin/delete-doctor", async (req, res) => {
  const { doctor } = req.body;
  if (!doctor || !doctor.trim()) return res.status(400).json({ error: "Falta el nombre del doctor" });

  try {
    await pool.query("DELETE FROM availability WHERE doctor=$1", [doctor.trim()]);
    await pool.query("DELETE FROM doctors WHERE name=$1", [doctor.trim()]);
    res.json({ success: true, message: `Doctor ${doctor.trim()} eliminado` });
  } catch (err) {
    console.error("❌ Error al eliminar doctor:", err);
    res.status(500).json({ error: "Error al eliminar doctor", details: err.message });
  }
});

app.get("/api/admin/doctors", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM doctors ORDER BY name ASC");
    res.json(result.rows || []);
  } catch (err) {
    console.error("❌ Error al obtener doctores:", err);
    res.status(500).json({ error: "Error al obtener doctores", details: err.message });
  }
});

// ---------------- ELIMINAR RESERVA ----------------
app.delete("/api/bookings/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM bookings WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al eliminar reserva:", err);
    res.status(500).json({ error: "Error al eliminar reserva", details: err.message });
  }
});

// ---------------- HTML ----------------
app.get("/", (req, res) => res.sendFile("public/index.html", { root: process.cwd() }));
app.get("/admin/bookings", (req, res) => res.sendFile("public/admin.html", { root: process.cwd() }));
app.get("/doctor", (req, res) => res.sendFile("public/doctor.html", { root: process.cwd() }));

// ---------------- INICIALIZACIÓN ----------------
async function initServer() {
  console.log("🚀 Inicializando servidor...");
  try {
    await initDatabase();
    initGoogleClient();
  } catch (err) {
    console.error("❌ Error crítico al inicializar el servidor:", err);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
}

initServer();
