import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DatabaseProvider } from "@/context/DatabaseContext";
import { LocationProvider } from "@/context/LocationContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECONNVRAE - Gestión de Transporte y Encomiendas VRAEM",
  description: "Sistema Multiplataforma para reservaciones de pasajes y envíos de encomiendas terrestre en la ruta Ayacucho-VRAEM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[#090d16] text-slate-100 antialiased" suppressHydrationWarning>
        {/* Animated Glassmorphism Background Blobs */}
        <div className="ambient-bg">
          <div className="ambient-blob-1"></div>
          <div className="ambient-blob-2"></div>
          <div className="ambient-blob-3"></div>
        </div>

        <DatabaseProvider>
          <LocationProvider>
            <div className="flex-grow flex flex-col relative z-10">
              {children}
            </div>
          </LocationProvider>
        </DatabaseProvider>
      </body>
    </html>
  );
}
