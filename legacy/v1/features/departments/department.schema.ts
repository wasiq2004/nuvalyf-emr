import { z } from "zod";

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(255),
  description: z.string().trim().max(1000).optional(),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;
