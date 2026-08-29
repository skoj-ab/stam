import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { type LoaderFunctionArgs, useLoaderData, useNavigate, useRevalidator } from "react-router";
import {
  ApiError,
  type Company,
  commitOcfImport,
  errorMessage,
  exportCompanyOcf,
  getCompany,
  listShareClasses,
  type OcfCompanyExportOptions,
  type OcfDryRunReport,
  type OcfDryRunResult,
  type OcfImportMode,
  type OcfPackage,
  type OcfTransferReason,
  type OcfTransferReasonResolution,
  previewOcfImport,
  type ShareClass,
} from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Badge,
  Button,
  Callout,
  DateField,
  Field,
  Fieldset,
  FormActions,
  formatCount,
  formatDate,
  formatDecimal,
  Input,
  LinkButton,
  Panel,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "../ui";

const IMPORT_MODES = [
  {
    value: "OPENING_SNAPSHOT",
    label: "Öppningsbild",
    description: "Skapa ett öppningstillstånd från innehaven i paketet.",
  },
  {
    value: "TRANSACTION_HISTORY",
    label: "Transaktionshistorik",
    description: "Återskapa de OCF-transaktioner som Stam stöder.",
  },
] as const;

const TRANSFER_REASONS: ReadonlyArray<{ value: OcfTransferReason; label: string }> = [
  { value: "SALE", label: "Köp" },
  { value: "GIFT", label: "Gåva" },
  { value: "INHERITANCE", label: "Arv" },
  { value: "DIVISION_OF_PROPERTY", label: "Bodelning" },
  { value: "OTHER", label: "Annat" },
];

const SUPPORTED_COUNT_LABELS: ReadonlyArray<
  readonly [keyof OcfDryRunReport["supportedCounts"], string]
> = [
  ["issuers", "Emittenter"],
  ["stakeholders", "Intressenter"],
  ["stockClasses", "Aktieslag"],
  ["rootStockIssuances", "Ursprungliga emissioner"],
  ["linkedStockIssuances", "Länkade emissioner"],
  ["stockTransfers", "Överlåtelser"],
  ["stockCancellations", "Makuleringar"],
  ["openingHoldings", "Öppningsinnehav"],
  ["eventDrafts", "Föreslagna registerhändelser"],
];

const COMMAND_LABELS: Record<string, string> = {
  CREATE_COMPANY: "Skapa bolag",
  CREATE_SHAREHOLDER: "Skapa aktieägare",
  CREATE_SHARE_CLASS: "Skapa aktieslag",
  APPEND_SHARE_EVENT: "Registrera händelse",
};

function modeLabel(mode: OcfImportMode): string {
  return mode === "OPENING_SNAPSHOT" ? "Öppningsbild" : "Transaktionshistorik";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value) return false;
  if (typeof value !== "object") return false;
  return !Array.isArray(value);
}

function hasPackageKeys(wrapper: Record<string, unknown>): boolean {
  const keys = Object.keys(wrapper);
  if (keys.length !== 2) return false;
  if (!keys.includes("manifest")) return false;
  return keys.includes("files");
}

function parsePackage(source: string): OcfPackage {
  const parsed: unknown = JSON.parse(source);
  if (!isJsonObject(parsed)) {
    throw new Error("JSON-innehållet måste vara ett objekt med manifest och files.");
  }
  if (!hasPackageKeys(parsed)) {
    throw new Error("Välj Stams tolkade OCF JSON-paket med exakt fälten manifest och files.");
  }
  if (!isJsonObject(parsed.files)) {
    throw new Error("Välj Stams tolkade OCF JSON-paket med exakt fälten manifest och files.");
  }
  return parsed as OcfPackage;
}

function ReportSummary({ report }: { report: OcfDryRunReport }) {
  const tone = report.valid ? "positive" : "critical";
  const title = report.valid ? "OCF-rapporten är godkänd" : "OCF-rapporten innehåller fel";
  return (
    <Callout tone={tone} title={title}>
      OCF {report.ocfVersion} · {modeLabel(report.mode)} · {formatCount(report.issues.length)} fel
      och varningar · {formatCount(report.losses.length)} informationsförluster
    </Callout>
  );
}

