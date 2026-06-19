import fs from "fs";
import path from "path";

/**
 * Static asset paths for Vercel @vercel/nft file tracing.
 * Runtime loads ESM packages via dynamic import() in ticketPdf.ts; without these
 * references the bundler omits @sparticuz/chromium and puppeteer-core from /var/task.
 */
const projectRoot = path.join(__dirname, "..", "..");

const TRACED_SERVERLESS_PDF_ASSETS = [
  "node_modules/@sparticuz/chromium/package.json",
  "node_modules/@sparticuz/chromium/build/index.js",
  "node_modules/@sparticuz/chromium/bin/chromium.br",
  "node_modules/@sparticuz/chromium/bin/al2023.tar.br",
  "node_modules/@sparticuz/chromium/bin/fonts.tar.br",
  "node_modules/@sparticuz/chromium/bin/swiftshader.tar.br",
  "node_modules/puppeteer-core/package.json",
  "node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js",
  "src/templates/emails/flightTicketEmail.mjml",
] as const;

for (const relativePath of TRACED_SERVERLESS_PDF_ASSETS) {
  fs.existsSync(path.join(projectRoot, relativePath));
}
