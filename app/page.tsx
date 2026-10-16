import { redirect } from "next/navigation";
import { getClinicSession } from "@/lib/auth/clinic-session";

export default async function Home() {
  const state = await getClinicSession();
  redirect(state.status === "ok" ? state.ctx.home : "/login");
}
