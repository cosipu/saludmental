window.addEventListener("load", async () => {
  // --- Elementos de reserva ---
  const professionalSelect = document.getElementById("professionalSelect");
  const daySelect = document.getElementById("daySelect");
  const hoursContainer = document.getElementById("hoursContainer");
  const bookingForm = document.getElementById("booking-form");
  const slotText = document.getElementById("slotText");
  const clientName = document.getElementById("clientName");
  const clientEmail = document.getElementById("clientEmail");
  const clientRUT = document.getElementById("clientRUT");
  const clientPhone = document.getElementById("clientPhone");
  const confirmBtn = document.getElementById("confirmBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const bookingMsg = document.getElementById("bookingMsg");

  let selectedProfessional = null;
  let selectedDate = null;
  let selectedHour = null;

  // --- Validar RUT chileno ---
  function validarRUT(rut) {
    rut = rut.replace(/\./g, "").replace("-", "");
    let cuerpo = rut.slice(0, -1);
    let dv = rut.slice(-1).toUpperCase();
    if (!/^\d+$/.test(cuerpo)) return false;
    let suma = 0, multiplo = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      suma += multiplo * parseInt(cuerpo[i]);
      multiplo = multiplo < 7 ? multiplo + 1 : 2;
    }
    let dvEsperado = 11 - (suma % 11);
    dvEsperado = dvEsperado === 11 ? "0" : dvEsperado === 10 ? "K" : dvEsperado.toString();
    return dv === dvEsperado;
  }

  // --- Cargar profesionales desde PostgreSQL ---
  const loadProfessionals = async () => {
    const res = await fetch("/api/admin/availability");
    const availability = await res.json();
    const professionals = [...new Set(availability.map(a => a.doctor))];
    professionalSelect.innerHTML = '<option value="">Selecciona profesional</option>';
    professionals.forEach(pro => {
      const option = document.createElement("option");
      option.value = pro;
      option.textContent = pro;
      professionalSelect.appendChild(option);
    });
  };
  await loadProfessionals();

  // --- Selección de profesional ---
  professionalSelect.addEventListener("change", () => {
    selectedProfessional = professionalSelect.value;
    daySelect.disabled = !selectedProfessional;
    hoursContainer.innerHTML = "";
    bookingForm.classList.add("hidden");
    bookingMsg.textContent = "";
  });

  // --- Selección de día ---
  daySelect.addEventListener("change", async () => {
    selectedDate = daySelect.value;
    hoursContainer.innerHTML = "";
    bookingForm.classList.add("hidden");
    bookingMsg.textContent = "";
    if (!selectedProfessional || !selectedDate) return;

    // Traer disponibilidad para el profesional y fecha
    const resAvailability = await fetch(`/api/admin/availability`);
    const availability = await resAvailability.json();
    const slotsForDay = availability
      .filter(a => a.doctor === selectedProfessional && a.date === selectedDate)
      .map(a => a.hour);

    if (slotsForDay.length === 0) {
      hoursContainer.textContent = "No hay horas disponibles para este día.";
      return;
    }

    // Traer reservas ya hechas
    const resBookings = await fetch("/api/bookings");
    const bookings = await resBookings.json();
    const availableSlots = slotsForDay.filter(hour => {
      const datetime = `${selectedDate}T${hour}:00`;
      return !bookings.some(b => b.professional === selectedProfessional && b.datetime === datetime);
    });

    if (availableSlots.length === 0) {
      hoursContainer.textContent = "No hay horas disponibles para este día.";
      return;
    }

    availableSlots.forEach(hour => {
      const btn = document.createElement("button");
      btn.textContent = hour;
      btn.addEventListener("click", () => {
        selectedHour = hour;
        slotText.textContent = `Seleccionaste: ${selectedDate} a las ${selectedHour}`;
        bookingForm.classList.remove("hidden");
        bookingMsg.textContent = "";
      });
      hoursContainer.appendChild(btn);
    });
  });

  // --- Cancelar reserva ---
  cancelBtn.addEventListener("click", () => {
    bookingForm.classList.add("hidden");
    bookingMsg.textContent = "";
    clientName.value = "";
    clientEmail.value = "";
    clientRUT.value = "";
    clientPhone.value = "";
  });

  // --- Confirmar reserva ---
  confirmBtn.addEventListener("click", async () => {
    bookingMsg.textContent = "";
    const name = clientName.value.trim();
    const email = clientEmail.value.trim();
    const rut = clientRUT.value.trim();
    const phone = clientPhone.value.trim();

    if (!name || !rut || !email || !phone) {
      bookingMsg.textContent = "Debes completar todos los campos";
      return;
    }
    if (!validarRUT(rut)) {
      bookingMsg.textContent = "RUT inválido";
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      bookingMsg.textContent = "Email inválido";
      return;
    }
    if (!/^\+?\d{8,15}$/.test(phone)) {
      bookingMsg.textContent = "Teléfono inválido";
      return;
    }

    const datetime = `${selectedDate}T${selectedHour}:00`;
    try {
      bookingMsg.innerHTML = "⏳ Procesando reserva...";
      confirmBtn.disabled = true;

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, rut, phone, professional: selectedProfessional, datetime }),
      });

      if (!res.ok) throw new Error("Error al crear la reserva");

      const data = await res.json();
      bookingMsg.innerHTML = `
        ✅ Reserva creada y correo enviado.<br>
        🔗 Accede a la reunión de Google Meet: <a href="${data.meetLink}" target="_blank">${data.meetLink}</a>
      `;
      bookingForm.classList.add("hidden");
      clientName.value = "";
      clientEmail.value = "";
      clientRUT.value = "";
      clientPhone.value = "";
      daySelect.dispatchEvent(new Event("change"));
    } catch (err) {
      console.error(err);
      bookingMsg.textContent = "❌ Error al crear la reserva o enviar el correo";
    } finally {
      confirmBtn.disabled = false;
    }
  });

  // ---------------- Admin login modal ----------------
  const adminBtn = document.getElementById("adminLoginBtn");
  const modal = document.getElementById("adminModal");
  const closeModal = document.getElementById("closeModal");
  const loginBtn = document.getElementById("loginBtn");
  const loginMsg = document.getElementById("loginMsg");

  adminBtn.addEventListener("click", () => modal.classList.remove("hidden"));
  closeModal.addEventListener("click", () => modal.classList.add("hidden"));
  loginBtn.addEventListener("click", () => {
    const user = document.getElementById("adminUser").value;
    const pass = document.getElementById("adminPass").value;
    if (user === "admin" && pass === "1234") {
      window.location.href = "/admin/bookings";
    } else {
      loginMsg.textContent = "Usuario o contraseña incorrectos";
      loginMsg.style.color = "red";
    }
  });
});
