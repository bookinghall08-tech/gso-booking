const form = document.getElementById("bookingForm");
const message = document.getElementById("message");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const booking = {
    name: form.name.value,
    email: form.email.value,
    date: form.date.value,
    time: form.time.value,
  };

  const res = await fetch("/send-appointment", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(booking),
});


  if (res.ok) {
    message.textContent = "✅ Appointment booked successfully!";
    form.reset();
  } else {
    message.textContent = "❌ Error booking appointment.";
  }
});
