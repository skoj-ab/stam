import { FortnoxParseError } from "./parser-model.ts";

const PDFTOTEXT_TIMEOUT_MS = 15_000;
const PDF_SIGNATURE = new TextEncoder().encode("%PDF-");

function hasPdfSignature(bytes: Uint8Array): boolean {
  return PDF_SIGNATURE.every((value, index) => bytes[index] === value);
}

function startConverter(pdf: Uint8Array) {
  try {
    return Bun.spawn(["pdftotext", "-layout", "-", "-"], {
      stdin: pdf,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (cause) {
    throw new Error("Unable to start pdftotext. Install Poppler's pdftotext utility.", { cause });
  }
}

async function convertPdf(pdf: Uint8Array) {
  const converter = startConverter(pdf);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    converter.kill();
  }, PDFTOTEXT_TIMEOUT_MS);
  const [exitCode, text] = await Promise.all([
    converter.exited,
    new Response(converter.stdout).text(),
    new Response(converter.stderr).text(),
  ]).finally(() => clearTimeout(timeout));
  return { exitCode, text, timedOut };
}

export async function extractPdfText(pdf: Uint8Array): Promise<string> {
  if (!hasPdfSignature(pdf)) throw new FortnoxParseError("The uploaded file is not a PDF.");
  const { exitCode, text, timedOut } = await convertPdf(pdf);

  if (timedOut) throw new FortnoxParseError("PDF text extraction timed out.");
  if (exitCode !== 0 || text.trim() === "") {
    throw new FortnoxParseError("The PDF has no readable text or is malformed.");
  }
  return text;
}
