import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseContext } from "../../db/database.ts";
import { createOwnerOverview, type OwnerOverview } from "../../domain/share-register/index.ts";
import {
  formatCompanyRegistrationIdentifier,
  formatSwedishIdentifier,
} from "../../domain/swedish-identifiers.ts";
import type { HistoricalSnapshotQuery } from "../projections/index.ts";
import {
  createShareRegisterExportSnapshot,
  recordShareRegisterExport,
  type ShareRegisterExport,
  type ShareRegisterExportSnapshot,
  shareRegisterExportFilename,
} from "./index.ts";

const TYPST_FONT_PATH = "/usr/share/fonts/truetype/liberation";
const TYPST_TIMEOUT_MS = 15_000;
const TYPST_TEMPLATE_URL = new URL("./share-register.typ", import.meta.url);

type TypstShareRegisterData = Readonly<{
  company: Readonly<{
    legalName: string;
    registrationValue: string;
  }>;
  effectiveOn: string;
  generatedAtIso: string;
  generatedAtLocal: string;
  lastAppliedSequence: string;
  ownerTotal: Readonly<{
    totalShares: string;
    totalVotes: string;
  }>;
  owners: readonly Readonly<{
    legalName: string;
    identifier: string;
    address: string;
    emailAddress: string;
    phoneNumber: string;
    totalShares: string;
    ownershipPercentage: string;
    totalVotes: string;
    votingPercentage: string;
  }>[];
  holdings: readonly Readonly<{
    range: string;
    legalName: string;
    identifier: string;
    kind: string;
    shareClass: string;
  }>[];
  shareClasses: readonly Readonly<{
    name: string;
    votesPerShare: string;
    totalShares: string;
  }>[];
}>;

async function typstExecutable(): Promise<string> {
  for (const path of [join(homedir(), ".local/bin/typst"), "/usr/local/bin/typst"]) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Fall through to the next standard installation location.
    }
  }
  return "typst";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("sv-SE").format(value).replaceAll("\u00a0", " ");
}

function formatRange(range: { from: number; to: number }): string {
  return range.from === range.to
    ? formatCount(range.from)
    : `${formatCount(range.from)}–${formatCount(range.to)}`;
}

function formatDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = new Intl.NumberFormat("sv-SE").format(BigInt(whole ?? "0"));
  return fraction ? `${grouped},${fraction}` : grouped;
}

function formatPercentage(value: string | undefined): string {
  return value === undefined ? "Saknas" : `${formatDecimal(value)} %`;
}

