import { type FormEvent, useState } from "react";
import { Link, type LoaderFunctionArgs, useLoaderData, useNavigate, useParams } from "react-router";
import { formatSwedishIdentifier } from "../../domain/swedish-identifiers";
import {
  appendMultiCompanyDetailsChange,
  errorMessage,
  getCompany,
  getCurrentSnapshot,
  listShareClasses,
  listShareholderCompanyMatches,
  listShareholderCopyCandidates,
  listShareholders,
  type MultiCompanyDetailsChangeInput,
  type MultiCompanyDetailsChangeResult,
  previewMultiCompanyDetailsChange,
  requestJson,
  type ShareClass,
  type Shareholder,
  type ShareholderCopyCandidate,
} from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Button,
  Callout,
  Checkbox,
  ConfirmDialog,
  DateField,
  EmptyState,
  Field,
  Fieldset,
  FormActions,
  formatDate,
  formatDecimal,
  Input,
  linkButtonClass,
  Panel,
  PlusIcon,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui";

function requireCompanyId(companyId: string | undefined): string {
  if (!companyId?.trim()) {
    throw new Response("Bolags-id saknas.", { status: 400 });
  }
  return companyId;
}

function requireShareholderId(shareholderId: string | undefined): string {
  if (!shareholderId?.trim()) {
    throw new Response("Aktieägar-id saknas.", { status: 400 });
  }
  return shareholderId;
}

function optionalFormValue(form: FormData, name: string): string | undefined {
  return String(form.get(name) ?? "").trim() || undefined;
}

