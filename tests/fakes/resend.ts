/**
 * In-memory stand-in for the `resend` package (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases `resend` here, so `server/email.ts` builds its client
 * from this module. Delivery always succeeds and lands in an inspectable outbox,
 * which is what lets the suites freeze both the response contract (`emailSent`)
 * and the side effect (who was mailed about what).
 */

export interface SentEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

const outbox: SentEmail[] = [];

export class Resend {
  constructor(_apiKey?: string) {}

  emails = {
    send: async (payload: { from: string; to: string; subject: string; html?: string }) => {
      outbox.push({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html ?? "",
      });
      return { data: { id: `fake-email-${outbox.length}` }, error: null };
    },
  };
}

// ─── Test control surface ───

/** Every email the server handed to Resend, in send order. */
export function sentEmails(): SentEmail[] {
  return outbox;
}

export function emailsTo(address: string): SentEmail[] {
  return outbox.filter((mail) => mail.to === address);
}

export function resetEmails(): void {
  outbox.length = 0;
}
