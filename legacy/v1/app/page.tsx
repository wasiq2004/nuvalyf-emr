import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/lib/auth/guards";

export default async function Home() {
  const session = await auth();
  const role = session?.user?.role;
  redirect(role && role in ROLE_HOME ? ROLE_HOME[role] : "/login");
}
