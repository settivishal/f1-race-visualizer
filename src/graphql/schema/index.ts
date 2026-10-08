import { builder } from '../builder';

// Imported for their side effects: each module registers its types and query
// fields on the shared builder. Order does not matter — Pothos resolves refs
// lazily — but the schema must be built after all of them have run.
import './archive';
import './entity';
import './meeting';
import './mutation';
import './race';
import './race-list';
import './search';
import './standings';

export const schema = builder.toSchema();
