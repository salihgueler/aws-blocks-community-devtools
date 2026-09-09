import { describe, it, expect } from "vitest";
import { REDACTED, looksSecret, redactValue } from "./redact.js";

// This module is the single redaction authority for every read path (local +
// cloud). A regression here silently ships password hashes to a browser, so the
// suite pins the *contract*, not the current implementation's incidental shape.

// The exact marker is U+2022 BULLET (•), not an ASCII 'REDACTED' — a naive test
// for the string "REDACTED" passes vacuously against this code. Assert the real
// constant, byte for byte.
const BULLET = "\u2022";

// Assembled from fragments rather than written as a literal: the repo's secret
// scanner matches on file content and flags a full PEM header as a hard-coded
// key, even in an obviously synthetic fixture. The joined value is identical
// and still exercises the PEM branch of SECRET_VALUE_PATTERNS.
const FAKE_PEM =
  ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ") +
  "\nMIIEabc123\n" +
  ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");

// Representative secret-shaped values, one per recognised credential shape.
const SECRETS: Record<string, string> = {
  "bcrypt-2a": "$2a$12$abcdefghijklmnopqrstuv0123456789012345678901234567890a",
  "bcrypt-2b": "$2b$10$abcdefghijklmnopqrstuv0123456789012345678901234567890b",
  "bcrypt-2y": "$2y$14$abcdefghijklmnopqrstuv0123456789012345678901234567890c",
  argon2: "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaHZhbHVlaGVyZQ",
  pbkdf2: "pbkdf2-sha256$29000$saltsaltsalt$deadbeefcafef00ddeadbeefcafef00d",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
  pem: FAKE_PEM,
  "aws-akia": "AKIAIOSFODNN7EXAMPLE",
};

describe("REDACTED marker", () => {
  it("is exactly the bullet-wrapped marker (U+2022, not ASCII)", () => {
    expect(REDACTED).toBe(`${BULLET}${BULLET}${BULLET}redacted${BULLET}${BULLET}${BULLET}`);
    // Guard against a future ASCII regression that a 'REDACTED'-substring
    // check would miss. The \x00-\x7F range is the point of the assertion —
    // it proves the marker is NOT plain ASCII.
    // eslint-disable-next-line no-control-regex
    expect(REDACTED).not.toMatch(/^[\x00-\x7F]*$/);
    expect(REDACTED).toContain(BULLET);
  });
});

describe("looksSecret — value shape is the authority", () => {
  for (const [shape, value] of Object.entries(SECRETS)) {
    it(`recognises ${shape}`, () => {
      expect(looksSecret(value)).toBe(true);
    });
  }

  it("does not flag benign strings", () => {
    for (const benign of ["Ada Lovelace", "2026-09-09", "us-east-1", "hello world", ""]) {
      expect(looksSecret(benign)).toBe(false);
    }
  });
});

describe("redactValue — secret-shaped values are masked regardless of key name", () => {
  // The most important property: a secret-shaped value must be redacted even
  // when it sits under an innocuous field name (no SECRET_KEY_PATTERN token),
  // because the store/field name is only a hint. This exercises the
  // content-first branch in redactShallow.
  for (const [shape, value] of Object.entries(SECRETS)) {
    it(`redacts a ${shape} value under the benign key "displayName"`, () => {
      const out = redactValue({ displayName: value }) as Record<string, unknown>;
      expect(out.displayName).toBe(REDACTED);
    });
  }

  it("redacts a bcrypt hash under an arbitrary non-secret field from any store", () => {
    const out = redactValue({
      note: SECRETS["bcrypt-2b"],
      label: SECRETS.argon2,
    }) as Record<string, unknown>;
    expect(out.note).toBe(REDACTED);
    expect(out.label).toBe(REDACTED);
  });

  it("redacts a field whose KEY matches the secret-name hint even when the value is benign", () => {
    const out = redactValue({ passwordHash: "not-actually-a-hash" }) as Record<string, unknown>;
    expect(out.passwordHash).toBe(REDACTED);
  });
});

