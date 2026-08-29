import { createHash } from "node:crypto";
import type { DatabaseContext } from "../../db/database.ts";
import {
  createShareRegisterSnapshot,
  type ShareClass,
  type ShareRegisterSnapshot,
} from "../../domain/share-register/index.ts";
import {
  formatCompanyRegistrationIdentifier,
  formatSwedishIdentifier,
} from "../../domain/swedish-identifiers.ts";
import { recordAuditEvent } from "../audit/index.ts";
import { type Company, requireCompany } from "../companies/index.ts";
import {
  type HistoricalSnapshotQuery,
  historicalSnapshotQuerySchema,
} from "../projections/index.ts";
import { loadShareRegister } from "../share-register/index.ts";

type CompanyIdentity = Pick<
  Company,
  "id" | "legalName" | "registrationCountry" | "registrationScheme" | "registrationValue"
>;

export type ShareRegisterExportSnapshot = Omit<ShareRegisterSnapshot, "effectiveOn" | "knownAt"> &
  Readonly<{
    schemaVersion: 1;
    company: CompanyIdentity;
    effectiveOn: string;
    knownAt: string;
    generatedAt: string;
    shareClasses: readonly ShareClass[];
    shareholderCatalog: readonly Readonly<
      Pick<
        ReturnType<typeof loadShareRegister>["shareholders"][number],
        "id" | "kind" | "identifierCountryCode" | "identifierScheme" | "identifierValue"
      >
    >[];
  }>;

export type ShareRegisterExport = Readonly<{
  content: string | Uint8Array;
  filename: string;
  contentType: string;
}>;

function availableAtCutoff(
  entry: { effectiveFrom: string; registeredAt: string },
  effectiveOn: string,
  knownAt: string,
): boolean {
  return entry.effectiveFrom <= effectiveOn && entry.registeredAt <= knownAt;
}

