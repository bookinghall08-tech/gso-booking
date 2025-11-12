import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import fs from "fs";
import puppeteer from "puppeteer";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import os from "os";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ====== Helper: Get Local IP ======
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// ====== App Configuration ======
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // 0.0.0.0 to accept all network connections
const LOCAL_IP = getLocalIP();
const BASE_URL = `http://${LOCAL_IP}:${PORT}`;

const appointments = [];

// ====== Email Setup ======
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ====== PDF Generation ======
async function createPDF(html, filePath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--no-zygote",
      "--single-process"
    ],
    executablePath:
      process.env.CHROME_PATH || puppeteer.executablePath(),
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: filePath, format: "A4", printBackground: true });
  await browser.close();
}



// ====== Routes ======

// POST /send-appointment
app.post("/send-appointment", async (req, res) => {
  const data = {
    ...req.body,
    id: uuidv4(),
    status: "pending",
    selectedDates: Array.isArray(req.body.selectedDates)
      ? req.body.selectedDates
      : req.body.selectedDates
      ? [req.body.selectedDates]
      : [],
  };
  appointments.push(data);
  console.log("📩 New appointment received:", data);

  try {
    const pdfPath = `appointment_${data.id}.pdf`;
    const html = generateAppointmentHTML(data);
    await createPDF(html, pdfPath);

    const venueType = (data.reservationType || data.activityType || "")
      .toLowerCase()
      .includes("tent")
      ? "Dome Tent"
      : "Training Hall";

    const emailHtml = `
      <h2>📩 New Reservation Request</h2>
      <p>A new reservation request has been submitted for the <b>${venueType}</b>.</p>
      <p>Event Title: <b>${data.eventTitle}</b></p>
      <p>Requested by: ${data.contactPerson} (${data.contactPersonEmail})</p>
      <p>See attached PDF for full details.</p>
      <a href="${BASE_URL}/confirm?id=${data.id}&status=approved"
        style="background:#28a745;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">✅ Approve</a>
      &nbsp;
      <a href="${BASE_URL}/confirm?id=${data.id}&status=rejected"
        style="background:#dc3545;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">❌ Reject</a>
    `;

    await transporter.sendMail({
      from: `"GSO Booking System" <${process.env.EMAIL_USER}>`,
      to: "suppyandpropertydivision@gmail.com", // Admin email
      subject: `📅 Reservation Request: ${data.eventTitle}`,
      html: emailHtml,
      attachments: [
        { filename: "Reservation_Request.pdf", path: pdfPath, contentType: "application/pdf" },
      ],
    });

    fs.unlinkSync(pdfPath);
    console.log("✅ Email with PDF sent successfully!");
    res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error("❌ Error sending appointment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /confirm
app.get("/confirm", async (req, res) => {
  const { id, status } = req.query;
  const appointment = appointments.find((a) => a.id === id);
  if (!appointment) return res.send("<h2>⚠️ Appointment not found.</h2>");

  appointment.status = status;
  const approved = status === "approved";
  const subject = `Your reservation "${appointment.eventTitle}" has been ${approved ? "approved" : "rejected"}`;
  const pdfPath = `appointment_confirmation_${appointment.id}.pdf`;
  const html = generateConfirmationHTML(appointment, approved);

  try {
    await createPDF(html, pdfPath);

    // Feedback link (replace with your real form if needed)
    const feedbackLink = `${BASE_URL}/feedback.html`;

    await transporter.sendMail({
      from: `"GSO Booking System" <${process.env.EMAIL_USER}>`,
      to: appointment.contactPersonEmail,
      subject,
      html: `
        <p>Dear ${appointment.contactPerson},</p>
        <p>Your reservation "<b>${appointment.eventTitle}</b>" has been ${approved ? "approved ✅" : "rejected ❌"}.</p>
        <p>Venue: <b>${appointment.reservationType || "Training Hall / Dome Tent"}</b></p>
        <p>Please see attached confirmation PDF for details.</p>
        ${approved ? `<p>💬 We’d love your feedback! <a href="${feedbackLink}" target="_blank">📝 Fill out Feedback Form</a></p>` : ""}
      `,
      attachments: [
        { filename: "Reservation_Confirmation.pdf", path: pdfPath, contentType: "application/pdf" },
      ],
    });

    fs.unlinkSync(pdfPath);
    console.log(`✅ Confirmation email sent to ${appointment.contactPersonEmail}`);
  } catch (err) {
    console.error("❌ Error in /confirm route:", err);
    return res.send(`<h2>❌ Error processing request: ${err.message}</h2>`);
  }

  const color = approved ? "#d4edda" : "#f8d7da";
  const emoji = approved ? "✅" : "❌";
  res.send(`
    <html>
      <head><title>${subject}</title></head>
      <body style="background:${color};display:flex;align-items:center;justify-content:center;height:100vh;font-family:Poppins;">
        <div style="background:white;padding:40px;border-radius:15px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center;">
          <h1>${emoji}</h1>
          <h2>${subject}</h2>
          <p>An email confirmation was sent to <strong>${appointment.contactPersonEmail}</strong>.</p>
        </div>
      </body>
    </html>
  `);
});

// ====== HTML Generators ======
function generateAppointmentHTML(data) {
  const type = (data.reservationType || data.activityType || "").toLowerCase();
  if (type.includes("tent")) return generateDomeTentPDF(data);
  return generateTrainingPDF(data);
}

// Dome Tent PDF
function generateDomeTentPDF(data) {
  const selectedDates = data.selectedDates.length ? data.selectedDates.join(", ") : "N/A";
  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8" /><title>Dome Tent Reservation</title></head>
    <body style="font-family:'Poppins',sans-serif;margin:40px;">
      <h1>🏕 Dome Tent Reservation Form</h1>
      <table border="1" cellspacing="0" cellpadding="8" width="100%">
        <tr><th>Date of Request</th><td>${data.dateRequest || "N/A"}</td></tr>
        <tr><th>Selected Date(s)</th><td>${selectedDates}</td></tr>
        <tr><th>Event Title</th><td>${data.eventTitle || "N/A"}</td></tr>
        <tr><th>Purpose</th><td>${data.activityType || "N/A"}</td></tr>
        <tr><th>Participants</th><td>${data.participants || "N/A"}</td></tr>
        <tr><th>Time</th><td>${data.startTime || "N/A"} - ${data.endTime || "N/A"}</td></tr>
        <tr><th>Venue</th><td>Dome Tent</td></tr>
      </table>
      <h2>Contact Information</h2>
      <table border="1" cellspacing="0" cellpadding="8" width="100%">
        <tr><th>Requesting Office</th><td>${data.requestingOffice || "N/A"}</td></tr>
        <tr><th>Contact Person</th><td>${data.contactPerson || "N/A"}</td></tr>
        <tr><th>Email</th><td>${data.contactPersonEmail || "N/A"}</td></tr>
        <tr><th>Mobile Number</th><td>${data.mobileNumber || "N/A"}</td></tr>
      </table>
      <h2>Notes</h2><p>${data.notes || "None"}</p>
      <p style="text-align:center;font-size:12px;color:#777;">Generated by GSO Booking System — ${new Date().toLocaleString()}</p>
    </body></html>`;
}

// Training Hall PDF
function generateTrainingPDF(data) {
  const selectedDates = data.selectedDates.length ? data.selectedDates.join(", ") : "N/A";
  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8" /><title>Training Reservation</title></head>
    <body style="font-family:'Poppins',sans-serif;margin:40px;">
      <h1>🏫 Training / Room Reservation Form</h1>
      <table border="1" cellspacing="0" cellpadding="8" width="100%">
        <tr><th>Date of Request</th><td>${data.dateRequest || "N/A"}</td></tr>
        <tr><th>Selected Date(s)</th><td>${selectedDates}</td></tr>
        <tr><th>Event Title</th><td>${data.eventTitle || "N/A"}</td></tr>
        <tr><th>Type of Activity</th><td>${data.activityType || "N/A"}</td></tr>
        <tr><th>Participants</th><td>${data.participants || "N/A"}</td></tr>
        <tr><th>Tables</th><td>${data.tablesQty || "N/A"}</td></tr>
        <tr><th>Chairs</th><td>${data.chairsQty || "N/A"}</td></tr>
        <tr><th>Room Layout</th><td>${data.roomLayout || "N/A"}</td></tr>
        <tr><th>Equipment Needed</th><td>${data.equipments || "N/A"}</td></tr>
        <tr><th>Time</th><td>${data.startTime || "N/A"} - ${data.endTime || "N/A"}</td></tr>
        <tr><th>Venue</th><td>Training Hall</td></tr>
      </table>
      <h2>Contact Information</h2>
      <table border="1" cellspacing="0" cellpadding="8" width="100%">
        <tr><th>Requesting Office</th><td>${data.requestingOffice || "N/A"}</td></tr>
        <tr><th>Contact Person</th><td>${data.contactPerson || "N/A"}</td></tr>
        <tr><th>Email</th><td>${data.contactPersonEmail || "N/A"}</td></tr>
        <tr><th>Mobile Number</th><td>${data.mobileNumber || "N/A"}</td></tr>
      </table>
      <h2>Notes</h2><p>${data.notes || "None"}</p>
      <p style="text-align:center;font-size:12px;color:#777;">Generated by GSO Booking System — ${new Date().toLocaleString()}</p>
    </body></html>`;
}

// Confirmation PDF
function generateConfirmationHTML(data, approved) {
  const selectedDates = data.selectedDates.length ? data.selectedDates.join(", ") : "N/A";
  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8" /><title>Reservation Confirmation</title></head>
    <body style="font-family:'Arial',sans-serif;margin:40px;">
      <h1 style="color:${approved ? "#28a745" : "#dc3545"};">Reservation ${approved ? "Approved ✅" : "Rejected ❌"}</h1>
      <table border="1" cellspacing="0" cellpadding="8" width="100%">
        <tr><th>Event Title</th><td>${data.eventTitle || "N/A"}</td></tr>
        <tr><th>Selected Date(s)</th><td>${selectedDates}</td></tr>
        <tr><th>Venue</th><td>${data.reservationType || "Training Hall / Dome Tent"}</td></tr>
        <tr><th>Contact</th><td>${data.contactPerson || "N/A"} (${data.contactPersonEmail || "N/A"})</td></tr>
      </table>
      <p style="margin-top:30px;">Dear ${data.contactPerson || "User"},<br>Your reservation request has been <b>${approved ? "approved ✅" : "rejected ❌"}</b>.</p>
      <p style="text-align:center;font-size:12px;color:#777;">Generated by GSO Booking System — ${new Date().toLocaleString()}</p>
    </body></html>`;
}

// ====== Start Server ======
app.listen(PORT, HOST, () => {
  console.log(`✅ Server running at ${BASE_URL}`);
  console.log(`🌐 Access this from other devices on the same network using ${BASE_URL}`);
});
