import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mjml2html = require("mjml") as (mjml: string) => { html: string };
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

function getOnboardingEmailHtml(firstname: string, email: string, password: string): string {
  const templatePath = path.join(process.cwd(), "src", "templates", "emails", "onboardingEmail.mjml");
  const mjmlSource = fs.readFileSync(templatePath, "utf-8");
  const mjmlWithVars = mjmlSource
    .replace(/\{\{firstname\}\}/g, firstname)
    .replace(/\{\{email\}\}/g, email)
    .replace(/\{\{password\}\}/g, password);
  const { html } = mjml2html(mjmlWithVars);
  return html;
}

export async function sendCrewWelcomeEmail(
  to: string,
  firstname: string,
  password: string
): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const html = getOnboardingEmailHtml(firstname, to, password);
  await transporter.sendMail({
    from,
    to,
    subject: "Welcome to Marine Flight - Your Crew Account",
    html,
  });
}
