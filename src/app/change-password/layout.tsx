import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function ChangePasswordLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) {
    redirect(user.rol === "CONDUCTOR" ? "/conductor" : "/dashboard");
  }
  return children;
}
