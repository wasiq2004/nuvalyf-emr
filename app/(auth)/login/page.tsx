import { redirect } from "next/navigation";
import { AuthLayout, Notice } from "@/components/app/auth-layout";
import { getClinicSession } from "@/lib/auth/clinic-session";
import ClinicLoginForm from "./ClinicLoginForm";

export const metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  suspended: "Your clinic's account has been suspended. Contact your clinic administrator.",
  disabled: "Your account has been disabled. Contact your clinic administrator.",
  expired: "Your session ended because your password or access changed. Please sign in again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const state = await getClinicSession();
  if (state.status === "ok") redirect(state.ctx.home);

  const { reason } = await searchParams;

  return (
    <AuthLayout
      accent="clinic"
      badge="Clinic staff sign-in"
      heading={
        <>
          Your whole clinic,
          <br />
          one place.
        </>
      }
      subheading="Front desk, triage, consultations, pharmacy and billing, each with exactly the access its role needs."
      footnote="Forgot your password? Your clinic administrator can issue a new one."
      title="Sign in"
      description="Use the clinic code your administrator gave you."
    >
      {reason && REASONS[reason] && <Notice>{REASONS[reason]}</Notice>}
      <ClinicLoginForm />
    </AuthLayout>
  );
}