export function createShareRegisterExportSnapshot(
  database: DatabaseContext,
  companyId: string,
  query: HistoricalSnapshotQuery,
  generatedAt = new Date(),
): ShareRegisterExportSnapshot {
  const requested = historicalSnapshotQuerySchema.parse(query);
  const generatedAtIso = generatedAt.toISOString();
  const effectiveOn = requested.effectiveOn ?? generatedAtIso.slice(0, 10);
  const knownAt = requested.knownAt ?? generatedAtIso;
  const register = loadShareRegister(database, companyId);
  const company = requireCompany(database, companyId);
  const snapshot = createShareRegisterSnapshot({ ...register, effectiveOn, knownAt });

  return Object.freeze({
    ...snapshot,
    schemaVersion: 1,
    company: Object.freeze({
      id: company.id,
      legalName: company.legalName,
      registrationCountry: company.registrationCountry,
      registrationScheme: company.registrationScheme,
      registrationValue: company.registrationValue,
    }),
    effectiveOn,
    knownAt,
    generatedAt: generatedAtIso,
    shareClasses: Object.freeze(
      register.shareClasses.filter((entry) => availableAtCutoff(entry, effectiveOn, knownAt)),
    ),
    shareholderCatalog: Object.freeze(
      register.shareholders
        .filter((entry) => availableAtCutoff(entry, effectiveOn, knownAt))
        .map(({ id, kind, identifierCountryCode, identifierScheme, identifierValue }) =>
          Object.freeze({
            id,
            kind,
            identifierCountryCode,
            identifierScheme,
            identifierValue,
          }),
        ),
    ),
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("sv-SE").format(value);
}

function formatRange(range: { from: number; to: number }): string {
  return range.from === range.to
    ? formatCount(range.from)
    : `${formatCount(range.from)}–${formatCount(range.to)}`;
}

function identifierText(value: string | undefined): string {
  return value ? formatSwedishIdentifier(value) : "Saknas";
}

function addressText(
  address: ShareRegisterExportSnapshot["shareholderDetails"][number]["details"]["address"],
): string {
  return [...address.lines, `${address.postalCode} ${address.locality}`.trim(), address.countryCode]
    .filter(Boolean)
    .join(", ");
}

function kindText(kind: "INDIVIDUAL" | "LEGAL_ENTITY" | undefined): string {
  if (kind === "INDIVIDUAL") return "Fysisk person";
  if (kind === "LEGAL_ENTITY") return "Juridisk person";
  return "Okänd";
}

function holdingRows(snapshot: ShareRegisterExportSnapshot): string {
  const details = new Map(
    snapshot.shareholderDetails.map((entry) => [entry.shareholderId, entry.details]),
  );
  const catalog = new Map(
    snapshot.shareholderCatalog.map((shareholder) => [shareholder.id, shareholder]),
  );
  const classes = new Map(snapshot.shareClasses.map((entry) => [entry.id, entry.name]));
  return snapshot.holdings
    .map((holding) => {
      const owner = details.get(holding.shareholderId);
      const shareholder = catalog.get(holding.shareholderId);
      const cells = [
        formatRange(holding.range),
        owner?.legalName ?? holding.shareholderId,
        identifierText(shareholder?.identifierValue),
        owner ? addressText(owner.address) : "Saknas",
        kindText(shareholder?.kind),
        classes.get(holding.shareClassId) ?? holding.shareClassId,
      ];
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
}

function totalRows(snapshot: ShareRegisterExportSnapshot): string {
  const classes = new Map(snapshot.shareClasses.map((entry) => [entry.id, entry]));
  return snapshot.totalsByClass
    .map(({ shareClassId, total }) => {
      const shareClass = classes.get(shareClassId);
      return `<tr><td>${escapeHtml(shareClass?.name ?? shareClassId)}</td><td>${escapeHtml(shareClass?.votesPerShare ?? "Saknas")}</td><td>${formatCount(total)}</td></tr>`;
    })
    .join("");
}

export function renderSwedishShareRegisterHtml(snapshot: ShareRegisterExportSnapshot): string {
  const title = `Aktiebok för ${snapshot.company.legalName}`;
  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page { size: A4 landscape; margin: 14mm; }
body { color: #171714; font: 10pt Georgia, serif; line-height: 1.35; }
h1, h2 { margin: 0 0 8px; } h1 { font-size: 20pt; } h2 { font-size: 13pt; margin-top: 20px; }
.meta { margin: 0 0 4px; } .notice { border: 1px solid #8a6d1d; padding: 8px; margin: 16px 0; }
table { border-collapse: collapse; width: 100%; } thead { display: table-header-group; }
th, td { border: 1px solid #777; padding: 5px; text-align: left; vertical-align: top; }
th { background: #eee; } tr { break-inside: avoid; } footer { margin-top: 20px; font-size: 8pt; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Organisationsnummer: ${escapeHtml(formatCompanyRegistrationIdentifier(snapshot.company))}</p>
<p class="meta">Verkningsdag: ${escapeHtml(snapshot.effectiveOn)} · Känt vid: ${escapeHtml(snapshot.knownAt)}</p>
<p class="notice"><strong>Observera:</strong> Stam lagrar ännu inte uppgifter om utfärdade aktiebrev eller bolagsordningsförbehåll. Kontrollera och komplettera dessa uppgifter innan dokumentet används som fullständig lagstadgad aktiebok.</p>
<h2>Aktieinnehav</h2>
<table><thead><tr><th>Aktienummer</th><th>Aktieägare</th><th>Identifierare</th><th>Postadress</th><th>Typ</th><th>Aktieslag</th></tr></thead><tbody>${holdingRows(snapshot)}</tbody></table>
<h2>Aktieslag och totalt antal aktier</h2>
<table><thead><tr><th>Aktieslag</th><th>Röster per aktie</th><th>Antal aktier</th></tr></thead><tbody>${totalRows(snapshot)}</tbody></table>
<footer>Genererad ${escapeHtml(snapshot.generatedAt)} · Senaste tillämpade sekvens ${snapshot.lastAppliedSequence ?? "saknas"}</footer>
</body></html>`;
}

export function shareRegisterExportFilename(
  snapshot: ShareRegisterExportSnapshot,
  extension: string,
): string {
  const identifier = formatCompanyRegistrationIdentifier(snapshot.company).replace(
    /[^0-9A-Za-z-]/g,
    "-",
  );
  return `aktiebok-${identifier}-${snapshot.effectiveOn}.${extension}`;
}

export function recordShareRegisterExport(
  database: DatabaseContext,
  snapshot: ShareRegisterExportSnapshot,
  format: "HTML" | "PDF",
  content: string | Uint8Array,
  actorUserId: string,
): void {
  const size = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
  recordAuditEvent(database, {
    type: "EXPORT_GENERATED",
    outcome: "SUCCEEDED",
    actorKind: "USER",
    actorUserId,
    companyId: snapshot.companyId,
    payload: {
      format,
      effectiveOn: snapshot.effectiveOn,
      knownAt: snapshot.knownAt,
      lastAppliedSequence: snapshot.lastAppliedSequence,
      sha256: createHash("sha256").update(content).digest("hex"),
      size,
    },
  });
}

export function createHtmlShareRegisterExport(
  database: DatabaseContext,
  companyId: string,
  query: HistoricalSnapshotQuery,
  actorUserId: string,
): ShareRegisterExport {
  const snapshot = createShareRegisterExportSnapshot(database, companyId, query);
  const content = renderSwedishShareRegisterHtml(snapshot);
  recordShareRegisterExport(database, snapshot, "HTML", content, actorUserId);
  return Object.freeze({
    content,
    filename: shareRegisterExportFilename(snapshot, "html"),
    contentType: "text/html; charset=utf-8",
  });
}
