import { useState } from "react";
import { AppShell, navLinkClass, PageBody, PageHeader, PageSection } from "../layout";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  ChevronDownIcon,
  Combobox,
  ConfirmDialog,
  DateField,
  DescriptionList,
  Dialog,
  EmptyState,
  Field,
  Fieldset,
  FilterBar,
  FilterChip,
  FormActions,
  formatCount,
  formatShareRange,
  formatTimestamp,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  Pagination,
  Panel,
  PlusIcon,
  RadioGroup,
  SearchField,
  Select,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
  TabPanel,
  Tabs,
  Text,
  Textarea,
  Toolbar,
  Tooltip,
  useTheme,
} from "../ui";

/*
 * The living reference for the Stam design system. Every component appears
 * here in the states a reviewer needs to see; if a component is not on this
 * page it is not finished.
 *
 * Run `bun run dev` and open http://localhost:5174/design.
 */

const SHARE_CLASSES = [
  { value: "a", label: "Serie A", description: "1 röst per aktie" },
  { value: "b", label: "Serie B", description: "0,1 röst per aktie" },
] as const;

const SHAREHOLDERS = [
  { value: "el", label: "Erik Lind", description: "19850101-0000" },
  { value: "sn", label: "Sara Nyberg", description: "19900202-0000" },
  { value: "eh", label: "Exempel Holding AB", description: "556000-0000" },
] as const;

const HOLDINGS = [
  { range: { from: 1, to: 6000 }, owner: "Erik Lind", shareClass: "Serie A", count: 6000 },
  { range: { from: 6001, to: 9000 }, owner: "Sara Nyberg", shareClass: "Serie A", count: 3000 },
  {
    range: { from: 9001, to: 10000 },
    owner: "Exempel Holding AB",
    shareClass: "Serie B",
    count: 1000,
  },
];

export function DesignSystemRoute() {
  return (
    <AppShell
      masthead={
        <Menu
          trigger={
            <Button size="sm" variant="ghost" iconEnd={<ChevronDownIcon size={14} />}>
              Exempelbolaget AB
            </Button>
          }
        >
          <MenuItem>Exempelbolaget AB</MenuItem>
          <MenuItem>Dotterbolaget AB</MenuItem>
          <MenuSeparator />
          <MenuItem iconStart={<PlusIcon size={14} />}>Nytt bolag…</MenuItem>
        </Menu>
      }
      account={
        <Menu
          trigger={
            <Button size="sm" variant="ghost" iconEnd={<ChevronDownIcon size={14} />}>
              Erik
            </Button>
          }
        >
          <MenuItem>Kontoinställningar</MenuItem>
          <MenuItem>Passkeys</MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger">Logga ut</MenuItem>
        </Menu>
      }
      nav={
        <>
          <a href="/design" className={navLinkClass(true)}>
            Designsystem
          </a>
          <a href="/" className={navLinkClass(false)}>
            Applikation
          </a>
        </>
      }
    >
      <PageHeader
        title="Designsystem"
        meta="Referensimplementation · alla komponenter i alla lägen"
        actions={
          <>
            <Button>Sekundär</Button>
            <Button variant="primary" iconStart={<PlusIcon size={14} />}>
              Primär åtgärd
            </Button>
          </>
        }
      />
      <PageBody>
        <FoundationSection />
        <ActionSection />
        <FormSection />
        <DataSection />
        <FeedbackSection />
        <OverlaySection />
      </PageBody>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-rule-subtle py-3 last:border-b-0">
      <span className="w-40 shrink-0 text-2xs font-semibold text-ink-subtle uppercase">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function FoundationSection() {
  const { preference, resolved, setPreference } = useTheme();
  const swatches: Array<[string, string]> = [
    ["paper", "bg-paper"],
    ["surface", "bg-surface"],
    ["surface-sunken", "bg-surface-sunken"],
    ["surface-hover", "bg-surface-hover"],
    ["surface-active", "bg-surface-active"],
    ["accent", "bg-accent"],
    ["accent-subtle", "bg-accent-subtle"],
    ["positive", "bg-positive"],
    ["caution", "bg-caution"],
    ["critical", "bg-critical"],
    ["ink", "bg-ink"],
    ["ink-muted", "bg-ink-muted"],
    ["ink-subtle", "bg-ink-subtle"],
  ];

  return (
    <PageSection
      title="Grund"
      description="Färg, typografi och tema. Alla värden kommer från styles/tokens.css."
      actions={
        <RadioGroup
          orientation="horizontal"
          value={preference}
          onValueChange={setPreference}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Ljust" },
            { value: "dark", label: "Mörkt" },
          ]}
        />
      }
    >
      <Panel title="Färgtokens" description={`Aktivt tema: ${resolved}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {swatches.map(([name, className]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-10 rounded-sm border border-rule ${className}`} />
              <code className="text-2xs text-ink-muted">{name}</code>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Typografi">
        <div className="flex flex-col gap-3">
          <p className="font-serif text-2xl font-semibold text-ink">
            Aktiebok för Exempelbolaget AB
          </p>
          <p className="font-serif text-xl font-semibold text-ink">Registrerade händelser</p>
          <p className="font-serif text-lg font-semibold text-ink">Aktieslag och röstvärden</p>
          <Separator />
          <Text>Brödtext i Inter, 14 px. Detta är standardstorleken i applikationen.</Text>
          <Text size="sm" tone="muted">
            Sekundär text för beskrivningar och hjälptexter.
          </Text>
          <Text size="xs" tone="subtle">
            Metatext för tidsstämplar och ursprung.
          </Text>
          <div className="flex flex-wrap items-baseline gap-2">
            <Text numeric className="font-mono">
              1 234 567 · 6 001–9 000
            </Text>
            <Text numeric>2026-08-28 14:05</Text>
          </div>
        </div>
      </Panel>
    </PageSection>
  );
}

