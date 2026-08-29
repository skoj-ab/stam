import { exactDecimalSchema, exactPriceSchema } from "../../domain/share-register/index.ts";
import {
  normalizeSwedishOrganizationNumber,
  normalizeSwedishPersonalNumber,
} from "../../domain/swedish-identifiers.ts";
import { validateOcfPackageSchemas } from "./schemas.ts";
import {
  OCF_VERSION,
  type OcfCatalogInput,
  type OcfConversion,
  type OcfDryRunReport,
  type OcfDryRunResult,
  type OcfEventDraft,
  type OcfImportOptions,
  type OcfInformationLoss,
  type OcfIssue,
  type OcfPackage,
  type OcfProposedCommand,
  type OcfRequiredResolution,
  type OcfSupportedCounts,
  type TransferReason,
} from "./types.ts";

type DataObject = Record<string, unknown>;
type Range = Readonly<{ from: number; to: number }>;
type LocatedObject = Readonly<{ file: string; index: number; value: DataObject }>;

type Stakeholder = Readonly<{
  id: string;
  kind: "INDIVIDUAL" | "LEGAL_ENTITY";
  identifierScheme: "PERSONNUMMER" | "ORGANISATIONSNUMMER";
  identifierValue: string;
  legalName: string;
  address: Readonly<{
    lines: readonly string[];
    postalCode: string;
    locality: string;
    countryCode: "SE";
  }>;
  file: string;
  index: number;
}>;

type StockClass = Readonly<{
  id: string;
  name: string;
  votesPerShare: string;
  file: string;
  index: number;
}>;

type Issuance = Readonly<{
  id: string;
  securityId: string;
  date: string;
  stakeholderId: string;
  stockClassId: string;
  ranges: readonly Range[];
  quantity: number;
  sharePrice?: Readonly<{ amount: string; currency: string }>;
  file: string;
  index: number;
}>;

type Terminal = Readonly<{
  kind: "TRANSFER" | "CANCELLATION";
  id: string;
  securityId: string;
  date: string;
  quantity: number;
  resultingSecurityIds: readonly string[];
  balanceSecurityId?: string;
  reasonText?: string;
  file: string;
  index: number;
}>;

type Analysis = Readonly<{
  issues: readonly OcfIssue[];
  losses: readonly OcfInformationLoss[];
  requiredResolutions: readonly OcfRequiredResolution[];
  issuer?: Readonly<{
    id: string;
    legalName: string;
    formationDate: string;
    organizationNumber: string;
  }>;
  asOf?: string;
  stakeholders: ReadonlyMap<string, Stakeholder>;
  stockClasses: ReadonlyMap<string, StockClass>;
  issuances: ReadonlyMap<string, Issuance>;
  terminals: readonly Terminal[];
  childSecurityIds: ReadonlySet<string>;
  terminalBySecurityId: ReadonlyMap<string, Terminal>;
  parentTerminalBySecurityId: ReadonlyMap<string, Terminal>;
}>;

const transferReasons: readonly TransferReason[] = Object.freeze([
  "SALE",
  "GIFT",
  "INHERITANCE",
  "DIVISION_OF_PROPERTY",
  "OTHER",
]);

function isRecord(value: unknown): value is DataObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function trimmedValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasDefinedValues<T extends object>(
  value: T,
): value is T & { [Key in keyof T]-?: Exclude<T[Key], undefined> } {
  return Object.values(value).every((item) => item !== undefined);
}

function objectPath(object: LocatedObject, suffix = ""): string {
  return `/items/${object.index}${suffix}`;
}

function addIssue(
  issues: OcfIssue[],
  input: Omit<OcfIssue, "severity"> & { severity?: OcfIssue["severity"] },
): void {
  issues.push({ severity: "ERROR", ...input });
}

