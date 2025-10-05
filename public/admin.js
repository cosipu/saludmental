document.addEventListener("DOMContentLoaded", async () => {
  // --- Elementos reservas ---
  const tableBody = document.querySelector("#bookingsTable tbody");
  const filterProfessional = document.getElementById("filterProfessional");
  const filterDate = document.getElementById("filterDate");
  const addBookingBtn = document.getElementById("addBookingBtn");
  const newName = document.getElementById("newName");
  const newEmail = document.getElementById("newEmail");
  const newRUT = document.getElementById("newRUT");
  const newPhone = document.getElementById("newPhone");
  const newProfessional = document.getElementById("newProfessional");
  const newDatetime = document.getElementById("newDatetime");

  // --- Elementos disponibilidad ---
  const selectDoctor = document.getElementById("selectDoctor");
  const doctorDate = document.getElementById("doctorDate");
  const doctorHours = document.getElementById("doctorHours");
  const updateAvailabilityBtn = document.getElementById("updateAvailabilityBtn");
  const availabilityMsg = document.getElementById("availabilityMsg");
  const deleteHourBtn = document.getElementById("deleteHourBtn");

  // Crear select dinámico para borrar horas
  const selectHourDelete = document.createElement("select");
  deleteHourBtn.insertAdjacentElement("beforebegin", selectHourDelete);

  // --- Elementos crear/eliminar doctor ---
  const newDoctorInput = document.getElementById("newDoctor");
  const addDoctorBtn = document.getElementById("addDoctorBtn");
  const deleteDoctorBtn = document.getElementById("deleteDoctorBtn");
  const selectDoctorAdmin = document.getElementById("selectDoctorAdmin"); // ya existe en HTML

  // ---------- FUNCIONES RESERVAS ----------
  const fetchBookings = async () => {
    const res = await fetch("/api/bookings");
    return await res.json();
  };

  const renderTable = async () => {
    const bookings = await fetchBookings();
    const profFilter = filterProfessional.value;
    const dateFilter = filterDate.value;

    tableBody.innerHTML = "";
    bookings
      .filter(b => !profFilter || b.professional === profFilter)
      .filter(b => !dateFilter || b.datetime.startsWith(dateFilter))
      .forEach(b => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${b.id}</td>
          <td>${b.professional}</td>
          <td>${b.name}</td>
          <td>${b.rut || "-"}</td>
          <td>${b.phone || "-"}</td>
          <td>${b.email || "-"}</td>
          <td>${b.datetime}</td>
          <td><button class="deleteBtn" data-id="${b.id}">Eliminar</button></td>
        `;
        tableBody.appendChild(tr);
      });

    document.querySelectorAll(".deleteBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (confirm("¿Deseas eliminar esta reserva?")) {
          await fetch(`/api/bookings/${id}`, { method: "DELETE" });
          renderTable();
        }
      });
    });
  };

  filterProfessional.addEventListener("change", renderTable);
  filterDate.addEventListener("change", renderTable);

  addBookingBtn.addEventListener("click", async () => {
    const name = newName.value.trim();
    const email = newEmail.value.trim();
    const rut = newRUT.value.trim();
    const phone = newPhone.value.trim();
    const professional = newProfessional.value;
    const datetime = newDatetime.value;

    if (!name || !datetime || !professional || !rut || !phone || !email)
      return alert("Completa todos los campos");

    await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, rut, phone, datetime, professional })
    });

    newName.value = "";
    newEmail.value = "";
    newRUT.value = "";
    newPhone.value = "";
    newDatetime.value = "";
    renderTable();
  });

  renderTable(); // inicializar tabla

  // ---------- FUNCIONES DISPONIBILIDAD ----------
  const loadDoctors = async () => {
    const res = await fetch("/api/admin/availability");
    const availability = await res.json();

    // Limpiar selects
    selectDoctor.innerHTML = '<option value="">--Selecciona un médico--</option>';
    newProfessional.innerHTML = '<option value="">--Selecciona un médico--</option>';
    filterProfessional.innerHTML = '<option value="">Todos</option>';
    selectDoctorAdmin.innerHTML = '<option value="">--Selecciona un doctor--</option>';

    Object.keys(availability).forEach(doc => {
      [selectDoctor, newProfessional, filterProfessional, selectDoctorAdmin].forEach(select => {
        const opt = document.createElement("option");
        opt.value = doc;
        opt.textContent = doc;
        select.appendChild(opt);
      });
    });
  };

  const loadAvailability = async () => {
    const res = await fetch("/api/admin/availability");
    const availability = await res.json();
    const doctor = selectDoctor.value;
    const date = doctorDate.value;

    const hours = availability[doctor]?.[date] || [];
    doctorHours.value = hours.join(",");

    selectHourDelete.innerHTML = "";
    if (hours.length > 0) {
      hours.forEach(h => {
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = h;
        selectHourDelete.appendChild(opt);
      });
    } else {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "--No hay horas disponibles--";
      selectHourDelete.appendChild(opt);
    }
  };

  await loadDoctors();
  loadAvailability();

  selectDoctor.addEventListener("change", loadAvailability);
  doctorDate.addEventListener("change", loadAvailability);

  updateAvailabilityBtn.addEventListener("click", async () => {
    const doctor = selectDoctor.value;
    const date = doctorDate.value;
    const hours = doctorHours.value.split(",").map(h => h.trim()).filter(Boolean);

    if (!doctor) return alert("Selecciona un doctor");
    if (!date) return alert("Selecciona una fecha");

    const res = await fetch("/api/admin/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor, date, hours })
    });

    if (res.ok) {
      availabilityMsg.textContent = "Disponibilidad actualizada ✅";
      setTimeout(() => (availabilityMsg.textContent = ""), 3000);
      loadAvailability();
    } else {
      availabilityMsg.textContent = "Error al actualizar";
    }
  });

  deleteHourBtn.addEventListener("click", async () => {
    const doctor = selectDoctor.value;
    const date = doctorDate.value;
    const hourToDelete = selectHourDelete.value;

    if (!doctor || !date || !hourToDelete) return alert("Selecciona doctor, fecha y hora");

    const resFetch = await fetch("/api/admin/availability");
    const availability = await resFetch.json();
    const currentHours = availability[doctor]?.[date] || [];
    const newHours = currentHours.filter(h => h !== hourToDelete);

    await fetch("/api/admin/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor, date, hours: newHours })
    });

    loadAvailability();
  });

  // ---------- CREAR / ELIMINAR DOCTOR ----------
  addDoctorBtn.addEventListener("click", async () => {
    const doctorName = newDoctorInput.value.trim();
    if (!doctorName) return alert("Ingresa el nombre del doctor");

    await fetch("/api/admin/add-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor: doctorName })
    });

    newDoctorInput.value = "";
    await loadDoctors();
    loadAvailability();
  });

  deleteDoctorBtn.addEventListener("click", async () => {
    const doctor = selectDoctorAdmin.value;
    if (!doctor) return alert("Selecciona un doctor");

    if (!confirm(`¿Deseas eliminar al doctor ${doctor}? Esto borrará toda su disponibilidad.`)) return;

    await fetch("/api/admin/delete-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor })
    });

    await loadDoctors();
    loadAvailability();
  });
});
