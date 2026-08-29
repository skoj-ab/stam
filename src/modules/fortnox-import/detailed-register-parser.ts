import {
  companySchema,
  detailedPostSchema,
  type FortnoxCompany,
  type FortnoxDetailedPost,
  FortnoxParseError,
  type ParsedFortnoxRegister,
  parsedRegisterSchema,
  previousOwnerSchema,
} from "./parser-model.ts";
import { SourceDocumentParser } from "./source-document-parser.ts";

type PostSection = Readonly<{ source: string; expectedPostNumber: number }>;
type NumberedPostSection = Readonly<{ source: string; postNumber: number }>;
type PostField = NumberedPostSection & Readonly<{ label: string }>;
type CurrencyPostField = Readonly<{
  post: NumberedPostSection;
  label: string;
  pattern: RegExp;
  description: string;
}>;

class DetailedRegisterParser extends SourceDocumentParser<ParsedFortnoxRegister> {
  private readonly text = this.normalizedText();

  parse(): ParsedFortnoxRegister {
    const company = this.parseCompanyHeader();
    const headings = [...this.text.matchAll(/^[ \t]*Aktiepost\s+\d+\s*$/gm)];
    if (headings.length === 0) {
      throw new FortnoxParseError("The detailed register has no posts.");
    }

    const posts = headings.map((heading, index) => {
      if (heading.index === undefined) {
        throw new FortnoxParseError("A post has no source position.");
      }
      return this.parsePost({
        source: this.text.slice(heading.index, headings[index + 1]?.index),
        expectedPostNumber: index + 1,
      });
    });
    return parsedRegisterSchema.parse({ company, posts });
  }

  private parseCompanyHeader(): FortnoxCompany {
    const lines = this.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const headingIndex = lines.indexOf("Aktiebok");
    if (headingIndex < 0) {
      throw new FortnoxParseError("Missing or malformed Aktiebok company header.");
    }
    return companySchema.parse({
      legalName: lines[headingIndex + 1],
      organizationNumber: lines[headingIndex + 2],
      exportDate: lines[headingIndex + 3],
    });
  }

  private parsePost({ source, expectedPostNumber }: PostSection): FortnoxDetailedPost {
    const postNumber = this.parsePostNumber({ source, expectedPostNumber });
    const post = { source, postNumber };
    const ownerLines = this.parseOwnerSection(post);
    if (ownerLines.length < 3) {
      throw new FortnoxParseError(`Post ${postNumber} has an incomplete current owner address.`);
    }

    return detailedPostSchema.parse({
      postNumber,
      ...this.parsePostValues(post),
      owner: {
        identifier: ownerLines[0],
        name: ownerLines[1],
        address: ownerLines.slice(2),
      },
      previousOwners: this.parsePreviousOwners(post),
    });
  }

  private parsePostNumber({ source, expectedPostNumber }: PostSection): number {
    const heading = this.requiredMatch({
      source,
      pattern: /^[ \t]*Aktiepost\s+(\d+)\s*$/m,
      description: "post heading",
    });
    const postNumber = this.parsePositiveInteger({
      source: this.requiredCapture({ match: heading, group: 1, description: "post number" }),
      description: "post number",
    });
    if (postNumber !== expectedPostNumber) {
      throw new FortnoxParseError(
        `Expected Aktiepost ${expectedPostNumber}, found Aktiepost ${postNumber}.`,
      );
    }
    return postNumber;
  }

  private parsePostValues(post: NumberedPostSection) {
    const countAndClass = this.parseCountAndClass(post);
    return {
      range: this.parseRange(post),
      ...countAndClass,
      votes: this.normalizeDecimal({
        source: this.fieldLine({ ...post, label: "Antal röster" }),
        description: `votes for post ${post.postNumber}`,
      }),
      enteredDate: this.fieldLine({ ...post, label: "Infört i aktieboken" }),
      capitalAmount: this.parseCurrencyField({
        post,
        label: "Postens kapitalbelopp",
        pattern: /^(.+?)\s*kr$/,
        description: "capital amount",
      }),
      quotientValue: this.parseCurrencyField({
        post,
        label: "Kvotvärde",
        pattern: /^(.+?)\s*kr\s*\/\s*aktie$/,
        description: "quotient value",
      }),
    };
  }

  private parseRange(post: NumberedPostSection): FortnoxDetailedPost["range"] {
    const match = this.requiredMatch({
      source: this.fieldLine({ ...post, label: "Aktienummer" }),
      pattern: /^([\d\s]+)\s*[-–]\s*([\d\s]+)$/,
      description: `share range for post ${post.postNumber}`,
    });
    return {
      from: this.parsePositiveInteger({
        source: this.requiredCapture({ match, group: 1, description: "range start" }),
        description: "range start",
      }),
      to: this.parsePositiveInteger({
        source: this.requiredCapture({ match, group: 2, description: "range end" }),
        description: "range end",
      }),
    };
  }

