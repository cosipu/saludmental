// doctor.js
window.addEventListener("DOMContentLoaded", async () => {
  const doctorLogin = document.getElementById("doctorLogin");
  const doctorPanel = document.getElementById("doctorPanel");
  const doctorNameSelect = document.getElementById("doctorName");
  const doctorPassword = document.getElementById("doctorPassword");
  const doctorLoginBtn = document.getElementById("doctorLoginBtn");
  const doctorLoginMsg = document.getElementById("doctorLoginMsg");
  const logoutBtn = document.getElementById("logoutBtn");
  const doctorBookings = document.getElementById("doctorBookings");
  const filterDate = document.getElementById("filterDate");

  // Cargar lista de doctores
  async function loadDoctors() {
    const res = await fetch("/api/admin/doctors");
    const doctors = await res.json();
    doctorNameSelect.innerHTML = '';
    doctors.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = d.name;
      doctorNameSelect.appendChild(opt);
    });
  }
  await loadDoctors();

  // Login seguro
  doctorLoginBtn.onclick = async () => {
    const doctor = doctorNameSelect.value;
    const password = doctorPassword.value;
    if (!doctor || !password) {
      doctorLoginMsg.textContent = "Completa todos los campos";
      return;
    }
    const res = await fetch("/api/doctor-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: doctor, password })
    });
    if (res.ok) {
      doctorLogin.classList.add("hidden");
      doctorPanel.classList.remove("hidden");
      localStorage.setItem("doctorName", doctor);
      loadBookings(doctor);
    } else {
      doctorLoginMsg.textContent = "Credenciales incorrectas";
    }
  };

  // Logout
  logoutBtn.onclick = () => {
    localStorage.removeItem("doctorName");
    doctorPanel.classList.add("hidden");
    doctorLogin.classList.remove("hidden");
  };

  // Mostrar reservas del doctor, filtrando por fecha si corresponde
  async function loadBookings(doctor) {
    const res = await fetch("/api/bookings");
    const bookings = await res.json();
    const dateFilter = filterDate.value;
    doctorBookings.innerHTML = '';
    bookings.filter(b => (b.professional || '').toLowerCase().trim() === doctor.toLowerCase().trim())
      .filter(b => !dateFilter || String(b.datetime).slice(0,10) === dateFilter)
      .forEach(b => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${b.name}</td>
          <td>${b.rut}</td>
          <td>${b.email}</td>
          <td>${b.phone}</td>
          <td>${b.datetime}</td>
          <td>${b.meet_link ? `<a href="${b.meet_link}" target="_blank">Enlace</a>` : '-'} </td>
        `;
        doctorBookings.appendChild(tr);
      });
  }

  filterDate.addEventListener("change", () => {
    const doctor = localStorage.getItem("doctorName");
    if (doctor) loadBookings(doctor);
  });

  // Si ya está logueado
  const savedDoctor = localStorage.getItem("doctorName");
  if (savedDoctor) {
    doctorLogin.classList.add("hidden");
    doctorPanel.classList.remove("hidden");
    doctorNameSelect.value = savedDoctor;
    loadBookings(savedDoctor);
  }
});
