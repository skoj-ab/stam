import { z } from "zod";
import type { DatabaseContext } from "../../db/database.ts";
import {
  createShareRegisterSnapshot,
  effectiveDateSchema,
  registeredAtSchema,
  type ShareRegisterSnapshot,
} from "../../domain/share-register/index.ts";
import { loadShareRegister } from "../share-register/index.ts";

export const historicalSnapshotQuerySchema = z
  .object({
    effectiveOn: effectiveDateSchema.optional(),
    knownAt: registeredAtSchema.optional(),
  })
  .strict();

export type HistoricalSnapshotQuery = z.input<typeof historicalSnapshotQuerySchema>;

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getCurrentShareRegisterSnapshot(
  database: DatabaseContext,
  companyId: string,
): ShareRegisterSnapshot {
  const register = loadShareRegister(database, companyId);
  return createShareRegisterSnapshot({ ...register, effectiveOn: utcToday() });
}

export function getHistoricalShareRegisterSnapshot(
  database: DatabaseContext,
  companyId: string,
  query: HistoricalSnapshotQuery,
): ShareRegisterSnapshot {
  const cutoffs = historicalSnapshotQuerySchema.parse(query);
  const register = loadShareRegister(database, companyId);
  return createShareRegisterSnapshot({ ...register, ...cutoffs });
}
