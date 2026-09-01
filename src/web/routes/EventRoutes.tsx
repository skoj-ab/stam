import { type FormEvent, useRef, useState } from "react";
import {
  Link,
  type LoaderFunctionArgs,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import {
  appendEvents,
  type Company,
  type EventMutationResult,
  errorMessage,
  getCompany,
  getCurrentSnapshot,
  listEvents,
  listShareClasses,
  listShareholders,
  previewEvents,
  type ShareClass,
  type ShareEventDraft,
  type Shareholder,
  type ShareRegisterEvent,
  type ShareRegisterSnapshot,
} from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Badge,
  Button,
  Callout,
  Combobox,
  ConfirmDialog,
  DateField,
  DescriptionList,
  EmptyState,
  Field,
  Fieldset,
  FormActions,
  formatCount,
  formatDate,
  formatDecimal,
  formatShareRange,
  formatTimestamp,
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
  Textarea,
} from "../ui";
import { useApplicationAccess } from "./ApplicationLayoutRoute";
import {
  STRUCTURAL_EVENT_FORM_TYPES,
  type StructuralEventFormType,
  StructuralEventWorkflow,
} from "./StructuralEventForms";

const STANDARD_EVENT_FORM_TYPES = ["issuance", "transfer", "cancellation", "correction"] as const;
const EVENT_FORM_TYPES = [
  "opening",
  ...STANDARD_EVENT_FORM_TYPES,
  ...STRUCTURAL_EVENT_FORM_TYPES,
] as const;

type EventFormType = (typeof EVENT_FORM_TYPES)[number];
type StandardEventFormType = (typeof STANDARD_EVENT_FORM_TYPES)[number];

type ShareRange = ShareRegisterSnapshot["holdings"][number]["range"];
type StructuralEvent = Extract<
  ShareRegisterEvent,
  {
    type:
      | "SHARE_CAPITAL_CHANGED"
      | "SHARES_SPLIT"
      | "SHARES_RENUMBERED"
      | "SOURCE_ACTIVITY_RECORDED";
  }
>;

type EventRouteData = {
  company: Company;
  shareholders: Shareholder[];
  shareClasses: ShareClass[];
  events: ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
};

type EventFormData = EventRouteData & {
  eventType: EventFormType;
};

const EVENT_TYPE_LABELS: Record<ShareRegisterEvent["type"], string> = {
  OPENING_STATE_IMPORTED: "Öppningsbalans",
  SHARES_ISSUED: "Emission",
  SHARES_TRANSFERRED: "Överlåtelse",
  SHARES_CANCELLED: "Makulering",
  SHAREHOLDER_DETAILS_CHANGED: "Ägaruppgifter ändrade",
  SHARE_CAPITAL_CHANGED: "Aktiekapital ändrat",
  SHARES_SPLIT: "Split",
  SHARES_RENUMBERED: "Omnumrering",
  SOURCE_ACTIVITY_RECORDED: "Källhändelse",
  EVENT_REVERSED: "Rättelse",
};

const CAPITAL_REASON_LABELS = {
  FORMATION: "bildande",
  ISSUE: "emission",
  BONUS_ISSUE: "fondemission",
  REDUCTION: "minskning",
  OTHER: "annan ändring",
} as const;

const SOURCE_OPTIONS = [
  { value: "SHARE_REGISTER", label: "Befintlig aktiebok" },
  { value: "OCF", label: "OCF-fil" },
  { value: "OTHER", label: "Annan källa" },
] as const;

type OpeningSource = (typeof SOURCE_OPTIONS)[number]["value"];

const SOURCE_LABELS: Record<OpeningSource, string> = {
  SHARE_REGISTER: "Befintlig aktiebok",
  OCF: "OCF-fil",
  OTHER: "Annan källa",
};

const TRANSFER_REASON_OPTIONS = [
  { value: "SALE", label: "Försäljning" },
  { value: "GIFT", label: "Gåva" },
  { value: "INHERITANCE", label: "Arv" },
  { value: "DIVISION_OF_PROPERTY", label: "Bodelning" },
  { value: "OTHER", label: "Annan anledning" },
] as const;

const TRANSFER_REASON_LABELS: Record<(typeof TRANSFER_REASON_OPTIONS)[number]["value"], string> = {
  SALE: "Försäljning",
  GIFT: "Gåva",
  INHERITANCE: "Arv",
  DIVISION_OF_PROPERTY: "Bodelning",
  OTHER: "Annan anledning",
};

const CANCELLATION_REASON_OPTIONS = [
  { value: "REDEMPTION", label: "Inlösen" },
  { value: "CANCELLATION", label: "Minskning av aktiekapital" },
  { value: "OTHER", label: "Annan anledning" },
] as const;

const CANCELLATION_REASON_LABELS: Record<
  (typeof CANCELLATION_REASON_OPTIONS)[number]["value"],
  string
> = {
  REDEMPTION: "Inlösen",
  CANCELLATION: "Minskning av aktiekapital",
  OTHER: "Annan anledning",
};

