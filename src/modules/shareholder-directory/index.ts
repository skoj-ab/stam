import type { DatabaseContext } from "../../db/database.ts";
import type { Shareholder, ShareholderDetails } from "../../domain/share-register/index.ts";
import { listCompanies, requireCompany } from "../companies/index.ts";
import { NotFoundError } from "../errors.ts";
import { getCurrentShareRegisterSnapshot } from "../projections/index.ts";
import { getShareholder, listShareholders } from "../shareholders/index.ts";

export type ShareholderCopyCandidate = Readonly<{
  sourceCompany: Readonly<{
    id: string;
    legalName: string;
    registrationValue: string;
  }>;
  sourceShareholderId: string;
  kind: Shareholder["kind"];
  identifierCountryCode: Shareholder["identifierCountryCode"];
  identifierScheme: Shareholder["identifierScheme"];
  identifierValue: string;
  details: ShareholderDetails;
}>;

export type ShareholderCompanyMatch = Readonly<{
  company: Readonly<{
    id: string;
    legalName: string;
    registrationValue: string;
  }>;
  shareholderId: string;
  details: ShareholderDetails;
}>;

function identifierKey(
  shareholder: Pick<Shareholder, "identifierCountryCode" | "identifierScheme" | "identifierValue">,
): string {
  return [
    shareholder.identifierCountryCode,
    shareholder.identifierScheme,
    shareholder.identifierValue,
  ].join(":");
}

export function listShareholderCopyCandidates(
  database: DatabaseContext,
  targetCompanyId: string,
): readonly ShareholderCopyCandidate[] {
  requireCompany(database, targetCompanyId);
  const existingIdentifiers = new Set(
    listShareholders(database, targetCompanyId).map(identifierKey),
  );
  const candidates = listCompanies(database)
    .filter(({ id }) => id !== targetCompanyId)
    .flatMap((company) => {
      const details = new Map(
        getCurrentShareRegisterSnapshot(database, company.id).shareholderDetails.map((entry) => [
          entry.shareholderId,
          entry.details,
        ]),
      );
      return listShareholders(database, company.id).flatMap((shareholder) => {
        const currentDetails = details.get(shareholder.id);
        if (!currentDetails || existingIdentifiers.has(identifierKey(shareholder))) return [];
        return [
          Object.freeze({
            sourceCompany: Object.freeze({
              id: company.id,
              legalName: company.legalName,
              registrationValue: company.registrationValue,
            }),
            sourceShareholderId: shareholder.id,
            kind: shareholder.kind,
            identifierCountryCode: shareholder.identifierCountryCode,
            identifierScheme: shareholder.identifierScheme,
            identifierValue: shareholder.identifierValue,
            details: currentDetails,
          }),
        ];
      });
    })
    .sort(
      (left, right) =>
        left.sourceCompany.legalName.localeCompare(right.sourceCompany.legalName, "sv") ||
        left.details.legalName.localeCompare(right.details.legalName, "sv") ||
        left.identifierValue.localeCompare(right.identifierValue),
    );
  return Object.freeze(candidates);
}

export function listShareholderCompanyMatches(
  database: DatabaseContext,
  anchorCompanyId: string,
  anchorShareholderId: string,
): readonly ShareholderCompanyMatch[] {
  const anchor = getShareholder(database, anchorShareholderId);
  if (!anchor || anchor.companyId !== anchorCompanyId) {
    throw new NotFoundError(`Shareholder not found in company: ${anchorShareholderId}`);
  }
  const key = identifierKey(anchor);
  const matches = listCompanies(database).flatMap((company) => {
    const shareholder = listShareholders(database, company.id).find(
      (candidate) => identifierKey(candidate) === key,
    );
    if (!shareholder) return [];
    const details =
      getCurrentShareRegisterSnapshot(database, company.id).shareholderDetails.find(
        (entry) => entry.shareholderId === shareholder.id,
      )?.details ?? shareholder.initialDetails;
    return [
      Object.freeze({
        company: Object.freeze({
          id: company.id,
          legalName: company.legalName,
          registrationValue: company.registrationValue,
        }),
        shareholderId: shareholder.id,
        details,
      }),
    ];
  });
  return Object.freeze(matches);
}