  private parseCountAndClass(post: NumberedPostSection) {
    const match = this.requiredMatch({
      source: this.fieldLine({ ...post, label: "Antal aktier" }),
      pattern: /^([\d\s]+)\s+\(([^()]+)\)$/,
      description: `share count and class for post ${post.postNumber}`,
    });
    return {
      count: this.parsePositiveInteger({
        source: this.requiredCapture({ match, group: 1, description: "share count" }),
        description: `share count for post ${post.postNumber}`,
      }),
      shareClass: this.requiredCapture({
        match,
        group: 2,
        description: "share class",
      }),
    };
  }

  private parseCurrencyField({ post, label, pattern, description }: CurrencyPostField): string {
    const match = this.requiredMatch({
      source: this.fieldLine({ ...post, label }),
      pattern,
      description: `${description} for post ${post.postNumber}`,
    });
    return this.normalizeDecimal({
      source: this.requiredCapture({ match, group: 1, description }),
      description: `${description} for post ${post.postNumber}`,
    });
  }

  private fieldLine({ source, label }: PostField): string {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`(?:^|\\n)${escapedLabel}[ \\t]*\\n[ \\t]*([^\\n]+)`));
    if (match) {
      return this.requiredCapture({ match, group: 1, description: label });
    }

    const lines = source.split("\n");
    const headingIndex = lines.findIndex((line) =>
      this.splitColumns({ source: line }).includes(label),
    );
    if (headingIndex < 0) throw new FortnoxParseError(`Missing or malformed ${label}.`);
    const headings = this.splitColumns({ source: lines[headingIndex] ?? "" });
    const valueLine = lines.slice(headingIndex + 1).find((line) => line.trim() !== "");
    if (!valueLine) throw new FortnoxParseError(`Missing value for ${label}.`);
    const values = this.splitColumns({ source: valueLine });
    const value = values[headings.indexOf(label)];
    if (!value) throw new FortnoxParseError(`Missing value for ${label}.`);
    return value;
  }

  private parseOwnerSection({ source, postNumber }: NumberedPostSection): string[] {
    const sequentialSection = source.match(
      /(?:^|\n)[ \t]*Aktieägare[ \t]*\n([\s\S]*?)\n[ \t]*Inlösenförbehåll(?:\n|$)/,
    );
    if (sequentialSection) {
      return this.requiredCapture({
        match: sequentialSection,
        group: 1,
        description: `current owner for post ${postNumber}`,
      })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }

    const lines = source.split("\n");
    const headingIndex = lines.findIndex((line) =>
      this.splitColumns({ source: line }).includes("Aktieägare"),
    );
    if (headingIndex < 0) {
      throw new FortnoxParseError(`Missing current owner for post ${postNumber}.`);
    }
    const ownerLines: string[] = [];
    for (const line of lines.slice(headingIndex + 1)) {
      if (line.trim() === "") {
        if (ownerLines.length > 0) break;
        continue;
      }
      const firstColumn = this.splitColumns({ source: line })[0];
      if (firstColumn) ownerLines.push(firstColumn);
    }
    return ownerLines;
  }

  private parsePreviousOwners({ source, postNumber }: NumberedPostSection) {
    if (/(?:^|\n)[ \t]*Inga tidigare ägare\./.test(source)) return [];

    const sectionMatch = source.match(/(?:^|\n)[ \t]*Tidigare ägare[ \t]*\n([\s\S]*)$/);
    if (!sectionMatch) {
      throw new FortnoxParseError(`Post ${postNumber} has no previous-owner declaration.`);
    }
    const section = this.requiredCapture({
      match: sectionMatch,
      group: 1,
      description: `previous owners for post ${postNumber}`,
    });
    const rows = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => this.isPreviousOwnerRow({ source: line }));
    if (rows.length === 0) {
      throw new FortnoxParseError(`Post ${postNumber} declares previous owners without rows.`);
    }

    return rows.map((row, index) => {
      const match = this.requiredMatch({
        source: row,
        pattern: /^(.+?)\s+\(([^()]+)\)\s+(\d{4}-\d{2}-\d{2})$/,
        description: `previous owner ${index + 1} for post ${postNumber}`,
      });
      return previousOwnerSchema.parse({
        name: this.requiredCapture({
          match,
          group: 1,
          description: "previous owner name",
        }),
        identifier: this.requiredCapture({
          match,
          group: 2,
          description: "previous owner identifier",
        }),
        enteredDate: this.requiredCapture({
          match,
          group: 3,
          description: "previous owner entered date",
        }),
      });
    });
  }

  private isPreviousOwnerRow({ source }: Readonly<{ source: string }>): boolean {
    if (source === "" || this.normalizeInline({ source }) === "Namn Införd") return false;
    if (/^Aktuell aktiebok\b/.test(source)) return false;
    return !/^\d+\(\d+\)$/.test(source);
  }
}

export function parseFortnoxDetailedRegister(source: string): ParsedFortnoxRegister {
  return new DetailedRegisterParser(source).parse();
}
