import SchemaBuilder from '@pothos/core';
import RelayPlugin from '@pothos/plugin-relay';
import type { Context } from './context';

/**
 * Pothos is code-first: the schema is TypeScript that already knows the
 * Drizzle row types, so a column rename becomes a type error rather than a
 * field that silently returns null. Nothing between the Drizzle schema and a
 * component retypes a shape by hand.
 *
 * Only the Relay plugin is registered. Pothos also ships a dataloader plugin
 * that would wire batching automatically — it is deliberately not used. Doing
 * the batching by hand is the milestone (document 04, Part 5); a plugin would
 * produce working code and teach nothing.
 */
export const builder = new SchemaBuilder<{
  Context: Context;
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    // Points are fractional: half points have been awarded for a shortened
    // race, and the fastest-lap era put .5 nowhere but made Float the honest
    // type for a column that is already real.
    Float: { Input: number; Output: number };
  };
}>({
  plugins: [RelayPlugin],
});

builder.queryType({});

builder.scalarType('DateTime', {
  serialize: (value) => value.toISOString(),
  parseValue: (value) => {
    if (typeof value !== 'string') throw new TypeError('DateTime must be a string');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('DateTime is not a valid date');
    return date;
  },
});
