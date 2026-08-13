import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  if (user) {
    redirect(user.rol === "CONDUCTOR" ? "/conductor" : "/dashboard");
  }
  return children;
}