function compareDiagnostic(
  left: OcfIssue | OcfInformationLoss,
  right: OcfIssue | OcfInformationLoss,
): number {
  return (
    left.file.localeCompare(right.file) ||
    left.path.localeCompare(right.path) ||
    (left.objectId ?? "").localeCompare(right.objectId ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function manifestReferences(manifest: unknown, issues: OcfIssue[]): readonly string[] {
  if (!isRecord(manifest)) return [];
  const references: string[] = [];
  const seen = new Set<string>();
  for (const [property, entries] of Object.entries(manifest)) {
    if (!property.endsWith("_files") || !Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      const filepath = isRecord(entry) ? stringValue(entry.filepath) : undefined;
      if (!filepath) continue;
      if (seen.has(filepath)) {
        addIssue(issues, {
          code: "DUPLICATE_FILE_REFERENCE",
          file: "manifest",
          path: `/${property}/${index}/filepath`,
          message: `Manifest filepath is referenced more than once: ${filepath}`,
        });
      } else {
        references.push(filepath);
        seen.add(filepath);
      }
    }
  }
  return references;
}

function referencedObjects(
  pkg: OcfPackage,
  references: readonly string[],
  issues: OcfIssue[],
): readonly LocatedObject[] {
  const objects: LocatedObject[] = [];
  const referenceSet = new Set(references);
  for (const filepath of references) {
    const file = pkg.files[filepath];
    if (file === undefined) {
      addIssue(issues, {
        code: "BROKEN_FILE_REFERENCE",
        file: "manifest",
        path: "/",
        message: `Manifest references a missing parsed file: ${filepath}`,
      });
      continue;
    }
    if (!isRecord(file) || !Array.isArray(file.items)) continue;
    file.items.forEach((value, index) => {
      if (isRecord(value)) objects.push({ file: filepath, index, value });
    });
  }
  for (const filepath of Object.keys(pkg.files).sort()) {
    if (!referenceSet.has(filepath)) {
      addIssue(issues, {
        code: "UNREFERENCED_PACKAGE_FILE",
        severity: "WARNING",
        file: filepath,
        path: "/",
        message: "The parsed file is not referenced by the manifest and will be ignored.",
      });
    }
  }
  return objects;
}

function duplicateObjectIds(objects: readonly LocatedObject[], issues: OcfIssue[]): void {
  const ids = new Map<string, LocatedObject>();
  for (const object of objects) {
    const id = stringValue(object.value.id);
    if (!id) continue;
    const first = ids.get(id);
    if (first) {
      addIssue(issues, {
        code: "DUPLICATE_OBJECT_ID",
        file: object.file,
        objectId: id,
        path: objectPath(object, "/id"),
        message: `Object ID duplicates ${first.file}${objectPath(first, "/id")}: ${id}`,
      });
    } else {
      ids.set(id, object);
    }
  }
}

function reportUnmappedFields(
  object: LocatedObject,
  mapped: ReadonlySet<string>,
  losses: OcfInformationLoss[],
): void {
  const objectId = stringValue(object.value.id);
  for (const property of Object.keys(object.value).sort()) {
    if (!mapped.has(property)) {
      losses.push({
        code: "UNMAPPED_OCF_FIELD",
        file: object.file,
        objectId,
        path: objectPath(object, `/${property}`),
        message: `OCF field '${property}' is retained in the source package but has no Stam core representation.`,
      });
    }
  }
}

function parseIssuer(
  manifest: unknown,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): Analysis["issuer"] {
  if (!isRecord(manifest) || !isRecord(manifest.issuer)) return undefined;
  const issuer = manifest.issuer;
  const id = stringValue(issuer.id);
  const legalName = trimmedValue(issuer.legal_name);
  const formationDate = stringValue(issuer.formation_date);
  const country = stringValue(issuer.country_of_formation);
  if (country !== "SE") {
    addIssue(issues, {
      code: "UNSUPPORTED_ISSUER_COUNTRY",
      file: "manifest",
      objectId: id,
      path: "/issuer/country_of_formation",
      message: "The first OCF profile supports Swedish issuers only.",
    });
  }
  const taxIds = Array.isArray(issuer.tax_ids) ? issuer.tax_ids : [];
  const swedishTaxIds = taxIds.filter((taxId) => isRecord(taxId) && taxId.country === "SE");
  const sourceTaxId =
    swedishTaxIds.length === 1 && isRecord(swedishTaxIds[0])
      ? stringValue(swedishTaxIds[0].tax_id)
      : undefined;
  const organizationNumber = sourceTaxId
    ? normalizeSwedishOrganizationNumber(sourceTaxId)
    : undefined;
  if (!organizationNumber) {
    addIssue(issues, {
      code: "SWEDISH_ISSUER_ID_REQUIRED",
      file: "manifest",
      objectId: id,
      path: "/issuer/tax_ids",
      message: "Issuer must have exactly one valid Swedish organisation number tax ID.",
    });
  }
  if (taxIds.length > 1) {
    losses.push({
      code: "ADDITIONAL_TAX_ID_NOT_IMPORTED",
      file: "manifest",
      objectId: id,
      path: "/issuer/tax_ids",
      message: "Only the Swedish organisation number is converted to the Stam company catalog.",
    });
  }
  for (const property of Object.keys(issuer).sort()) {
    if (
      !new Set([
        "object_type",
        "id",
        "legal_name",
        "formation_date",
        "country_of_formation",
        "tax_ids",
      ]).has(property)
    ) {
      losses.push({
        code: "UNMAPPED_OCF_FIELD",
        file: "manifest",
        objectId: id,
        path: `/issuer/${property}`,
        message: `Issuer field '${property}' has no Stam core representation.`,
      });
    }
  }
  return id && legalName && formationDate && organizationNumber
    ? { id, legalName, formationDate, organizationNumber }
    : undefined;
}

function stakeholderKind(value: unknown): Stakeholder["kind"] | undefined {
  if (value === "INDIVIDUAL") return "INDIVIDUAL";
  if (value === "INSTITUTION") return "LEGAL_ENTITY";
  return undefined;
}

function stakeholderIdentifier(
  object: LocatedObject,
  kind: Stakeholder["kind"] | undefined,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
):
  | Readonly<{
      scheme: Stakeholder["identifierScheme"];
      value: string;
    }>
  | undefined {
  const taxIds = Array.isArray(object.value.tax_ids) ? object.value.tax_ids : [];
  const swedishTaxIds = taxIds.filter((taxId) => isRecord(taxId) && taxId.country === "SE");
  const taxId =
    swedishTaxIds.length === 1 && isRecord(swedishTaxIds[0])
      ? stringValue(swedishTaxIds[0].tax_id)
      : undefined;
  const value =
    taxId && kind
      ? kind === "INDIVIDUAL"
        ? normalizeSwedishPersonalNumber(taxId)
        : normalizeSwedishOrganizationNumber(taxId)
      : undefined;
  if (!value || !kind) {
    addIssue(issues, {
      code: "SWEDISH_STAKEHOLDER_ID_REQUIRED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/tax_ids"),
      message:
        "Stakeholder must have one valid Swedish tax ID matching its individual/institution type.",
    });
    return undefined;
  }
  if (taxIds.length > 1) {
    losses.push({
      code: "ADDITIONAL_TAX_ID_NOT_IMPORTED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/tax_ids"),
      message: "Only the stakeholder's Swedish personal or organisation number is converted.",
    });
  }
  return { scheme: kind === "INDIVIDUAL" ? "PERSONNUMMER" : "ORGANISATIONSNUMMER", value };
}

function stakeholderAddress(
  object: LocatedObject,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): Stakeholder["address"] | undefined {
  const addresses = Array.isArray(object.value.addresses)
    ? object.value.addresses.filter(isRecord)
    : [];
  const addressIndex = addresses.findIndex((candidate) => candidate.country === "SE");
  const address = addresses[addressIndex];
  const streetSuite = address ? trimmedValue(address.street_suite) : undefined;
  const locality = address ? trimmedValue(address.city) : undefined;
  const postalCode = address ? trimmedValue(address.postal_code) : undefined;
  if (!streetSuite || !locality || !postalCode) {
    addIssue(issues, {
      code: "SWEDISH_STAKEHOLDER_ADDRESS_REQUIRED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/addresses"),
      message: "Stakeholder must have a complete Swedish address for Stam catalog creation.",
    });
    return undefined;
  }
  if (addresses.length > 1) {
    losses.push({
      code: "ADDITIONAL_ADDRESS_NOT_IMPORTED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/addresses"),
      message: "Only the first complete Swedish stakeholder address is converted.",
    });
  }
  if (address) {
    for (const property of Object.keys(address).sort()) {
      if (["street_suite", "city", "country", "postal_code"].includes(property)) continue;
      losses.push({
        code: "UNMAPPED_OCF_FIELD",
        file: object.file,
        objectId: stringValue(object.value.id),
        path: objectPath(object, `/addresses/${addressIndex}/${property}`),
        message: `Stakeholder address field '${property}' has no Stam core representation.`,
      });
    }
  }
  return {
    lines: streetSuite
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    postalCode,
    locality,
    countryCode: "SE",
  };
}

function reportStakeholderNameLosses(object: LocatedObject, losses: OcfInformationLoss[]): void {
  if (!isRecord(object.value.name)) return;
  for (const property of Object.keys(object.value.name).sort()) {
    if (property === "legal_name") continue;
    losses.push({
      code: "UNMAPPED_OCF_FIELD",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, `/name/${property}`),
      message: `Stakeholder name field '${property}' has no separate Stam core representation.`,
    });
  }
}

