/**
 * Secret redaction — one implementation for every read path.
 *
 * Name-based redaction alone is a denylist, and it failed the first time the
 * console met an unfamiliar project: a `<scope>-auth-users` store shipped
 * bcrypt hashes to the browser because no name token matched. So the value
 * shape is the authority and the store name is only a hint.
 */

export const SECRET_KEY_PATTERN =
  /secret|token|password|hash|code|challenge|session|auth|credential/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}/, // bcrypt
  /\$argon2[id]{1,2}\$/, // argon2
  /^\$?pbkdf2[-_$]/i, // pbkdf2
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
];

export const REDACTED = "•••redacted•••";

/**
 * Ancillary stores (one-time codes, sessions, challenges) are usually empty
 * while the block's primary store holds the data, so they sort last — landing
 * on an empty `-codes` table makes a populated block look broken.
 */
const ANCILLARY = /-(codes|sessions|tokens|challenges|cache)$/i;

export function orderStores(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const rank = Number(ANCILLARY.test(a)) - Number(ANCILLARY.test(b));
    return rank !== 0 ? rank : a.length - b.length || a.localeCompare(b);
  });
}

/** True when a serialized value carries a recognizable credential shape. */
export function looksSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/** Mask secret-bearing fields while leaving benign ones (names, dates) readable. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return REDACTED;
  // Elements take the same content check as object fields: mapping redactValue
  // here would hit the unconditional string branch above and mask every benign
  // string in the array, so a `tags` field rendered as rows of bullets.
  if (Array.isArray(value)) return value.map(redactShallow);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactShallow(field);
    }
    return output;
  }
  return value;
}

function redactShallow(value: unknown): unknown {
  if (typeof value === "string") {
    // Content check first: a 60-char bcrypt hash under an innocuous field
    // name would otherwise pass the length test and leak.
    if (looksSecret(value) || value.length > 120) return REDACTED;
    return value;
  }
  if (value !== null && typeof value === "object") return redactValue(value);
  return value;
}