const FORM_COPY: Record<
  StandardEventFormType,
  {
    title: string;
    panelTitle: string;
    previewLabel: string;
    confirmTitle: string;
    confirmLabel: string;
  }
> = {
  issuance: {
    title: "Registrera emission",
    panelTitle: "Nya aktier",
    previewLabel: "Granska emission",
    confirmTitle: "Registrera emission",
    confirmLabel: "Registrera emission",
  },
  transfer: {
    title: "Registrera överlåtelse",
    panelTitle: "Överlåtelse",
    previewLabel: "Granska överlåtelse",
    confirmTitle: "Registrera överlåtelse",
    confirmLabel: "Registrera överlåtelse",
  },
  cancellation: {
    title: "Registrera makulering",
    panelTitle: "Aktier som upphör",
    previewLabel: "Granska makulering",
    confirmTitle: "Makulera aktier",
    confirmLabel: "Makulera aktier",
  },
  correction: {
    title: "Registrera rättelse",
    panelTitle: "Rättelse av händelse",
    previewLabel: "Granska rättelse",
    confirmTitle: "Registrera rättelse",
    confirmLabel: "Registrera rättelse",
  },
};

function requiredCompanyId(params: LoaderFunctionArgs["params"]): string {
  if (!params.companyId) {
    throw new Response("Bolag saknas", { status: 400 });
  }
  return params.companyId;
}

function isEventFormType(value: string | undefined): value is EventFormType {
  return EVENT_FORM_TYPES.some((eventType) => eventType === value);
}

function isStructuralEventFormType(value: EventFormType): value is StructuralEventFormType {
  return STRUCTURAL_EVENT_FORM_TYPES.some((eventType) => eventType === value);
}

async function loadEventRouteData({ companyId }: { companyId: string }): Promise<EventRouteData> {
  const [company, shareholders, shareClasses, events, currentSnapshot] = await Promise.all([
    getCompany({ companyId }),
    listShareholders({ companyId }),
    listShareClasses({ companyId }),
    listEvents({ companyId }),
    getCurrentSnapshot({ companyId }),
  ]);
  return { company, shareholders, shareClasses, events, currentSnapshot };
}

export async function eventHistoryLoader({ params }: LoaderFunctionArgs): Promise<EventRouteData> {
  return loadEventRouteData({ companyId: requiredCompanyId(params) });
}

export async function eventFormLoader({ params }: LoaderFunctionArgs): Promise<EventFormData> {
  const companyId = requiredCompanyId(params);
  if (!isEventFormType(params.eventType)) {
    throw new Response("Okänd händelsetyp", { status: 404 });
  }
  return { ...(await loadEventRouteData({ companyId })), eventType: params.eventType };
}

function rangeCount(ranges: readonly ShareRange[]): number {
  return ranges.reduce((total, range) => total + range.to - range.from + 1, 0);
}

function snapshotTotal(snapshot: ShareRegisterSnapshot): number {
  return snapshot.totalsByClass.reduce((total, entry) => total + entry.total, 0);
}

function formattedRanges(ranges: readonly ShareRange[]): string {
  return ranges.map(formatShareRange).join(", ");
}

function noteSuffix({ note }: { note?: string }): string {
  return note ? ` · ${note}` : "";
}

function priceSuffix(event: Extract<ShareRegisterEvent, { type: "SHARES_ISSUED" }>): string {
  const price = event.payload.subscriptionPrice;
  return price ? ` · ${formatDecimal(price.amount)} ${price.currency} per aktie` : "";
}

function structuralEventSummary(event: StructuralEvent): string {
  switch (event.type) {
    case "SHARE_CAPITAL_CHANGED":
      return `${formatDecimal(event.payload.after.amount)} ${event.payload.after.currency} · ${CAPITAL_REASON_LABELS[event.payload.reason]}${noteSuffix({ note: event.payload.note })}`;
    case "SHARES_SPLIT":
      return `Faktor ${formatCount(event.payload.factor)}${noteSuffix({ note: event.payload.note })}`;
    case "SHARES_RENUMBERED": {
      const shares = event.payload.holdings.reduce(
        (total, holding) => total + rangeCount(holding.ranges),
        0,
      );
      return `${formatCount(shares)} aktier · ${event.payload.note}`;
    }
    case "SOURCE_ACTIVITY_RECORDED":
      return `${event.payload.category} · ${event.payload.description}`;
  }
}

function isStructuralEvent(event: ShareRegisterEvent): event is StructuralEvent {
  return (
    event.type === "SHARE_CAPITAL_CHANGED" ||
    event.type === "SHARES_SPLIT" ||
    event.type === "SHARES_RENUMBERED" ||
    event.type === "SOURCE_ACTIVITY_RECORDED"
  );
}

function shareholderName({
  data,
  shareholderId,
}: {
  data: EventRouteData;
  shareholderId: string;
}): string {
  return (
    data.shareholders.find((shareholder) => shareholder.id === shareholderId)?.initialDetails
      .legalName ?? shareholderId
  );
}

function currentShareholderName({
  data,
  shareholderId,
}: {
  data: EventRouteData;
  shareholderId: string;
}): string {
  return (
    data.currentSnapshot.shareholderDetails.find((entry) => entry.shareholderId === shareholderId)
      ?.details.legalName ?? shareholderName({ data, shareholderId })
  );
}

