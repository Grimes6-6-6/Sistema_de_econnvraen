import { requirePageRole } from "@/lib/auth/authorization";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageRole(["OPERADOR", "ADMINISTRADOR"]);
  return children;
}
