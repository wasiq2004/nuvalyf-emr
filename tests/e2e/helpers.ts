import { expect, type Page } from "@playwright/test";
import dotenv from "dotenv";
import postgres from "postgres";
import { databaseSsl } from "../../lib/db/ssl";
import { totpCode, totpStep } from "../../lib/auth/totp";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

/** Two-step secrets set up during this run, and the last time step each used. */
const secrets = new Map<string, { secret: string; lastStep: number }>();

/** A fresh code: waits for the next 30-second step if this one was already used. */
async function freshCode(email: string): Promise<string> {
  const entry = secrets.get(email)!;
  while (totpStep(Date.now()) <= entry.lastStep) await new Promise((r) => setTimeout(r, 500));
  entry.lastStep = totpStep(Date.now());
  return totpCode(entry.secret, Date.now());
}

/** Sets up two-step sign-in on the setup page, as a person with an authenticator app would. */
export async function enrolTwoStep(page: Page, email: string, landing: string) {
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  const secret = (await page.getByLabel("Setup key").innerText()).replace(/\s/g, "");
  secrets.set(email, { secret, lastStep: totpStep(Date.now()) });
  await page.getByLabel("2. Enter the 6-digit code it now shows").fill(totpCode(secret, Date.now()));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByText("Shown once.")).toBeVisible();
  await page.getByLabel("I have saved these codes").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(landing);
}

/** The seeded Super Admin's two-step setup from an earlier run is unknown to this one: start it afresh. */
async function clearOperatorTwoStep(email: string) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) return;
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: databaseSsl(url) });
  try {
    await sql`update platform.operators set mfa_secret = null, mfa_pending_secret = null, mfa_enabled_at = null, mfa_last_step = null, mfa_recovery_hashes = '[]'::jsonb where lower(email) = ${email.toLowerCase()}`;
  } finally {
    await sql.end();
  }
}

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.PLATFORM_ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.PLATFORM_ADMIN_PASSWORD ?? "";

export async function operatorSignIn(page: Page) {
  expect(ADMIN_EMAIL, "Set E2E_ADMIN_EMAIL / PLATFORM_ADMIN_EMAIL").not.toBe("");
  if (!secrets.has(ADMIN_EMAIL)) await clearOperatorTwoStep(ADMIN_EMAIL);
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  if (secrets.has(ADMIN_EMAIL)) {
    // Every operator uses two-step sign-in: the code box appears after the password.
    await page.getByLabel("Code from your authenticator app").fill(await freshCode(ADMIN_EMAIL));
    await page.getByRole("button", { name: "Sign in to console" }).click();
    await page.waitForURL("**/platform");
    return;
  }
  await page.waitForURL("**/platform/account/two-step");
  await enrolTwoStep(page, ADMIN_EMAIL, "**/platform");
}

/** Signs a clinic user in with a one-time password and sets a permanent one. */
export async function clinicFirstSignIn(
  page: Page,
  clinicCode: string,
  email: string,
  oneTimePassword: string,
  newPassword: string,
  landing = "**/today",
) {
  await page.goto("/login");
  await page.getByLabel("Clinic code").fill(clinicCode);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(oneTimePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/change-password");
  await page.getByLabel("Current password").fill(oneTimePassword);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  // Clinic Admins must set up two-step sign-in before anything else opens. The
  // browser passes through the home page on its way there, so let it settle first.
  await page.waitForURL((url) => url.pathname !== "/change-password");
  await page.waitForLoadState("networkidle");
  if (new URL(page.url()).pathname === "/two-step") await enrolTwoStep(page, email, landing);
  else await page.waitForURL(landing);
}

export async function readOneTimePassword(page: Page): Promise<string> {
  await expect(page.getByText("Shown once")).toBeVisible();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByRole("button", { name: "I have saved it" }).click();
  return secret;
}
