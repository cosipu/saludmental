const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node"); // Import correcto para Node

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const dbFile = path.join(process.cwd(), "db.json");
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, JSON.stringify({ bookings: [], availability: {} }, null, 2));
}

const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

(async function main() {
  await db.read();
  db.data ||= { bookings: [], availability: {} };

  // ---------- RUTAS ----------
  app.get("/api/bookings", (req, res) => res.json(db.data.bookings));

  app.post("/api/bookings", async (req, res) => {
    const { name, email, rut, phone, datetime, professional } = req.body;

    // Validación básica
    if (!name || !email || !rut || !phone || !datetime || !professional) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    const booking = { id: Date.now(), name, email, rut, phone, professional, datetime };
    db.data.bookings.push(booking);
    await db.write();
    res.json(booking);
  });

  app.delete("/api/bookings/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    db.data.bookings = db.data.bookings.filter(b => b.id !== id);
    await db.write();
    res.json({ message: "Reserva eliminada" });
  });

  app.get("/api/admin/availability", (req, res) => res.json(db.data.availability));

  app.post("/api/admin/availability", async (req, res) => {
    const { doctor, date, hours } = req.body;
    db.data.availability[doctor] ||= {};
    db.data.availability[doctor][date] = hours;
    await db.write();
    res.json({ message: "Disponibilidad actualizada" });
  });

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

  // ---------- SERVIR HTML ----------
  app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "public/index.html")));
  app.get("/admin/bookings", (req, res) => res.sendFile(path.join(process.cwd(), "public/admin.html")));

 const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

})();
