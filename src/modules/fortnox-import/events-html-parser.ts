import { eventSchema, type FortnoxEvent, FortnoxParseError } from "./parser-model.ts";
import { SourceDocumentParser } from "./source-document-parser.ts";

type EventRow = FortnoxEvent & { variant: "desktop" | "mobile" };
type EventMarkup = Readonly<{ source: string; description: string }>;
type EventCopies = Readonly<{
  mobileRows: readonly EventRow[];
  desktopRows: readonly EventRow[];
}>;
type EventLookup = Readonly<{
  mobileRow: FortnoxEvent;
  desktopById: Map<string, EventRow>;
}>;
type EventRowGrammar = Readonly<{
  variant: EventRow["variant"];
  pattern: RegExp;
}>;
type ExtractedEventRow = Readonly<{
  sourceId: string;
  values: readonly string[];
  variant: EventRow["variant"];
}>;

class EventsHtmlParser extends SourceDocumentParser<readonly FortnoxEvent[]> {
  parse(): readonly FortnoxEvent[] {
    const mobileRows = this.parseMobileRows();
    const desktopRows = this.parseDesktopRows();
    if (mobileRows.length === 0 || desktopRows.length === 0) {
      throw new FortnoxParseError(
        "The events HTML must contain both mobile and desktop event rows.",
      );
    }
    return Object.freeze(this.reconcileEventCopies({ mobileRows, desktopRows }));
  }

  private parseMobileRows(): EventRow[] {
    return this.parseRows({
      variant: "mobile",
      pattern: /<ul\b([^>]*class=["'][^"']*\bcards\b[^"']*["'][^>]*)>([\s\S]*?)<\/ul>/gi,
    });
  }

  private parseDesktopRows(): EventRow[] {
    return this.parseRows({
      variant: "desktop",
      pattern:
        /<div\b([^>]*class=["'][^"']*\bdesktop-view-value\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi,
    });
  }

  private parseRows({ variant, pattern }: EventRowGrammar): EventRow[] {
    const rows: EventRow[] = [];
    for (const match of this.source.matchAll(pattern)) {
      const attributes = this.requiredCapture({
        match,
        group: 1,
        description: `${variant} event attributes`,
      });
      const sourceId = this.numericSourceId({ source: attributes, description: variant });
      const values = this.strongValues({
        source: this.requiredCapture({
          match,
          group: 2,
          description: `${variant} event ${sourceId}`,
        }),
        description: `${variant} event ${sourceId}`,
      });
      rows.push(this.parseExtractedRow({ sourceId, values, variant }));
    }
    return rows;
  }

  private parseExtractedRow({ sourceId, values, variant }: ExtractedEventRow): EventRow {
    const labels = [values[0], values[2], values[4]];
    const malformedMobile =
      variant === "mobile" && (values.length !== 6 || labels.join("|") !== "Datum|Typ|Beskrivning");
    const malformedDesktop = variant === "desktop" && values.length !== 3;
    if (malformedMobile || malformedDesktop) {
      throw new FortnoxParseError(`Malformed ${variant} event row ${sourceId}.`);
    }
    const eventValues = variant === "mobile" ? [values[1], values[3], values[5]] : values;
    return {
      ...eventSchema.parse({
        sourceId,
        date: eventValues[0],
        type: eventValues[1],
        description: eventValues[2],
      }),
      variant,
    };
  }

  private numericSourceId({ source, description }: EventMarkup): string {
    const sourceId = this.htmlAttribute({ source, description: "id" });
    if (!sourceId || !/^\d+$/.test(sourceId)) {
      throw new FortnoxParseError(`A ${description} event row has no numeric source ID.`);
    }
    return sourceId;
  }

  private strongValues({ source }: EventMarkup): string[] {
    return [...source.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)].map((match) =>
      this.visibleHtmlText({
        source: this.requiredCapture({ match, group: 1, description: "event value" }),
      }),
    );
  }

  private reconcileEventCopies({ mobileRows, desktopRows }: EventCopies): FortnoxEvent[] {
    const desktopById = this.indexDesktopRows({ desktopRows });
    const events = mobileRows.map(({ variant: _variant, ...mobileRow }) =>
      this.reconcileMobileRow({ mobileRow, desktopById }),
    );
    this.assertAllEventsMatched({ events, desktopById });
    return events;
  }

  private indexDesktopRows({ desktopRows }: Pick<EventCopies, "desktopRows">) {
    const desktopById = new Map<string, EventRow>();
    for (const row of desktopRows) {
      if (desktopById.has(row.sourceId)) {
        throw new FortnoxParseError(`Duplicate desktop event source ID ${row.sourceId}.`);
      }
      desktopById.set(row.sourceId, row);
    }
    return desktopById;
  }

  private reconcileMobileRow({ mobileRow, desktopById }: EventLookup): FortnoxEvent {
    const desktopRow = desktopById.get(mobileRow.sourceId);
    if (!desktopRow) {
      throw new FortnoxParseError(`Event ${mobileRow.sourceId} is missing from the desktop rows.`);
    }
    if (!this.sameEvent({ mobile: mobileRow, desktop: desktopRow })) {
      throw new FortnoxParseError(`Mobile and desktop event ${mobileRow.sourceId} disagree.`);
    }
    desktopById.delete(mobileRow.sourceId);
    return eventSchema.parse(mobileRow);
  }

  private assertAllEventsMatched({
    events,
    desktopById,
  }: Readonly<{
    events: readonly FortnoxEvent[];
    desktopById: ReadonlyMap<string, EventRow>;
  }>): void {
    if (desktopById.size > 0) {
      throw new FortnoxParseError(
        `Event ${desktopById.keys().next().value} is missing from the mobile rows.`,
      );
    }
    if (new Set(events.map((event) => event.sourceId)).size !== events.length) {
      throw new FortnoxParseError("The mobile events contain duplicate source IDs.");
    }
  }

  private sameEvent({
    mobile,
    desktop,
  }: Readonly<{ mobile: FortnoxEvent; desktop: FortnoxEvent }>): boolean {
    return (
      mobile.date === desktop.date &&
      mobile.type === desktop.type &&
      mobile.description === desktop.description
    );
  }
}

export function parseFortnoxEventsHtml(source: string): readonly FortnoxEvent[] {
  return new EventsHtmlParser(source).parse();
}
