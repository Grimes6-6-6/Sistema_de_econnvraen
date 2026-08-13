import { requirePageRole } from "@/lib/auth/authorization";

export default async function ConductorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageRole(["CONDUCTOR", "ADMINISTRADOR"]);
  return children;
}