function ActionSection() {
  const [loading, setLoading] = useState(false);
  return (
    <PageSection title="Åtgärder">
      <Panel>
        <Row label="Varianter">
          <Button variant="primary">Primär</Button>
          <Button variant="secondary">Sekundär</Button>
          <Button variant="ghost">Diskret</Button>
          <Button variant="danger">Destruktiv</Button>
        </Row>
        <Row label="Storlekar">
          <Button size="sm">Liten</Button>
          <Button size="md">Normal</Button>
        </Row>
        <Row label="Lägen">
          <Button disabled>Inaktiverad</Button>
          <Button
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1200);
            }}
          >
            Klicka för laddning
          </Button>
          <Button iconStart={<PlusIcon size={14} />}>Med ikon</Button>
          <Button iconEnd={<ChevronDownIcon size={14} />}>Med chevron</Button>
        </Row>
        <Row label="Ikonknappar">
          <IconButton label="Fler åtgärder" icon={<MoreIcon />} />
          <IconButton label="Fler åtgärder" icon={<MoreIcon />} variant="secondary" />
          <IconButton label="Ta bort" icon={<MoreIcon />} variant="danger" />
          <IconButton label="Liten" icon={<MoreIcon />} size="sm" variant="secondary" />
        </Row>
        <Row label="Meny">
          <Menu trigger={<Button iconEnd={<ChevronDownIcon size={14} />}>Åtgärder</Button>}>
            <MenuItem hint="N">Nyemission…</MenuItem>
            <MenuItem>Överlåtelse…</MenuItem>
            <MenuItem disabled>Makulering… (kräver aktier)</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger">Rätta händelse…</MenuItem>
          </Menu>
        </Row>
        <Row label="Tooltip">
          <Tooltip content="Aktienummer är unika inom bolaget">
            <Button variant="ghost">Hovra här</Button>
          </Tooltip>
        </Row>
      </Panel>
    </PageSection>
  );
}

