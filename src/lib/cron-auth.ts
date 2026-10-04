import { timingSafeEqual } from 'node:crypto';

/**
 * A shared secret, not a session — no user is involved in a cron invocation.
 *
 * Compared with `timingSafeEqual` rather than `===`. The difference is small
 * and the attack is impractical over a network, but a string compare that
 * returns early on the first wrong byte is the kind of thing worth not writing
 * in the first place, and it costs one function.
 */
export function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // A missing secret denies everything. It must never mean "no check needed" —
  // that is the same shape as the credential fallback the seed script exists to
  // avoid, and it would leave the endpoint open exactly where it is unset.
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : header;

  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a leak of one
  // bit — the length. Nothing can be done about that without padding, and the
  // length of a secret is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
