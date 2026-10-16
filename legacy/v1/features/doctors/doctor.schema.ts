import { z } from "zod";
import { emailSchema, nameSchema, passwordSchema } from "@/features/auth/auth.schema";

export const createDoctorSchema = z.object({
  first_name: nameSchema,
  last_name: nameSchema,
  email: emailSchema,
  password: passwordSchema,

  specialization: z.string().trim().min(1, "Select a specialization").max(255),
  license_number: z.string().trim().min(1, "License number is required").max(100),
  years_of_experience: z.coerce
    .number({ message: "Enter years of experience" })
    .int("Use whole years")
    .min(0)
    .max(70),

  department_id: z.uuid("Select a department"),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
