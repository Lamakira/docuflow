/**
 * signingKeys.ts — how a desktop access-token signing key is written, and the
 * one place that spelling is understood.
 *
 * `<key-id>:<secret>`: an id naming the key, then the secret itself. The id is
 * not a secret — it rides in the header of every token that key signs, which is
 * what lets a verifier pick the right key while two are in circulation.
 *
 * Nothing here reads the environment. `server/config.ts` does that and hands the
 * raw value over, which is what lets the test harness split a key by exactly the
 * server's rules rather than by its own — a second implementation of this format
 * is a second thing to keep true.
 */

/** One HMAC key the desktop agent's access tokens are signed and checked with. */
export interface SigningKey {
  id: string;
  secret: string;
}

/** Short and printable: the id has to survive a JWT header intact. */
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The floor under a secret's length. `openssl rand -hex 32` — what `.env.example`
 * asks for — is 64 characters, so this refuses only values nobody generated. The
 * id is validated strictly; the secret is the half that actually holds the door,
 * and would be the wrong one to be lenient about.
 */
export const MIN_SECRET_LENGTH = 32;

/**
 * A written key, split into its two halves, or an error naming the variable it
 * came from. Splits on the first colon, so a secret containing one survives.
 */
export function parseSigningKey(name: string, raw: string): SigningKey {
  const separator = raw.indexOf(":");
  const id = separator > 0 ? raw.slice(0, separator) : "";
  const secret = separator > 0 ? raw.slice(separator + 1) : "";

  if (!ID_PATTERN.test(id) || secret.length === 0) {
    throw new Error(
      `${name} must be written as <key-id>:<secret> — an id of letters, digits, ` +
        `'.', '-' or '_' naming the key, a colon, then the secret. Carrying the id ` +
        `with the secret is what keeps the two from being rotated apart.`
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} names a secret of ${secret.length} characters; ${MIN_SECRET_LENGTH} is the ` +
        `minimum. The secret is the whole of what separates a stranger from a token ` +
        `this deployment will honour — generate it, e.g. openssl rand -hex 32.`
    );
  }

  return { id, secret };
}