function SupportedCountsSection({ report }: { report: OcfDryRunReport }) {
  return (
    <PageSection title="Stödda OCF-objekt">
      <Table caption="Antal objekt som servern kan behandla" density="compact">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Objekttyp</TableHeaderCell>
            <TableHeaderCell numeric>Antal</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {SUPPORTED_COUNT_LABELS.map(([key, label]) => (
            <TableRow key={key}>
              <TableCell header>{label}</TableCell>
              <TableCell numeric>{formatCount(report.supportedCounts[key])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageSection>
  );
}

function IssuesSection({ issues }: { issues: OcfDryRunReport["issues"] }) {
  if (issues.length === 0) {
    return (
      <PageSection title="Problem i OCF-underlaget">
        <Callout tone="positive">Servern hittade inga fel eller varningar.</Callout>
      </PageSection>
    );
  }
  return (
    <PageSection title="Problem i OCF-underlaget">
      <Table caption="Fel och varningar från serverns OCF-kontroll" density="compact">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Nivå</TableHeaderCell>
            <TableHeaderCell>Kod</TableHeaderCell>
            <TableHeaderCell>Plats</TableHeaderCell>
            <TableHeaderCell>Meddelande</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {issues.map((issue, index) => (
            <TableRow key={`${issue.code}:${issue.file}:${issue.objectId ?? index}:${issue.path}`}>
              <TableCell>
                <Badge tone={issue.severity === "ERROR" ? "critical" : "caution"}>
                  {issue.severity === "ERROR" ? "Fel" : "Varning"}
                </Badge>
              </TableCell>
              <TableCell mono>{issue.code}</TableCell>
              <TableCell mono>
                {issue.file}:{issue.path}
              </TableCell>
              <TableCell>{issue.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageSection>
  );
}

function LossesSection({ losses }: { losses: OcfDryRunReport["losses"] }) {
  if (losses.length === 0) {
    return (
      <PageSection title="Informationsförluster">
        <Callout tone="positive">Ingen informationsförlust har rapporterats.</Callout>
      </PageSection>
    );
  }
  return (
    <PageSection title="Informationsförluster">
      <Table caption="Information som inte kan återges fullständigt" density="compact">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Kod</TableHeaderCell>
            <TableHeaderCell>Plats</TableHeaderCell>
            <TableHeaderCell>Meddelande</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {losses.map((loss, index) => (
            <TableRow key={`${loss.code}:${loss.file}:${loss.objectId ?? index}:${loss.path}`}>
              <TableCell mono>{loss.code}</TableCell>
              <TableCell mono>
                {loss.file}:{loss.path}
              </TableCell>
              <TableCell>{loss.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageSection>
  );
}

function CommandsSection({ commands }: { commands: OcfDryRunReport["proposedCommands"] }) {
  if (commands.length === 0) {
    return (
      <PageSection title="Föreslagna kommandon">
        <Callout tone="info">Inga kommandon kan föreslås för det aktuella underlaget.</Callout>
      </PageSection>
    );
  }
  return (
    <PageSection title="Föreslagna kommandon">
      <Table caption="Kommandon som importen kommer att utföra" density="compact">
        <TableHead>
          <TableRow>
            <TableHeaderCell numeric>Ordning</TableHeaderCell>
            <TableHeaderCell>Kommando</TableHeaderCell>
            <TableHeaderCell>Källnyckel</TableHeaderCell>
            <TableHeaderCell>Indata</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {commands.map((command) => (
            <TableRow key={`${command.sequence}:${command.sourceKey}`}>
              <TableCell numeric>{formatCount(command.sequence)}</TableCell>
              <TableCell>{COMMAND_LABELS[command.command] ?? command.command}</TableCell>
              <TableCell mono>{command.sourceKey}</TableCell>
              <TableCell>
                <code className="break-all font-mono text-xs">{JSON.stringify(command.input)}</code>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageSection>
  );
}

function ReportView({
  report,
  showCommands = false,
}: {
  report: OcfDryRunReport;
  showCommands?: boolean;
}) {
  return (
    <>
      <ReportSummary report={report} />
      <SupportedCountsSection report={report} />
      <IssuesSection issues={report.issues} />
      <LossesSection losses={report.losses} />
      {showCommands ? <CommandsSection commands={report.proposedCommands} /> : null}
    </>
  );
}

type ResolutionState = Partial<Record<string, OcfTransferReasonResolution>>;
type RequiredResolution = OcfDryRunReport["requiredResolutions"][number];
type ResolutionChange = (
  sourceTransactionId: string,
  resolution: OcfTransferReasonResolution,
) => void;

function createResolution(
  reason: OcfTransferReason,
  reasonNote?: string,
): OcfTransferReasonResolution {
  if (!reasonNote) return { reason };
  return { reason, reasonNote };
}

function changeResolutionReason(
  required: RequiredResolution,
  current: OcfTransferReasonResolution | undefined,
  reason: OcfTransferReason | null,
  onChange: ResolutionChange,
): void {
  if (!reason) return;
  onChange(required.sourceTransactionId, createResolution(reason, current?.reasonNote));
}

function changeResolutionNote(
  required: RequiredResolution,
  current: OcfTransferReasonResolution | undefined,
  reasonNote: string,
  onChange: ResolutionChange,
): void {
  if (!current) return;
  onChange(required.sourceTransactionId, createResolution(current.reason, reasonNote));
}

function ResolutionPanel({
  required,
  resolution,
  onChange,
}: {
  required: RequiredResolution;
  resolution?: OcfTransferReasonResolution;
  onChange: ResolutionChange;
}) {
  const options = TRANSFER_REASONS.filter(({ value }) => required.allowedValues.includes(value));
  return (
    <Panel title={`Överlåtelse ${required.sourceTransactionId}`} description={required.message}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Överlåtelseorsak" required>
          <Select
            options={options}
            value={resolution?.reason ?? null}
            onValueChange={(reason) =>
              changeResolutionReason(required, resolution, reason, onChange)
            }
            required
          />
        </Field>
        <Field label="Notering" description="Valfri förklaring till orsaken.">
          <Input
            value={resolution?.reasonNote ?? ""}
            disabled={!resolution}
            onChange={(event) =>
              changeResolutionNote(required, resolution, event.target.value, onChange)
            }
          />
        </Field>
      </div>
    </Panel>
  );
}

function resolutionsComplete(
  requiredResolutions: OcfDryRunReport["requiredResolutions"],
  resolutions: ResolutionState,
): boolean {
  return requiredResolutions.every(({ sourceTransactionId }) =>
    Boolean(resolutions[sourceTransactionId]),
  );
}

function ResolutionFields({
  report,
  resolutions,
  onChange,
  onSubmit,
  loading,
}: {
  report: OcfDryRunReport;
  resolutions: ResolutionState;
  onChange: ResolutionChange;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
}) {
  if (report.requiredResolutions.length === 0) return null;
  const complete = resolutionsComplete(report.requiredResolutions, resolutions);

  return (
    <PageSection
      title="Komplettera överlåtelseorsaker"
      description="OCF saknar orsaker som krävs i Stams aktiebok. Ange dem och kör förhandsgranskningen igen."
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {report.requiredResolutions.map((required) => (
          <ResolutionPanel
            key={required.sourceTransactionId}
            required={required}
            resolution={resolutions[required.sourceTransactionId]}
            onChange={onChange}
          />
        ))}
        <FormActions align="start">
          <Button type="submit" variant="primary" loading={loading} disabled={!complete}>
            Förhandsgranska igen
          </Button>
        </FormActions>
      </form>
    </PageSection>
  );
}

function canCommitImport(
  pkg: OcfPackage | undefined,
  preview: OcfDryRunResult | undefined,
): pkg is OcfPackage {
  if (!pkg) return false;
  if (!preview) return false;
  if (!preview.report.valid) return false;
  return Boolean(preview.conversion);
}

export function OcfImportRoute() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<OcfImportMode>("OPENING_SNAPSHOT");
  const [pkg, setPackage] = useState<OcfPackage>();
  const [preview, setPreview] = useState<OcfDryRunResult>();
  const [resolutions, setResolutions] = useState<ResolutionState>({});
  const [error, setError] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  function changeSource(value: string) {
    setSource(value);
    setPreview(undefined);
    setPackage(undefined);
    setResolutions({});
    setError(undefined);
    setFileError(undefined);
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileError(undefined);
    if (!file.name.toLocaleLowerCase("sv-SE").endsWith(".json")) {
      setFileError("Välj en JSON-fil med ändelsen .json.");
      event.target.value = "";
      return;
    }
    try {
      changeSource(await file.text());
    } catch {
      setFileError("Filen kunde inte läsas. Försök igen eller klistra in JSON-innehållet.");
    }
  }

  function importOptions() {
    const transferReasonResolutions = Object.fromEntries(
      Object.entries(resolutions).flatMap(([key, resolution]) =>
        resolution
          ? [
              [
                key,
                {
                  reason: resolution.reason,
                  ...(resolution.reasonNote?.trim()
                    ? { reasonNote: resolution.reasonNote.trim() }
                    : {}),
                },
              ],
            ]
          : [],
      ),
    );
    return {
      mode,
      ...(Object.keys(transferReasonResolutions).length > 0 ? { transferReasonResolutions } : {}),
    };
  }

  async function runPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewing(true);
    setError(undefined);
    try {
      const parsedPackage = pkg ?? parsePackage(source);
      setPackage(parsedPackage);
      setPreview(await previewOcfImport({ package: parsedPackage, options: importOptions() }));
      setFileError(undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.report) {
        setPreview({ report: caught.report });
      }
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function commit() {
    if (!canCommitImport(pkg, preview)) return;
    setCommitting(true);
    setError(undefined);
    try {
      const result = await commitOcfImport({ package: pkg, options: importOptions() });
      await revalidator.revalidate();
      navigate(`/companies/${result.company.id}/register`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.report) {
        setPreview({ report: caught.report });
        setError("Importen avvisades vid den slutliga serverkontrollen. Granska rapporten.");
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setCommitting(false);
    }
  }

  if (preview) {
    return (
      <>
        <PageHeader
          title="Granska OCF-import"
          meta={`OCF ${preview.report.ocfVersion} · ${modeLabel(preview.report.mode)}`}
        />
        <PageBody>
          {error ? (
            <Callout tone="critical" title="Importen kunde inte genomföras">
              {error}
            </Callout>
          ) : null}
          <ReportView report={preview.report} showCommands />
          <ResolutionFields
            report={preview.report}
            resolutions={resolutions}
            onChange={(sourceTransactionId, resolution) =>
              setResolutions((current) => ({ ...current, [sourceTransactionId]: resolution }))
            }
            onSubmit={runPreview}
            loading={previewing}
          />
          <FormActions align="start">
            <Button
              variant="danger"
              loading={committing}
              disabled={!canCommitImport(pkg, preview)}
              onClick={commit}
            >
              Importera bolag och aktiebok
            </Button>
            <Button
              disabled={committing || previewing}
              onClick={() => {
                setPreview(undefined);
                setError(undefined);
              }}
            >
              Tillbaka och ändra
            </Button>
          </FormActions>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Importera OCF" meta="Läs in Stams tolkade OCF JSON-paket" />
      <PageBody width="form">
        <Callout tone="info" title="Tolkad OCF JSON, inte ZIP">
          Importen tar emot en JSON-wrapper med fälten manifest och files. OCF ZIP-paket stöds ännu
          inte.
        </Callout>
        {error ? (
          <Callout tone="critical" title="Underlaget kunde inte förhandsgranskas">
            {error}
          </Callout>
        ) : null}
        {fileError ? (
          <Callout tone="critical" title="Filen kunde inte läsas">
            {fileError}
          </Callout>
        ) : null}
        <Panel
          title="OCF-underlag"
          description="Läs in en JSON-fil eller klistra in samma wrapper."
        >
          <form className="flex flex-col gap-5" onSubmit={runPreview}>
            <Field
              label="JSON-innehåll"
              description="Wrappern ska matcha {manifest, files}."
              required
            >
              <Textarea
                rows={12}
                required
                autoFocus
                value={source}
                onChange={(event) => changeSource(event.target.value)}
              />
            </Field>
            <Field label="Läs in JSON-fil" description="En enda fil med ändelsen .json.">
              <Input type="file" accept=".json,application/json" onChange={readFile} />
            </Field>
            <Fieldset legend="Importläge" description="Välj hur OCF-paketet ska bli en aktiebok.">
              <RadioGroup
                options={IMPORT_MODES}
                value={mode}
                onValueChange={(value) => {
                  setMode(value);
                  setPreview(undefined);
                  setResolutions({});
                }}
              />
            </Fieldset>
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={previewing}>
                Förhandsgranska import
              </Button>
              <Button
                type="button"
                disabled={previewing}
                onClick={() => navigate("/companies/new")}
              >
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>
    </>
  );
}

export type OcfExportLoaderData = {
  company: Company;
  shareClasses: ShareClass[];
};

export async function ocfExportLoader({
  params,
}: LoaderFunctionArgs): Promise<OcfExportLoaderData> {
  if (!params.companyId) throw new Response("Bolag saknas.", { status: 400 });
  const companyId = params.companyId;
  const [company, shareClasses] = await Promise.all([
    getCompany({ companyId }),
    listShareClasses({ companyId }),
  ]);
  return { company, shareClasses };
}

type Download = { url: string; filename: string };

export function OcfExportRoute() {
  const { company, shareClasses } = useLoaderData() as OcfExportLoaderData;
  const [report, setReport] = useState<OcfDryRunReport>();
  const [download, setDownload] = useState<Download>();
  const [error, setError] = useState<string>();
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    return () => {
      if (download) URL.revokeObjectURL(download.url);
    };
  }, [download]);

  async function submitExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExporting(true);
    setError(undefined);
    setReport(undefined);
    setDownload(undefined);
    const form = new FormData(event.currentTarget);
    const options: OcfCompanyExportOptions = {
      formationDate: String(form.get("formationDate") ?? ""),
      asOf: String(form.get("asOf") ?? ""),
      stockClasses: Object.fromEntries(
        shareClasses.map((shareClass) => [
          shareClass.id,
          {
            classType: String(form.get(`classType:${shareClass.id}`) ?? "COMMON") as
              | "COMMON"
              | "PREFERRED",
            defaultIdPrefix: String(form.get(`defaultIdPrefix:${shareClass.id}`) ?? ""),
            initialSharesAuthorized: String(
              form.get(`initialSharesAuthorized:${shareClass.id}`) ?? "",
            ),
            seniority: String(form.get(`seniority:${shareClass.id}`) ?? ""),
          },
        ]),
      ),
    };

    try {
      const result = await exportCompanyOcf({ companyId: company.id, options });
      setReport(result.report);
      if (result.package) {
        const blob = new Blob([JSON.stringify(result.package, null, 2)], {
          type: "application/json",
        });
        setDownload({
          url: URL.createObjectURL(blob),
          filename: `stam-ocf-${company.id}-${options.asOf}.json`,
        });
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.report) {
        setReport(caught.report);
        setError("Exporten kunde inte skapa ett paket. Granska serverrapporten nedan.");
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Exportera OCF"
        meta={`${company.legalName} · Stams tolkade OCF JSON-paket`}
      />
      <PageBody>
        <Callout tone="info" title="Tolkad OCF JSON, inte ZIP">
          Exporten skapar Stams tolkade OCF JSON-wrapper med manifest och files. ZIP-export är inte
          implementerad.
        </Callout>
        {error ? (
          <Callout tone="critical" title="OCF-exporten kunde inte slutföras">
            {error}
          </Callout>
        ) : null}
        {download ? (
          <Callout
            tone="positive"
            title="OCF-paketet är klart"
            actions={
              <LinkButton href={download.url} download={download.filename}>
                Ladda ned tolkad OCF JSON
              </LinkButton>
            }
          >
            Servern har validerat paketet. Ladda ned JSON-wrappern och bevara rapporten nedan.
          </Callout>
        ) : null}

        <PageSection
          title="Exportuppgifter"
          description="Alla aktieslag som gäller på exportdagen behöver OCF-metadata."
        >
          <form className="flex flex-col gap-4" onSubmit={submitExport}>
            <Panel title="Bolag och brytdatum">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bolagets bildandedatum" required>
                  <DateField name="formationDate" required autoFocus />
                </Field>
                <Field label="Exportera per" required>
                  <DateField
                    name="asOf"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
              </div>
            </Panel>

            {shareClasses.map((shareClass, index) => (
              <Panel
                key={shareClass.id}
                title={`Aktieslag ${shareClass.name}`}
                description={`${formatDecimal(shareClass.votesPerShare)} röster per aktie · gäller från ${formatDate(shareClass.effectiveFrom)}`}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="OCF-klasstyp" required>
                    <Select
                      name={`classType:${shareClass.id}`}
                      options={[
                        { value: "COMMON", label: "Stamaktie" },
                        { value: "PREFERRED", label: "Preferensaktie" },
                      ]}
                      defaultValue="COMMON"
                      required
                    />
                  </Field>
                  <Field label="ID-prefix" description="Prefix för OCF-värdepapper." required>
                    <Input
                      name={`defaultIdPrefix:${shareClass.id}`}
                      defaultValue={shareClass.name}
                      required
                    />
                  </Field>
                  <Field label="Ursprungligt antal auktoriserade aktier" required>
                    <Input
                      name={`initialSharesAuthorized:${shareClass.id}`}
                      numeric
                      inputMode="decimal"
                      required
                      pattern="[1-9]\d*(?:\.\d+)?"
                    />
                  </Field>
                  <Field label="Prioritet" description="0 eller ett positivt decimaltal." required>
                    <Input
                      name={`seniority:${shareClass.id}`}
                      numeric
                      inputMode="decimal"
                      required
                      defaultValue={String(index)}
                      pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
                    />
                  </Field>
                </div>
              </Panel>
            ))}

            <FormActions align="start">
              <Button type="submit" variant="primary" loading={exporting}>
                Skapa tolkad OCF JSON
              </Button>
            </FormActions>
          </form>
        </PageSection>

        {report ? <ReportView report={report} /> : null}
      </PageBody>
    </>
  );
}
