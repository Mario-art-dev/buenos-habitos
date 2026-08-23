"use client";

import { useEffect, useState } from "react";

type ProviderName = "gemini" | "groq" | "cerebras" | "mistral" | "anthropic" | "openai";

interface Status {
  provider: ProviderName;
  configured: boolean;
  source: "app" | "env" | null;
}

// De mejor a peor calidad para este uso (mismo orden que FALLBACK_ORDER en provider.ts) — así se
// ve de un vistazo cuál se va a usar primero en cuanto tenga clave.
const PROVIDER_INFO: Record<ProviderName, { label: string; free: boolean; signupUrl: string }> = {
  gemini: { label: "Gemini (Google)", free: true, signupUrl: "https://aistudio.google.com/apikey" },
  groq: { label: "Groq", free: true, signupUrl: "https://console.groq.com/keys" },
  cerebras: { label: "Cerebras", free: true, signupUrl: "https://cloud.cerebras.ai" },
  mistral: { label: "Mistral", free: true, signupUrl: "https://console.mistral.ai" },
  anthropic: { label: "Anthropic (Claude)", free: false, signupUrl: "https://console.anthropic.com" },
  openai: { label: "OpenAI (GPT)", free: false, signupUrl: "https://platform.openai.com/api-keys" },
};
const ORDER: ProviderName[] = ["gemini", "groq", "cerebras", "mistral", "anthropic", "openai"];

/**
 * Gestión de claves de IA directamente desde la web, para quien no pueda/sepa moverse por
 * Settings → Secrets del repositorio de GitHub: se pegan aquí y se guardan en la base de datos,
 * sin tocar nada de GitHub. Se prueban en orden de mejor a peor calidad (ver FALLBACK_ORDER en
 * src/lib/ai/provider.ts) — en cuanto una se queda sin cupo, se usa la siguiente que tenga clave,
 * sola, sin reiniciar el servidor.
 */
export default function AiProvidersSettings() {
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderName, string>>>({});
  const [busy, setBusy] = useState<ProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/settings/ai-keys");
    const data = await res.json();
    setStatuses(data.statuses);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(provider: ProviderName) {
    const apiKey = (drafts[provider] ?? "").trim();
    if (!apiKey) return;
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar la clave");
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la clave");
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: ProviderName) {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) throw new Error("No se pudo quitar la clave");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la clave");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-800 p-6">
      <h2 className="font-semibold">Proveedores de IA</h2>
      <p className="mt-1 text-sm text-slate-400">
        La IA elige los mejores momentos, clasifica fotogramas y escribe títulos/descripciones/hashtags. Pega aquí
        la clave de cualquiera que tengas — se prueban en este orden (de mejor a peor) y en cuanto una se queda
        sin cupo, se usa sola la siguiente que tenga clave, sin tocar nada más ni reiniciar el servidor.
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 space-y-3">
        {statuses === null ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          ORDER.map((provider) => {
            const status = statuses.find((s) => s.provider === provider);
            const info = PROVIDER_INFO[provider];
            return (
              <div key={provider} className="rounded-xl border border-ink-600 bg-ink-900/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-slate-200">{info.label}</span>
                    {!info.free && <span className="ml-2 text-xs text-amber-400">de pago</span>}
                  </div>
                  {status?.configured ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg border border-emerald-500/40 px-2 py-1 text-xs text-emerald-400">
                        {status.source === "app" ? "Configurada aquí" : "Configurada por variable de entorno"}
                      </span>
                      {status.source === "app" && (
                        <button
                          onClick={() => remove(provider)}
                          disabled={busy === provider}
                          className="rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-500">
                      Sin configurar
                    </span>
                  )}
                </div>
                {!status?.configured && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      placeholder="Pega aquí la clave de API"
                      value={drafts[provider] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [provider]: e.target.value }))}
                      className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-brand-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => save(provider)}
                        disabled={busy === provider || !(drafts[provider] ?? "").trim()}
                        className="rounded-lg bg-gradient-to-r from-brand-500 to-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <a
                        href={info.signupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-slate-300 hover:border-brand-500"
                      >
                        Conseguir clave
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