function formatServerTimestamp(value: string, timeZone: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const offset =
    new Intl.DateTimeFormat("sv-SE", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((entry) => entry.type === "timeZoneName")
      ?.value.replace("GMT", "UTC") ?? "UTC";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} · ${timeZone} (${offset})`;
}

function addressText(
  details: ShareRegisterExportSnapshot["shareholderDetails"][number]["details"],
): string {
  return [
    ...details.address.lines,
    `${details.address.postalCode} ${details.address.locality}`.trim(),
    details.address.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
}

function shareholderKind(kind: "INDIVIDUAL" | "LEGAL_ENTITY" | undefined): string {
  if (kind === "INDIVIDUAL") return "Fysisk person";
  if (kind === "LEGAL_ENTITY") return "Juridisk person";
  return "Okänd";
}

type ShareholderDetails = ShareRegisterExportSnapshot["shareholderDetails"][number]["details"];
type ExportShareClass = ShareRegisterExportSnapshot["shareClasses"][number];

function typstOwnerRows(
  details: ReadonlyMap<string, ShareholderDetails>,
  identifiers: ReadonlyMap<string, string>,
  overview: OwnerOverview,
): TypstShareRegisterData["owners"] {
  return overview.owners.map((overviewOwner) => {
    const owner = details.get(overviewOwner.shareholderId);
    return Object.freeze({
      legalName: owner?.legalName ?? overviewOwner.shareholderId,
      identifier: formatSwedishIdentifier(identifiers.get(overviewOwner.shareholderId) ?? "Saknas"),
      address: owner ? addressText(owner) : "Saknas",
      emailAddress: owner?.emailAddress ?? "E-post saknas",
      phoneNumber: owner?.phoneNumber ?? "Telefonnummer saknas",
      totalShares: formatCount(overviewOwner.totalShares),
      ownershipPercentage: formatPercentage(overviewOwner.ownershipPercentage),
      totalVotes: formatDecimal(overviewOwner.totalVotes),
      votingPercentage: formatPercentage(overviewOwner.votingPercentage),
    });
  });
}

function typstHoldingRows(
  snapshot: ShareRegisterExportSnapshot,
  details: ReadonlyMap<string, ShareholderDetails>,
  catalog: ReadonlyMap<string, ShareRegisterExportSnapshot["shareholderCatalog"][number]>,
  classes: ReadonlyMap<string, ExportShareClass>,
): TypstShareRegisterData["holdings"] {
  return snapshot.holdings.map((holding) => {
    const owner = details.get(holding.shareholderId);
    const shareholder = catalog.get(holding.shareholderId);
    return Object.freeze({
      range: formatRange(holding.range),
      legalName: owner?.legalName ?? holding.shareholderId,
      identifier: formatSwedishIdentifier(shareholder?.identifierValue ?? "Saknas"),
      kind: shareholderKind(shareholder?.kind),
      shareClass: classes.get(holding.shareClassId)?.name ?? holding.shareClassId,
    });
  });
}

function typstShareClassRows(
  snapshot: ShareRegisterExportSnapshot,
  classes: ReadonlyMap<string, ExportShareClass>,
): TypstShareRegisterData["shareClasses"] {
  return snapshot.totalsByClass.map(({ shareClassId, total }) => {
    const shareClass = classes.get(shareClassId);
    return Object.freeze({
      name: shareClass?.name ?? shareClassId,
      votesPerShare: shareClass?.votesPerShare ?? "Saknas",
      totalShares: formatCount(total),
    });
  });
}

export function createTypstShareRegisterData(
  snapshot: ShareRegisterExportSnapshot,
  serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): TypstShareRegisterData {
  const details = new Map(
    snapshot.shareholderDetails.map((entry) => [entry.shareholderId, entry.details]),
  );
  const catalog = new Map(snapshot.shareholderCatalog.map((entry) => [entry.id, entry]));
  const identifiers = new Map(
    snapshot.shareholderCatalog.map((entry) => [entry.id, entry.identifierValue]),
  );
  const classes = new Map(snapshot.shareClasses.map((entry) => [entry.id, entry]));
  const overview = createOwnerOverview({
    holdings: snapshot.holdings,
    totalsByShareholder: snapshot.totalsByShareholder,
    shareClasses: snapshot.shareClasses,
  });

  return Object.freeze({
    company: Object.freeze({
      legalName: snapshot.company.legalName,
      registrationValue: formatCompanyRegistrationIdentifier(snapshot.company),
    }),
    effectiveOn: snapshot.effectiveOn,
    generatedAtIso: snapshot.generatedAt,
    generatedAtLocal: formatServerTimestamp(snapshot.generatedAt, serverTimeZone),
    lastAppliedSequence:
      snapshot.lastAppliedSequence === undefined
        ? "Saknas"
        : formatCount(snapshot.lastAppliedSequence),
    ownerTotal: Object.freeze({
      totalShares: formatCount(overview.totalShares),
      totalVotes: formatDecimal(overview.totalVotes),
    }),
    owners: Object.freeze(typstOwnerRows(details, identifiers, overview)),
    holdings: Object.freeze(typstHoldingRows(snapshot, details, catalog, classes)),
    shareClasses: Object.freeze(typstShareClassRows(snapshot, classes)),
  });
}

async function compileTypstPdf(data: TypstShareRegisterData): Promise<Uint8Array> {
  const workspace = await mkdtemp(join(tmpdir(), "stam-typst-"));
  const sourcePath = join(workspace, "share-register.typ");
  const dataPath = join(workspace, "data.json");
  const outputPath = join(workspace, "share-register.pdf");

  try {
    await Promise.all([
      writeFile(sourcePath, await readFile(TYPST_TEMPLATE_URL)),
      writeFile(dataPath, JSON.stringify(data)),
    ]);

    const executable = await typstExecutable();
    const compiler = (() => {
      try {
        return Bun.spawn({
          cmd: [
            executable,
            "compile",
            "--root",
            workspace,
            "--creation-timestamp",
            String(Math.floor(new Date(data.generatedAtIso).getTime() / 1_000)),
            "--font-path",
            TYPST_FONT_PATH,
            "--pdf-standard",
            "a-2b",
            "--jobs",
            "1",
            "--diagnostic-format",
            "short",
            sourcePath,
            outputPath,
          ],
          cwd: workspace,
          stdout: "ignore",
          stderr: "pipe",
        });
      } catch (cause) {
        throw new Error(
          `Unable to start Typst at ${executable}. Install Typst 0.15.1 in ~/.local/bin, /usr/local/bin, or on PATH.`,
          { cause },
        );
      }
    })();

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      compiler.kill();
    }, TYPST_TIMEOUT_MS);
    const [exitCode, stderr] = await Promise.all([
      compiler.exited,
      new Response(compiler.stderr).text(),
    ]).finally(() => clearTimeout(timeout));

    if (timedOut) {
      throw new Error(`Typst PDF rendering exceeded ${TYPST_TIMEOUT_MS} ms.`);
    }
    if (exitCode !== 0) {
      const diagnostic = stderr.trim();
      throw new Error(`Typst PDF rendering failed${diagnostic ? `: ${diagnostic}` : "."}`);
    }

    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function renderSwedishShareRegisterPdf(
  snapshot: ShareRegisterExportSnapshot,
): Promise<Uint8Array> {
  return compileTypstPdf(createTypstShareRegisterData(snapshot));
}

export async function createPdfShareRegisterExport({
  database,
  companyId,
  query,
  actorUserId,
}: {
  database: DatabaseContext;
  companyId: string;
  query: HistoricalSnapshotQuery;
  actorUserId: string;
}): Promise<ShareRegisterExport> {
  const snapshot = createShareRegisterExportSnapshot(database, companyId, query);
  const content = await renderSwedishShareRegisterPdf(snapshot);
  recordShareRegisterExport(database, snapshot, "PDF", content, actorUserId);
  return Object.freeze({
    content,
    filename: shareRegisterExportFilename(snapshot, "pdf"),
    contentType: "application/pdf",
  });
}
