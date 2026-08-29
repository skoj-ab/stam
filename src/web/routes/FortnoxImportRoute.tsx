import { type ChangeEvent, type FormEvent, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { formatSwedishIdentifier } from "../../domain/swedish-identifiers";
import {
  commitFortnoxImport,
  errorMessage,
  type FortnoxImportFiles,
  type FortnoxImportPlan,
  type FortnoxImportPreview,
  type FortnoxImportWarning,
  previewFortnoxImport,
} from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  DescriptionList,
  Field,
  FormActions,
  formatCount,
  formatDate,
  formatDecimal,
  formatShareRange,
  Input,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui";

type SelectedSources = Partial<FortnoxImportFiles>;

const SOURCE_FIELDS = [
  {
    key: "detailedRegisterPdf",
    label: "Detaljerad aktiebok",
    description: "PDF-rapporten Aktiebok från fliken Rapporter.",
    accept: ".pdf,application/pdf",
    extension: /\.pdf$/i,
  },
  {
    key: "ownerOverviewPdf",
    label: "Ägaröversikt",
    description: "PDF-rapporten Ägaröversikt från fliken Rapporter.",
    accept: ".pdf,application/pdf",
    extension: /\.pdf$/i,
  },
  {
    key: "eventsHtml",
    label: "Händelsehistorik",
    description: "Den sparade webbsidan från fliken Händelser.",
    accept: ".html,.htm,text/html",
    extension: /\.html?$/i,
  },
] as const;

type SourceKey = (typeof SOURCE_FIELDS)[number]["key"];

function warningText(warning: FortnoxImportWarning): string {
  if (warning.code === "SOURCE_HISTORY_ORDER") {
    return warning.postNumber
      ? `Historiken för aktiepost ${warning.postNumber} måste återskapas från källhändelserna.`
      : "En ägarhistorik måste återskapas från källhändelserna.";
  }
  return warning.sourceId
    ? `Fortnox-händelse ${warning.sourceId} kan inte återskapas automatiskt.`
    : "En Fortnox-händelse kan inte återskapas automatiskt.";
}

function SourceStep({
  files,
  error,
  fileError,
  previewing,
  onFileChange,
  onSubmit,
  onCancel,
}: {
  files: SelectedSources;
  error?: string;
  fileError?: string;
  previewing: boolean;
  onFileChange: (key: SourceKey, event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Importera från Fortnox"
        meta="Steg 1 av 2 · välj de tre underlagen från Fortnox"
      />
      <PageBody width="form">
        {error ? (
          <Callout tone="critical" title="Underlagen kunde inte förhandsgranskas">
            {error}
          </Callout>
        ) : null}
        {fileError ? (
          <Callout tone="critical" title="Filen kunde inte läsas">
            {fileError}
          </Callout>
        ) : null}
        <Callout title="Hämta underlagen från Fortnox">
          Ladda ned rapporterna Aktiebok och Ägaröversikt som PDF under Rapporter. Öppna sedan
          Händelser och spara sidan som HTML i webbläsaren.
        </Callout>
        <Panel
          title="Fortnox-underlag"
          description="Filerna läses och kontrolleras först när du förhandsgranskar importen."
        >
          <form className="flex flex-col gap-5" onSubmit={onSubmit}>
            {SOURCE_FIELDS.map((field, index) => (
              <Field
                key={field.key}
                label={field.label}
                description={
                  files[field.key]
                    ? `${field.description} Vald fil: ${files[field.key]?.name}`
                    : field.description
                }
                required
              >
                <Input
                  type="file"
                  accept={field.accept}
                  required={!files[field.key]}
                  autoFocus={index === 0}
                  onChange={(event) => onFileChange(field.key, event)}
                />
              </Field>
            ))}
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={previewing}>
                Förhandsgranska import
              </Button>
              <Button type="button" disabled={previewing} onClick={onCancel}>
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>
    </>
  );
}

function ImportSummary({ plan }: { plan: FortnoxImportPlan }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Bolag">
        <DescriptionList
          items={[
            { term: "Företagsnamn", description: plan.company.legalName },
            {
              term: "Organisationsnummer",
              description: formatSwedishIdentifier(plan.company.registrationValue),
            },
            { term: "Exportdatum", description: formatDate(plan.company.exportDate) },
            { term: "Serverkontroll", description: <Badge tone="positive">Godkänd</Badge> },
          ]}
        />
      </Panel>
      <Panel title="Aktieslag, kapital och summor">
        <DescriptionList
          items={[
            { term: "Aktieslag", description: plan.shareClass.name },
            {
              term: "Röster per aktie",
              description: formatDecimal(plan.shareClass.votesPerShare),
            },
            {
              term: "Totalt antal aktier",
              description: formatCount(plan.shareClass.totalShares),
            },
            {
              term: "Totalt antal röster",
              description: formatDecimal(plan.shareClass.totalVotes),
            },
            {
              term: "Aktiekapital",
              description: `${formatDecimal(plan.shareCapital.amount)} ${plan.shareCapital.currency}`,
            },
            { term: "Aktieägare", description: formatCount(plan.shareholders.length) },
          ]}
        />
      </Panel>
    </div>
  );
}

function ImportHoldings({ plan }: { plan: FortnoxImportPlan }) {
  return (
    <PageSection
      title="Aktieägare och innehav"
      description={`${formatCount(plan.shareholders.length)} aktieägare i det förhandsgranskade öppningstillståndet.`}
    >
      <Table
        caption={`Aktieägare och innehav per ${formatDate(plan.company.exportDate)}`}
        density="compact"
      >
        <TableHead>
          <TableRow>
            <TableHeaderCell>Aktieägare</TableHeaderCell>
            <TableHeaderCell>Person-/organisationsnummer</TableHeaderCell>
            <TableHeaderCell>Adress</TableHeaderCell>
            <TableHeaderCell>Aktienummer</TableHeaderCell>
            <TableHeaderCell numeric>Aktier</TableHeaderCell>
            <TableHeaderCell numeric>Röster</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {plan.shareholders.map((shareholder) => {
            const holding = plan.holdings.find(
              (candidate) => candidate.shareholderKey === shareholder.key,
            );
            return (
              <TableRow key={shareholder.key}>
                <TableCell header>
                  <div>{shareholder.initialDetails.legalName}</div>
                  <div className="text-ink-muted">
                    {shareholder.kind === "INDIVIDUAL" ? "Fysisk person" : "Juridisk person"}
                  </div>
                </TableCell>
                <TableCell mono>{formatSwedishIdentifier(shareholder.identifierValue)}</TableCell>
                <TableCell>
                  {[
                    ...shareholder.initialDetails.address.lines,
                    `${shareholder.initialDetails.address.postalCode} ${shareholder.initialDetails.address.locality}`,
                  ].join(", ")}
                </TableCell>
                <TableCell mono>
                  {holding?.ranges.map(formatShareRange).join(", ") ?? "Saknas"}
                </TableCell>
                <TableCell numeric>{formatCount(shareholder.totalShares)}</TableCell>
                <TableCell numeric>{formatDecimal(shareholder.totalVotes)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </PageSection>
  );
}

function ImportSourceEvents({ events }: { events: FortnoxImportPlan["sourceEvents"] }) {
  return (
    <PageSection
      title="Bevarad källhistorik"
      description="Samtliga händelser sparas som källhistorik och tolkas inte om till andra registerhändelser."
    >
      <Table caption="Alla källhändelser från Fortnox" density="compact">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Käll-id</TableHeaderCell>
            <TableHeaderCell>Datum</TableHeaderCell>
            <TableHeaderCell>Typ</TableHeaderCell>
            <TableHeaderCell>Beskrivning</TableHeaderCell>
            <TableHeaderCell>Hantering</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.sourceId}>
              <TableCell mono>{event.sourceId}</TableCell>
              <TableCell>{formatDate(event.date)}</TableCell>
              <TableCell>{event.type}</TableCell>
              <TableCell>{event.description}</TableCell>
              <TableCell>
                <Badge tone="neutral">Bevaras som källa</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageSection>
  );
}

function ImportWarnings({ warnings }: { warnings: readonly FortnoxImportWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <Callout tone="caution" title="Importen innehåller varningar">
      <div className="flex flex-col gap-2">
        {warnings.map((warning, index) => (
          <p key={`${warning.code}:${warning.sourceId ?? warning.postNumber ?? index}`}>
            {warningText(warning)}
          </p>
        ))}
      </div>
    </Callout>
  );
}

function PreviewStep({
  preview,
  error,
  committing,
  warningsAcknowledged,
  onWarningsAcknowledged,
  onBack,
  onCommit,
}: {
  preview: FortnoxImportPreview;
  error?: string;
  committing: boolean;
  warningsAcknowledged: boolean;
  onWarningsAcknowledged: (checked: boolean) => void;
  onBack: () => void;
  onCommit: () => void;
}) {
  const { plan } = preview;
  const hasWarnings = plan.analysis.warnings.length > 0;

  return (
    <>
      <PageHeader
        title="Granska Fortnox-import"
        meta={`Steg 2 av 2 · ${plan.company.legalName} · export ${formatDate(plan.company.exportDate)}`}
      />
      <PageBody>
        {error ? (
          <Callout tone="critical" title="Importen kunde inte genomföras">
            {error}
          </Callout>
        ) : null}
        <Callout tone="positive" title="Underlagen är servervaliderade">
          Förhandsgranskningen har inte ändrat aktieboken. Underlagen valideras på nytt när du
          importerar.
        </Callout>

        <ImportSummary plan={plan} />
        <ImportHoldings plan={plan} />
        <ImportSourceEvents events={plan.sourceEvents} />
        <ImportWarnings warnings={plan.analysis.warnings} />

        {hasWarnings ? (
          <Checkbox
            checked={warningsAcknowledged}
            onCheckedChange={onWarningsAcknowledged}
            label="Jag har granskat varningarna och vill fortsätta"
            description="Importen kan genomföras först när varningarna har godkänts."
          />
        ) : null}

        <FormActions align="start">
          <Button
            variant="danger"
            loading={committing}
            disabled={hasWarnings && !warningsAcknowledged}
            onClick={onCommit}
          >
            Importera bolag och aktiebok
          </Button>
          <Button disabled={committing} onClick={onBack}>
            Tillbaka och ändra
          </Button>
        </FormActions>
      </PageBody>
    </>
  );
}

export function FortnoxImportRoute() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [files, setFiles] = useState<SelectedSources>({});
  const [preview, setPreview] = useState<FortnoxImportPreview>();
  const [error, setError] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);

  function completeSources(sources: SelectedSources): sources is FortnoxImportFiles {
    return SOURCE_FIELDS.every(({ key }) => sources[key] instanceof File);
  }

  function selectFile(key: SourceKey, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileError(undefined);
    const field = SOURCE_FIELDS.find((candidate) => candidate.key === key);
    if (!field?.extension.test(file.name)) {
      setFileError(key === "eventsHtml" ? "Välj en HTML-fil." : "Välj en PDF-fil.");
      event.target.value = "";
      return;
    }
    setFiles((current) => ({ ...current, [key]: file }));
  }

  async function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completeSources(files)) {
      setFileError("Välj båda PDF-rapporterna och den sparade HTML-sidan.");
      return;
    }
    setPreviewing(true);
    setError(undefined);
    try {
      setPreview(await previewFortnoxImport(files));
      setFileError(undefined);
      setWarningsAcknowledged(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function commit() {
    if (preview?.plan.analysis.warnings.length && !warningsAcknowledged) return;
    if (!completeSources(files)) return;
    setCommitting(true);
    setError(undefined);
    try {
      const result = await commitFortnoxImport(files);
      await revalidator.revalidate();
      navigate(`/companies/${result.company.id}/register`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCommitting(false);
    }
  }

  if (preview) {
    return (
      <PreviewStep
        preview={preview}
        error={error}
        committing={committing}
        warningsAcknowledged={warningsAcknowledged}
        onWarningsAcknowledged={setWarningsAcknowledged}
        onBack={() => {
          setError(undefined);
          setPreview(undefined);
        }}
        onCommit={commit}
      />
    );
  }

  return (
    <SourceStep
      files={files}
      error={error}
      fileError={fileError}
      previewing={previewing}
      onFileChange={selectFile}
      onSubmit={submitPreview}
      onCancel={() => navigate("/companies/new")}
    />
  );
}
