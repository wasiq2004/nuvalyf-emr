// Reusable zod building blocks so every form validates the same way.
import { z } from "zod";
import { isValidTimeZone } from "@/lib/time";

export const emailField = z
  .string({ message: "Email is required" })
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(255));

export const nameField = z.string({ message: "Required" }).trim().min(1, "Required").max(100);

export const requiredText = (max: number, label = "This field") =>
  z.string({ message: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

/** Optional text: empty input becomes undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const optionalEmail = z
  .union([z.literal(""), emailField])
  .optional()
  .transform((v) => (v ? v : undefined));

export const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s\-()]{7,20}$/, "Enter a valid phone number");

export const optionalPhone = z
  .union([z.literal(""), phoneField])
  .optional()
  .transform((v) => (v ? v : undefined));

export const idField = z.uuid("Invalid reference");

export const optionalId = z
  .union([z.literal(""), z.uuid("Invalid reference")])
  .optional()
  .transform((v) => (v ? v : null));

export const timezoneField = z.string().refine(isValidTimeZone, "Choose a valid timezone");

export const clinicCodeField = z
  .string({ message: "Clinic code is required" })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "3-40 characters: lowercase letters, numbers and hyphens");

export const passwordField = (min: number) =>
  z
    .string({ message: "Password is required" })
    .min(min, `Use at least ${min} characters`)
    .max(128, "Use at most 128 characters");

/** Checkbox groups arrive as a string (one ticked) or an array. */
export const stringList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

/** HTML checkbox: "on"/"true" when ticked, absent when not. */
export const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

export function passwordChangeSchema(min: number) {
  return z
    .object({
      currentPassword: z.string({ message: "Enter your current password" }).min(1, "Enter your current password"),
      newPassword: passwordField(min),
      confirmPassword: z.string({ message: "Confirm the new password" }),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    });
}

/** Optional number from a form field: empty becomes null. */
export const optionalNumber = (min: number, max: number, label = "Value") =>
  z
    .union([
      z.literal(""),
      z.coerce
        .number({ message: `${label} must be a number` })
        .min(min, `${label} must be at least ${min}`)
        .max(max, `${label} must be at most ${max}`),
    ])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

export const optionalInt = (min: number, max: number, label = "Value") =>
  z
    .union([
      z.literal(""),
      z.coerce
        .number({ message: `${label} must be a whole number` })
        .int(`${label} must be a whole number`)
        .min(min, `${label} must be at least ${min}`)
        .max(max, `${label} must be at most ${max}`),
    ])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

/** Optional amount of money as a decimal string (never a float). */
export const optionalMoney = z
  .union([z.literal(""), z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 120 or 120.50")])
  .optional()
  .transform((v) => (v ? v : undefined));

/** true/false from a JSON call or a form field. */
export const booleanField = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");
