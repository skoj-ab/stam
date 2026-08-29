import { z } from "zod";
import type { DatabaseContext } from "../../db/database.ts";
import {
  effectiveDateSchema,
  type ShareholderDetails,
  shareholderDetailsSchema,
} from "../../domain/share-register/index.ts";
import { ApplicationConflictError } from "../errors.ts";
import {
  appendShareEventBatches,
  type CompanyShareEventBatchResult,
  previewShareEventBatches,
} from "../share-events/index.ts";
import {
  listShareholderCompanyMatches,
  type ShareholderCompanyMatch,
} from "../shareholder-directory/index.ts";

const nonemptyStringSchema = z.string().trim().min(1);

export const multiCompanyDetailsChangeInputSchema = z
  .object({
    targetCompanyIds: z.array(nonemptyStringSchema).min(1),
    effectiveDate: effectiveDateSchema,
    after: shareholderDetailsSchema,
  })
  .strict()
  .superRefine(({ targetCompanyIds }, context) => {
    if (new Set(targetCompanyIds).size !== targetCompanyIds.length) {
      context.addIssue({
        code: "custom",
        path: ["targetCompanyIds"],
        message: "Target companies must be unique",
      });
    }
  });

export type MultiCompanyDetailsChangeInput = z.input<typeof multiCompanyDetailsChangeInputSchema>;

export type MultiCompanyDetailsChangeResult = Readonly<{
  results: readonly Readonly<{
    company: ShareholderCompanyMatch["company"];
    shareholderId: string;
    events: CompanyShareEventBatchResult["result"]["events"];
  }>[];
}>;

type MultiCompanyDetailsChangeRequest = Readonly<{
  database: DatabaseContext;
  anchorCompanyId: string;
  anchorShareholderId: string;
  input: MultiCompanyDetailsChangeInput;
  registeredBy: string;
}>;

function detailsChangeBatches(
  matches: readonly ShareholderCompanyMatch[],
  targetCompanyIds: readonly string[],
  effectiveDate: string,
  after: ShareholderDetails,
) {
  const byCompanyId = new Map(matches.map((match) => [match.company.id, match]));
  return targetCompanyIds.map((companyId) => {
    const match = byCompanyId.get(companyId);
    if (!match) {
      throw new ApplicationConflictError(`Matching shareholder not found in company: ${companyId}`);
    }
    return {
      match,
      batch: {
        companyId,
        drafts: [
          {
            effectiveDate,
            type: "SHAREHOLDER_DETAILS_CHANGED" as const,
            payload: { shareholderId: match.shareholderId, after },
          },
        ],
      },
    };
  });
}

function changeResult(
  requested: ReturnType<typeof detailsChangeBatches>,
  results: readonly CompanyShareEventBatchResult[],
): MultiCompanyDetailsChangeResult {
  return Object.freeze({
    results: Object.freeze(
      requested.map(({ match }, index) =>
        Object.freeze({
          company: match.company,
          shareholderId: match.shareholderId,
          events: results[index]?.result.events ?? [],
        }),
      ),
    ),
  });
}

function prepareDetailsChange(
  database: DatabaseContext,
  anchorCompanyId: string,
  anchorShareholderId: string,
  input: MultiCompanyDetailsChangeInput,
) {
  const values = multiCompanyDetailsChangeInputSchema.parse(input);
  if (!values.targetCompanyIds.includes(anchorCompanyId)) {
    throw new ApplicationConflictError("The current company must be included in the update");
  }
  const matches = listShareholderCompanyMatches(database, anchorCompanyId, anchorShareholderId);
  return detailsChangeBatches(matches, values.targetCompanyIds, values.effectiveDate, values.after);
}

export function previewMultiCompanyShareholderDetailsChange(
  request: MultiCompanyDetailsChangeRequest,
): MultiCompanyDetailsChangeResult {
  const { database, anchorCompanyId, anchorShareholderId, input, registeredBy } = request;
  const requested = prepareDetailsChange(database, anchorCompanyId, anchorShareholderId, input);
  const results = previewShareEventBatches(
    database,
    requested.map(({ batch }) => batch),
    registeredBy,
  );
  return changeResult(requested, results);
}

export function appendMultiCompanyShareholderDetailsChange(
  request: MultiCompanyDetailsChangeRequest,
): MultiCompanyDetailsChangeResult {
  const { database, anchorCompanyId, anchorShareholderId, input, registeredBy } = request;
  const requested = prepareDetailsChange(database, anchorCompanyId, anchorShareholderId, input);
  const results = appendShareEventBatches(
    database,
    requested.map(({ batch }) => batch),
    registeredBy,
  );
  return changeResult(requested, results);
}
