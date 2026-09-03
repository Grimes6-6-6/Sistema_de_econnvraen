import type { Metadata } from "next";
import { Geist_Mono, Roboto } from "next/font/google";
import "./globals.css";
import { DatabaseProvider } from "@/context/DatabaseContext";
import { LocationProvider } from "@/context/LocationContext";
import { FeedbackProvider } from "@/components/ui/FeedbackProvider";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECONNVRAE - Gestión de Transporte y Encomiendas VRAEM",
  description: "Plataforma web empresarial para la gestión de pasajes, viajes, recojos y encomiendas en la ruta Ayacucho-VRAEM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${roboto.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="design-v2 min-h-full flex flex-col antialiased" suppressHydrationWarning>
        <FeedbackProvider>
          <DatabaseProvider>
            <LocationProvider>
              <div className="flex-grow flex flex-col relative z-10">
                {children}
              </div>
            </LocationProvider>
          </DatabaseProvider>
        </FeedbackProvider>
      </body>
    </html>
  );
}
