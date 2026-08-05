/**
 * Builds a minimal valid single-page PDF (Buffer) with the given text lines.
 * Used for VEVO entitlement certificate downloads.
 */
export function buildSimplePdf(lines: string[]): Buffer {
  const escapePdfText = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const safeLines = lines.map((line) => escapePdfText(line.slice(0, 110)));
  const contentLines: string[] = ["BT", "/F1 12 Tf", "50 760 Td"];
  safeLines.forEach((line, index) => {
    if (index === 0) {
      contentLines.push(`(${line}) Tj`);
    } else {
      contentLines.push(`0 -18 Td (${line}) Tj`);
    }
  });
  contentLines.push("ET");
  const content = contentLines.join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
  );
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream\nendobj\n`);
  objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

export function buildSimplePdfDataUri(lines: string[]): string {
  return `data:application/pdf;base64,${buildSimplePdf(lines).toString("base64")}`;
}
