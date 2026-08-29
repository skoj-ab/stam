import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import {
  appendEvents,
  type Company,
  type EventMutationResult,
  errorMessage,
  getHistoricalSnapshot,
  previewEvents,
  type ShareClass,
  type ShareEventDraft,
  type Shareholder,
  type ShareRegisterSnapshot,
} from "../api/client";
import { PageBody, PageHeader } from "../layout";
import {
  Button,
  Callout,
  ConfirmDialog,
  DateField,
  DescriptionList,
  Field,
  Fieldset,
  FormActions,
  formatCount,
  formatDecimal,
  formatShareRange,
  Input,
  Panel,
  Select,
  Textarea,
} from "../ui";

export const STRUCTURAL_EVENT_FORM_TYPES = ["capital", "split", "renumbering"] as const;
export type StructuralEventFormType = (typeof STRUCTURAL_EVENT_FORM_TYPES)[number];

type StructuralEventData = {
  company: Company;
  shareholders: Shareholder[];
  shareClasses: ShareClass[];
  currentSnapshot: ShareRegisterSnapshot;
};

type ShareRange = ShareRegisterSnapshot["holdings"][number]["range"];

type RenumberingGroup = {
  shareholderId: string;
  shareClassId: string;
  ranges: ShareRange[];
};

type DraftContext = {
  groups: readonly RenumberingGroup[];
  capitalBefore?: ShareRegisterSnapshot["shareCapital"];
};

const CAPITAL_REASONS = [
  { value: "FORMATION", label: "Bildande" },
  { value: "ISSUE", label: "Emission" },
  { value: "BONUS_ISSUE", label: "Fondemission" },
  { value: "REDUCTION", label: "Minskning" },
  { value: "OTHER", label: "Annan ändring" },
] as const;

const COPY: Record<
  StructuralEventFormType,
  { title: string; panelTitle: string; previewLabel: string; confirmLabel: string }