function parseStakeholder(
  object: LocatedObject,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): Stakeholder | undefined {
  const id = stringValue(object.value.id);
  const legalName = isRecord(object.value.name)
    ? trimmedValue(object.value.name.legal_name)
    : undefined;
  const kind = stakeholderKind(object.value.stakeholder_type);
  const identifier = stakeholderIdentifier(object, kind, issues, losses);
  const address = stakeholderAddress(object, issues, losses);
  reportStakeholderNameLosses(object, losses);
  reportUnmappedFields(
    object,
    new Set(["object_type", "id", "name", "stakeholder_type", "addresses", "tax_ids"]),
    losses,
  );
  if (!id) return undefined;
  if (!legalName) return undefined;
  if (!kind) return undefined;
  if (!identifier) return undefined;
  if (!address) return undefined;
  return {
    id,
    kind,
    identifierScheme: identifier.scheme,
    identifierValue: identifier.value,
    legalName,
    address,
    file: object.file,
    index: object.index,
  };
}

function parseStockClass(
  object: LocatedObject,
  losses: OcfInformationLoss[],
): StockClass | undefined {
  const id = stringValue(object.value.id);
  const name = trimmedValue(object.value.name);
  const votesPerShare = stringValue(object.value.votes_per_share);
  reportUnmappedFields(object, new Set(["object_type", "id", "name", "votes_per_share"]), losses);
  return id && name && votesPerShare
    ? { id, name, votesPerShare, file: object.file, index: object.index }
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeRanges(ranges: readonly Range[]): readonly Range[] {
  return [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
}

function rangesQuantity(ranges: readonly Range[]): number {
  return ranges.reduce((total, range) => total + range.to - range.from + 1, 0);
}

function validNonOverlappingRanges(ranges: readonly Range[]): boolean {
  return ranges.every(
    (range, index) =>
      range.from <= range.to && (index === 0 || range.from > (ranges[index - 1]?.to ?? 0)),
  );
}

function parseRanges(object: LocatedObject, issues: OcfIssue[]): readonly Range[] | undefined {
  if (
    !Array.isArray(object.value.share_numbers_issued) ||
    object.value.share_numbers_issued.length === 0
  ) {
    addIssue(issues, {
      code: "EXACT_SHARE_RANGES_REQUIRED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/share_numbers_issued"),
      message: "Stock issuance must contain exact positive integral share-number ranges.",
    });
    return undefined;
  }
  const ranges: Range[] = [];
  for (const [rangeIndex, range] of object.value.share_numbers_issued.entries()) {
    const from = isRecord(range) ? positiveInteger(range.starting_share_number) : undefined;
    const to = isRecord(range) ? positiveInteger(range.ending_share_number) : undefined;
    if (!from || !to || from > to) {
      addIssue(issues, {
        code: "MALFORMED_SHARE_RANGE",
        file: object.file,
        objectId: stringValue(object.value.id),
        path: objectPath(object, `/share_numbers_issued/${rangeIndex}`),
        message: "Share-number range endpoints must be positive safe integers with start <= end.",
      });
      continue;
    }
    ranges.push({ from, to });
  }
  const normalized = normalizeRanges(ranges);
  if (!validNonOverlappingRanges(normalized)) {
    addIssue(issues, {
      code: "OVERLAPPING_SHARE_RANGES",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/share_numbers_issued"),
      message: "Share-number ranges within an issuance must not overlap.",
    });
  }
  return normalized.length === object.value.share_numbers_issued.length ? normalized : undefined;
}

function reportUnsupportedIssuanceTerms(object: LocatedObject, issues: OcfIssue[]): void {
  for (const property of ["stock_plan_id", "vesting_terms_id", "vestings", "issuance_type"]) {
    if (object.value[property] === undefined) continue;
    addIssue(issues, {
      code: "UNSUPPORTED_STOCK_SECURITY_TERMS",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, `/${property}`),
      message: `The first OCF profile cannot represent stock security term '${property}'.`,
    });
  }
}

function parseIssuanceQuantity(
  object: LocatedObject,
  ranges: readonly Range[] | undefined,
  issues: OcfIssue[],
): number | undefined {
  const quantity = positiveInteger(object.value.quantity);
  if (!quantity) {
    addIssue(issues, {
      code: "INTEGRAL_SHARE_QUANTITY_REQUIRED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/quantity"),
      message: "Stock quantity must be an exact positive safe integer.",
    });
    return undefined;
  }
  if (ranges && quantity !== rangesQuantity(ranges)) {
    addIssue(issues, {
      code: "SHARE_RANGE_QUANTITY_MISMATCH",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/quantity"),
      message: "Issuance quantity must equal its exact share-number ranges.",
    });
  }
  return quantity;
}

function parseIssuance(
  object: LocatedObject,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): Issuance | undefined {
  reportUnsupportedIssuanceTerms(object, issues);
  const ranges = parseRanges(object, issues);
  const quantity = parseIssuanceQuantity(object, ranges, issues);
  reportUnmappedFields(
    object,
    new Set([
      "object_type",
      "id",
      "security_id",
      "date",
      "stakeholder_id",
      "stock_class_id",
      "quantity",
      "share_numbers_issued",
      "share_price",
    ]),
    losses,
  );
  const sharePriceRecord = isRecord(object.value.share_price) ? object.value.share_price : {};
  const sharePriceParts = {
    amount: stringValue(sharePriceRecord.amount),
    currency: stringValue(sharePriceRecord.currency),
  };
  const core = {
    id: stringValue(object.value.id),
    securityId: stringValue(object.value.security_id),
    date: stringValue(object.value.date),
    stakeholderId: stringValue(object.value.stakeholder_id),
    stockClassId: stringValue(object.value.stock_class_id),
    quantity,
    ranges,
  };
  if (!hasDefinedValues(core)) return undefined;
  return {
    ...core,
    sharePrice: hasDefinedValues(sharePriceParts) ? sharePriceParts : undefined,
    file: object.file,
    index: object.index,
  };
}

function parseTerminal(
  object: LocatedObject,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): Terminal | undefined {
  const type = object.value.object_type;
  const kind = type === "TX_STOCK_TRANSFER" ? "TRANSFER" : "CANCELLATION";
  const quantity = positiveInteger(object.value.quantity);
  if (!quantity) {
    addIssue(issues, {
      code: "INTEGRAL_SHARE_QUANTITY_REQUIRED",
      file: object.file,
      objectId: stringValue(object.value.id),
      path: objectPath(object, "/quantity"),
      message: "Stock quantity must be an exact positive safe integer.",
    });
  }
  const resultingSecurityIds =
    kind === "TRANSFER" && Array.isArray(object.value.resulting_security_ids)
      ? object.value.resulting_security_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  reportUnmappedFields(
    object,
    new Set([
      "object_type",
      "id",
      "security_id",
      "date",
      "quantity",
      "resulting_security_ids",
      "balance_security_id",
      "reason_text",
    ]),
    losses,
  );
  const core = {
    id: stringValue(object.value.id),
    securityId: stringValue(object.value.security_id),
    date: stringValue(object.value.date),
    quantity,
  };
  if (!hasDefinedValues(core)) return undefined;
  return {
    ...core,
    kind,
    resultingSecurityIds,
    balanceSecurityId: stringValue(object.value.balance_security_id),
    reasonText: stringValue(object.value.reason_text),
    file: object.file,
    index: object.index,
  };
}

