"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Stethoscope,
  UserCircle2,
  X,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { updateAppointmentStatusAction } from "@/features/appointments/appointment.actions";
import type { AppointmentAction, AppointmentStatus } from "@/features/appointments/appointment.policy";
import type { AppointmentCardData } from "./types";

type Props = {
  appointments: AppointmentCardData[];
  variant: "patient" | "doctor";
  emptyTitle: string;
  emptyDescription: string;
};

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pending:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  confirmed:
    "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-900",
  completed:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
  cancelled:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
};

const SUCCESS_MESSAGE: Record<AppointmentAction, string> = {
  confirm: "Appointment confirmed",
  complete: "Appointment marked as completed",
  cancel: "Appointment cancelled",
};

export function AppointmentList({ appointments, variant, emptyTitle, emptyDescription }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function runAction(appointmentId: string, action: AppointmentAction) {
    setBusyId(appointmentId);
    const result = await updateAppointmentStatusAction(appointmentId, action);
    setBusyId(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(SUCCESS_MESSAGE[action]);
    startTransition(() => router.refresh());
  }

  if (appointments.length === 0) {
    return (
      <Card className="border-dashed bg-zinc-50/50 dark:bg-zinc-900/50 shadow-none border-zinc-200 dark:border-zinc-800">
        <CardContent className="py-20 text-center flex flex-col items-center">
          <div className="h-14 w-14 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
            <CalendarDays className="h-6 w-6 text-zinc-400" />
          </div>
          <p className="text-lg font-medium text-zinc-700 dark:text-zinc-300">{emptyTitle}</p>
          <p className="text-zinc-500 text-sm mt-1 max-w-sm">{emptyDescription}</p>
        </CardContent>
      </Card>
    );
  }

  const PersonIcon = variant === "patient" ? Stethoscope : UserCircle2;

  return (
    <div className="grid gap-4 mt-6">
      {appointments.map((apt) => {
        const busy = busyId === apt.id;
        const personLabel = variant === "patient" ? `Dr. ${apt.name}` : apt.name;
        const subtitle = variant === "patient" ? apt.department ?? apt.email : apt.email;

        return (
          <Card
            key={apt.id}
            className="group overflow-hidden border-zinc-200 dark:border-zinc-800 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-teal-200 dark:hover:border-teal-900/50 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl"
          >
            <CardContent className="p-0">
              <div className="flex flex-col sm:flex-row">
                {/* Date badge */}
                <div className="bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 p-6 flex sm:flex-col items-center sm:justify-center border-b sm:border-b-0 sm:border-r border-zinc-100 dark:border-zinc-800 min-w-[120px] gap-3 sm:gap-1">
                  <div className="text-center">
                    <p className="text-teal-600 dark:text-teal-400 font-bold text-3xl leading-none">
                      {apt.dayLabel}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400 font-medium text-sm mt-1 uppercase tracking-widest">
                      {apt.monthLabel}
                    </p>
                  </div>
                  <div className="ml-auto sm:ml-0 flex items-center gap-1.5 bg-white dark:bg-zinc-800 px-3 py-1.5 rounded-full shadow-sm sm:mt-3 border border-zinc-100 dark:border-zinc-700">
                    <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      {apt.timeLabel}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 p-6 flex flex-col sm:flex-row justify-between gap-6">
                  <div className="space-y-4 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800/50 flex items-center justify-center shrink-0">
                        <PersonIcon className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 line-clamp-1">
                          {personLabel}
                        </h3>
                        {subtitle && (
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">
                            {subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    {apt.notes && (
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3.5 text-sm border border-zinc-100 dark:border-zinc-800 flex gap-2.5">
                        <FileText className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                        <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                          {apt.notes}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Status & actions */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 shrink-0 border-t sm:border-t-0 pt-4 sm:pt-0 border-zinc-100 dark:border-zinc-800 sm:border-l sm:pl-6">
                    <Badge
                      variant="outline"
                      className={`whitespace-nowrap px-3 py-1 uppercase tracking-wider text-[10px] font-bold ${STATUS_STYLES[apt.status]}`}
                    >
                      {apt.status}
                    </Badge>

                    <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
                      {apt.actions.includes("confirm") && (
                        <Button
                          size="sm"
                          onClick={() => runAction(apt.id, "confirm")}
                          disabled={busy}
                          className="bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900"
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          Confirm
                        </Button>
                      )}

                      {apt.actions.includes("complete") && (
                        <Button
                          size="sm"
                          onClick={() => runAction(apt.id, "complete")}
                          disabled={busy}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <CheckCheck className="w-4 h-4 mr-1.5" />
                          Mark completed
                        </Button>
                      )}

                      {apt.actions.includes("cancel") && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={busy}>
                              <X className="w-4 h-4 mr-1.5" />
                              {busy ? "Working..." : "Cancel"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="max-w-md">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel appointment?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This cancels the appointment with {personLabel} on {apt.fullLabel}.
                                This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep appointment</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => runAction(apt.id, "cancel")}
                                className="bg-red-600 hover:bg-red-700 text-white"
                              >
                                Yes, cancel
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