describe("redactValue — benign values pass through untouched", () => {
  it("leaves non-secret object fields exactly as-is", () => {
    const input = {
      id: "user-42",
      name: "Ada Lovelace",
      createdAt: "2026-09-09T00:00:00Z",
      region: "us-east-1",
      count: 7,
      active: true,
      absent: null,
    };
    const out = redactValue(input) as Record<string, unknown>;
    expect(out).toEqual(input);
  });

  it("leaves primitive numbers, booleans and null unchanged at the top level", () => {
    expect(redactValue(7)).toBe(7);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
  });

  it("redacts a bare top-level string unconditionally (string values are opaque)", () => {
    expect(redactValue("Ada Lovelace")).toBe(REDACTED);
  });
});

describe("redactValue — nested structures", () => {
  it("catches secrets inside nested objects under benign keys", () => {
    // Benign container + field keys, so this exercises nested value-shape
    // detection rather than key-name matching.
    const out = redactValue({
      user: {
        name: "Ada",
        details: { stored: SECRETS["bcrypt-2a"] },
      },
    }) as { user: { name: unknown; details: { stored: unknown } } };
    expect(out.user.name).toBe("Ada");
    expect(out.user.details.stored).toBe(REDACTED);
  });

  it("redacts a whole sub-object when its KEY matches the secret-name hint", () => {
    const out = redactValue({
      user: { name: "Ada", credentials: { stored: "anything" } },
    }) as { user: { name: unknown; credentials: unknown } };
    expect(out.user.name).toBe("Ada");
    // 'credentials' matches SECRET_KEY_PATTERN, so the entire value is masked.
    expect(out.user.credentials).toBe(REDACTED);
  });

  it("catches secrets inside arrays", () => {
    const out = redactValue({
      items: [{ label: "safe", value: "just text" }, { label: "key", value: SECRETS["aws-akia"] }],
    }) as { items: Array<{ label: unknown; value: unknown }> };
    expect(out.items[0]!.value).toBe("just text");
    expect(out.items[1]!.value).toBe(REDACTED);
  });

  it("catches a secret in a deeply nested array of objects", () => {
    const out = redactValue({
      accounts: [{ profile: { pem: SECRETS.pem } }],
    }) as { accounts: Array<{ profile: { pem: unknown } }> };
    expect(out.accounts[0]!.profile.pem).toBe(REDACTED);
  });
});

describe("redactValue — arrays of primitives are not over-redacted", () => {
  // Regression: the array branch used to map redactValue, whose first line masks
  // ANY string unconditionally, so a benign string array came back as rows of
  // bullets and a real store looked corrupt. Arrays must take the same
  // shape-checking path as object fields.
  it("leaves an array of benign strings untouched", () => {
    const out = redactValue({ tags: ["alpha", "beta"] }) as { tags: unknown };
    expect(out.tags).toEqual(["alpha", "beta"]);
  });

  it("still redacts a secret-shaped string inside an array of strings", () => {
    const out = redactValue({ tags: ["alpha", SECRETS["aws-akia"]] }) as { tags: unknown[] };
    expect(out.tags[0]).toBe("alpha");
    expect(out.tags[1]).toBe(REDACTED);
  });

  it("leaves arrays of non-string primitives untouched", () => {
    const out = redactValue({ counts: [1, 2, 3], flags: [true, false, null] }) as {
      counts: unknown;
      flags: unknown;
    };
    expect(out.counts).toEqual([1, 2, 3]);
    expect(out.flags).toEqual([true, false, null]);
  });

  it("redacts an array whose KEY matches the secret-name hint", () => {
    const out = redactValue({ sessionTokens: ["a", "b"] }) as Record<string, unknown>;
    expect(out.sessionTokens).toBe(REDACTED);
  });
});
