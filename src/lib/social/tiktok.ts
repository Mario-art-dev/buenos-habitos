import fs from "fs";
import crypto from "crypto";
import { config } from "@/lib/config";
import { getAccount, saveAccount } from "./accounts";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USERINFO_URL = "https://open.tiktokapis.com/v2/user/info/";
// Flujo de "subir al inbox como borrador": es el que permiten las apps SIN auditar por TikTok.
// Cuando TikTok apruebe tu app para publicación directa, cambia esta URL por:
// https://open.tiktokapis.com/v2/post/publish/video/init/  (y añade post_info con privacy_level)
const INBOX_UPLOAD_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

const SCOPES = ["user.info.basic", "video.upload", "video.publish"];

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** TikTok exige PKCE (RFC 7636) en el login: sin code_challenge da "Something went wrong". */
function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function getTikTokAuthUrl(): { url: string; state: string; codeVerifier: string } {
  const state = crypto.randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    scope: SCOPES.join(","),
    response_type: "code",
    redirect_uri: config.tiktok.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTH_URL}?${params.toString()}`, state, codeVerifier };
}

interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope: string;
  error?: string;
  error_description?: string;
}

export async function handleTikTokOAuthCallback(code: string, codeVerifier: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.tiktok.redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const data = (await res.json()) as TikTokTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(`Fallo autenticando con TikTok: ${data.error_description ?? res.statusText}`);
  }

  let accountName: string | null = null;
  try {
    const infoRes = await fetch(`${USERINFO_URL}?fields=display_name`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const info = await infoRes.json();
    accountName = info?.data?.user?.display_name ?? null;
  } catch {
    // no crítico
  }

  await saveAccount({
    platform: "TIKTOK",
    accountName,
    accountId: data.open_id,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  });
}

async function refreshTokenIfNeeded(): Promise<string> {
  const account = await getAccount("TIKTOK");
  if (!account) throw new Error("TikTok no está conectado. Ve a Ajustes para conectarlo.");

  if (account.expiresAt && account.expiresAt.getTime() > Date.now() + 60_000) {
    return account.accessToken;
  }
  if (!account.refreshToken) return account.accessToken;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
  });
  const data = (await res.json()) as TikTokTokenResponse;
  if (!res.ok || data.error) {
    return account.accessToken; // seguimos con el que había, fallará más adelante si de verdad expiró
  }

  await saveAccount({
    platform: "TIKTOK",
    accountName: account.accountName,
    accountId: account.accountId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? account.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  });
  return data.access_token;
}

export interface UploadToTikTokParams {
  filePath: string;
  title: string;
  description: string;
  hashtags: string[];
}

/**
 * Sube el vídeo al inbox de TikTok como borrador (único modo permitido para apps sin auditar
 * por el "Content Posting API"). El creador lo verá dentro de la app de TikTok, en "Borradores",
 * listo para revisar y publicar con un toque.
 */
export async function uploadShortToTikTok(
  params: UploadToTikTokParams
): Promise<{ publishId: string; status: "DRAFT" }> {
  const accessToken = await refreshTokenIfNeeded();
  const stats = fs.statSync(params.filePath);
  const videoSize = stats.size;

  const initRes = await fetch(INBOX_UPLOAD_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    }),
  });
  const initData = await initRes.json();
  if (!initRes.ok || initData.error?.code !== "ok") {
    throw new Error(`TikTok rechazó la subida: ${initData.error?.message ?? initRes.statusText}`);
  }

  const { publish_id: publishId, upload_url: uploadUrl } = initData.data;

  const fileBuffer = fs.readFileSync(params.filePath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Fallo subiendo el vídeo a TikTok (${uploadRes.status})`);
  }

  return { publishId, status: "DRAFT" };
}
