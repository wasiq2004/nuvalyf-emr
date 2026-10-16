import { describe, expect, it } from "vitest";
import { availableActions, checkAppointmentAction } from "@/features/appointments/appointment.policy";

const now = new Date("2026-10-16T10:00:00Z");
const future = new Date("2026-10-17T10:00:00Z");
const past = new Date("2026-10-15T10:00:00Z");

describe("checkAppointmentAction", () => {
  it("lets a patient cancel their future appointment", () => {
    expect(
      checkAppointmentAction({ actor: "patient", action: "cancel", status: "pending", startsAt: future, now }),
    ).toBeNull();
  });

  it("stops a patient cancelling an appointment that has started", () => {
    expect(
      checkAppointmentAction({ actor: "patient", action: "cancel", status: "confirmed", startsAt: past, now }),
    ).toMatch(/no longer be cancelled/);
  });

  it("stops a patient confirming their own appointment", () => {
    expect(
      checkAppointmentAction({ actor: "patient", action: "confirm", status: "pending", startsAt: future, now }),
    ).not.toBeNull();
  });

  it("only allows completing a confirmed appointment once it has started", () => {
    expect(
      checkAppointmentAction({ actor: "doctor", action: "complete", status: "confirmed", startsAt: past, now }),
    ).toBeNull();
    expect(
      checkAppointmentAction({ actor: "doctor", action: "complete", status: "confirmed", startsAt: future, now }),
    ).toMatch(/once it has started/);
    expect(
      checkAppointmentAction({ actor: "doctor", action: "complete", status: "pending", startsAt: past, now }),
    ).not.toBeNull();
  });

  it("treats completed and cancelled as final", () => {
    for (const status of ["completed", "cancelled"] as const) {
      for (const action of ["confirm", "complete", "cancel"] as const) {
        expect(checkAppointmentAction({ actor: "doctor", action, status, startsAt: future, now })).not.toBeNull();
      }
    }
  });
});

describe("availableActions", () => {
  it("offers a doctor confirm and cancel on a future pending booking", () => {
    expect(availableActions({ actor: "doctor", status: "pending", startsAt: future, now })).toEqual([
      "confirm",
      "cancel",
    ]);
  });

  it("offers a doctor complete and cancel on a past confirmed visit", () => {
    expect(availableActions({ actor: "doctor", status: "confirmed", startsAt: past, now })).toEqual([
      "complete",
      "cancel",
    ]);
  });

  it("offers a patient only cancel", () => {
    expect(availableActions({ actor: "patient", status: "confirmed", startsAt: future, now })).toEqual([
      "cancel",
    ]);
  });
});