function shareholderDetailsFromForm(form: FormData): Shareholder["initialDetails"] {
  return {
    legalName: String(form.get("legalName") ?? "").trim(),
    emailAddress: optionalFormValue(form, "emailAddress"),
    phoneNumber: optionalFormValue(form, "phoneNumber"),
    address: {
      lines: [String(form.get("addressLine") ?? "").trim()],
      postalCode: String(form.get("postalCode") ?? "").trim(),
      locality: String(form.get("locality") ?? "").trim(),
      countryCode: String(form.get("countryCode") ?? "")
        .trim()
        .toUpperCase(),
    },
  };
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function submitCatalogForm<T>({
  operation,
  onSuccess,
  setError,
  setLoading,
}: {
  operation: () => Promise<T>;
  onSuccess: (result: T) => void;
  setError: (value: string | undefined) => void;
  setLoading: (value: boolean) => void;
}): Promise<void> {
  setLoading(true);
  setError(undefined);
  try {
    onSuccess(await operation());
  } catch (caught) {
    setError(errorMessage(caught));
  } finally {
    setLoading(false);
  }
}

function ContactFields({ details }: { details?: Shareholder["initialDetails"] }) {
  return (
    <Fieldset legend="Kontaktuppgifter">
      <Field label="E-postadress">
        <Input
          type="email"
          name="emailAddress"
          defaultValue={details?.emailAddress}
          autoComplete="email"
        />
      </Field>
      <Field label="Telefonnummer">
        <Input
          type="tel"
          name="phoneNumber"
          defaultValue={details?.phoneNumber}
          autoComplete="tel"
        />
      </Field>
    </Fieldset>
  );
}

function AddressFields({ details }: { details?: Shareholder["initialDetails"] }) {
  return (
    <Fieldset legend="Adress">
      <Field label="Adressrad" required>
        <Input
          name="addressLine"
          defaultValue={details?.address.lines.join(", ")}
          autoComplete="street-address"
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Postnummer" required>
          <Input
            name="postalCode"
            defaultValue={details?.address.postalCode}
            autoComplete="postal-code"
            required
          />
        </Field>
        <Field label="Ort" required>
          <Input
            name="locality"
            defaultValue={details?.address.locality}
            autoComplete="address-level2"
            required
          />
        </Field>
      </div>
      <Field label="Landkod" description="Två bokstäver, exempelvis SE." required>
        <Input
          name="countryCode"
          defaultValue={details?.address.countryCode ?? "SE"}
          maxLength={2}
          pattern="[A-Za-z]{2}"
          autoComplete="country"
          required
        />
      </Field>
    </Fieldset>
  );
}

export async function shareholdersLoader({ params }: LoaderFunctionArgs) {
  const companyId = requireCompanyId(params.companyId);
  const [company, shareholders, snapshot] = await Promise.all([
    getCompany({ companyId }),
    listShareholders({ companyId }),
    getCurrentSnapshot({ companyId }),
  ]);
  return { company, shareholders, snapshot };
}

export function ShareholdersRoute() {
  const { company, shareholders, snapshot } = useLoaderData<typeof shareholdersLoader>();
  const createPath = `/companies/${company.id}/shareholders/new`;
  const currentDetails = new Map(
    snapshot.shareholderDetails.map(({ shareholderId, details }) => [shareholderId, details]),
  );

  return (
    <>
      <PageHeader
        title="Aktieägare"
        meta={`${company.legalName} · ${shareholders.length} registrerade aktieägare`}
        actions={
          <Link className={linkButtonClass("primary")} to={createPath}>
            <PlusIcon /> Lägg till aktieägare
          </Link>
        }
      />
      <PageBody>
        <PageSection title="Aktieägarkatalog">
          {shareholders.length === 0 ? (
            <EmptyState
              title="Inga aktieägare registrerade"
              description="Lägg till den första aktieägaren innan aktier registreras."
              action={
                <Link className={linkButtonClass("primary")} to={createPath}>
                  Lägg till aktieägare
                </Link>
              }
            />
          ) : (
            <Table caption={`Aktieägare i ${company.legalName}`} captionHidden>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Namn</TableHeaderCell>
                  <TableHeaderCell>Typ</TableHeaderCell>
                  <TableHeaderCell>Person-/organisationsnummer</TableHeaderCell>
                  <TableHeaderCell>Adress</TableHeaderCell>
                  <TableHeaderCell>Kontakt</TableHeaderCell>
                  <TableHeaderCell>Gäller från</TableHeaderCell>
                  <TableHeaderCell>Åtgärd</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shareholders.map((shareholder) => {
                  const details = currentDetails.get(shareholder.id) ?? shareholder.initialDetails;
                  const address = details.address;
                  return (
                    <TableRow key={shareholder.id}>
                      <TableCell header>{details.legalName}</TableCell>
                      <TableCell>
                        {shareholder.kind === "INDIVIDUAL" ? "Fysisk person" : "Juridisk person"}
                      </TableCell>
                      <TableCell mono>
                        {formatSwedishIdentifier(shareholder.identifierValue)}
                      </TableCell>
                      <TableCell>
                        {address.lines.join(", ")}, {address.postalCode} {address.locality},{" "}
                        {address.countryCode}
                      </TableCell>
                      <TableCell>
                        <div>{details.emailAddress ?? "E-post saknas"}</div>
                        <div className="text-ink-muted">
                          {details.phoneNumber ?? "Telefonnummer saknas"}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(shareholder.effectiveFrom)}</TableCell>
                      <TableCell>
                        <Link
                          className="text-accent-ink underline underline-offset-2"
                          to={`/companies/${company.id}/shareholders/${shareholder.id}/edit`}
                        >
                          Ändra uppgifter
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </PageBody>
    </>
  );
}

const SHAREHOLDER_KIND_OPTIONS = [
  { value: "INDIVIDUAL", label: "Fysisk person" },
  { value: "LEGAL_ENTITY", label: "Juridisk person" },
] as const;

const MANUAL_SHAREHOLDER_VALUE = "__manual__";

function copyCandidateOptions(candidates: readonly ShareholderCopyCandidate[]) {
  return [
    {
      value: MANUAL_SHAREHOLDER_VALUE,
      label: "Registrera manuellt",
      description: "Ange nya aktieägaruppgifter",
    },
    ...candidates.map((candidate) => ({
      value: candidate.sourceShareholderId,
      label: candidate.details.legalName,
      description: `${candidate.sourceCompany.legalName} · ${formatSwedishIdentifier(candidate.identifierValue)}`,
    })),
  ];
}

export async function createShareholderLoader({ params }: LoaderFunctionArgs) {
  const companyId = requireCompanyId(params.companyId);
  const [company, copyCandidates] = await Promise.all([
    getCompany({ companyId }),
    listShareholderCopyCandidates({ companyId }),
  ]);
  return { company, copyCandidates };
}

export function CreateShareholderRoute() {
  const { company, copyCandidates } = useLoaderData<typeof createShareholderLoader>();
  const companyId = company.id;
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [kind, setKind] =
    useState<(typeof SHAREHOLDER_KIND_OPTIONS)[number]["value"]>("INDIVIDUAL");
  const [selectedCandidateId, setSelectedCandidateId] = useState(MANUAL_SHAREHOLDER_VALUE);
  const listPath = `/companies/${companyId}/shareholders`;
  const selectedCandidate = copyCandidates.find(
    ({ sourceShareholderId }) => sourceShareholderId === selectedCandidateId,
  );

  function selectCopyCandidate(value: string | null): void {
    const nextValue = value ?? MANUAL_SHAREHOLDER_VALUE;
    setSelectedCandidateId(nextValue);
    const candidate = copyCandidates.find(
      ({ sourceShareholderId }) => sourceShareholderId === nextValue,
    );
    if (candidate) setKind(candidate.kind);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitCatalogForm({
      setLoading,
      setError,
      operation: () =>
        requestJson<Shareholder>({
          path: `/api/companies/${companyId}/shareholders`,
          init: {
            method: "POST",
            body: JSON.stringify({
              kind,
              identifierCountryCode: "SE",
              identifierScheme: kind === "INDIVIDUAL" ? "PERSONNUMMER" : "ORGANISATIONSNUMMER",
              identifierValue: String(form.get("identifierValue") ?? "").trim(),
              initialDetails: shareholderDetailsFromForm(form),
              effectiveFrom: String(form.get("effectiveFrom") ?? ""),
            }),
          },
        }),
      onSuccess: () => navigate(listPath),
    });
  }

  return (
    <>
      <PageHeader
        title="Lägg till aktieägare"
        meta="Registrera aktieägarens ursprungliga uppgifter"
      />
      <PageBody width="form">
        {error ? <Callout tone="critical">{error}</Callout> : null}
        {copyCandidates.length > 0 ? (
          <Panel title="Återanvänd aktieägaruppgifter">
            <Field
              label="Kopiera från annat bolag"
              description="Uppgifterna kopieras till en ny, fristående aktieägare i det här bolaget."
            >
              <Select
                value={selectedCandidateId}
                options={copyCandidateOptions(copyCandidates)}
                onValueChange={selectCopyCandidate}
              />
            </Field>
          </Panel>
        ) : null}
        <Panel title="Aktieägaruppgifter">
          <form key={selectedCandidateId} className="flex flex-col gap-5" onSubmit={submit}>
            <Field label="Typ av aktieägare" required>
              <Select
                name="kind"
                options={SHAREHOLDER_KIND_OPTIONS}
                value={kind}
                onValueChange={(value) => value && setKind(value)}
                disabled={Boolean(selectedCandidate)}
                required
              />
            </Field>
            <Field label="Juridiskt namn" required>
              <Input
                name="legalName"
                defaultValue={selectedCandidate?.details.legalName}
                autoFocus
                required
              />
            </Field>
            <Field
              label={kind === "INDIVIDUAL" ? "Personnummer" : "Organisationsnummer"}
              description="Ange med eller utan bindestreck före de fyra sista siffrorna."
              required
            >
              <Input
                name="identifierValue"
                defaultValue={
                  selectedCandidate
                    ? formatSwedishIdentifier(selectedCandidate.identifierValue)
                    : undefined
                }
                readOnly={Boolean(selectedCandidate)}
                required
              />
            </Field>
            <ContactFields details={selectedCandidate?.details} />
            <AddressFields details={selectedCandidate?.details} />
            <Field label="Gäller från" description="Datum då uppgifterna börjar gälla." required>
              <DateField name="effectiveFrom" required />
            </Field>
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={loading}>
                Lägg till aktieägare
              </Button>
              <Button type="button" onClick={() => navigate(listPath)} disabled={loading}>
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>
    </>
  );
}

export async function editShareholderLoader({ params }: LoaderFunctionArgs) {
  const companyId = requireCompanyId(params.companyId);
  const shareholderId = requireShareholderId(params.shareholderId);
  const [company, shareholders, snapshot, companyMatches] = await Promise.all([
    getCompany({ companyId }),
    listShareholders({ companyId }),
    getCurrentSnapshot({ companyId }),
    listShareholderCompanyMatches({ companyId, shareholderId }),
  ]);
  const shareholder = shareholders.find(({ id }) => id === shareholderId);
  if (!shareholder) throw new Response("Aktieägaren finns inte.", { status: 404 });
  const details =
    snapshot.shareholderDetails.find((entry) => entry.shareholderId === shareholderId)?.details ??
    shareholder.initialDetails;
  return { company, shareholder, details, companyMatches };
}

export function EditShareholderRoute() {
  const { company, shareholder, details, companyMatches } =
    useLoaderData<typeof editShareholderLoader>();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([company.id]);
  const [pendingInput, setPendingInput] = useState<MultiCompanyDetailsChangeInput>();
  const [preview, setPreview] = useState<MultiCompanyDetailsChangeResult>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const listPath = `/companies/${company.id}/shareholders`;

  function selectCompany(companyId: string, selected: boolean): void {
    setSelectedCompanyIds((current) =>
      selected ? [...new Set([...current, companyId])] : current.filter((id) => id !== companyId),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      targetCompanyIds: selectedCompanyIds,
      effectiveDate: String(form.get("effectiveDate") ?? ""),
      after: shareholderDetailsFromForm(form),
    };
    await submitCatalogForm({
      setLoading,
      setError,
      operation: () =>
        previewMultiCompanyDetailsChange({
          companyId: company.id,
          shareholderId: shareholder.id,
          input,
        }),
      onSuccess: (result) => {
        setPendingInput(input);
        setPreview(result);
        setConfirmOpen(true);
      },
    });
  }

  async function confirmUpdate(): Promise<void> {
    if (!pendingInput) return;
    await submitCatalogForm({
      setLoading,
      setError,
      operation: () =>
        appendMultiCompanyDetailsChange({
          companyId: company.id,
          shareholderId: shareholder.id,
          input: pendingInput,
        }),
      onSuccess: () => navigate(listPath),
    });
  }

  return (
    <>
      <PageHeader title="Ändra aktieägaruppgifter" meta={company.legalName} />
      <PageBody width="form">
        {error ? <Callout tone="critical">{error}</Callout> : null}
        <Panel title={details.legalName}>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <Field label="Juridiskt namn" required>
              <Input name="legalName" defaultValue={details.legalName} autoFocus required />
            </Field>
            <Field
              label={shareholder.kind === "INDIVIDUAL" ? "Personnummer" : "Organisationsnummer"}
              description="Identifieraren kan inte ändras."
            >
              <Input value={formatSwedishIdentifier(shareholder.identifierValue)} readOnly />
            </Field>
            <ContactFields details={details} />
            <AddressFields details={details} />
            <Fieldset legend="Bolag som ska uppdateras">
              {companyMatches.map((match) => {
                const isCurrentCompany = match.company.id === company.id;
                return (
                  <Checkbox
                    key={match.company.id}
                    checked={selectedCompanyIds.includes(match.company.id)}
                    onCheckedChange={(checked) => selectCompany(match.company.id, checked)}
                    disabled={isCurrentCompany}
                    label={match.company.legalName}
                    description={
                      isCurrentCompany
                        ? "Det aktuella bolaget uppdateras alltid."
                        : `Nuvarande uppgifter: ${match.details.legalName}`
                    }
                  />
                );
              })}
            </Fieldset>
            <Field label="Gäller från" description="Datum då ändringen börjar gälla." required>
              <DateField
                name="effectiveDate"
                min={shareholder.effectiveFrom}
                defaultValue={
                  shareholder.effectiveFrom > currentDate()
                    ? shareholder.effectiveFrom
                    : currentDate()
                }
                required
              />
            </Field>
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={loading}>
                Granska och spara
              </Button>
              <Button type="button" onClick={() => navigate(listPath)} disabled={loading}>
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Spara aktieägaruppgifter"
        description={`En separat ändringshändelse registreras i ${preview?.results.length ?? 0} bolag.`}
        confirmLabel="Registrera ändringarna"
        loading={loading}
        onConfirm={confirmUpdate}
      >
        <ul className="space-y-1 text-sm text-ink-muted">
          {preview?.results.map((result) => (
            <li key={result.company.id}>{result.company.legalName}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}

export async function shareClassesLoader({ params }: LoaderFunctionArgs) {
  const companyId = requireCompanyId(params.companyId);
  const [company, shareClasses] = await Promise.all([
    getCompany({ companyId }),
    listShareClasses({ companyId }),
  ]);
  return { company, shareClasses };
}

export function ShareClassesRoute() {
  const { company, shareClasses } = useLoaderData<typeof shareClassesLoader>();
  const createPath = `/companies/${company.id}/share-classes/new`;

  return (
    <>
      <PageHeader
        title="Aktieslag"
        meta={`${company.legalName} · ${shareClasses.length} registrerade aktieslag`}
        actions={
          <Link className={linkButtonClass("primary")} to={createPath}>
            <PlusIcon /> Lägg till aktieslag
          </Link>
        }
      />
      <PageBody>
        <PageSection title="Aktieslagskatalog">
          {shareClasses.length === 0 ? (
            <EmptyState
              title="Inga aktieslag registrerade"
              description="Lägg till det första aktieslaget innan aktier registreras."
              action={
                <Link className={linkButtonClass("primary")} to={createPath}>
                  Lägg till aktieslag
                </Link>
              }
            />
          ) : (
            <Table caption={`Aktieslag i ${company.legalName}`} captionHidden>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Aktieslag</TableHeaderCell>
                  <TableHeaderCell numeric>Röster per aktie</TableHeaderCell>
                  <TableHeaderCell>Gäller från</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shareClasses.map((shareClass) => (
                  <TableRow key={shareClass.id}>
                    <TableCell header>{shareClass.name}</TableCell>
                    <TableCell numeric>{formatDecimal(shareClass.votesPerShare)}</TableCell>
                    <TableCell>{formatDate(shareClass.effectiveFrom)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </PageBody>
    </>
  );
}

export function CreateShareClassRoute() {
  const companyId = requireCompanyId(useParams().companyId);
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const listPath = `/companies/${companyId}/share-classes`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitCatalogForm({
      setLoading,
      setError,
      operation: () =>
        requestJson<ShareClass>({
          path: `/api/companies/${companyId}/share-classes`,
          init: {
            method: "POST",
            body: JSON.stringify({
              name: String(form.get("name") ?? "").trim(),
              votesPerShare: String(form.get("votesPerShare") ?? "").trim(),
              effectiveFrom: String(form.get("effectiveFrom") ?? ""),
            }),
          },
        }),
      onSuccess: () => navigate(listPath),
    });
  }

  return (
    <>
      <PageHeader title="Lägg till aktieslag" meta="Registrera aktieslagets ursprungliga villkor" />
      <PageBody width="form">
        {error ? <Callout tone="critical">{error}</Callout> : null}
        <Panel title="Aktieslagsuppgifter">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <Field label="Namn" description="Exempelvis A eller B." required>
              <Input name="name" autoFocus required />
            </Field>
            <Field
              label="Röster per aktie"
              description="Ange ett exakt decimaltal med punkt som decimaltecken."
              required
            >
              <Input
                name="votesPerShare"
                inputMode="decimal"
                pattern="0|[1-9][0-9]*([.][0-9]+)?"
                required
                numeric
              />
            </Field>
            <Field label="Gäller från" description="Datum då aktieslaget börjar gälla." required>
              <DateField name="effectiveFrom" required />
            </Field>
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={loading}>
                Lägg till aktieslag
              </Button>
              <Button type="button" onClick={() => navigate(listPath)} disabled={loading}>
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>
    </>
  );
}
