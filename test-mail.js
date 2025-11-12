import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "blackpinkjoints@gmail.com",
    pass: "eojdzlrrtbsqkcxo",
  },
});

const mailOptions = {
  from: '"Test" <blackpinkjoints@gmail.com>',
  to: "neust.jaydine.villanueva@gmail.com",
  subject: "Test Email",
  text: "This is a test email from Node.js",
};

transporter.sendMail(mailOptions, (err, info) => {
  if (err) console.log("❌ Error:", err);
  else console.log("✅ Email sent:", info.response);
});
