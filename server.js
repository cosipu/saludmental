const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

// ---------------- DATABASE ----------------
const dbFile = path.join(process.cwd(), "db.json");
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, JSON.stringify({ bookings: [], availability: {} }, null, 2));
}
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

// ---------------- GOOGLE CONFIG ----------------
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
];

let oAuth2Client;

// Inicializar cliente OAuth
function initGoogleClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error("❌ No se encontró credentials.json");
    return;
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.web;

  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(tokens);
    console.log("✅ Token cargado correctamente");
  } else {
    console.log("⚠️ Falta token.json — autoriza visitando /auth");
  }
}

// ---------------- Nodemailer con OAuth2 ----------------
async function createTransporter() {
  if (!oAuth2Client) throw new Error("❌ OAuth2 no inicializado");

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: "saludparachile@gmail.com",
      clientId: oAuth2Client._clientId,
      clientSecret: oAuth2Client._clientSecret,
      refreshToken: oAuth2Client.credentials.refresh_token,
      accessToken: await oAuth2Client.getAccessToken(),
    },
  });
}

// ---------------- RUTAS DE AUTORIZACIÓN ----------------
app.get("/auth", (req, res) => {
  if (!oAuth2Client) return res.status(500).send("❌ Google OAuth no inicializado");

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  if (!oAuth2Client) return res.status(500).send("❌ Google OAuth no inicializado");

  const code = req.query.code;
  if (!code) return res.status(400).send("❌ Falta el parámetro 'code'.");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log("✅ Token guardado correctamente");

    res.send("✅ Autenticación completada correctamente. Ya puedes cerrar esta pestaña.");
  } catch (error) {
    console.error("❌ Error en /oauth2callback:", error);
    res.status(500).send("Error al procesar la autenticación.");
  }
});

// ---------------- API PRINCIPAL ----------------
(async function main() {
  await db.read();
  db.data ||= { bookings: [], availability: {} };
  initGoogleClient();

  // Obtener todas las reservas
  app.get("/api/bookings", (req, res) => res.json(db.data.bookings));

  // Crear reserva + evento Google Meet + enviar correo
  app.post("/api/bookings", async (req, res) => {
    const { name, email, rut, phone, datetime, professional } = req.body;

    if (!name || !email || !rut || !phone || !datetime || !professional) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    const booking = { id: Date.now(), name, email, rut, phone, professional, datetime };
    db.data.bookings.push(booking);
    await db.write();

    try {
      const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
      const start = new Date(datetime);
      const end = new Date(start.getTime() + 30 * 60 * 1000); // 30 min

      const event = {
        summary: `Consulta con ${professional}`,
        description: `Consulta online con ${name}`,
        start: { dateTime: start.toISOString(), timeZone: "America/Santiago" },
        end: { dateTime: end.toISOString(), timeZone: "America/Santiago" },
        attendees: [{ email }],
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      };

      const response = await calendar.events.insert({
        calendarId: "primary",
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: "all",
      });

      booking.meetLink = response.data.hangoutLink;
      await db.write();

      // ---------------- Enviar correo automático usando OAuth2 ----------------
      const transporter = await createTransporter();
      const mailOptions = {
        from: '"Salud Para Chile" <saludparachile@gmail.com>',
        to: email,
        subject: `Reserva confirmada con ${professional}`,
        html: `
          <p>Hola ${name},</p>
          <p>Tu reserva con ${professional} ha sido confirmada para <strong>${datetime}</strong>.</p>
          <p>Accede a la reunión de Google Meet usando este enlace:</p>
          <a href="${booking.meetLink}" target="_blank">${booking.meetLink}</a>
          <p>Gracias por confiar en nosotros.</p>
        `,
      };

      await transporter.sendMail(mailOptions);
      console.log("📧 Correo enviado a", email);

      res.json({ success: true, booking, meetLink: booking.meetLink });
    } catch (error) {
      console.error("❌ Error al crear evento o enviar correo:", error);
      res.status(500).json({ error: "Error al crear la reunión o enviar el correo." });
    }
  });

  // Eliminar reserva
  app.delete("/api/bookings/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    db.data.bookings = db.data.bookings.filter(b => b.id !== id);
    await db.write();
    res.json({ message: "Reserva eliminada" });
  });

  // Disponibilidad
  app.get("/api/admin/availability", (req, res) => res.json(db.data.availability));

  app.post("/api/admin/availability", async (req, res) => {
    const { doctor, date, hours } = req.body;
    db.data.availability[doctor] ||= {};
    db.data.availability[doctor][date] = hours;
    await db.write();
    res.json({ message: "Disponibilidad actualizada" });
  });

  // Agregar / eliminar doctores
  app.post("/api/admin/add-doctor", async (req, res) => {
    const { doctor } = req.body;
    db.data.availability[doctor] ||= {};
    await db.write();
    res.json({ message: "Doctor agregado" });
  });

  app.post("/api/admin/delete-doctor", async (req, res) => {
    const { doctor } = req.body;
    if (!db.data.availability[doctor])
      return res.status(404).json({ error: "Doctor no encontrado" });

    delete db.data.availability[doctor];
    db.data.bookings = db.data.bookings.filter(b => b.professional !== doctor);
    await db.write();
    res.json({ message: "Doctor eliminado" });
  });

  // HTML
  app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public/index.html")));
  app.get("/admin/bookings", (req, res) => res.sendFile(path.join(process.cwd(), "public/admin.html")));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
})();
