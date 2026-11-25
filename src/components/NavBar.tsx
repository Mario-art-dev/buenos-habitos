"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/estudia", label: "Estudia" },
  { href: "/settings", label: "Ajustes" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  if (pathname === "/login" || pathname.startsWith("/estudia")) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-ink-700 bg-ink-800/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/estudia" className="font-bold text-base" onClick={() => setMenuOpen(false)}>
          Estudia
        </Link>
        <nav className="hidden items-center gap-5 text-sm sm:flex">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-slate-300 hover:text-white">
              {link.label}
            </Link>
          ))}
          <button onClick={logout} className="text-slate-400 hover:text-white">
            Salir
          </button>
        </nav>
        <button className="sm:hidden text-2xl px-2" aria-label="Menú" onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
      </div>
      {menuOpen ? (
        <nav className="flex flex-col gap-1 border-t border-ink-700 px-4 py-3 text-sm sm:hidden">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="py-2 text-slate-300">
              {link.label}
            </Link>
          ))}
          <button onClick={logout} className="py-2 text-left text-slate-400">Salir</button>
        </nav>
      ) : null}
    </header>
  );
}