> = {
  capital: {
    title: "Ändra aktiekapital",
    panelTitle: "Nytt aktiekapital",
    previewLabel: "Granska kapitaländring",
    confirmLabel: "Registrera kapitaländring",
  },
  split: {
    title: "Registrera split",
    panelTitle: "Split av samtliga aktier",
    previewLabel: "Granska split",
    confirmLabel: "Registrera split",
  },
  renumbering: {
    title: "Numrera om aktier",
    panelTitle: "Ny fullständig numrering",
    previewLabel: "Granska omnumrering",
    confirmLabel: "Registrera omnumrering",
  },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function requiredValue({
  form,
  name,
  label,
}: {
  form: FormData;
  name: string;
  label: string;
}): string {
  const value = String(form.get(name) ?? "").trim();
  if (!value) throw new Error(`${label} måste anges.`);
  return value;
}

function optionalValue({ form, name }: { form: FormData; name: string }): string | undefined {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function positiveShareNumber({
  value,
  source,
}: {
  value: string | undefined;
  source: string;
}): number {
  if (!value) throw new Error(`”${source}” saknar ett aktienummer.`);
  if (!/^\d+$/.test(value)) throw new Error(`”${source}” innehåller ett ogiltigt aktienummer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`”${source}” innehåller ett för stort aktienummer.`);
  }
  if (number < 1) throw new Error(`”${source}” innehåller ett aktienummer mindre än 1.`);
  return number;
}

function parseRange(value: string): ShareRange {
  const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(value);
  if (!match) throw new Error(`”${value}” är inte ett giltigt aktienummer eller intervall.`);
  const from = positiveShareNumber({ value: match[1], source: value });
  const to = positiveShareNumber({ value: match[2] ?? match[1], source: value });
  if (to < from) {
    throw new Error(`”${value}” är inte ett giltigt positivt aktieintervall.`);
  }
  return { from, to };
}

function parseRanges(value: string): ShareRange[] {
  const parts = value
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Ange minst ett aktienummer eller intervall.");
  return parts.map(parseRange);
}

function renumberingGroups(snapshot: ShareRegisterSnapshot): RenumberingGroup[] {
  const groups = new Map<string, RenumberingGroup>();
  for (const holding of snapshot.holdings) {
    const key = JSON.stringify([holding.shareholderId, holding.shareClassId]);
    const current = groups.get(key);
    if (current) current.ranges.push(holding.range);
    else groups.set(key, { ...holding, ranges: [holding.range] });
  }
  return [...groups.values()];
}

function buildDraft(
  eventType: StructuralEventFormType,
  form: FormData,
  context: DraftContext,
): ShareEventDraft {
  const effectiveDate = requiredValue({ form, name: "effectiveDate", label: "Verkningsdatum" });
  const note = optionalValue({ form, name: "note" });
  if (eventType === "capital") {
    return {
      effectiveDate,
      type: "SHARE_CAPITAL_CHANGED",
      payload: {
        ...(context.capitalBefore ? { before: context.capitalBefore } : {}),
        after: {
          amount: requiredValue({ form, name: "amount", label: "Aktiekapital" }),
          currency: requiredValue({ form, name: "currency", label: "Valuta" }).toUpperCase(),
        },
        reason: requiredValue({ form, name: "reason", label: "Anledning" }),
        ...(note ? { note } : {}),
      },
    };
  }
  if (eventType === "split") {
    const factor = Number(requiredValue({ form, name: "factor", label: "Splitfaktor" }));
    if (!Number.isSafeInteger(factor) || factor < 2) {
      throw new Error("Splitfaktorn måste vara ett heltal på minst 2.");
    }
    return {
      effectiveDate,
      type: "SHARES_SPLIT",
      payload: { factor, ...(note ? { note } : {}) },
    };
  }
  return {
    effectiveDate,
    type: "SHARES_RENUMBERED",
    payload: {
      holdings: context.groups.map((group, index) => ({
        shareholderId: group.shareholderId,
        shareClassId: group.shareClassId,
        ranges: parseRanges(
          requiredValue({ form, name: `ranges:${index}`, label: "Ny numrering" }),
        ),
      })),
      note: requiredValue({ form, name: "note", label: "Anteckning" }),
    },
  };
}

function personName({
  data,
  shareholderId,
}: {
  data: StructuralEventData;
  shareholderId: string;
}): string {
  return (
    data.currentSnapshot.shareholderDetails.find((entry) => entry.shareholderId === shareholderId)
      ?.details.legalName ??
    data.shareholders.find((entry) => entry.id === shareholderId)?.initialDetails.legalName ??
    shareholderId
  );
}

function className({ data, shareClassId }: { data: StructuralEventData; shareClassId: string }) {
  return data.shareClasses.find((entry) => entry.id === shareClassId)?.name ?? shareClassId;
}

function EventFields({
  data,
  eventType,
  groups,
}: {
  data: StructuralEventData;
  eventType: StructuralEventFormType;
  groups: readonly RenumberingGroup[];
}) {
  if (eventType === "capital") {
    const capital = data.currentSnapshot.shareCapital;
    return (
      <>
        {capital ? (
          <Callout tone="info">
            Nuvarande aktiekapital är {formatDecimal(capital.amount)} {capital.currency}.
          </Callout>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nytt aktiekapital" required>
            <Input name="amount" inputMode="decimal" numeric required />
          </Field>
          <Field label="Valuta" required>
            <Input
              name="currency"
              defaultValue={capital?.currency ?? "SEK"}
              maxLength={3}
              required
            />
          </Field>
        </div>
        <Field label="Anledning" required>
          <Select name="reason" options={CAPITAL_REASONS} required />
        </Field>
        <Field label="Anteckning" description="Valfri komplettering till kapitaländringen.">
          <Textarea name="note" />
        </Field>
      </>
    );
  }
  if (eventType === "split") {
    return (
      <>
        <Field
          label="Splitfaktor"
          description="Faktor 2 gör varje befintlig aktie till två och räknar om alla aktienummer."
          required
        >
          <Input name="factor" type="number" min={2} step={1} numeric required />
        </Field>
        <Field label="Anteckning" description="Valfri hänvisning till beslutet.">
          <Textarea name="note" />
        </Field>
      </>
    );
  }
  return (
    <>
      <Callout tone="caution" title="Hela aktieboken måste numreras om">
        Ange den nya fullständiga numreringen. Antalet aktier per ägare och aktieslag får inte
        ändras, och inga nya intervall får överlappa.
      </Callout>
      {groups.map((group, index) => (
        <Fieldset
          key={`${group.shareholderId}:${group.shareClassId}`}
          legend={`${personName({ data, shareholderId: group.shareholderId })} · aktieslag ${className({ data, shareClassId: group.shareClassId })}`}
          description={`Nuvarande nummer: ${group.ranges.map(formatShareRange).join(", ")}`}
        >
          <Field
            label="Nya aktienummer"
            description="Separera flera intervall med komma eller ny rad."
            required
          >
            <Textarea
              name={`ranges:${index}`}
              defaultValue={group.ranges.map(formatShareRange).join(", ")}
              required
            />
          </Field>
        </Fieldset>
      ))}
      <Field label="Anteckning" description="Beskriv beslutet och den nya nummerserien." required>
        <Textarea name="note" required />
      </Field>
    </>
  );
}

function holdingPreviewItems(result: EventMutationResult, data: StructuralEventData) {
  return renumberingGroups(result.currentSnapshot).map((group) => ({
    term: `${personName({ data, shareholderId: group.shareholderId })} · ${className({ data, shareClassId: group.shareClassId })}`,
    description: group.ranges.map(formatShareRange).join(", "),
  }));
}

function eventPreviewItems(result: EventMutationResult) {
  const event = result.events.at(-1);
  if (event?.type === "SHARE_CAPITAL_CHANGED") {
    return [
      {
        term: "Aktiekapital före",
        description: event.payload.before
          ? `${formatDecimal(event.payload.before.amount)} ${event.payload.before.currency}`
          : "Inte tidigare registrerat",
      },
      {
        term: "Aktiekapital efter",
        description: `${formatDecimal(event.payload.after.amount)} ${event.payload.after.currency}`,
      },
    ];
  }
  if (event?.type === "SHARES_SPLIT") {
    return [{ term: "Splitfaktor", description: formatCount(event.payload.factor) }];
  }
  if (event?.type === "SHARES_RENUMBERED") {
    return [{ term: "Anteckning", description: event.payload.note }];
  }
  return [];
}

function previewFacts(result: EventMutationResult, data: StructuralEventData) {
  const total = result.currentSnapshot.totalsByClass.reduce((sum, entry) => sum + entry.total, 0);
  return (
    <DescriptionList
      items={[
        ...eventPreviewItems(result),
        { term: "Aktier efter registrering", description: formatCount(total) },
        { term: "Innehavsrader", description: formatCount(result.currentSnapshot.holdings.length) },
        ...holdingPreviewItems(result, data),
      ]}
    />
  );
}

export function StructuralEventWorkflow({
  data,
  eventType,
}: {
  data: StructuralEventData;
  eventType: StructuralEventFormType;
}) {
  const navigate = useNavigate();
  const copy = COPY[eventType];
  const groups = renumberingGroups(data.currentSnapshot);
  const [error, setError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [appending, setAppending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draft, setDraft] = useState<ShareEventDraft>();
  const [preview, setPreview] = useState<EventMutationResult>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    setPreviewing(true);
    try {
      const effectiveDate = requiredValue({ form, name: "effectiveDate", label: "Verkningsdatum" });
      const capitalBefore =
        eventType === "capital"
          ? (
              await getHistoricalSnapshot({
                companyId: data.company.id,
                effectiveOn: effectiveDate,
              })
            ).shareCapital
          : undefined;
      const candidate = buildDraft(eventType, form, { groups, capitalBefore });
      const result = await previewEvents({ companyId: data.company.id, drafts: [candidate] });
      setDraft(candidate);
      setPreview(result);
      setConfirmOpen(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (!draft) return;
    setAppending(true);
    try {
      await appendEvents({ companyId: data.company.id, drafts: [draft] });
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
        <Callout tone="caution" title="Strukturell händelse kan inte rättas automatiskt">
          Kontrollera förhandsgranskningen noggrant. Händelsen är permanent och stöder inte vanlig
          återföring genom rättelse.
        </Callout>
        {error ? (
          <Callout tone="critical" title="Händelsen kunde inte förhandsgranskas">
            {error}
          </Callout>
        ) : null}
        <Panel title={copy.panelTitle}>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <Field label="Verkningsdatum" required>
              <DateField name="effectiveDate" defaultValue={today()} required />
            </Field>
            <EventFields data={data} eventType={eventType} groups={groups} />
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={previewing}>
                {copy.previewLabel}
              </Button>
              <Button
                type="button"
                disabled={previewing}
                onClick={() => navigate(`/companies/${data.company.id}/events`)}
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
        title={copy.title}
        description="Servern har validerat den fullständiga aktieboken efter händelsen. Registreringen är permanent och kan inte återföras automatiskt."
        confirmLabel={copy.confirmLabel}
        tone="danger"
        loading={appending}
        onConfirm={confirm}
      >
        {preview ? previewFacts(preview, data) : null}
      </ConfirmDialog>
    </>
  );
}
