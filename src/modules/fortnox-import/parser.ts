import { parseFortnoxDetailedRegister } from "./detailed-register-parser.ts";
import { parseFortnoxEventsHtml } from "./events-html-parser.ts";
import { analyzeImport, assertCompanyMatch } from "./import-analysis.ts";
import { parseFortnoxOwnerOverview } from "./owner-overview-parser.ts";
import {
  type FortnoxDetailedPost,
  type FortnoxOwnerOverview,
  type FortnoxParserInput,
  type ParsedFortnoxImport,
  parsedImportSchema,
  parserInputSchema,
} from "./parser-model.ts";

export { parseFortnoxDetailedRegister } from "./detailed-register-parser.ts";
export { parseFortnoxEventsHtml } from "./events-html-parser.ts";
export { parseFortnoxOwnerOverview } from "./owner-overview-parser.ts";
export {
  type FortnoxCompany,
  type FortnoxDetailedPost,
  type FortnoxEvent,
  type FortnoxImportWarning,
  type FortnoxOwnerOverview,
  FortnoxParseError,
  type FortnoxParserInput,
  type ParsedFortnoxImport,
} from "./parser-model.ts";

function normalizeInline(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function reconcileWrappedOwnerNames(
  posts: readonly FortnoxDetailedPost[],
  overview: FortnoxOwnerOverview,
): readonly FortnoxDetailedPost[] {
  const overviewByIdentifier = new Map(
    overview.owners.map((owner) => [owner.identifier, normalizeInline(owner.name)]),
  );
  return posts.map((post) => {
    const overviewName = overviewByIdentifier.get(post.owner.identifier);
    if (!overviewName || normalizeInline(post.owner.name) === overviewName) return post;

    let detailedName = post.owner.name;
    let consumedAddressLines = 0;
    while (
      normalizeInline(detailedName).length < overviewName.length &&
      consumedAddressLines < post.owner.address.length
    ) {
      detailedName += ` ${post.owner.address[consumedAddressLines]}`;
      consumedAddressLines += 1;
    }
    if (normalizeInline(detailedName) !== overviewName || consumedAddressLines === 0) return post;

    return {
      ...post,
      owner: {
        ...post.owner,
        name: overviewName,
        address: post.owner.address.slice(consumedAddressLines),
      },
    };
  });
}

export function parseFortnoxExport(input: FortnoxParserInput): ParsedFortnoxImport {
  const sources = parserInputSchema.parse(input);
  const detailed = parseFortnoxDetailedRegister(sources.detailedRegisterText);
  const overview = parseFortnoxOwnerOverview(sources.ownerOverviewText);
  const events = parseFortnoxEventsHtml(sources.eventsHtml);
  assertCompanyMatch({ detailed: detailed.company, overview: overview.company });
  const posts = reconcileWrappedOwnerNames(detailed.posts, overview);

  return parsedImportSchema.parse({
    company: detailed.company,
    posts,
    overview,
    events,
    analysis: analyzeImport({ posts, overview, events }),
  });
}

export function parseFortnoxImport(input: FortnoxParserInput): ParsedFortnoxImport {
  return parseFortnoxExport(input);
}
