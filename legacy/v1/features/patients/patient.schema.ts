import { z } from "zod";
import { nameSchema } from "@/features/auth/auth.schema";

export const patientProfileSchema = z.object({
  first_name: nameSchema,
  last_name: nameSchema,
  gender: z.enum(["male", "female", "other"], { message: "Select a gender" }),
  contact_number: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]{7,20}$/, "Enter a valid phone number"),
  address: z.string().trim().max(500).optional(),
});

export type PatientProfileInput = z.infer<typeof patientProfileSchema>;
