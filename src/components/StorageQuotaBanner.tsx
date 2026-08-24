"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface StorageQuotaStatus {
  usedBytes: number;
  warnBytes: number;
  blockBytes: number;
  isWarning: boolean;
  isBlocked: boolean;
}

function formatGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

// Cada cuánto se refresca mientras la pestaña está abierta — el almacenamiento puede crecer
// deprisa mientras se generan shorts, así que conviene que el aviso no se quede desactualizado
// mucho rato sin que el usuario tenga que recargar la página a mano.
const POLL_MS = 60_000;

export default function StorageQuotaBanner() {
  const pathname = usePathname();
  const [status, setStatus] = useState<StorageQuotaStatus | null>(null);

  useEffect(() => {
    if (pathname === "/login") return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/storage/status");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        // si falla la comprobación, no se muestra ningún aviso — nunca debe romper la navegación
      }
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]);

  if (pathname === "/login" || !status || (!status.isWarning && !status.isBlocked)) return null;

  const used = formatGb(status.usedBytes);

  if (status.isBlocked) {
    return (
      <div className="border-b border-red-900 bg-red-950/60 px-4 py-2.5 text-center text-sm text-red-200">
        🚫 <span className="font-semibold">Límite de almacenamiento alcanzado</span> ({used} GB) — no se pueden
        crear shorts nuevos hasta que publiques o borres shorts antiguos de la{" "}
        <a href="/gallery" className="underline hover:text-white">
          galería
        </a>{" "}
        para liberar hueco.
      </div>
    );
  }

  return (
    <div className="border-b border-amber-900 bg-amber-950/50 px-4 py-2.5 text-center text-sm text-amber-200">
      ⚠️ Te falta poco para agotar el límite de almacenamiento gratuito ({used} GB) — publica o borra shorts
      antiguos de la{" "}
      <a href="/gallery" className="underline hover:text-white">
        galería
      </a>{" "}
      pronto para no quedarte sin poder crear más.
    </div>
  );
}
