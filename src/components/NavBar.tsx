"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-ink-700 bg-ink-800/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="inline-block h-7 w-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-700" />
          Escenas Virales <span className="text-slate-400 font-normal">Studio</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="text-slate-300 hover:text-white">
            Inicio
          </Link>
          <Link href="/rankings" className="text-slate-300 hover:text-white">
            Rankings
          </Link>
          <Link href="/gallery" className="text-slate-300 hover:text-white">
            Galería
          </Link>
          <Link href="/settings" className="text-slate-300 hover:text-white">
            Ajustes
          </Link>
          <button onClick={logout} className="text-slate-400 hover:text-white">
            Salir
          </button>
        </nav>
      </div>
    </header>
  );
}
