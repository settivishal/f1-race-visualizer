import 'dotenv/config';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';

/**
 * Creates or updates the single admin account.
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm tsx scripts/seed-admin.ts
 *
 * **No credential defaults anywhere.** A missing variable is a failure, not a
 * fallback. The rule comes from the v1 defect it exists to prevent:
 * `feature/supabase` shipped a hardcoded administrator login in
 * `auth.service.ts` with no NODE_ENV guard, so a line that read as a
 * development convenience was a production backdoor.
 *
 * The dangerous shape is a nullish-coalescing fallback on a credential read
 * from the environment. It works locally, it works in CI, and it works in
 * production — which is exactly the problem, because nothing ever fails to
 * draw attention to it. The verification steps grep for that shape, so this
 * comment describes it rather than spelling it, to keep the check free of
 * matches on its own documentation.
 *
 * A plaintext password exists nowhere, including in this file: it arrives in
 * the environment and is hashed before it touches the database.
 */
const ROUNDS = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must both be set. There is no default.',
    );
    process.exit(1);
  }

  // Long enough that a leaked hash is not worth grinding, and short enough to
  // stay inside bcrypt's 72-byte input limit without silent truncation.
  if (password.length < 12) {
    console.error('ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    console.error(
      'ADMIN_PASSWORD must be at most 72 bytes — bcrypt silently ignores anything beyond that.',
    );
    process.exit(1);
  }

  const db = getDb();
  const passwordHash = await hash(password, ROUNDS);

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
    console.log(`updated password for ${email}`);
    return;
  }

  await db.insert(users).values({ email, passwordHash });
  console.log(`created admin ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