function validateReferences(
  stakeholders: ReadonlyMap<string, Stakeholder>,
  stockClasses: ReadonlyMap<string, StockClass>,
  issuances: ReadonlyMap<string, Issuance>,
  issues: OcfIssue[],
): void {
  for (const issuance of issuances.values()) {
    if (!stakeholders.has(issuance.stakeholderId)) {
      addIssue(issues, {
        code: "BROKEN_STAKEHOLDER_REFERENCE",
        file: issuance.file,
        objectId: issuance.id,
        path: `/items/${issuance.index}/stakeholder_id`,
        message: `Unknown stakeholder_id: ${issuance.stakeholderId}`,
      });
    }
    if (!stockClasses.has(issuance.stockClassId)) {
      addIssue(issues, {
        code: "BROKEN_STOCK_CLASS_REFERENCE",
        file: issuance.file,
        objectId: issuance.id,
        path: `/items/${issuance.index}/stock_class_id`,
        message: `Unknown stock_class_id: ${issuance.stockClassId}`,
      });
    }
  }
}

function sameRanges(left: readonly Range[], right: readonly Range[]): boolean {
  const merge = (ranges: readonly Range[]) =>
    normalizeRanges(ranges).reduce<Range[]>((merged, range) => {
      const prior = merged.at(-1);
      if (prior && range.from === prior.to + 1) {
        merged[merged.length - 1] = { from: prior.from, to: range.to };
      } else {
        merged.push(range);
      }
      return merged;
    }, []);
  const mergedLeft = merge(left);
  const mergedRight = merge(right);
  return (
    mergedLeft.length === mergedRight.length &&
    mergedLeft.every(
      (range, index) =>
        range.from === mergedRight[index]?.from && range.to === mergedRight[index]?.to,
    )
  );
}

function rangesContained(child: readonly Range[], parent: readonly Range[]): boolean {
  const mergedParent = normalizeRanges(parent).reduce<Range[]>((merged, range) => {
    const prior = merged.at(-1);
    if (prior && range.from === prior.to + 1) {
      merged[merged.length - 1] = { from: prior.from, to: range.to };
    } else {
      merged.push(range);
    }
    return merged;
  }, []);
  return child.every((range) =>
    mergedParent.some((candidate) => range.from >= candidate.from && range.to <= candidate.to),
  );
}

