import {
  extractPdfText,
  FortnoxParseError,
  type FortnoxParserInput,
} from "../modules/fortnox-import/index.ts";

const MAX_SOURCE_FILE_SIZE = 5 * 1024 * 1024;
const UPLOAD_FIELDS = Object.freeze({
  detailedRegisterPdf: { extension: /\.pdf$/i, description: "detailed register PDF" },
  ownerOverviewPdf: { extension: /\.pdf$/i, description: "owner overview PDF" },
  eventsHtml: { extension: /\.html?$/i, description: "events HTML" },
});

type UploadField = keyof typeof UPLOAD_FIELDS;

function requiredFile(form: FormData, field: UploadField): File {
  const value = form.get(field);
  const expected = UPLOAD_FIELDS[field];
  if (!(value instanceof File) || value.size === 0) {
    throw new FortnoxParseError(`Missing ${expected.description}.`);
  }
  if (value.size > MAX_SOURCE_FILE_SIZE) {
    throw new FortnoxParseError(`${expected.description} exceeds 5 MB.`);
  }
  if (!expected.extension.test(value.name)) {
    throw new FortnoxParseError(`Unexpected file type for ${expected.description}.`);
  }
  return value;
}

async function parseMultipartRequest(request: Request): Promise<FortnoxParserInput> {
  const form = await request.formData().catch(() => {
    throw new FortnoxParseError("Malformed multipart upload.");
  });
  const detailedRegister = requiredFile(form, "detailedRegisterPdf");
  const ownerOverview = requiredFile(form, "ownerOverviewPdf");
  const events = requiredFile(form, "eventsHtml");
  const [detailedRegisterText, ownerOverviewText, eventsHtml] = await Promise.all([
    detailedRegister.bytes().then(extractPdfText),
    ownerOverview.bytes().then(extractPdfText),
    events.text(),
  ]);
  return { detailedRegisterText, ownerOverviewText, eventsHtml };
}

export async function parseFortnoxImportRequest(
  request: Request,
  parseJson: (input: unknown) => FortnoxParserInput,
): Promise<FortnoxParserInput> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("multipart/form-data")) return parseMultipartRequest(request);
  return parseJson(await request.json());
}
