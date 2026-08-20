"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/rankings", label: "Rankings" },
  { href: "/split", label: "Cortar en shorts" },
  { href: "/product", label: "Producto" },
  { href: "/song", label: "Canción" },
  { href: "/gallery", label: "Galería" },
  { href: "/settings", label: "Ajustes" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-ink-700 bg-ink-800/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-base sm:text-lg" onClick={() => setMenuOpen(false)}>
          <span className="inline-block h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br from-brand-400 to-brand-700" />
          <span className="whitespace-nowrap">
            Escenas Virales <span className="font-normal text-slate-400">Studio</span>
          </span>
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

        <button
          type="button"
          aria-label="Abrir menú"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 text-slate-200 sm:hidden"
        >
          {menuOpen ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {menuOpen && (
        <nav className="flex flex-col gap-1 border-t border-ink-700 px-4 py-3 text-sm sm:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-2 py-2 text-slate-300 hover:bg-ink-700 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              logout();
            }}
            className="rounded-lg px-2 py-2 text-left text-slate-400 hover:bg-ink-700 hover:text-white"
          >
            Salir
          </button>
        </nav>
      )}
    </header>
  );
}