function shareClassName({
  data,
  shareClassId,
}: {
  data: EventRouteData;
  shareClassId: string;
}): string {
  return (
    data.shareClasses.find((shareClass) => shareClass.id === shareClassId)?.name ?? shareClassId
  );
}

function eventSummary(event: ShareRegisterEvent, data: EventRouteData): string {
  if (isStructuralEvent(event)) return structuralEventSummary(event);
  switch (event.type) {
    case "OPENING_STATE_IMPORTED": {
      const shares = event.payload.holdings.reduce(
        (total, holding) => total + rangeCount(holding.ranges),
        0,
      );
      return `${formatCount(shares)} aktier från ${SOURCE_LABELS[event.payload.sourceType]} · ${event.payload.importNote}`;
    }
    case "SHARES_ISSUED":
      return `${shareholderName({ data, shareholderId: event.payload.shareholderId })} · ${shareClassName({ data, shareClassId: event.payload.shareClassId })} · ${formattedRanges(event.payload.ranges)}${priceSuffix(event)}`;
    case "SHARES_TRANSFERRED":
      return `${shareholderName({ data, shareholderId: event.payload.transferorId })} till ${shareholderName({ data, shareholderId: event.payload.transfereeId })} · ${shareClassName({ data, shareClassId: event.payload.shareClassId })} · ${formattedRanges(event.payload.ranges)} · ${TRANSFER_REASON_LABELS[event.payload.reason]}${noteSuffix({ note: event.payload.reasonNote })}`;
    case "SHARES_CANCELLED":
      return `${shareholderName({ data, shareholderId: event.payload.shareholderId })} · ${shareClassName({ data, shareClassId: event.payload.shareClassId })} · ${formattedRanges(event.payload.ranges)} · ${CANCELLATION_REASON_LABELS[event.payload.reason]}${noteSuffix({ note: event.payload.reasonNote })}`;
    case "SHAREHOLDER_DETAILS_CHANGED":
      return `${event.payload.before.legalName} till ${event.payload.after.legalName}`;
    case "EVENT_REVERSED": {
      const target = data.events.find((candidate) => candidate.id === event.payload.targetEventId);
      const targetLabel = target
        ? `#${target.sequence} ${EVENT_TYPE_LABELS[target.type].toLocaleLowerCase("sv-SE")}`
        : event.payload.targetEventId;
      return `${targetLabel} · ${event.payload.explanation}`;
    }
  }
}

function correctedTargetIds(events: readonly ShareRegisterEvent[]): Set<string> {
  return new Set(
    events.flatMap((event) =>
      event.type === "EVENT_REVERSED" ? [event.payload.targetEventId] : [],
    ),
  );
}

function correctionCandidates(events: readonly ShareRegisterEvent[]): ShareRegisterEvent[] {
  const corrected = correctedTargetIds(events);
  return events.filter(
    (event) =>
      (event.type === "SHARES_ISSUED" ||
        event.type === "SHARES_TRANSFERRED" ||
        event.type === "SHARES_CANCELLED" ||
        event.type === "SHAREHOLDER_DETAILS_CHANGED") &&
      !corrected.has(event.id),
  );
}

function EventActionLinks({ basePath, hasOpening }: { basePath: string; hasOpening: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {!hasOpening ? (
        <Link className={linkButtonClass()} to={`${basePath}/opening`}>
          Öppningsbalans
        </Link>
      ) : null}
      <Link className={linkButtonClass()} to={`${basePath}/issuance`}>
        Emission
      </Link>
      <Link className={linkButtonClass()} to={`${basePath}/transfer`}>
        Överlåtelse
      </Link>
      <Link className={linkButtonClass()} to={`${basePath}/cancellation`}>
        Makulering
      </Link>
      <Link className={linkButtonClass()} to={`${basePath}/capital`}>
        Aktiekapital
      </Link>
      {hasOpening ? (
        <>
          <Link className={linkButtonClass()} to={`${basePath}/split`}>
            Split
          </Link>
          <Link className={linkButtonClass()} to={`${basePath}/renumbering`}>
            Omnumrering
          </Link>
        </>
      ) : null}
      <Link className={linkButtonClass()} to={`${basePath}/correction`}>
        Rättelse
      </Link>
    </div>
  );
}

