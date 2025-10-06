window.addEventListener("load", async () => {
  // --- Login Médico modal ---
  const doctorBtn = document.getElementById("doctorLoginBtn");
  const doctorModal = document.getElementById("doctorModal");
  const closeDoctorModal = document.getElementById("closeDoctorModal");
  const doctorLoginBtnModal = document.getElementById("doctorLoginBtnModal");
  const doctorLoginMsg = document.getElementById("doctorLoginMsg");

  doctorBtn.addEventListener("click", () => doctorModal.classList.remove("hidden"));
  closeDoctorModal.addEventListener("click", () => doctorModal.classList.add("hidden"));
  doctorLoginBtnModal.addEventListener("click", async () => {
    const name = document.getElementById("doctorUser").value;
    const pass = document.getElementById("doctorPass").value;
    doctorLoginMsg.textContent = "";
    if (!name || !pass) {
      doctorLoginMsg.textContent = "Debes ingresar nombre y contraseña";
      doctorLoginMsg.style.color = "red";
      return;
    }
    // Llamar al backend para validar login médico
    try {
      const res = await fetch("/api/doctor-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: pass })
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = "/doctor";
      } else {
        doctorLoginMsg.textContent = data.message || "Credenciales incorrectas";
        doctorLoginMsg.style.color = "red";
      }
    } catch (err) {
      doctorLoginMsg.textContent = "Error de conexión";
      doctorLoginMsg.style.color = "red";
    }
  });
  // Ocultar modal de reserva al cargar la página (solo una vez)
  const bookingModal = document.getElementById("bookingModal");
  const closeBookingModal = document.getElementById("closeBookingModal");
  // Asegura que el modal SIEMPRE esté oculto al cargar
  if (bookingModal) bookingModal.style.display = "none";
  if (closeBookingModal) closeBookingModal.onclick = () => {
    bookingModal.style.display = "none";
  };
  bookingModal.addEventListener("click", e => {
    if (e.target === bookingModal) bookingModal.style.display = "none";
  });
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
  const doctorInfo = document.getElementById("doctorInfo");
  const availableHoursInfo = document.getElementById("availableHoursInfo");

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
  professionalSelect.addEventListener("change", async () => {
    selectedProfessional = professionalSelect.value;
    daySelect.disabled = !selectedProfessional;
    hoursContainer.innerHTML = "";
    bookingForm.classList.add("hidden");
    bookingMsg.textContent = "";
    selectedHour = null;
    doctorInfo.textContent = selectedProfessional ? `Doctor seleccionado: ${selectedProfessional}` : "";
    availableHoursInfo.textContent = "";
    if (selectedProfessional) {
      // Mostrar días disponibles para el doctor
      const resAvailability = await fetch(`/api/admin/availability`);
      const availability = await resAvailability.json();
      const days = [...new Set(availability.filter(a => a.doctor === selectedProfessional).map(a => a.date))];
      if (days.length > 0) {
        availableHoursInfo.textContent = `Días con horas disponibles: ${days.join(", ")}`;
      } else {
        availableHoursInfo.textContent = "No hay días disponibles para este profesional.";
      }
    }
  });

  // --- Selección de día ---
  daySelect.addEventListener("change", async () => {
    selectedDate = daySelect.value;
    hoursContainer.innerHTML = "";
    bookingForm.classList.add("hidden");
    bookingMsg.textContent = "";
    selectedHour = null;
    availableHoursInfo.textContent = "";
    if (!selectedProfessional || !selectedDate) return;

    // Traer disponibilidad para el profesional y fecha
    const resAvailability = await fetch(`/api/admin/availability`);
    const availability = await resAvailability.json();
    const slotsForDay = availability
      .filter(a => a.doctor === selectedProfessional && String(a.date).slice(0,10) === selectedDate)
      .map(a => a.hour);

    if (slotsForDay.length === 0) {
      hoursContainer.textContent = "No hay horas disponibles para este día.";
      return;
    }

    // Traer reservas ya hechas
    const resBookings = await fetch("/api/bookings");
    const bookings = await resBookings.json();

    const availableSlots = slotsForDay.filter(hour => {
      const datetime = `${selectedDate}T${hour}`;
      // Permitir coincidencia aunque b.datetime tenga segundos o milisegundos
      return !bookings.some(b => {
        if (b.professional !== selectedProfessional) return false;
        // Tomar solo YYYY-MM-DDTHH:mm de la reserva
        const booked = String(b.datetime).slice(0,16);
        return booked === datetime;
      });
    });

    if (availableSlots.length === 0) {
      hoursContainer.textContent = "No hay horas disponibles para este día.";
      return;
    }

    availableHoursInfo.textContent = `Horas disponibles para ${selectedDate}: ${availableSlots.join(", ")}`;

    availableSlots.forEach(hour => {
      const btn = document.createElement("button");
      btn.textContent = hour;
      btn.type = "button";
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
    selectedHour = null;
  });

  // --- Confirmar reserva ---
  confirmBtn.addEventListener("click", async () => {
    bookingMsg.textContent = "";
    const name = clientName.value.trim();
    const email = clientEmail.value.trim();
    const rut = clientRUT.value.trim();
    const phone = clientPhone.value.trim();

    if (!name || !rut || !email || !phone || !selectedProfessional || !selectedDate || !selectedHour) {
      bookingMsg.textContent = "Debes completar todos los campos y seleccionar una hora";
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
  // Mostrar modal de confirmación
  bookingModal.style.display = "flex";
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