function FormSection() {
  const [shareClass, setShareClass] = useState<string | null>("a");
  const [holder, setHolder] = useState<string | null>(null);
  const [reason, setReason] = useState("SALE");
  const [showRetired, setShowRetired] = useState(false);

  return (
    <PageSection title="Formulär">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Kontroller">
          <div className="flex flex-col gap-4">
            <Field label="Aktieägare" description="Sök bland registrerade ägare." required>
              <Combobox options={SHAREHOLDERS} value={holder} onValueChange={setHolder} />
            </Field>
            <Field label="Aktieslag" required>
              <Select options={SHARE_CLASSES} value={shareClass} onValueChange={setShareClass} />
            </Field>
            <Field label="Antal aktier" description="Positivt heltal.">
              <Input numeric defaultValue="3000" trailing="st" />
            </Field>
            <Field label="Teckningskurs">
              <Input numeric placeholder="0,00" trailing="kr" />
            </Field>
            <Field label="Verkningsdag" description="Datum då överlåtelsen gäller.">
              <DateField defaultValue="2026-08-28" />
            </Field>
            <Field
              label="Aktienummer"
              error="Intervallet 6 001–9 000 ägs inte av Erik Lind på verkningsdagen."
            >
              <Input defaultValue="6001-9000" />
            </Field>
            <Field label="Anteckning" description="Sparas oföränderligt med händelsen.">
              <Textarea placeholder="Beskriv underlaget för registreringen…" />
            </Field>
            <Field label="Inaktiverat fält" disabled>
              <Input defaultValue="Går inte att ändra" disabled />
            </Field>
          </div>
        </Panel>

        <Panel title="Val och grupper">
          <div className="flex flex-col gap-5">
            <Fieldset legend="Överlåtelseorsak" description="Krävs för varje överlåtelse.">
              <RadioGroup
                value={reason}
                onValueChange={setReason}
                options={[
                  { value: "SALE", label: "Köp" },
                  { value: "GIFT", label: "Gåva" },
                  { value: "INHERITANCE", label: "Arv" },
                  { value: "DIVISION_OF_PROPERTY", label: "Bodelning" },
                  { value: "OTHER", label: "Annat", description: "Kräver en förklaring." },
                ]}
              />
            </Fieldset>
            <Separator />
            <Checkbox
              label="Jag har verifierat underlaget"
              description="Registreringen kan inte ändras i efterhand, bara rättas."
            />
            <Checkbox label="Delvis markerad" indeterminate />
            <Checkbox label="Inaktiverad" disabled />
            <Separator />
            <Switch
              label="Visa makulerade aktier"
              checked={showRetired}
              onCheckedChange={setShowRetired}
            />
            <FormActions>
              <Button>Avbryt</Button>
              <Button variant="primary">Registrera händelse</Button>
            </FormActions>
          </div>
        </Panel>
      </div>
    </PageSection>
  );
}

