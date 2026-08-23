"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ScheduleSettings from "@/components/ScheduleSettings";
import AiProvidersSettings from "@/components/AiProvidersSettings";

interface Account {
  platform: "YOUTUBE" | "TIKTOK";
  accountName: string | null;
  accountId: string | null;
  updatedAt: string;
}

interface OAuthInfo {
  youtubeConfigured: boolean;
  tiktokConfigured: boolean;
  youtubeCallbackUrl: string;
  tiktokCallbackUrl: string;
  youtubeClientId: string | null;
  youtubeClientSecretLength: number | null;
  tiktokClientKey: string | null;
  tiktokClientSecretLength: number | null;
}

/** Botón "Copiar" para pegar directo en Google Cloud Console / TikTok for Developers. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-300 hover:border-brand-500"
    >
      {copied ? "✓ Copiado" : "Copiar"}
    </button>
  );
}

export default function SettingsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [oauth, setOauth] = useState<OAuthInfo | null>(null);
  const params = useSearchParams();

  async function load() {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data.accounts);
    setOauth(data.oauth);
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

      <AiProvidersSettings />

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
          ) : oauth && !oauth.youtubeConfigured ? (
            <span className="rounded-lg border border-amber-600/40 px-4 py-2 text-sm text-amber-400">
              Faltan credenciales
            </span>
          ) : (
            <a href="/api/auth/youtube" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">
              Conectar YouTube
            </a>
          )}
        </div>
        {!yt && oauth && (
          <div className="mt-4 rounded-xl border border-ink-600 bg-ink-900/50 p-3 text-xs text-slate-400">
            {!oauth.youtubeConfigured ? (
              <p>
                Falta configurar <code className="text-slate-300">GOOGLE_CLIENT_ID</code> y{" "}
                <code className="text-slate-300">GOOGLE_CLIENT_SECRET</code> en el .env (README, sección
                YouTube) antes de poder conectar la cuenta.
              </p>
            ) : (
              <>
                <p>
                  Antes de darle a "Conectar", añade esta URL exacta como "URI de redirección autorizado"
                  en tu{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-400 underline"
                  >
                    Google Cloud Console → Credenciales
                  </a>{" "}
                  (cambia cada vez que se reinicia el "Servidor temporal", así que puede que tengas que
                  volver a añadirla):
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1.5 text-slate-300">
                    {oauth.youtubeCallbackUrl}
                  </code>
                  <CopyButton text={oauth.youtubeCallbackUrl} />
                </div>
                <p className="mt-3">
                  Si te da <strong className="text-slate-300">"Error 401: invalid_client"</strong> al
                  conectar, el Client ID guardado en GitHub no coincide con el de Google (a veces se
                  cuela un espacio al pegarlo desde el móvil). Compara este que está leyendo el
                  servidor AHORA MISMO, letra por letra, con el que ves en Google Cloud Console:
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1.5 text-slate-300">
                    {oauth.youtubeClientId}
                  </code>
                  {oauth.youtubeClientId && <CopyButton text={oauth.youtubeClientId} />}
                </div>
                <p className="mt-2 text-slate-500">
                  Client Secret guardado: {oauth.youtubeClientSecretLength} caracteres (no se enseña el
                  valor por seguridad — si esperabas otra longitud, vuelve a generarlo y actualiza el
                  secreto de GitHub).
                </p>
              </>
            )}
          </div>
        )}
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
          ) : oauth && !oauth.tiktokConfigured ? (
            <span className="rounded-lg border border-amber-600/40 px-4 py-2 text-sm text-amber-400">
              Faltan credenciales
            </span>
          ) : (
            <a href="/api/auth/tiktok" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-black">
              Conectar TikTok
            </a>
          )}
        </div>
        {!tt && oauth && (
          <div className="mt-4 rounded-xl border border-ink-600 bg-ink-900/50 p-3 text-xs text-slate-400">
            {!oauth.tiktokConfigured ? (
              <p>
                Falta configurar <code className="text-slate-300">TIKTOK_CLIENT_KEY</code> y{" "}
                <code className="text-slate-300">TIKTOK_CLIENT_SECRET</code> en el .env (README, sección
                TikTok) antes de poder conectar la cuenta.
              </p>
            ) : (
              <>
                <p>
                  Antes de darle a "Conectar", añade esta URL exacta como "Redirect URI" en tu{" "}
                  <a
                    href="https://developers.tiktok.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-400 underline"
                  >
                    TikTok for Developers → tu app → Login Kit
                  </a>{" "}
                  (cambia cada vez que se reinicia el "Servidor temporal", así que puede que tengas que
                  volver a añadirla):
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1.5 text-slate-300">
                    {oauth.tiktokCallbackUrl}
                  </code>
                  <CopyButton text={oauth.tiktokCallbackUrl} />
                </div>
                <p className="mt-3">
                  Si te da un error de cliente inválido al conectar, compara este Client Key (lo que
                  está leyendo el servidor ahora mismo) letra por letra con el de TikTok for Developers:
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1.5 text-slate-300">
                    {oauth.tiktokClientKey}
                  </code>
                  {oauth.tiktokClientKey && <CopyButton text={oauth.tiktokClientKey} />}
                </div>
                <p className="mt-2 text-slate-500">
                  Client Secret guardado: {oauth.tiktokClientSecretLength} caracteres (no se enseña el
                  valor por seguridad).
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <ScheduleSettings />
    </div>
  );
}