function validateLifecycle(
  issuances: ReadonlyMap<string, Issuance>,
  terminals: readonly Terminal[],
  issues: OcfIssue[],
): Readonly<{
  children: ReadonlySet<string>;
  terminalBySecurityId: ReadonlyMap<string, Terminal>;
  parentTerminalBySecurityId: ReadonlyMap<string, Terminal>;
}> {
  const children = new Set<string>();
  const terminalBySecurityId = new Map<string, Terminal>();
  const parentTerminalBySecurityId = new Map<string, Terminal>();
  for (const terminal of terminals) {
    const source = issuances.get(terminal.securityId);
    if (!source) {
      addIssue(issues, {
        code: "BROKEN_SECURITY_REFERENCE",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}/security_id`,
        message: `Terminal transaction references unknown security_id: ${terminal.securityId}`,
      });
      continue;
    }
    if (terminalBySecurityId.has(terminal.securityId)) {
      addIssue(issues, {
        code: "SECURITY_TERMINATED_MORE_THAN_ONCE",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}/security_id`,
        message: `Security is already consumed by transaction ${terminalBySecurityId.get(terminal.securityId)?.id}.`,
      });
      continue;
    }
    terminalBySecurityId.set(terminal.securityId, terminal);
    if (terminal.date < source.date) {
      addIssue(issues, {
        code: "TERMINAL_BEFORE_SECURITY_ISSUANCE",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}/date`,
        message: "A terminal transaction cannot predate its source security issuance.",
      });
    }
    const childIds = [
      ...terminal.resultingSecurityIds,
      ...(terminal.balanceSecurityId ? [terminal.balanceSecurityId] : []),
    ];
    if (new Set(childIds).size !== childIds.length || childIds.includes(terminal.securityId)) {
      addIssue(issues, {
        code: "INVALID_LIFECYCLE_CHILD_REFERENCE",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}`,
        message:
          "Result and balance security IDs must be distinct from each other and the source security.",
      });
    }
    const childIssuances: Issuance[] = [];
    for (const childId of childIds) {
      const child = issuances.get(childId);
      if (!child) {
        addIssue(issues, {
          code: "BROKEN_RESULTING_SECURITY_REFERENCE",
          file: terminal.file,
          objectId: terminal.id,
          path: `/items/${terminal.index}`,
          message: `Terminal transaction references unknown resulting security_id: ${childId}`,
        });
        continue;
      }
      if (children.has(childId)) {
        addIssue(issues, {
          code: "SECURITY_HAS_MULTIPLE_PARENTS",
          file: terminal.file,
          objectId: terminal.id,
          path: `/items/${terminal.index}`,
          message: `Resulting security has already been linked by another terminal transaction: ${childId}`,
        });
      }
      children.add(childId);
      if (!parentTerminalBySecurityId.has(childId)) {
        parentTerminalBySecurityId.set(childId, terminal);
      }
      childIssuances.push(child);
      if (child.date !== terminal.date || child.stockClassId !== source.stockClassId) {
        addIssue(issues, {
          code: "LIFECYCLE_CHILD_MISMATCH",
          file: child.file,
          objectId: child.id,
          path: `/items/${child.index}`,
          message:
            "A linked issuance must have the terminal transaction date and source stock class.",
        });
      }
      if (!rangesContained(child.ranges, source.ranges)) {
        addIssue(issues, {
          code: "LIFECYCLE_RANGE_OUTSIDE_SOURCE",
          file: child.file,
          objectId: child.id,
          path: `/items/${child.index}/share_numbers_issued`,
          message: "Linked issuance ranges must be contained in the source security ranges.",
        });
      }
    }
    const resultChildren = childIssuances.filter((child) =>
      terminal.resultingSecurityIds.includes(child.securityId),
    );
    const balance = terminal.balanceSecurityId
      ? issuances.get(terminal.balanceSecurityId)
      : undefined;
    const combinedRanges = normalizeRanges(childIssuances.flatMap((child) => child.ranges));
    if (!validNonOverlappingRanges(combinedRanges)) {
      addIssue(issues, {
        code: "LIFECYCLE_CHILD_RANGES_OVERLAP",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}`,
        message: "Result and balance security ranges must not overlap.",
      });
    }
    if (terminal.kind === "TRANSFER") {
      const transfereeIds = new Set(resultChildren.map((child) => child.stakeholderId));
      if (
        resultChildren.length === 0 ||
        transfereeIds.size !== 1 ||
        transfereeIds.has(source.stakeholderId)
      ) {
        addIssue(issues, {
          code: "UNREPRESENTABLE_TRANSFER_PARTIES",
          file: terminal.file,
          objectId: terminal.id,
          path: `/items/${terminal.index}/resulting_security_ids`,
          message:
            "A supported transfer must have linked result issuances for exactly one different stakeholder.",
        });
      }
      if (rangesQuantity(resultChildren.flatMap((child) => child.ranges)) !== terminal.quantity) {
        addIssue(issues, {
          code: "TRANSFER_QUANTITY_MISMATCH",
          file: terminal.file,
          objectId: terminal.id,
          path: `/items/${terminal.index}/quantity`,
          message: "Transfer quantity must equal all resulting issuance ranges.",
        });
      }
    }
    if (balance && balance.stakeholderId !== source.stakeholderId) {
      addIssue(issues, {
        code: "BALANCE_OWNER_MISMATCH",
        file: balance.file,
        objectId: balance.id,
        path: `/items/${balance.index}/stakeholder_id`,
        message: "A balance security must retain the source stakeholder.",
      });
    }
    const expectedChildQuantity = source.quantity - terminal.quantity;
    if ((balance?.quantity ?? 0) !== expectedChildQuantity) {
      addIssue(issues, {
        code: "TERMINAL_BALANCE_MISMATCH",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}/quantity`,
        message:
          "Terminal quantity plus the linked balance quantity must equal the source quantity.",
      });
    }
    if (terminal.kind === "TRANSFER" && !sameRanges(combinedRanges, source.ranges)) {
      addIssue(issues, {
        code: "TRANSFER_RANGE_PARTITION_MISMATCH",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}`,
        message: "Transfer result and balance ranges must exactly partition the source ranges.",
      });
    }
  }
  const roots = [...issuances.values()].filter((issuance) => !children.has(issuance.securityId));
  for (const [index, root] of roots.entries()) {
    for (const prior of roots.slice(0, index)) {
      if (!validNonOverlappingRanges(normalizeRanges([...root.ranges, ...prior.ranges]))) {
        addIssue(issues, {
          code: "ROOT_ISSUANCE_RANGES_OVERLAP",
          file: root.file,
          objectId: root.id,
          path: `/items/${root.index}/share_numbers_issued`,
          message: `Fresh issuance ranges overlap root issuance ${prior.id}.`,
        });
      }
    }
  }
  for (const issuance of issuances.values()) {
    const visited = new Set<string>();
    let current: Issuance | undefined = issuance;
    while (current) {
      if (visited.has(current.securityId)) {
        addIssue(issues, {
          code: "LIFECYCLE_CYCLE",
          file: issuance.file,
          objectId: issuance.id,
          path: `/items/${issuance.index}/security_id`,
          message: "Security lineage contains a cycle and has no truthful root issuance.",
        });
        break;
      }
      visited.add(current.securityId);
      const parent = parentTerminalBySecurityId.get(current.securityId);
      current = parent ? issuances.get(parent.securityId) : undefined;
    }
  }
  return { children, terminalBySecurityId, parentTerminalBySecurityId };
}

function validateUniqueStakeholderIdentifiers(
  stakeholders: ReadonlyMap<string, Stakeholder>,
  issues: OcfIssue[],
): void {
  const identifiers = new Map<string, Stakeholder>();
  for (const stakeholder of stakeholders.values()) {
    const key = `${stakeholder.identifierScheme}:${stakeholder.identifierValue}`;
    const duplicate = identifiers.get(key);
    if (duplicate) {
      addIssue(issues, {
        code: "DUPLICATE_STAM_SHAREHOLDER_IDENTIFIER",
        file: stakeholder.file,
        objectId: stakeholder.id,
        path: `/items/${stakeholder.index}/tax_ids`,
        message: `Normalized identifier duplicates stakeholder ${duplicate.id}.`,
      });
    } else {
      identifiers.set(key, stakeholder);
    }
  }
}

function validateStockClassCompatibility(
  stockClasses: ReadonlyMap<string, StockClass>,
  issues: OcfIssue[],
): void {
  const classNames = new Map<string, StockClass>();
  for (const stockClass of stockClasses.values()) {
    const duplicate = classNames.get(stockClass.name);
    if (duplicate) {
      addIssue(issues, {
        code: "DUPLICATE_STAM_SHARE_CLASS_NAME",
        file: stockClass.file,
        objectId: stockClass.id,
        path: `/items/${stockClass.index}/name`,
        message: `Share-class name duplicates stock class ${duplicate.id}.`,
      });
    } else {
      classNames.set(stockClass.name, stockClass);
    }
    if (!exactDecimalSchema.safeParse(stockClass.votesPerShare).success) {
      addIssue(issues, {
        code: "STAM_DECIMAL_INCOMPATIBLE",
        file: stockClass.file,
        objectId: stockClass.id,
        path: `/items/${stockClass.index}/votes_per_share`,
        message: "votes_per_share is valid OCF Numeric but not a supported Stam exact decimal.",
      });
    }
  }
}

function validateIssuancePrices(
  issuances: ReadonlyMap<string, Issuance>,
  issues: OcfIssue[],
): void {
  for (const issuance of issuances.values()) {
    if (issuance.sharePrice && !exactPriceSchema.safeParse(issuance.sharePrice).success) {
      addIssue(issues, {
        code: "STAM_PRICE_INCOMPATIBLE",
        file: issuance.file,
        objectId: issuance.id,
        path: `/items/${issuance.index}/share_price`,
        message: "share_price is schema-valid OCF but not a supported Stam exact price.",
      });
    }
  }
}

function validateCatalogCompatibility(collected: CollectedObjects, issues: OcfIssue[]): void {
  validateUniqueStakeholderIdentifiers(collected.stakeholders, issues);
  validateStockClassCompatibility(collected.stockClasses, issues);
  validateIssuancePrices(collected.issuances, issues);
}

function cancellationRanges(source: Issuance, balance: Issuance | undefined): readonly Range[] {
  let remaining = balance ? [...balance.ranges] : [];
  const cancelled: Range[] = [];
  for (const sourceRange of source.ranges) {
    let cursor = sourceRange.from;
    for (const kept of remaining.filter(
      (range) => range.to >= sourceRange.from && range.from <= sourceRange.to,
    )) {
      if (cursor < kept.from) cancelled.push({ from: cursor, to: kept.from - 1 });
      cursor = Math.max(cursor, kept.to + 1);
    }
    if (cursor <= sourceRange.to) cancelled.push({ from: cursor, to: sourceRange.to });
    remaining = remaining.filter((range) => range.to > sourceRange.to);
  }
  return cancelled;
}

function requiredTransferResolutions(
  terminals: readonly Terminal[],
  options: OcfImportOptions,
  issues: OcfIssue[],
): readonly OcfRequiredResolution[] {
  const required: OcfRequiredResolution[] = [];
  for (const terminal of terminals
    .filter((candidate) => candidate.kind === "TRANSFER")
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const resolution = options.transferReasonResolutions?.[terminal.id];
    if (!resolution || !transferReasons.includes(resolution.reason)) {
      required.push({
        code: "TRANSFER_REASON_REQUIRED",
        sourceTransactionId: terminal.id,
        allowedValues: transferReasons,
        message: `Select an explicit Stam transfer reason for OCF transaction ${terminal.id}.`,
      });
      addIssue(issues, {
        code: "TRANSFER_REASON_REQUIRED",
        file: terminal.file,
        objectId: terminal.id,
        path: `/items/${terminal.index}`,
        message: `An explicit transfer reason resolution keyed by '${terminal.id}' is required.`,
      });
    }
  }
  return required;
}

type CollectedObjects = Readonly<{
  stakeholders: Map<string, Stakeholder>;
  stockClasses: Map<string, StockClass>;
  issuances: Map<string, Issuance>;
  terminals: Terminal[];
}>;

function reportManifestMetadataLosses(manifest: unknown, losses: OcfInformationLoss[]): void {
  if (!isRecord(manifest)) return;
  for (const property of ["generated_at", "comments"]) {
    if (manifest[property] === undefined) continue;
    losses.push({
      code: "UNMAPPED_OCF_PACKAGE_METADATA",
      file: "manifest",
      path: `/${property}`,
      message: `OCF package metadata '${property}' is not represented in Stam catalog or event drafts.`,
    });
  }
}

function collectIssuance(
  object: LocatedObject,
  collected: CollectedObjects,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): void {
  const issuance = parseIssuance(object, issues, losses);
  if (!issuance) return;
  if (!collected.issuances.has(issuance.securityId)) {
    collected.issuances.set(issuance.securityId, issuance);
    return;
  }
  addIssue(issues, {
    code: "DUPLICATE_SECURITY_ID",
    file: issuance.file,
    objectId: issuance.id,
    path: `/items/${issuance.index}/security_id`,
    message: `Stock security_id is issued more than once: ${issuance.securityId}`,
  });
}

function collectStakeholder(
  object: LocatedObject,
  collected: CollectedObjects,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): void {
  const stakeholder = parseStakeholder(object, issues, losses);
  if (stakeholder && !collected.stakeholders.has(stakeholder.id)) {
    collected.stakeholders.set(stakeholder.id, stakeholder);
  }
}

function collectStockClass(
  object: LocatedObject,
  collected: CollectedObjects,
  losses: OcfInformationLoss[],
): void {
  const stockClass = parseStockClass(object, losses);
  if (stockClass && !collected.stockClasses.has(stockClass.id)) {
    collected.stockClasses.set(stockClass.id, stockClass);
  }
}

function collectTerminal(
  object: LocatedObject,
  collected: CollectedObjects,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): void {
  const terminal = parseTerminal(object, issues, losses);
  if (terminal) collected.terminals.push(terminal);
}

function collectSupportedObject(
  object: LocatedObject,
  collected: CollectedObjects,
  issues: OcfIssue[],
  losses: OcfInformationLoss[],
): void {
  const type = stringValue(object.value.object_type);
  if (type === "STAKEHOLDER") {
    collectStakeholder(object, collected, issues, losses);
    return;
  }
  if (type === "STOCK_CLASS") {
    collectStockClass(object, collected, losses);
    return;
  }
  if (type === "TX_STOCK_ISSUANCE") {
    collectIssuance(object, collected, issues, losses);
    return;
  }
  if (type === "TX_STOCK_TRANSFER" || type === "TX_STOCK_CANCELLATION") {
    collectTerminal(object, collected, issues, losses);
    return;
  }
  addIssue(issues, {
    code: "UNSUPPORTED_OCF_OBJECT",
    file: object.file,
    objectId: stringValue(object.value.id),
    path: objectPath(object, "/object_type"),
    message: `The first OCF profile does not support object type: ${type ?? "missing"}`,
  });
}

function validateTransactionDate(
  transaction: Readonly<{ date: string; file: string; id: string; index: number }>,
  issuer: Analysis["issuer"],
  asOf: string | undefined,
  issues: OcfIssue[],
): void {
  if (issuer && transaction.date < issuer.formationDate) {
    addIssue(issues, {
      code: "TRANSACTION_BEFORE_FORMATION",
      file: transaction.file,
      objectId: transaction.id,
      path: `/items/${transaction.index}/date`,
      message: "Transaction predates issuer formation.",
    });
  }
  if (asOf && transaction.date > asOf) {
    addIssue(issues, {
      code: "TRANSACTION_AFTER_AS_OF",
      file: transaction.file,
      objectId: transaction.id,
      path: `/items/${transaction.index}/date`,
      message: "Transaction is after the manifest as_of date.",
    });
  }
}

function validateTransactionDates(
  collected: CollectedObjects,
  issuer: Analysis["issuer"],
  asOf: string | undefined,
  issues: OcfIssue[],
): void {
  for (const issuance of collected.issuances.values()) {
    validateTransactionDate(issuance, issuer, asOf, issues);
  }
  for (const terminal of collected.terminals) {
    validateTransactionDate(terminal, issuer, asOf, issues);
  }
}

function reportDescendantPriceLosses(
  issuances: ReadonlyMap<string, Issuance>,
  children: ReadonlySet<string>,
  losses: OcfInformationLoss[],
): void {
  for (const issuance of issuances.values()) {
    if (!children.has(issuance.securityId) || !issuance.sharePrice) continue;
    losses.push({
      code: "DESCENDANT_ISSUANCE_PRICE_NOT_IMPORTED",
      file: issuance.file,
      objectId: issuance.id,
      path: `/items/${issuance.index}/share_price`,
      message:
        "A linked descendant issuance is converted through its terminal event, which cannot retain its OCF share price.",
    });
  }
}

function reportSnapshotHistoryLosses(
  collected: CollectedObjects,
  options: OcfImportOptions,
  losses: OcfInformationLoss[],
): void {
  if (options.mode !== "OPENING_SNAPSHOT") return;
  for (const transaction of [...collected.issuances.values(), ...collected.terminals]) {
    losses.push({
      code: "OCF_HISTORY_COLLAPSED_TO_SNAPSHOT",
      file: transaction.file,
      objectId: transaction.id,
      path: `/items/${transaction.index}`,
      message:
        "Opening snapshot mode preserves the resulting holding but does not import this transaction as history.",
    });
  }
}

function analyzeOcfPackage(pkg: OcfPackage, options: OcfImportOptions): Analysis {
  const issues = [...validateOcfPackageSchemas(pkg)];
  const losses: OcfInformationLoss[] = [];
  const references = manifestReferences(pkg.manifest, issues);
  const objects = referencedObjects(pkg, references, issues);
  duplicateObjectIds(objects, issues);
  const issuer = parseIssuer(pkg.manifest, issues, losses);
  const asOf = isRecord(pkg.manifest) ? stringValue(pkg.manifest.as_of) : undefined;
  reportManifestMetadataLosses(pkg.manifest, losses);
  const collected: CollectedObjects = {
    stakeholders: new Map(),
    stockClasses: new Map(),
    issuances: new Map(),
    terminals: [],
  };
  for (const object of objects) collectSupportedObject(object, collected, issues, losses);
  validateCatalogCompatibility(collected, issues);
  validateReferences(collected.stakeholders, collected.stockClasses, collected.issuances, issues);
  const lifecycle = validateLifecycle(collected.issuances, collected.terminals, issues);
  validateTransactionDates(collected, issuer, asOf, issues);
  reportDescendantPriceLosses(collected.issuances, lifecycle.children, losses);
  reportSnapshotHistoryLosses(collected, options, losses);
  const requiredResolutions = requiredTransferResolutions(collected.terminals, options, issues);
  return {
    issues: issues.sort(compareDiagnostic),
    losses: losses.sort(compareDiagnostic),
    requiredResolutions,
    issuer,
    asOf,
    stakeholders: collected.stakeholders,
    stockClasses: collected.stockClasses,
    issuances: collected.issuances,
    terminals: collected.terminals,
    childSecurityIds: lifecycle.children,
    terminalBySecurityId: lifecycle.terminalBySecurityId,
    parentTerminalBySecurityId: lifecycle.parentTerminalBySecurityId,
  };
}

function placeholder(kind: "company" | "shareholder" | "share-class", sourceKey: string): string {
  return `$${kind}:${sourceKey}`;
}

function activeIssuances(analysis: Analysis): readonly Issuance[] {
  return [...analysis.issuances.values()].filter(
    (issuance) => !analysis.terminalBySecurityId.has(issuance.securityId),
  );
}

function catalogEffectiveDate(
  analysis: Analysis,
  referencesCatalogObject: (issuance: Issuance) => boolean,
): string {
  return (
    [...analysis.issuances.values()]
      .filter(referencesCatalogObject)
      .map((issuance) => issuance.date)
      .sort()[0] ??
    analysis.asOf ??
    analysis.issuer?.formationDate ??
    ""
  );
}

function buildCatalogInputs(analysis: Analysis): readonly OcfCatalogInput[] {
  if (!analysis.issuer) return [];
  const companySourceKey = `ocf:issuer:${analysis.issuer.id}`;
  const inputs: OcfCatalogInput[] = [
    {
      kind: "COMPANY",
      sourceKey: companySourceKey,
      input: {
        legalName: analysis.issuer.legalName,
        registrationCountry: "SE",
        registrationScheme: "ORGANISATIONSNUMMER",
        registrationValue: analysis.issuer.organizationNumber,
      },
    },
  ];
  for (const stakeholder of [...analysis.stakeholders.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    inputs.push({
      kind: "SHAREHOLDER",
      sourceKey: `ocf:stakeholder:${stakeholder.id}`,
      input: {
        companyId: placeholder("company", companySourceKey),
        kind: stakeholder.kind,
        identifierCountryCode: "SE",
        identifierScheme: stakeholder.identifierScheme,
        identifierValue: stakeholder.identifierValue,
        initialDetails: { legalName: stakeholder.legalName, address: stakeholder.address },
        effectiveFrom: catalogEffectiveDate(
          analysis,
          (issuance) => issuance.stakeholderId === stakeholder.id,
        ),
      },
    });
  }
  for (const stockClass of [...analysis.stockClasses.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    inputs.push({
      kind: "SHARE_CLASS",
      sourceKey: `ocf:stock-class:${stockClass.id}`,
      input: {
        companyId: placeholder("company", companySourceKey),
        name: stockClass.name,
        votesPerShare: stockClass.votesPerShare,
        effectiveFrom: catalogEffectiveDate(
          analysis,
          (issuance) => issuance.stockClassId === stockClass.id,
        ),
      },
    });
  }
  return inputs;
}

function holdingPayload(issuance: Issuance): Readonly<Record<string, unknown>> {
  return {
    shareholderId: placeholder("shareholder", `ocf:stakeholder:${issuance.stakeholderId}`),
    shareClassId: placeholder("share-class", `ocf:stock-class:${issuance.stockClassId}`),
    ranges: issuance.ranges,
  };
}

function transferDraft(
  terminal: Terminal,
  source: Issuance,
  analysis: Analysis,
  options: OcfImportOptions,
): OcfEventDraft | undefined {
  const result = analysis.issuances.get(terminal.resultingSecurityIds[0] ?? "");
  const resolution = options.transferReasonResolutions?.[terminal.id];
  if (!result || !resolution) return undefined;
  const ranges = normalizeRanges(
    terminal.resultingSecurityIds.flatMap((id) => analysis.issuances.get(id)?.ranges ?? []),
  );
  return {
    sourceKey: `ocf:transaction:${terminal.id}`,
    effectiveDate: terminal.date,
    type: "SHARES_TRANSFERRED",
    payload: {
      transferorId: placeholder("shareholder", `ocf:stakeholder:${source.stakeholderId}`),
      transfereeId: placeholder("shareholder", `ocf:stakeholder:${result.stakeholderId}`),
      shareClassId: placeholder("share-class", `ocf:stock-class:${source.stockClassId}`),
      ranges,
      reason: resolution.reason,
      ...(resolution.reasonNote ? { reasonNote: resolution.reasonNote } : {}),
    },
  };
}

function cancellationDraft(
  terminal: Terminal,
  source: Issuance,
  analysis: Analysis,
): OcfEventDraft {
  const balance = terminal.balanceSecurityId
    ? analysis.issuances.get(terminal.balanceSecurityId)
    : undefined;
  return {
    sourceKey: `ocf:transaction:${terminal.id}`,
    effectiveDate: terminal.date,
    type: "SHARES_CANCELLED",
    payload: {
      shareholderId: placeholder("shareholder", `ocf:stakeholder:${source.stakeholderId}`),
      shareClassId: placeholder("share-class", `ocf:stock-class:${source.stockClassId}`),
      ranges: cancellationRanges(source, balance),
      reason: "OTHER",
      ...(terminal.reasonText ? { reasonNote: terminal.reasonText } : {}),
    },
  };
}

function terminalDraft(
  terminal: Terminal,
  analysis: Analysis,
  options: OcfImportOptions,
): OcfEventDraft | undefined {
  const source = analysis.issuances.get(terminal.securityId);
  if (!source) return undefined;
  return terminal.kind === "TRANSFER"
    ? transferDraft(terminal, source, analysis, options)
    : cancellationDraft(terminal, source, analysis);
}

function terminalLineageOrder(terminal: Terminal, analysis: Analysis): number {
  let order = 1;
  let sourceSecurityId = terminal.securityId;
  const visited = new Set<string>();
  while (!visited.has(sourceSecurityId)) {
    visited.add(sourceSecurityId);
    const parent = analysis.parentTerminalBySecurityId.get(sourceSecurityId);
    if (!parent) break;
    order += 1;
    sourceSecurityId = parent.securityId;
  }
  return order;
}

function buildEventDrafts(analysis: Analysis, options: OcfImportOptions): readonly OcfEventDraft[] {
  if (!analysis.issuer || !analysis.asOf) return [];
  if (options.mode === "OPENING_SNAPSHOT") {
    return [
      {
        sourceKey: `ocf:opening:${analysis.issuer.id}:${analysis.asOf}`,
        effectiveDate: analysis.asOf,
        type: "OPENING_STATE_IMPORTED",
        payload: {
          holdings: activeIssuances(analysis).map(holdingPayload),
          sourceType: "OCF",
          importNote: `OCF ${OCF_VERSION} opening snapshot as of ${analysis.asOf}`,
        },
      },
    ];
  }
  const drafts: OcfEventDraft[] = [
    {
      sourceKey: `ocf:bootstrap:${analysis.issuer.id}`,
      effectiveDate: analysis.issuer.formationDate,
      type: "OPENING_STATE_IMPORTED",
      payload: {
        holdings: [],
        sourceType: "OCF",
        importNote: `Empty OCF ${OCF_VERSION} history bootstrap`,
      },
    },
  ];
  const roots = [...analysis.issuances.values()].filter(
    (issuance) => !analysis.childSecurityIds.has(issuance.securityId),
  );
  const historyEntries: Readonly<{
    date: string;
    order: number;
    id: string;
    draft: OcfEventDraft;
  }>[] = [
    ...roots.map((issuance) => ({
      date: issuance.date,
      order: 0,
      id: issuance.id,
      draft: {
        sourceKey: `ocf:transaction:${issuance.id}`,
        effectiveDate: issuance.date,
        type: "SHARES_ISSUED" as const,
        payload: {
          ...holdingPayload(issuance),
          ...(issuance.sharePrice ? { subscriptionPrice: issuance.sharePrice } : {}),
        },
      },
    })),
    ...analysis.terminals.flatMap((terminal) => {
      const draft = terminalDraft(terminal, analysis, options);
      return draft
        ? [
            {
              date: terminal.date,
              order: terminalLineageOrder(terminal, analysis),
              id: terminal.id,
              draft,
            },
          ]
        : [];
    }),
  ];
  historyEntries.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.order - right.order ||
      left.id.localeCompare(right.id),
  );
  drafts.push(...historyEntries.map((entry) => entry.draft));
  return drafts;
}

function buildConversion(analysis: Analysis, options: OcfImportOptions): OcfConversion | undefined {
  if (!analysis.issuer || analysis.issues.some((issue) => issue.severity === "ERROR"))
    return undefined;
  return {
    mode: options.mode,
    companySourceKey: `ocf:issuer:${analysis.issuer.id}`,
    catalogInputs: buildCatalogInputs(analysis),
    eventDrafts: buildEventDrafts(analysis, options),
  };
}

function proposedCommands(conversion: OcfConversion | undefined): readonly OcfProposedCommand[] {
  if (!conversion) return [];
  const commands: OcfProposedCommand[] = [];
  for (const input of conversion.catalogInputs) {
    commands.push({
      sequence: commands.length + 1,
      sourceKey: input.sourceKey,
      command:
        input.kind === "COMPANY"
          ? "CREATE_COMPANY"
          : input.kind === "SHAREHOLDER"
            ? "CREATE_SHAREHOLDER"
            : "CREATE_SHARE_CLASS",
      input: input.input,
    });
  }
  for (const draft of conversion.eventDrafts) {
    commands.push({
      sequence: commands.length + 1,
      sourceKey: draft.sourceKey,
      command: "APPEND_SHARE_EVENT",
      input: { effectiveDate: draft.effectiveDate, type: draft.type, payload: draft.payload },
    });
  }
  return commands;
}

function counts(analysis: Analysis, conversion: OcfConversion | undefined): OcfSupportedCounts {
  const roots = [...analysis.issuances.values()].filter(
    (issuance) => !analysis.childSecurityIds.has(issuance.securityId),
  );
  return {
    issuers: analysis.issuer ? 1 : 0,
    stakeholders: analysis.stakeholders.size,
    stockClasses: analysis.stockClasses.size,
    rootStockIssuances: roots.length,
    linkedStockIssuances: analysis.issuances.size - roots.length,
    stockTransfers: analysis.terminals.filter((terminal) => terminal.kind === "TRANSFER").length,
    stockCancellations: analysis.terminals.filter((terminal) => terminal.kind === "CANCELLATION")
      .length,
    openingHoldings: conversion?.mode === "OPENING_SNAPSHOT" ? activeIssuances(analysis).length : 0,
    eventDrafts: conversion?.eventDrafts.length ?? 0,
  };
}

export function dryRunOcfImport(pkg: OcfPackage, options: OcfImportOptions): OcfDryRunResult {
  const analysis = analyzeOcfPackage(pkg, options);
  const conversion = buildConversion(analysis, options);
  const report: OcfDryRunReport = {
    ocfVersion: OCF_VERSION,
    mode: options.mode,
    valid: !analysis.issues.some((issue) => issue.severity === "ERROR"),
    issues: analysis.issues,
    supportedCounts: counts(analysis, conversion),
    losses: analysis.losses,
    requiredResolutions: analysis.requiredResolutions,
    proposedCommands: proposedCommands(conversion),
  };
  return conversion ? { report, conversion } : { report };
}

export function convertOcfPackage(pkg: OcfPackage, options: OcfImportOptions): OcfConversion {
  const result = dryRunOcfImport(pkg, options);
  if (!result.conversion) {
    const firstError = result.report.issues.find((issue) => issue.severity === "ERROR");
    throw new Error(
      firstError ? `${firstError.code}: ${firstError.message}` : "OCF package cannot be converted.",
    );
  }
  return result.conversion;
}
