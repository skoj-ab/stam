import { Form, Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { createOwnerOverview } from "../../domain/share-register";
import { formatSwedishIdentifier } from "../../domain/swedish-identifiers";
import {
  type Company,
  getCompany,
  getCurrentSnapshot,
  getHistoricalSnapshot,
  listShareClasses,
  listShareholders,
  type ShareClass,
  type Shareholder,
  type ShareRegisterSnapshot,
} from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Button,
  DateField,
  EmptyState,
  Field,
  FormActions,
  formatCount,
  formatDate,
  formatDecimal,
  formatShareRange,
  formatTimestamp,
  Input,
  LinkButton,
  linkButtonClass,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui";

type RegisterData = {
  company: Company;
  shareholders: Shareholder[];
  shareClasses: ShareClass[];
  snapshot: ShareRegisterSnapshot;
};

type HistoricalRegisterData = RegisterData & {
  effectiveOn: string;
  knownAt?: string;
};

function requireCompanyId(params: LoaderFunctionArgs["params"]): string {
  if (!params.companyId) {
    throw new Response("Bolag saknas.", { status: 400 });
  }
  return params.companyId;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeKnownAt({ value }: { value: string | null }): string | undefined {
  const knownAt = value?.trim();
  if (!knownAt) return undefined;

  // A datetime-local control has no offset. Resolve it in the user's timezone
  // before sending the UTC timestamp required by the historical API.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(knownAt)) {
    const timestamp = new Date(knownAt);
    if (!Number.isNaN(timestamp.valueOf())) return timestamp.toISOString();
  }

  return knownAt;
}

export async function currentRegisterLoader({ params }: LoaderFunctionArgs): Promise<RegisterData> {
  const companyId = requireCompanyId(params);
  const [company, shareholders, shareClasses, snapshot] = await Promise.all([
    getCompany({ companyId }),
    listShareholders({ companyId }),
    listShareClasses({ companyId }),
    getCurrentSnapshot({ companyId }),
  ]);
  return { company, shareholders, shareClasses, snapshot };
}

export async function historicalRegisterLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<HistoricalRegisterData> {
  const companyId = requireCompanyId(params);
  const query = new URL(request.url).searchParams;
  const effectiveOn = query.get("effectiveOn") || today();
  const knownAt = normalizeKnownAt({ value: query.get("knownAt") });
  const [company, shareholders, shareClasses, snapshot] = await Promise.all([
    getCompany({ companyId }),
    listShareholders({ companyId }),
    listShareClasses({ companyId }),
    getHistoricalSnapshot({ companyId, effectiveOn, knownAt }),
  ]);
  return { company, shareholders, shareClasses, snapshot, effectiveOn, knownAt };
}

function cutoffLabel({ effectiveOn, knownAt }: { effectiveOn: string; knownAt?: string }): string {
  return knownAt
    ? `Per ${formatDate(effectiveOn)} · Känt ${formatTimestamp(knownAt)}`
    : `Per ${formatDate(effectiveOn)} · Kunskapsläge nu`;
}

function cutoffCaption({
  subject,
  effectiveOn,
  knownAt,
}: {
  subject: string;
  effectiveOn: string;
  knownAt?: string;
}): string {
  return knownAt
    ? `${subject} per ${formatDate(effectiveOn)}, känt ${formatTimestamp(knownAt)}`
    : `${subject} per ${formatDate(effectiveOn)}, med uppgifter registrerade till nu`;
}

function shareholderKind(shareholder?: Shareholder): string {
  if (!shareholder) return "Okänd";
  return shareholder.kind === "INDIVIDUAL" ? "Fysisk person" : "Juridisk person";
}

function localDateTimeValue({ knownAt }: { knownAt?: string }): string | undefined {
  if (!knownAt) return undefined;
  const timestamp = new Date(knownAt);
  if (Number.isNaN(timestamp.valueOf())) return undefined;
  const localTimestamp = new Date(timestamp.valueOf() - timestamp.getTimezoneOffset() * 60_000);
  return localTimestamp.toISOString().slice(0, 19);
}

function pdfExportPath(companyId: string, effectiveOn: string, knownAt?: string): string {
  const query = new URLSearchParams({ effectiveOn });
  if (knownAt) query.set("knownAt", knownAt);
  return `/api/companies/${companyId}/share-register/export/pdf?${query}`;
}

type RegisterViewProps = {
  data: RegisterData;
  effectiveOn: string;
  knownAt?: string;
};

function OwnershipOverviewSection({ data, effectiveOn, knownAt }: RegisterViewProps) {
  const shareholderById = new Map(
    data.shareholders.map((shareholder) => [shareholder.id, shareholder]),
  );
  const detailsByShareholderId = new Map(
    data.snapshot.shareholderDetails.map(({ shareholderId, details }) => [shareholderId, details]),
  );
  const overview = createOwnerOverview({
    holdings: data.snapshot.holdings,
    totalsByShareholder: data.snapshot.totalsByShareholder,
    shareClasses: data.shareClasses,
  });
  const percentage = (value: string | undefined) =>
    value === undefined ? "Saknas" : `${formatDecimal(value)} %`;

  return (
    <PageSection
      title="Ägaröversikt"
      description="Aktier, röster och respektive andel per aktieägare, summerat över alla aktieslag."
    >
      {data.snapshot.totalsByShareholder.length === 0 ? (
        <Panel>
          <EmptyState
            title="Inga aktieägare med innehav"
            description={`Aktieboken innehåller inga innehav per ${formatDate(effectiveOn)}.`}
          />
        </Panel>
      ) : (
        <Table
          caption={cutoffCaption({ subject: "Ägaröversikt", effectiveOn, knownAt })}
          density="compact"
        >
          <TableHead>
            <TableRow>
              <TableHeaderCell>Aktieägare</TableHeaderCell>
              <TableHeaderCell>Person-/organisationsnummer</TableHeaderCell>
              <TableHeaderCell>Adress</TableHeaderCell>
              <TableHeaderCell>Kontakt</TableHeaderCell>
              <TableHeaderCell numeric>Aktier</TableHeaderCell>
              <TableHeaderCell numeric>Röster</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {overview.owners.map((owner) => {
              const { shareholderId } = owner;
              const details = detailsByShareholderId.get(shareholderId);
              const shareholder = shareholderById.get(shareholderId);
              return (
                <TableRow key={shareholderId}>
                  <TableCell>{details?.legalName ?? shareholderId}</TableCell>
                  <TableCell mono muted={!shareholder}>
                    {shareholder ? formatSwedishIdentifier(shareholder.identifierValue) : "Saknas"}
                  </TableCell>
                  <TableCell muted={!details}>
                    {details
                      ? [
                          ...details.address.lines,
                          `${details.address.postalCode} ${details.address.locality}`.trim(),
                          details.address.countryCode,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : "Saknas"}
                  </TableCell>
                  <TableCell>
                    <div>{details?.emailAddress ?? "E-post saknas"}</div>
                    <div className="text-ink-muted">
                      {details?.phoneNumber ?? "Telefonnummer saknas"}
                    </div>
                  </TableCell>
                  <TableCell numeric>
                    <div>{formatCount(owner.totalShares)}</div>
                    <div className="text-ink-muted">{percentage(owner.ownershipPercentage)}</div>
                  </TableCell>
                  <TableCell numeric>
                    <div>{formatDecimal(owner.totalVotes)}</div>
                    <div className="text-ink-muted">{percentage(owner.votingPercentage)}</div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFoot className="font-bold italic">
            <TableRow>
              <TableCell colSpan={4}>Totalt</TableCell>
              <TableCell numeric>{formatCount(overview.totalShares)}</TableCell>
              <TableCell numeric>{formatDecimal(overview.totalVotes)}</TableCell>
            </TableRow>
          </TableFoot>
        </Table>
      )}
    </PageSection>
  );
}

function HoldingsSection({ data, effectiveOn, knownAt }: RegisterViewProps) {
  const shareholderById = new Map(
    data.shareholders.map((shareholder) => [shareholder.id, shareholder]),
  );
  const detailsByShareholderId = new Map(
    data.snapshot.shareholderDetails.map(({ shareholderId, details }) => [shareholderId, details]),
  );
  const shareClassById = new Map(
    data.shareClasses.map((shareClass) => [shareClass.id, shareClass]),
  );

  return (
    <PageSection title="Aktieinnehav">
      {data.snapshot.holdings.length === 0 ? (
        <Panel>
          <EmptyState
            title="Inga aktieinnehav"
            description={`Aktieboken innehåller inga innehav per ${formatDate(effectiveOn)}.`}
          />
        </Panel>
      ) : (
        <Table
          caption={cutoffCaption({ subject: "Aktieinnehav", effectiveOn, knownAt })}
          density="compact"
        >
          <TableHead>
            <TableRow>
              <TableHeaderCell>Aktienummer</TableHeaderCell>
              <TableHeaderCell>Aktieägare</TableHeaderCell>
              <TableHeaderCell>Person-/organisationsnummer</TableHeaderCell>
              <TableHeaderCell>Aktieslag</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.snapshot.holdings.map((holding) => {
              const details = detailsByShareholderId.get(holding.shareholderId);
              const shareholder = shareholderById.get(holding.shareholderId);
              const shareClass = shareClassById.get(holding.shareClassId);
              return (
                <TableRow
                  key={`${holding.shareholderId}-${holding.shareClassId}-${holding.range.from}-${holding.range.to}`}
                >
                  <TableCell mono>{formatShareRange(holding.range)}</TableCell>
                  <TableCell>
                    <div>{details?.legalName ?? holding.shareholderId}</div>
                    <div className="text-ink-muted">{shareholderKind(shareholder)}</div>
                  </TableCell>
                  <TableCell mono muted={!shareholder}>
                    {shareholder ? formatSwedishIdentifier(shareholder.identifierValue) : "Saknas"}
                  </TableCell>
                  <TableCell>{shareClass?.name ?? holding.shareClassId}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </PageSection>
  );
}

function TotalsSection({ data, effectiveOn, knownAt }: RegisterViewProps) {
  const shareClassById = new Map(
    data.shareClasses.map((shareClass) => [shareClass.id, shareClass]),
  );
  return (
    <PageSection title="Aktieslag och totalt antal aktier">
      {data.snapshot.totalsByClass.length === 0 ? (
        <Panel>
          <EmptyState
            title="Inga klasstotaler"
            description={`Inga aktier redovisas per ${formatDate(effectiveOn)}.`}
          />
        </Panel>
      ) : (
        <Table
          caption={cutoffCaption({ subject: "Klasstotaler", effectiveOn, knownAt })}
          density="compact"
        >
          <TableHead>
            <TableRow>
              <TableHeaderCell>Aktieslag</TableHeaderCell>
              <TableHeaderCell numeric>Röster per aktie</TableHeaderCell>
              <TableHeaderCell numeric>Antal aktier</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.snapshot.totalsByClass.map(({ shareClassId, total }) => {
              const shareClass = shareClassById.get(shareClassId);
              return (
                <TableRow key={shareClassId}>
                  <TableCell header>{shareClass?.name ?? shareClassId}</TableCell>
                  <TableCell numeric>
                    {shareClass ? formatDecimal(shareClass.votesPerShare) : "Saknas"}
                  </TableCell>
                  <TableCell numeric>{formatCount(total)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </PageSection>
  );
}

function RegisterTables(props: RegisterViewProps) {
  return (
    <PageBody>
      <OwnershipOverviewSection {...props} />
      <HoldingsSection {...props} />
      <TotalsSection {...props} />
    </PageBody>
  );
}

export function CurrentRegisterRoute() {
  const data = useLoaderData() as RegisterData;
  const effectiveOn = data.snapshot.effectiveOn ?? today();
  return (
    <>
      <PageHeader
        title={`Aktiebok för ${data.company.legalName}`}
        meta={cutoffLabel({ effectiveOn, knownAt: data.snapshot.knownAt })}
        actions={
          <>
            <LinkButton href={pdfExportPath(data.company.id, effectiveOn)} download>
              Ladda ned PDF
            </LinkButton>
            <Link
              className={linkButtonClass("secondary")}
              to={`/companies/${data.company.id}/register/export/ocf`}
            >
              Exportera OCF
            </Link>
            <Link
              className={linkButtonClass("secondary")}
              to={`/companies/${data.company.id}/register/history`}
            >
              Historisk aktiebok
            </Link>
          </>
        }
      />
      <RegisterTables data={data} effectiveOn={effectiveOn} knownAt={data.snapshot.knownAt} />
    </>
  );
}

export function HistoricalRegisterRoute() {
  const data = useLoaderData() as HistoricalRegisterData;
  return (
    <>
      <PageHeader
        title={`Historisk aktiebok för ${data.company.legalName}`}
        meta={cutoffLabel({ effectiveOn: data.effectiveOn, knownAt: data.knownAt })}
        actions={
          <>
            <LinkButton
              href={pdfExportPath(data.company.id, data.effectiveOn, data.knownAt)}
              download
            >
              Ladda ned PDF
            </LinkButton>
            <Link
              className={linkButtonClass("secondary")}
              to={`/companies/${data.company.id}/register`}
            >
              Aktuell aktiebok
            </Link>
          </>
        }
      />
      <PageBody>
        <PageSection
          title="Historiskt urval"
          description="Välj verkningsdag och, vid behov, vilket registreringsläge som var känt."
        >
          <Panel>
            <Form method="get" className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Verkningsdag" required>
                  <DateField name="effectiveOn" defaultValue={data.effectiveOn} required />
                </Field>
                <Field
                  label="Känt vid"
                  description="Lämna tomt för alla uppgifter som är registrerade nu."
                >
                  <Input
                    type="datetime-local"
                    name="knownAt"
                    defaultValue={localDateTimeValue({ knownAt: data.knownAt })}
                    step={1}
                  />
                </Field>
              </div>
              <FormActions align="start">
                <Button type="submit" variant="primary">
                  Visa aktiebok
                </Button>
              </FormActions>
            </Form>
          </Panel>
        </PageSection>
      </PageBody>
      <RegisterTables data={data} effectiveOn={data.effectiveOn} knownAt={data.knownAt} />
    </>
  );
}
