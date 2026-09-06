import { writeFileSync } from 'node:fs';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { schema } from '@/graphql/schema';

/**
 * Writes the built schema to schema.graphql, which is committed.
 *
 * Two reasons it is a file rather than something codegen reads from the
 * TypeScript directly. Codegen's loader does not resolve the "@/" alias, and
 * more usefully: a committed SDL file makes every schema change visible in a
 * diff. Removing a field is then something a reviewer sees, rather than a
 * change that only shows up as a client receiving null later.
 *
 * Sorted, so the diff reflects real changes and not Pothos's registration
 * order.
 */
writeFileSync('schema.graphql', `${printSchema(lexicographicSortSchema(schema))}\n`);
console.log('wrote schema.graphql');
