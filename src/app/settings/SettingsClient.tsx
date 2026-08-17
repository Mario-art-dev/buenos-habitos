"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ScheduleSettings from "@/components/ScheduleSettings";

interface Account {
  platform: "YOUTUBE" | "TIKTOK";
  accountName: string | null;
  accountId: string | null;
  updatedAt: string;
}

export default function SettingsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const params = useSearchParams();

  async function load() {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data.accounts);
  }

  useEffect(() => {
    load();
  }, []);

  async function disconnect(platform: "YOUTUBE" | "TIKTOK") {
    await fetch("/api/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    load();
  }

  const yt = accounts.find((a) => a.platform === "YOUTUBE");
  const tt = accounts.find((a) => a.platform === "TIKTOK");
  const errorCode = params.get("error");
  const connected = params.get("connected");

  const ERROR_MESSAGES: Record<string, string> = {
    youtube_sin_credenciales:
      "Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el .env (mira el README, sección YouTube) antes de poder conectar la cuenta.",
    tiktok_sesion_expirada:
      "El enlace de TikTok caducó antes de terminar (pasaron más de 10 min). Vuelve a darle a \"Conectar TikTok\".",
    tiktok_estado_invalido:
      "No se pudo verificar la conexión con TikTok (posible enlace caducado o abierto dos veces). Vuelve a intentarlo.",
    tiktok_no_code: "TikTok no envió el código de acceso. Vuelve a intentarlo.",
  };
  const error = errorCode ? ERROR_MESSAGES[errorCode] ?? errorCode : null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}
      {connected && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          Cuenta de {connected === "youtube" ? "YouTube" : "TikTok"} conectada correctamente.
        </div>
      )}

      <div className="rounded-2xl border border-ink-700 bg-ink-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">YouTube</h2>
            <p className="text-sm text-slate-400">
              {yt ? `Conectado como ${yt.accountName ?? yt.accountId}` : "No conectado. Los shorts se publicarán como públicos automáticamente."}
            </p>
          </div>
          {yt ? (
            <button onClick={() => disconnect("YOUTUBE")} className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400">
              Desconectar
            </button>
          ) : (
            <a href="/api/auth/youtube" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">
              Conectar YouTube
            </a>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-700 bg-ink-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">TikTok</h2>
            <p className="text-sm text-slate-400">
              {tt
                ? `Conectado como ${tt.accountName ?? tt.accountId}`
                : "No conectado. Mientras la app no esté auditada por TikTok, los shorts llegan como borrador a tu bandeja."}
            </p>
          </div>
          {tt ? (
            <button onClick={() => disconnect("TIKTOK")} className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400">
              Desconectar
            </button>
          ) : (
            <a href="/api/auth/tiktok" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-black">
              Conectar TikTok
            </a>
          )}
        </div>
      </div>

      <ScheduleSettings />
    </div>
  );
}
