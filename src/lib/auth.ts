import { config } from "./config";

// Usamos Web Crypto (SubtleCrypto) en vez del módulo "crypto" de Node porque
// este archivo se importa también desde middleware.ts, que corre en el Edge Runtime.

const COOKIE_NAME = "ev_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 días

async function getKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(config.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string): Promise<string> {
  const key = await getKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(signature);
}

export async function createSessionToken(): Promise<string> {
  const payload = `ok.${Date.now()}`;
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [marker, ts, signature] = parts;
  const payload = `${marker}.${ts}`;
  const expected = await sign(payload);
  if (expected.length !== signature.length || expected !== signature) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age <= MAX_AGE_SECONDS * 1000;
}

export function checkPassword(password: string): boolean {
  if (!config.appPassword) return true; // sin contraseña configurada, no se exige login
  if (password.length !== config.appPassword.length) return false;
  let mismatch = 0;
  for (let i = 0; i < password.length; i++) {
    mismatch |= password.charCodeAt(i) ^ config.appPassword.charCodeAt(i);
  }
  return mismatch === 0;
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAgeSeconds: MAX_AGE_SECONDS,
};
