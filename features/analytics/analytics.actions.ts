"use server";

// Every input here is a strict schema: a request carrying any other field
// (a name, mobile number, record number...) is refused before it reaches a
// query.
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, requiredText } from "@/lib/validation";
import { cohortDefinitionSchema } from "./analytics-rules";
import { archiveCohort, createCohort, minCell, runCohort, updateCohort } from "./analytics.service";

const cohortFields = {
  name: requiredText(200, "A name"),
  purpose: z.string({ message: "State the purpose" }).trim().min(20, "Describe the purpose in a sentence (at least 20 characters)").max(2000),
  definition: cohortDefinitionSchema,
};

export const createCohortAction = clinicAction(
  { name: "analytics.createCohort", permission: "analytics:manage", module: "analytics", schema: z.object(cohortFields).strict() },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await createCohort(tx, session.clinicId, input, session.userId);
      await audit(tx, { action: "ANALYTICS_COHORT_CREATED", targetType: "cohort", targetId: row.id, details: { name: input.name, purpose: input.purpose } });
      return row;
    }),
);

export const updateCohortAction = clinicAction(
  { name: "analytics.updateCohort", permission: "analytics:manage", module: "analytics", schema: z.object({ id: idField, ...cohortFields }).strict() },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const result = await updateCohort(tx, id, values);
      await audit(tx, { action: "ANALYTICS_COHORT_UPDATED", targetType: "cohort", targetId: id, details: { version: result.version, purpose: values.purpose } });
      return result;
    }),
);

export const archiveCohortAction = clinicAction(
  { name: "analytics.archiveCohort", permission: "analytics:manage", module: "analytics", schema: z.object({ id: idField }).strict() },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      await archiveCohort(tx, input.id);
      await audit(tx, { action: "ANALYTICS_COHORT_ARCHIVED", targetType: "cohort", targetId: input.id });
    }),
);

export const runCohortAction = clinicAction(
  { name: "analytics.runCohort", permission: "analytics:read", module: "analytics", schema: z.object({ id: idField }).strict() },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await runCohort(tx, session.clinicId, input.id, session.userId, await minCell(tx, session.clinicId));
      await audit(tx, { action: "ANALYTICS_COHORT_RUN", targetType: "cohort", targetId: input.id, details: { version: result.version, size: result.size } });
      return result;
    }),
);
