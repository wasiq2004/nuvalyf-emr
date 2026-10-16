import { z } from "zod";
import { isValidDateString } from "@/lib/time";
import { optionalEmail, optionalPhone, optionalText } from "@/lib/validation";

export const sexField = z.enum(["male", "female", "other", "unknown"], { message: "Choose sex" });

const optionalDate = z
  .union([z.literal(""), z.string().refine(isValidDateString, "Enter a valid date")])
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalAge = z
  .union([z.literal(""), z.coerce.number().int("Use whole years").min(0).max(130)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

/** Identifying details shared by the duplicate search and registration. */
export const identitySchema = z.object({
  firstName: z.string({ message: "First name is required" }).trim().min(1, "First name is required").max(100),
  lastName: optionalText(100),
  mobile: optionalPhone,
  dateOfBirth: optionalDate,
  statedAgeYears: optionalAge,
});

export const patientSchema = identitySchema
  .extend({
    sex: sexField,
    altPhone: optionalPhone,
    email: optionalEmail,
    addressLine: optionalText(500),
    city: optionalText(100),
  })
  .refine((v) => v.dateOfBirth || v.statedAgeYears !== undefined, {
    message: "Enter a date of birth or an age",
    path: ["dateOfBirth"],
  })
  .refine((v) => !v.dateOfBirth || v.dateOfBirth <= new Date().toISOString().slice(0, 10), {
    message: "Date of birth cannot be in the future",
    path: ["dateOfBirth"],
  });
