const functions = require("firebase-functions");
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const dotenv = require("dotenv");
const chromium = require("chrome-aws-lambda");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== In-memory appointments =====
const appointments = [];

// ===== Generate PDF =====
async function createPDF(html) {
  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
  await browser.close();
  return pdfBuffer;
}

// ===== Nodemailer =====
const functions = require("firebase-functions");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: functions.config().email.user,
    pass: functions.config().email.pass,
  },
});


// ===== POST /send-appointment =====
app.post("/send-appointment", async (req, res) => {
  const data = { ...req.body, id: uuidv4(), status: "pending" };
  appointments.push(data);

  try {
    const html = `<h1>Appointment Request</h1><pre>${JSON.stringify(data, null, 2)}</pre>`;
    const pdfBuffer = await createPDF(html);

    await transporter.sendMail({
      from: `"Booking System" <${process.env.EMAIL_USER}>`,
      to: "neust.jaydine.villanueva@gmail.com",
      subject: `New Appointment: ${data.eventTitle}`,
      html: `<p>New appointment request received.</p>`,
      attachments: [{ filename: "Appointment.pdf", content: pdfBuffer }],
    });

    res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== Export for Firebase =====
exports.api = functions.https.onRequest(app);