function DataSection() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const total = HOLDINGS.reduce((sum, holding) => sum + holding.count, 0);

  return (
    <PageSection title="Data">
      <Panel
        title="Aktiebok"
        description="Per 2026-08-28 · känt 2026-08-28 12:00"
        flush
        actions={<Button size="sm">Exportera</Button>}
        footer={
          <Pagination
            page={page}
            pageCount={5}
            onPageChange={setPage}
            totalCount={132}
            pageSize={50}
            className="px-0 py-0"
          />
        }
      >
        <Toolbar>
          <SearchField
            value={query}
            onValueChange={setQuery}
            placeholder="Sök ägare eller aktienummer"
          />
          <FilterBar onClearAll={() => undefined}>
            <FilterChip
              label="Aktieslag"
              value="Serie A"
              onClear={() => undefined}
              onClick={() => undefined}
            />
            <FilterChip label="Ägare" onClick={() => undefined} />
          </FilterBar>
        </Toolbar>
        <Table caption="Aktiebok per 2026-08-28" captionHidden framed={false}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Aktienummer</TableHeaderCell>
              <TableHeaderCell>Ägare</TableHeaderCell>
              <TableHeaderCell>Slag</TableHeaderCell>
              <TableHeaderCell numeric>Antal</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {HOLDINGS.map((holding) => (
              <TableRow key={holding.range.from} interactive>
                <TableCell mono>{formatShareRange(holding.range)}</TableCell>
                <TableCell header>{holding.owner}</TableCell>
                <TableCell>{holding.shareClass}</TableCell>
                <TableCell numeric>{formatCount(holding.count)}</TableCell>
                <TableCell>
                  <Badge tone="positive">Aktiv</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFoot>
            <TableRow>
              <TableCell colSpan={3}>Summa</TableCell>
              <TableCell numeric>{formatCount(total)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFoot>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Bolagsuppgifter">
          <DescriptionList
            items={[
              { term: "Organisationsnummer", description: "556000-0000" },
              { term: "Säte", description: "Stockholm" },
              { term: "Totalt antal aktier", description: formatCount(10000) },
              { term: "Aktieslag", description: "2" },
              { term: "Öppningstillstånd", description: formatTimestamp("2026-01-15T09:12:00Z") },
              { term: "Senaste händelse", description: "#47" },
            ]}
          />
        </Panel>

        <Panel title="Statusmärken">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">Utkast</Badge>
              <Badge tone="accent">Nyemission</Badge>
              <Badge tone="positive">Registrerad</Badge>
              <Badge tone="caution">Backdaterad</Badge>
              <Badge tone="critical">Rättad</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="solid" tone="accent">
                Solid
              </Badge>
              <Badge variant="outline" tone="positive">
                Kontur
              </Badge>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Vyer" flush>
        <div className="px-4 pt-3">
          <Tabs defaultValue="current">
            <TabList>
              <Tab value="current">Aktuell</Tab>
              <Tab value="history">Historik</Tab>
              <Tab value="events">Händelser</Tab>
            </TabList>
            <TabPanel value="current">
              <Text size="sm" tone="muted" className="pb-4">
                Aktuell ägarbild, projicerad från hela händelseströmmen.
              </Text>
            </TabPanel>
            <TabPanel value="history">
              <Text size="sm" tone="muted" className="pb-4">
                Historisk ögonblicksbild med verkningsdag och kännedomstidpunkt.
              </Text>
            </TabPanel>
            <TabPanel value="events">
              <Text size="sm" tone="muted" className="pb-4">
                Oföränderlig händelselogg i sekvensordning.
              </Text>
            </TabPanel>
          </Tabs>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Tomt läge" flush>
          <EmptyState
            title="Inga händelser registrerade"
            description="Bolaget har ännu inget öppningstillstånd. Importera en verifierad utgångspunkt för att börja."
            action={<Button variant="primary">Importera öppningstillstånd</Button>}
          />
        </Panel>
        <Panel title="Laddning">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Spinner label="Laddar" />
              <Text size="sm" tone="muted">
                Spinner för åtgärder som redan har startat.
              </Text>
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
              <Skeleton className="w-3/4" />
            </div>
          </div>
        </Panel>
      </div>
    </PageSection>
  );
}

function FeedbackSection() {
  return (
    <PageSection title="Återkoppling">
      <div className="flex flex-col gap-3">
        <Callout tone="info" title="Historisk vy">
          Du ser aktieboken som den såg ut 2024-06-20. Registreringar efter detta datum visas inte.
        </Callout>
        <Callout tone="positive" title="Händelse registrerad">
          Överlåtelsen av 3 000 aktier har lagts till som händelse #48.
        </Callout>
        <Callout tone="caution" title="Backdaterad händelse">
          Händelsen får verkan före tre senare registreringar. Hela den efterföljande strömmen
          valideras om innan den accepteras.
        </Callout>
        <Callout
          tone="critical"
          title="Registreringen avvisades"
          actions={<Button size="sm">Visa händelse #31</Button>}
        >
          Aktier 6 001–9 000 ägs inte av Erik Lind på verkningsdagen 2024-06-20.
        </Callout>
      </div>
    </PageSection>
  );
}

function OverlaySection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <PageSection title="Överlägg">
      <Panel>
        <Row label="Dialog">
          <Button onClick={() => setDialogOpen(true)}>Öppna formulärdialog</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Öppna bekräftelse
          </Button>
        </Row>
      </Panel>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Nyemission"
        description="Nya aktier tilldelas ett sammanhängande nummerintervall."
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>Avbryt</Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>
              Registrera
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Aktieägare" required>
            <Combobox options={SHAREHOLDERS} />
          </Field>
          <Field label="Aktieslag" required>
            <Select options={SHARE_CLASSES} defaultValue="a" />
          </Field>
          <Field label="Antal aktier" required>
            <Input numeric trailing="st" />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Makulera aktier"
        description="Aktier 9 001–10 000 upphör att existera. Numren återanvänds aldrig. Detta kan bara ångras genom en rättelse."
        confirmLabel="Makulera 1 000 aktier"
        tone="danger"
        onConfirm={() => setConfirmOpen(false)}
      />
    </PageSection>
  );
}