export function EventHistoryRoute() {
  const data = useLoaderData() as EventRouteData;
  const { canWrite } = useApplicationAccess();
  const events = [...data.events].sort((left, right) => left.sequence - right.sequence);
  const corrected = correctedTargetIds(events);
  const correctionEventIds = new Set(correctionCandidates(events).map((event) => event.id));
  const basePath = `/companies/${data.company.id}/events`;
  const hasOpening = events.some((event) => event.type === "OPENING_STATE_IMPORTED");

  return (
    <>
      <PageHeader
        title="Händelser"
        meta={`${data.company.legalName} · ${formatCount(events.length)} registrerade händelser`}
        actions={
          canWrite ? (
            <Link
              className={linkButtonClass("primary")}
              to={`${basePath}/${hasOpening ? "issuance" : "opening"}`}
            >
              <PlusIcon /> {hasOpening ? "Ny händelse" : "Importera öppningsbalans"}
            </Link>
          ) : undefined
        }
      />
      <PageBody>
        {canWrite ? (
          <PageSection
            title="Registrera händelse"
            description="Alla ändringar förhandsgranskas av servern innan de registreras."
          >
            <Panel>
              <EventActionLinks basePath={basePath} hasOpening={hasOpening} />
            </Panel>
          </PageSection>
        ) : null}

        <PageSection
          title="Händelsehistorik"
          description="Historiken är oföränderlig och visas i registrerad sekvensordning."
        >
          {events.length === 0 ? (
            <EmptyState
              title="Inga händelser registrerade"
              description={
                canWrite
                  ? "Importera en verifierad öppningsbalans för att börja föra aktieboken."
                  : "Det finns inga händelser att visa."
              }
              action={
                canWrite ? (
                  <Link className={linkButtonClass("primary")} to={`${basePath}/opening`}>
                    Importera öppningsbalans
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Table caption="Oföränderlig händelsehistorik i sekvensordning" density="compact">
              <TableHead>
                <TableRow>
                  <TableHeaderCell numeric>Sekvens</TableHeaderCell>
                  <TableHeaderCell>Typ</TableHeaderCell>
                  <TableHeaderCell>Verkningsdatum</TableHeaderCell>
                  <TableHeaderCell>Registrerad</TableHeaderCell>
                  <TableHeaderCell>Innehåll</TableHeaderCell>
                  {canWrite ? <TableHeaderCell>Rättelse</TableHeaderCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell numeric header>
                      {formatCount(event.sequence)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={event.type === "EVENT_REVERSED" ? "caution" : "neutral"}>
                          {EVENT_TYPE_LABELS[event.type]}
                        </Badge>
                        {corrected.has(event.id) ? <Badge tone="critical">Rättad</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(event.effectiveDate)}</TableCell>
                    <TableCell muted>{formatTimestamp(event.registeredAt)}</TableCell>
                    <TableCell>{eventSummary(event, data)}</TableCell>
                    {canWrite ? (
                      <TableCell>
                        {correctionEventIds.has(event.id) ? (
                          <Link
                            className="text-accent-ink underline underline-offset-2"
                            to={`${basePath}/correction?target=${encodeURIComponent(event.id)}`}
                          >
                            Rätta händelse
                          </Link>
                        ) : null}
                      </TableCell>
                    ) : null}
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

class RangeInputError extends Error {}

class FormInputError extends Error {}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parseShareRange(part: string): ShareRange {
  const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
  if (!match) {
    throw new RangeInputError(`”${part}” är inte ett giltigt aktienummer eller intervall.`);
  }
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  if (![from, to].every(isPositiveSafeInteger)) {
    throw new RangeInputError("Aktienummer måste vara positiva heltal.");
  }
  if (from > to) {
    throw new RangeInputError(`Intervallet ”${part}” har ett slut som är mindre än början.`);
  }
  return { from, to };
}

function parseShareRanges(input: string): ShareRange[] {
  const parts = input
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new RangeInputError("Ange minst ett aktienummer eller intervall.");
  }
  return parts.map(parseShareRange);
}

function requiredFormValue({
  form,
  name,
  label,
}: {
  form: FormData;
  name: string;
  label: string;
}): string {
  const value = String(form.get(name) ?? "").trim();
  if (!value) throw new FormInputError(`${label} måste anges.`);
  return value;
}

function optionalFormValue({ form, name }: { form: FormData; name: string }): string | undefined {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shareholderOptions(data: EventRouteData) {
  return data.shareholders.map((shareholder) => {
    const total = data.currentSnapshot.holdings
      .filter((holding) => holding.shareholderId === shareholder.id)
      .reduce((sum, holding) => sum + rangeCount([holding.range]), 0);
    return {
      value: shareholder.id,
      label: currentShareholderName({ data, shareholderId: shareholder.id }),
      description:
        total > 0
          ? `${formatCount(total)} aktier i aktuell ägarbild`
          : "Inga aktier i aktuell ägarbild",
    };
  });
}

function shareClassOptions(data: EventRouteData) {
  return data.shareClasses.map((shareClass) => {
    const total =
      data.currentSnapshot.totalsByClass.find((entry) => entry.shareClassId === shareClass.id)
        ?.total ?? 0;
    return {
      value: shareClass.id,
      label: shareClass.name,
      description: `${formatDecimal(shareClass.votesPerShare)} röster per aktie · ${formatCount(total)} aktier i aktuell ägarbild`,
    };
  });
}

function eventOptions(data: EventRouteData) {
  return correctionCandidates(data.events).map((event) => ({
    value: event.id,
    label: `#${event.sequence} · ${EVENT_TYPE_LABELS[event.type]} · ${formatDate(event.effectiveDate)}`,
    description: eventSummary(event, data),
  }));
}

function optionalReasonNote(form: FormData): Record<string, string> {
  const reasonNote = optionalFormValue({ form, name: "reasonNote" });
  return reasonNote ? { reasonNote } : {};
}

function optionalSubscriptionPrice(form: FormData): Record<string, unknown> {
  const amount = optionalFormValue({ form, name: "subscriptionAmount" });
  if (!amount) return {};
  const currency =
    optionalFormValue({ form, name: "subscriptionCurrency" })?.toUpperCase() || "SEK";
  return { subscriptionPrice: { amount, currency } };
}

function buildStandardDraft(eventType: StandardEventFormType, form: FormData): ShareEventDraft {
  const effectiveDate = requiredFormValue({
    form,
    name: "effectiveDate",
    label: "Verkningsdatum",
  });

  switch (eventType) {
    case "issuance": {
      return {
        effectiveDate,
        type: "SHARES_ISSUED",
        payload: {
          shareholderId: requiredFormValue({ form, name: "shareholderId", label: "Aktieägare" }),
          shareClassId: requiredFormValue({ form, name: "shareClassId", label: "Aktieslag" }),
          ranges: parseShareRanges(
            requiredFormValue({ form, name: "ranges", label: "Aktienummer" }),
          ),
          ...optionalSubscriptionPrice(form),
        },
      };
    }
    case "transfer": {
      return {
        effectiveDate,
        type: "SHARES_TRANSFERRED",
        payload: {
          transferorId: requiredFormValue({ form, name: "transferorId", label: "Överlåtare" }),
          transfereeId: requiredFormValue({ form, name: "transfereeId", label: "Förvärvare" }),
          shareClassId: requiredFormValue({ form, name: "shareClassId", label: "Aktieslag" }),
          ranges: parseShareRanges(
            requiredFormValue({ form, name: "ranges", label: "Aktienummer" }),
          ),
          reason: requiredFormValue({ form, name: "reason", label: "Anledning" }),
          ...optionalReasonNote(form),
        },
      };
    }
    case "cancellation": {
      return {
        effectiveDate,
        type: "SHARES_CANCELLED",
        payload: {
          shareholderId: requiredFormValue({ form, name: "shareholderId", label: "Aktieägare" }),
          shareClassId: requiredFormValue({ form, name: "shareClassId", label: "Aktieslag" }),
          ranges: parseShareRanges(
            requiredFormValue({ form, name: "ranges", label: "Aktienummer" }),
          ),
          reason: requiredFormValue({ form, name: "reason", label: "Anledning" }),
          ...optionalReasonNote(form),
        },
      };
    }
    case "correction":
      return {
        effectiveDate,
        type: "EVENT_REVERSED",
        payload: {
          targetEventId: requiredFormValue({ form, name: "targetEventId", label: "Händelse" }),
          explanation: requiredFormValue({ form, name: "explanation", label: "Förklaring" }),
        },
      };
  }
}

function RangeField({ error }: { error?: string }) {
  return (
    <Field
      label="Aktienummer"
      description="Separera flera intervall med komma eller ny rad, exempelvis 1-100, 205."
      error={error}
      required
    >
      <Textarea name="ranges" rows={3} required />
    </Field>
  );
}

function StandardEventFields({
  data,
  eventType,
  initialTargetId,
  rangeError,
}: {
  data: EventRouteData;
  eventType: StandardEventFormType;
  initialTargetId?: string;
  rangeError?: string;
}) {
  const holders = shareholderOptions(data);
  const classes = shareClassOptions(data);

  if (eventType === "issuance") {
    return (
      <>
        <Field label="Aktieägare" required>
          <Combobox name="shareholderId" options={holders} required />
        </Field>
        <Field label="Aktieslag" required>
          <Select name="shareClassId" options={classes} required />
        </Field>
        <RangeField error={rangeError} />
        <Field
          label="Teckningskurs"
          description="Valfritt exakt belopp per aktie. Lämna tomt om uppgiften inte ska registreras."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="subscriptionAmount" inputMode="decimal" placeholder="10.50" />
            <Input
              name="subscriptionCurrency"
              defaultValue="SEK"
              maxLength={3}
              aria-label="Valuta"
            />
          </div>
        </Field>
      </>
    );
  }

  if (eventType === "transfer") {
    return (
      <>
        <Field label="Överlåtare" required>
          <Combobox name="transferorId" options={holders} required />
        </Field>
        <Field label="Förvärvare" required>
          <Combobox name="transfereeId" options={holders} required />
        </Field>
        <Field label="Aktieslag" required>
          <Select name="shareClassId" options={classes} required />
        </Field>
        <RangeField error={rangeError} />
        <Field label="Anledning" required>
          <Select name="reason" options={TRANSFER_REASON_OPTIONS} required />
        </Field>
        <Field label="Anteckning" description="Valfri komplettering till anledningen.">
          <Textarea name="reasonNote" />
        </Field>
      </>
    );
  }

  if (eventType === "cancellation") {
    return (
      <>
        <Field label="Nuvarande aktieägare" required>
          <Combobox name="shareholderId" options={holders} required />
        </Field>
        <Field label="Aktieslag" required>
          <Select name="shareClassId" options={classes} required />
        </Field>
        <RangeField error={rangeError} />
        <Field label="Anledning" required>
          <Select name="reason" options={CANCELLATION_REASON_OPTIONS} required />
        </Field>
        <Field label="Anteckning" description="Valfri komplettering till anledningen.">
          <Textarea name="reasonNote" />
        </Field>
      </>
    );
  }

  const targets = eventOptions(data);
  const defaultTarget = targets.some((option) => option.value === initialTargetId)
    ? initialTargetId
    : undefined;
  return (
    <>
      {targets.length === 0 ? (
        <Callout tone="caution" title="Ingen händelse kan rättas">
          Det finns ingen tidigare, fristående händelse som inte redan har rättats.
        </Callout>
      ) : null}
      <Field
        label="Händelse att rätta"
        description="Den ursprungliga händelsen ligger kvar oförändrad i historiken."
        required
      >
        <Combobox
          name="targetEventId"
          options={targets}
          defaultValue={defaultTarget}
          disabled={targets.length === 0}
          required
        />
      </Field>
      <Field label="Förklaring" description="Beskriv varför händelsen ska återföras." required>
        <Textarea name="explanation" required />
      </Field>
    </>
  );
}

function PreviewFacts({ snapshot }: { snapshot: ShareRegisterSnapshot }) {
  return (
    <DescriptionList
      items={[
        { term: "Aktier efter registrering", description: formatCount(snapshotTotal(snapshot)) },
        { term: "Innehavsrader", description: formatCount(snapshot.holdings.length) },
        { term: "Aktieslag", description: formatCount(snapshot.totalsByClass.length) },
      ]}
    />
  );
}

function StandardEventWorkflow({
  data,
  eventType,
  initialTargetId,
}: {
  data: EventRouteData;
  eventType: StandardEventFormType;
  initialTargetId?: string;
}) {
  const navigate = useNavigate();
  const copy = FORM_COPY[eventType];
  const [error, setError] = useState<string>();
  const [rangeError, setRangeError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [appending, setAppending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<ShareEventDraft[]>();
  const [preview, setPreview] = useState<EventMutationResult>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setRangeError(undefined);

    let draft: ShareEventDraft;
    try {
      draft = buildStandardDraft(eventType, new FormData(event.currentTarget));
    } catch (caught) {
      if (caught instanceof RangeInputError) {
        setRangeError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : "Formuläret kunde inte läsas.");
      }
      return;
    }

    setPreviewing(true);
    try {
      const result = await previewEvents({ companyId: data.company.id, drafts: [draft] });
      setPendingDrafts([draft]);
      setPreview(result);
      setConfirmOpen(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (!pendingDrafts) return;
    setAppending(true);
    setError(undefined);
    try {
      await appendEvents({ companyId: data.company.id, drafts: pendingDrafts });
      navigate(`/companies/${data.company.id}/events`);
    } catch (caught) {
      setError(errorMessage(caught));
      setConfirmOpen(false);
    } finally {
      setAppending(false);
    }
  }

  return (
    <>
      <PageHeader title={copy.title} meta={data.company.legalName} />
      <PageBody width="form">
        {error ? (
          <Callout tone="critical" title="Händelsen kunde inte registreras">
            {error}
          </Callout>
        ) : null}
        <Panel title={copy.panelTitle}>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <Field
              label="Verkningsdatum"
              description="Datum då händelsen ska få verkan i aktieboken."
              required
            >
              <DateField name="effectiveDate" defaultValue={today()} required />
            </Field>
            <StandardEventFields
              data={data}
              eventType={eventType}
              initialTargetId={initialTargetId}
              rangeError={rangeError}
            />
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={previewing}>
                {copy.previewLabel}
              </Button>
              <Button
                onClick={() => navigate(`/companies/${data.company.id}/events`)}
                disabled={previewing}
              >
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={copy.confirmTitle}
        description="Händelsen läggs till permanent i den oföränderliga historiken. Den kan bara återföras genom en ny rättelse."
        confirmLabel={copy.confirmLabel}
        tone="danger"
        loading={appending}
        onConfirm={confirm}
      >
        {preview ? <PreviewFacts snapshot={preview.currentSnapshot} /> : null}
      </ConfirmDialog>
    </>
  );
}

type OpeningHoldingRow = {
  id: number;
  shareholderId: string | null;
  shareClassId: string | null;
  rangesInput: string;
  shareholderError?: string;
  shareClassError?: string;
  rangesError?: string;
};

function emptyOpeningRow(id: number): OpeningHoldingRow {
  return { id, shareholderId: null, shareClassId: null, rangesInput: "" };
}

type OpeningHoldingDraft = {
  shareholderId: string;
  shareClassId: string;
  ranges: ShareRange[];
};

function validateOpeningRow(row: OpeningHoldingRow): {
  row: OpeningHoldingRow;
  holding?: OpeningHoldingDraft;
} {
  const shareholderError = row.shareholderId ? undefined : "Välj en aktieägare.";
  const shareClassError = row.shareClassId ? undefined : "Välj ett aktieslag.";
  let rangesError: string | undefined;
  let ranges: ShareRange[] | undefined;
  try {
    ranges = parseShareRanges(row.rangesInput);
  } catch (caught) {
    rangesError = caught instanceof Error ? caught.message : "Aktienumren kunde inte läsas.";
  }
  const validatedRow = { ...row, shareholderError, shareClassError, rangesError };
  if ([shareholderError, shareClassError, rangesError].some(Boolean)) return { row: validatedRow };
  if (!ranges) return { row: validatedRow };
  return {
    row: validatedRow,
    holding: {
      shareholderId: row.shareholderId as string,
      shareClassId: row.shareClassId as string,
      ranges,
    },
  };
}

function openingMetadataError({
  effectiveDate,
  sourceType,
  importNote,
}: {
  effectiveDate: string;
  sourceType: OpeningSource | null;
  importNote: string;
}): string | undefined {
  if (!effectiveDate) return "Verkningsdatum måste anges.";
  if (!sourceType) return "Källtyp måste anges.";
  if (!importNote) return "Importanteckning måste anges.";
  return undefined;
}

function OpeningReview({
  data,
  draft,
  preview,
  previewedAt,
  error,
  appending,
  onBack,
  onConfirm,
}: {
  data: EventRouteData;
  draft: ShareEventDraft;
  preview: EventMutationResult;
  previewedAt: string;
  error?: string;
  appending: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const snapshot = preview.currentSnapshot;
  const payload = draft.payload as {
    sourceType: (typeof SOURCE_OPTIONS)[number]["value"];
    importNote: string;
  };
  const caption = `Förhandsvisad aktiebok per ${snapshot.effectiveOn ?? draft.effectiveDate}, känd vid ${formatTimestamp(previewedAt)}`;

  return (
    <>
      <PageHeader
        title="Granska öppningsbalans"
        meta={`${data.company.legalName} · förhandsvisning, ännu inte registrerad`}
      />
      <PageBody width="form">
        {error ? (
          <Callout tone="critical" title="Öppningsbalansen kunde inte registreras">
            {error}
          </Callout>
        ) : null}
        <Callout tone="caution" title="Kontrollera uppgifterna noggrant">
          Förhandsvisningen har inte ändrat aktieboken. Registrering sker först när du bekräftar.
        </Callout>
        <Panel title="Källa och verkningsdatum">
          <DescriptionList
            items={[
              { term: "Verkningsdatum", description: formatDate(draft.effectiveDate) },
              { term: "Källa", description: SOURCE_LABELS[payload.sourceType] },
              { term: "Anteckning", description: payload.importNote },
            ]}
          />
        </Panel>
        <Panel title="Summor per aktieslag" description={caption} flush>
          <Table caption={caption} captionHidden framed={false}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Aktieslag</TableHeaderCell>
                <TableHeaderCell numeric>Antal aktier</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.totalsByClass.map((total) => (
                <TableRow key={total.shareClassId}>
                  <TableCell header>
                    {shareClassName({ data, shareClassId: total.shareClassId })}
                  </TableCell>
                  <TableCell numeric>{formatCount(total.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <Panel title="Innehav" description={caption} flush>
          <Table caption={caption} captionHidden density="compact" framed={false}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Aktieägare</TableHeaderCell>
                <TableHeaderCell>Aktieslag</TableHeaderCell>
                <TableHeaderCell>Aktienummer</TableHeaderCell>
                <TableHeaderCell numeric>Antal</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.holdings.map((holding) => (
                <TableRow
                  key={`${holding.shareholderId}:${holding.shareClassId}:${holding.range.from}:${holding.range.to}`}
                >
                  <TableCell header>
                    {shareholderName({ data, shareholderId: holding.shareholderId })}
                  </TableCell>
                  <TableCell>
                    {shareClassName({ data, shareClassId: holding.shareClassId })}
                  </TableCell>
                  <TableCell mono>{formatShareRange(holding.range)}</TableCell>
                  <TableCell numeric>{formatCount(rangeCount([holding.range]))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <FormActions align="start">
          <Button variant="danger" loading={appending} onClick={onConfirm}>
            Bekräfta och registrera
          </Button>
          <Button disabled={appending} onClick={onBack}>
            Tillbaka och ändra
          </Button>
        </FormActions>
      </PageBody>
    </>
  );
}

function OpeningEventWorkflow({ data }: { data: EventRouteData }) {
  const navigate = useNavigate();
  const nextRowId = useRef(2);
  const [rows, setRows] = useState<OpeningHoldingRow[]>([emptyOpeningRow(1)]);
  const [error, setError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [appending, setAppending] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ShareEventDraft>();
  const [preview, setPreview] = useState<EventMutationResult>();
  const [previewedAt, setPreviewedAt] = useState<string>();
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [sourceType, setSourceType] = useState<OpeningSource | null>(null);
  const [importNote, setImportNote] = useState("");
  const holders = shareholderOptions(data);
  const classes = shareClassOptions(data);

  function updateRow(id: number, patch: Partial<OpeningHoldingRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, emptyOpeningRow(nextRowId.current)]);
    nextRowId.current += 1;
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const validated = rows.map(validateOpeningRow);
    setRows(validated.map((result) => result.row));
    const holdings = validated.flatMap((result) => (result.holding ? [result.holding] : []));
    if (holdings.length !== rows.length) return;

    const trimmedNote = importNote.trim();
    const metadataError = openingMetadataError({
      effectiveDate,
      sourceType,
      importNote: trimmedNote,
    });
    if (metadataError) {
      setError(metadataError);
      return;
    }
    const draft: ShareEventDraft = {
      effectiveDate,
      type: "OPENING_STATE_IMPORTED",
      payload: { holdings, sourceType, importNote: trimmedNote },
    };

    setPreviewing(true);
    try {
      const result = await previewEvents({ companyId: data.company.id, drafts: [draft] });
      setPendingDraft(draft);
      setPreview(result);
      setPreviewedAt(result.events[0]?.registeredAt ?? new Date().toISOString());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (!pendingDraft) return;
    setAppending(true);
    setError(undefined);
    try {
      await appendEvents({ companyId: data.company.id, drafts: [pendingDraft] });
      navigate(`/companies/${data.company.id}/events`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAppending(false);
    }
  }

  if (pendingDraft && preview && previewedAt) {
    return (
      <OpeningReview
        data={data}
        draft={pendingDraft}
        preview={preview}
        previewedAt={previewedAt}
        error={error}
        appending={appending}
        onBack={() => {
          setPendingDraft(undefined);
          setPreview(undefined);
          setPreviewedAt(undefined);
          setError(undefined);
        }}
        onConfirm={confirm}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Importera öppningsbalans"
        meta={`${data.company.legalName} · verifierad ingående ägarbild`}
      />
      <PageBody width="form">
        {error ? (
          <Callout tone="critical" title="Öppningsbalansen kunde inte förhandsgranskas">
            {error}
          </Callout>
        ) : null}
        <Panel title="Källa">
          <form className="flex flex-col gap-5" onSubmit={review}>
            <Field
              label="Verkningsdatum"
              description="Datum då den verifierade öppningsbalansen gäller."
              required
            >
              <DateField
                name="effectiveDate"
                value={effectiveDate}
                onChange={(change) => setEffectiveDate(change.currentTarget.value)}
                required
              />
            </Field>
            <Field label="Källtyp" required>
              <Select
                name="sourceType"
                options={SOURCE_OPTIONS}
                value={sourceType}
                onValueChange={setSourceType}
                required
              />
            </Field>
            <Field
              label="Importanteckning"
              description="Ange vilket underlag som har kontrollerats."
              required
            >
              <Textarea
                name="importNote"
                value={importNote}
                onChange={(change) => setImportNote(change.currentTarget.value)}
                required
              />
            </Field>

            {rows.map((row, index) => (
              <Fieldset
                key={row.id}
                legend={`Innehav ${index + 1}`}
                description="En aktieägare och ett aktieslag kan omfatta flera intervall."
              >
                <Field label="Aktieägare" error={row.shareholderError} required>
                  <Combobox
                    options={holders}
                    value={row.shareholderId}
                    onValueChange={(shareholderId) =>
                      updateRow(row.id, { shareholderId, shareholderError: undefined })
                    }
                    required
                  />
                </Field>
                <Field label="Aktieslag" error={row.shareClassError} required>
                  <Select
                    options={classes}
                    value={row.shareClassId}
                    onValueChange={(shareClassId) =>
                      updateRow(row.id, { shareClassId, shareClassError: undefined })
                    }
                    required
                  />
                </Field>
                <Field
                  label="Aktienummer"
                  description="Separera flera intervall med komma eller ny rad, exempelvis 1-100, 205."
                  error={row.rangesError}
                  required
                >
                  <Textarea
                    value={row.rangesInput}
                    onChange={(change) =>
                      updateRow(row.id, {
                        rangesInput: change.currentTarget.value,
                        rangesError: undefined,
                      })
                    }
                    required
                  />
                </Field>
                <Button
                  size="sm"
                  onClick={() =>
                    setRows((current) => current.filter((candidate) => candidate.id !== row.id))
                  }
                  disabled={rows.length === 1}
                >
                  Ta bort innehav
                </Button>
              </Fieldset>
            ))}

            <Button size="sm" iconStart={<PlusIcon />} onClick={addRow}>
              Lägg till innehav
            </Button>
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={previewing}>
                Granska öppningsbalans
              </Button>
              <Button
                onClick={() => navigate(`/companies/${data.company.id}/events`)}
                disabled={previewing}
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

export function EventFormRoute() {
  const data = useLoaderData() as EventFormData;
  const [searchParams] = useSearchParams();
  if (data.eventType === "opening") {
    return <OpeningEventWorkflow data={data} />;
  }
  if (isStructuralEventFormType(data.eventType)) {
    return <StructuralEventWorkflow data={data} eventType={data.eventType} />;
  }
  return (
    <StandardEventWorkflow
      data={data}
      eventType={data.eventType}
      initialTargetId={searchParams.get("target") ?? undefined}
    />
  );
}
