import { FortnoxParseError, nonemptyStringSchema } from "./parser-model.ts";

const namedHtmlEntities: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  apos: "'",
  aring: "å",
  Aring: "Å",
  auml: "ä",
  Auml: "Ä",
  eacute: "é",
  Eacute: "É",
  gt: ">",
  lt: "<",
  nbsp: " ",
  ouml: "ö",
  Ouml: "Ö",
  quot: '"',
});

type MatchRequest = Readonly<{ source: string; pattern: RegExp; description: string }>;
type CaptureRequest = Readonly<{
  match: RegExpMatchArray;
  group: number;
  description: string;
}>;
type NumericField = Readonly<{ source: string; description: string }>;
type HtmlFragment = Readonly<{ source: string }>;
type SourceLine = Readonly<{ source: string }>;

export abstract class SourceDocumentParser<Result> {
  protected readonly source: string;

  constructor(source: string) {
    this.source = nonemptyStringSchema.parse(source);
  }

  abstract parse(): Result;

  protected normalizedText(): string {
    return this.decodeHtmlEntities({ source: this.source })
      .replace(/\r\n?/g, "\n")
      .replace(/[\u00a0\u202f]/g, " ")
      .trim();
  }

  protected normalizeInline({ source }: SourceLine): string {
    return source.replace(/\s+/g, " ").trim();
  }

  protected normalizeDecimal({ source, description }: NumericField): string {
    const compact = source.replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(compact)) {
      throw new FortnoxParseError(`Malformed decimal for ${description}: ${source}`);
    }
    const [integer = "0", fraction] = compact.split(".");
    const normalizedInteger = integer.replace(/^0+(?=\d)/, "");
    return fraction === undefined ? normalizedInteger : `${normalizedInteger}.${fraction}`;
  }

  protected parsePositiveInteger({ source, description }: NumericField): number {
    const compact = source.replace(/\s/g, "");
    if (!/^\d+$/.test(compact)) {
      throw new FortnoxParseError(`Malformed integer for ${description}: ${source}`);
    }
    const parsed = Number(compact);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new FortnoxParseError(
        `Integer outside the supported range for ${description}: ${source}`,
      );
    }
    return parsed;
  }

  protected requiredMatch({ source, pattern, description }: MatchRequest): RegExpMatchArray {
    const match = source.match(pattern);
    if (!match) throw new FortnoxParseError(`Missing or malformed ${description}.`);
    return match;
  }

  protected requiredCapture({ match, group, description }: CaptureRequest): string {
    const value = match[group];
    if (value === undefined || value.trim() === "") {
      throw new FortnoxParseError(`Missing ${description}.`);
    }
    return value.trim();
  }

  protected splitColumns({ source }: SourceLine): string[] {
    return source
      .trim()
      .split(/\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  protected htmlAttribute({ source, description }: NumericField): string | undefined {
    const match = source.match(new RegExp(`\\b${description}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    return match?.[2];
  }

  protected visibleHtmlText({ source }: HtmlFragment): string {
    return this.decodeHtmlEntities({ source: source.replace(/<[^>]+>/g, "") })
      .replace(/[\u00a0\u202f]/g, " ")
      .trim();
  }

  private decodeHtmlEntities({ source }: HtmlFragment): string {
    return source.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (_entity, encoded: string) => {
      if (encoded.startsWith("#")) return this.decodeNumericHtmlEntity({ source: encoded });
      const decoded = namedHtmlEntities[encoded];
      if (decoded === undefined) {
        throw new FortnoxParseError(`Unsupported HTML entity: &${encoded};`);
      }
      return decoded;
    });
  }

  private decodeNumericHtmlEntity({ source }: HtmlFragment): string {
    const hexadecimal = source.toLowerCase().startsWith("#x");
    const codePoint = Number.parseInt(source.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      throw new FortnoxParseError(`Invalid HTML entity: &${source};`);
    }
  }
}
