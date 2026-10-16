// Phase 10 security fixes (from the independent review).
import { describe, expect, it } from "vitest";
import { isValidSessionProof, sessionProof } from "@/lib/auth/session-proof";
import { clientIp } from "@/lib/request";
import { describeError } from "@/lib/errors";
import { cohortDefinitionSchema, monthEnd } from "@/features/analytics/analytics-rules";

describe("session version updates", () => {
  const secret = "test-secret";
  it("accept only a proof minted for this subject and version", () => {
    const proof = sessionProof(secret, "user-1", 4);
    expect(isValidSessionProof(secret, "user-1", 4, proof)).toBe(true);
    expect(isValidSessionProof(secret, "user-1", 5, proof)).toBe(false); // a stolen cookie bumping its own version
    expect(isValidSessionProof(secret, "user-2", 4, proof)).toBe(false);
    expect(isValidSessionProof("other-secret", "user-1", 4, proof)).toBe(false);
    expect(isValidSessionProof(secret, "user-1", 4, undefined)).toBe(false);
    expect(isValidSessionProof(secret, "user-1", "4", proof)).toBe(false);
  });
});

describe("client IP", () => {
  it("reads the entry our proxies appended, ignoring what the client sent", () => {
    // The client forged "1.1.1.1"; our single proxy appended the real address.
    expect(clientIp("1.1.1.1, 203.0.113.7", null, 1)).toBe("203.0.113.7");
    expect(clientIp("9.9.9.9, 203.0.113.7, 10.0.0.2", null, 2)).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7", null, 1)).toBe("203.0.113.7");
    expect(clientIp(null, "198.51.100.4", 1)).toBe("198.51.100.4");
    expect(clientIp("1.1.1.1", "198.51.100.4", 0)).toBe("198.51.100.4");
  });
});

describe("error logging", () => {
  it("never includes query parameters", () => {
    const error = Object.assign(new Error("Failed query: update app.users set password_hash = $1\nparams: $argon2id$v=19$secret,Asha"), {
      cause: { code: "23505", constraint_name: "users_email_key" },
    });
    const text = describeError(error);
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("Asha");
    expect(text).toContain("sqlstate=23505");
    expect(text).toContain("constraint=users_email_key");
  });
});

describe("analytics windows", () => {
  it("are whole months, with ages in 5-year steps", () => {
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2024-02-01")).toBe("2024-02-29");
    expect(cohortDefinitionSchema.safeParse({ from: "2026-01-01", to: "2026-03-31" }).success).toBe(true);
    expect(cohortDefinitionSchema.safeParse({ from: "2026-01-02", to: "2026-03-31" }).success).toBe(false);
    expect(cohortDefinitionSchema.safeParse({ from: "2026-01-01", to: "2026-03-30" }).success).toBe(false);
    expect(cohortDefinitionSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", ageMin: 45, ageMax: 64 }).success).toBe(true);
    expect(cohortDefinitionSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", ageMin: 46 }).success).toBe(false);
    expect(cohortDefinitionSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", ageMax: 45 }).success).toBe(false);
  });
});
