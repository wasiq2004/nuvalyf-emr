import { redirect } from "next/navigation";
import { AuthLayout, Notice } from "@/components/app/auth-layout";
import { getOperatorSession } from "@/lib/auth/platform-session";
import OperatorLoginForm from "./OperatorLoginForm";

export const metadata = { title: "Operations console" };

const REASONS: Record<string, string> = {
  disabled: "This operator account has been disabled.",
  expired: "Your console session ended. Sessions last one hour from sign-in.",
};

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const state = await getOperatorSession();
  if (state.status === "ok") redirect("/platform");
  const { reason } = await searchParams;

  return (
    <AuthLayout
      accent="platform"
      badge="Operations console"
      heading={
        <>
          Run the estate.
          <br />
          Never the records.
        </>
      }
      subheading="Onboard clinics, set their plans and keep them running. This console has no access to patient data of any kind."
      footnote="Console sessions last one hour and are not extended."
      title="Operator sign-in"
      description="Separate from clinic sign-in. A clinic session grants nothing here."
    >
      {reason && REASONS[reason] && <Notice>{REASONS[reason]}</Notice>}
      <OperatorLoginForm />
    </AuthLayout>
  );
}
