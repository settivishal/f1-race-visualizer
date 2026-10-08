import { dataTier, driverStatus, ingestStatus, raceStatus, raceType } from '@/db/schema';
import { builder } from '../builder';

/**
 * The schema's enums, taken from the database's own. A value added to a
 * pgEnum reaches GraphQL with no second list to keep in step.
 */
export const RaceType = builder.enumType('RaceType', { values: raceType.enumValues });
/** What this race's era published. See the `data_tier` enum in db/schema.ts. */
export const DataTier = builder.enumType('DataTier', { values: dataTier.enumValues });
export const DriverStatus = builder.enumType('DriverStatus', { values: driverStatus.enumValues });
export const RaceStatus = builder.enumType('RaceStatus', { values: raceStatus.enumValues });
export const IngestRunStatus = builder.enumType('IngestRunStatus', { values: ingestStatus.enumValues });
