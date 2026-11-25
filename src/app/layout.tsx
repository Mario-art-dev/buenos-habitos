import type { Metadata } from "next";
import "./globals.css";
import { config } from "@/lib/config";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: `${config.channel.name} Studio — Generador de Shorts Virales`,
  description: "Convierte cualquier vídeo en shorts virales con IA: mejores momentos, títulos, hashtags y publicación automática.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <NavBar />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
