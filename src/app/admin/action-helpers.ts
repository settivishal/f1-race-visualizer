import { auth } from '@/auth';

/**
 * The guard every admin Server Action starts with.
 *
 * **Each function calls `requireAdmin` as its first statement, and that is not
 * decoration.** An exported Server Action is reachable by direct POST whether
 * or not anything imports it, and a page-level check does not extend to the
 * actions defined beneath it — Next's own data-security guide says so in those
 * words. The proxy guards navigation to `/admin`; it does not guard this.
 *
 * The failure mode is what makes it worth stating: an action missing its check
 * behaves correctly through the UI forever, because the UI only ever reaches it
 * from a page the proxy already guarded. Nothing surfaces the gap.
 *
 * See docs/decisions.md, "Three guard layers, not two".
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
}

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

/**
 * A resolver error reaches here as a GraphQLError whose message is safe to
 * show — they are written by this codebase, not by a driver. Anything else is
 * reported generically rather than leaking an internal string into the UI.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

/** A form field as a number: NaN when it is missing or not one. */
export function numberField(formData: FormData, name: string): number {
  return Number(String(formData.get(name) ?? '').trim());
}
