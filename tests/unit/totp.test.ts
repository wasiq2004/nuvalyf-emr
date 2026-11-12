// Two-step sign-in codes, checked against the standard's own test vectors.
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecoveryCode, hotp, newRecoveryCodes, newTotpSecret, otpauthUri, totpCode, consumeRecoveryCode, verifyTotp } from "@/lib/auth/totp";

// RFC 6238 appendix B: SHA-1 secret "12345678901234567890". The RFC lists 8
// digits; the last 6 are what a 6-digit authenticator shows.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
] as const;

describe("TOTP", () => {
  it("matches every RFC 6238 test vector", () => {
    for (const [seconds, eight] of RFC) {
      expect(hotp(base32Decode(RFC_SECRET), Math.floor(seconds / 30), 8)).toBe(eight);
      expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(eight.slice(-6));
    }
  });

  it("matches the RFC 4226 HOTP test vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(Buffer.from("12345678901234567890"), counter)).toBe(code));
  });

  it("round-trips base32, and makes 160-bit secrets", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI"); // RFC 4648
  });

  it("accepts the current code and one step of clock drift either side, no more", () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), now, null)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now, null)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now, null)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now, null)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 90_000), now, null)).toBeNull();
  });

  it("refuses a code once used, so it cannot be replayed", () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = verifyTotp(secret, totpCode(secret, now), now, null)!;
    expect(verifyTotp(secret, totpCode(secret, now), now, step)).toBeNull();
  });

  it("refuses anything but six digits, and another account's code", () => {
    const now = 1_800_000_000_000;
    const a = newTotpSecret();
    const b = newTotpSecret();
    expect(verifyTotp(a, "12345", now, null)).toBeNull();
    expect(verifyTotp(a, "abcdef", now, null)).toBeNull();
    expect(verifyTotp(a, totpCode(b, now), now, null)).toBeNull();
  });

  it("builds the link an authenticator app opens", () => {
    const uri = otpauthUri("NuvaLyf", "dr.rao@clinic.in", "JBSWY3DPEHPK3PXP");
    expect(uri).toBe("otpauth://totp/NuvaLyf%3Adr.rao%40clinic.in?secret=JBSWY3DPEHPK3PXP&issuer=NuvaLyf&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes", () => {
  it("are ten distinct codes, each usable exactly once, typed loosely", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const hashes = codes.map(hashRecoveryCode);
    const left = consumeRecoveryCode(hashes, codes[3].toLowerCase().replace("-", " "));
    expect(left).toHaveLength(9);
    expect(consumeRecoveryCode(left!, codes[3])).toBeNull();
    expect(consumeRecoveryCode(hashes, "AAAAA-AAAAA")).toBeNull();
  });

  it("are stored as hashes, never as the codes", () => {
    const [code] = newRecoveryCodes(1);
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(code)).not.toContain(code.replace("-", ""));
  });
});
