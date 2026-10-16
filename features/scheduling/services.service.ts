import "server-only";

import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";

export type ServiceInput = {
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
};

export async function listServices(tx: Tx, { activeOnly = false } = {}) {
  const rows = await tx.select().from(services).orderBy(asc(services.name));
  return activeOnly ? rows.filter((s) => s.isActive) : rows;
}

function values(input: ServiceInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    durationMinutes: input.durationMinutes,
    price: input.price.toFixed(2),
    isActive: input.isActive,
  };
}

export async function createService(tx: Tx, clinicId: string, input: ServiceInput) {
  try {
    const [row] = await tx.insert(services).values({ clinicId, ...values(input) }).returning({ id: services.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A service with this name already exists.");
    throw error;
  }
}

export async function updateService(tx: Tx, id: string, input: ServiceInput) {
  try {
    const [row] = await tx
      .update(services)
      .set({ ...values(input), updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning({ id: services.id });
    if (!row) throw new AppError("Service not found.");
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A service with this name already exists.");
    throw error;
  }
}
