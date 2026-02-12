import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
});

export async function sendCrewWelcomeEmail(
  to: string,
  firstname: string,
  password: string
): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  await transporter.sendMail({
    from,
    to,
    subject: "Welcome to Marine Flight - Your Crew Account",
    html: `
      <h2>Welcome, ${firstname}!</h2>
      <p>Your crew account has been created successfully.</p>
      <p>Here are your login credentials:</p>
      <ul>
        <li><strong>Email:</strong> ${to}</li>
        <li><strong>Password:</strong> ${password}</li>
      </ul>
      <p>Please change your password after your first login.</p>
      <p>Best regards,<br/>Marine Flight Team</p>
    `,
  });
}
