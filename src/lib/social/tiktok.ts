import fs from "fs";
import crypto from "crypto";
import { config } from "@/lib/config";
import { getAccount, saveAccount } from "./accounts";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USERINFO_URL = "https://open.tiktokapis.com/v2/user/info/";
// Publicación DIRECTA (Content Posting API) en vez del flujo antiguo de "subir al inbox como
// borrador" — pedido explícito: el borrador ni siquiera llegaba a aparecer en la app. Con la app
// SIN auditar por TikTok, esta misma URL sigue funcionando pero fuerza privacy_level=SELF_ONLY
// (solo lo ve el propio dueño de la cuenta) — sigue siendo un vídeo REAL ya publicado, no un
// borrador manual — y en cuanto TikTok audite la app, empieza a admitir PUBLIC_TO_EVERYONE sin
// tener que tocar este código (ver pickPrivacyLevel/queryCreatorInfo más abajo).
const DIRECT_POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

// "video.publish" es imprescindible para publicación DIRECTA — IMPORTANTE: hay que añadir este
// scope al producto "Content Posting API" en el panel de desarrollador de TikTok (la misma app
// que ya usa video.upload) antes de volver a conectar TikTok tras este cambio; si no, TikTok
// rechaza el login entero con "Something went wrong / scope".
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

export function getTikTokAuthUrl(redirectUri: string): { url: string; state: string; codeVerifier: string } {
  const state = crypto.randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    scope: SCOPES.join(","),
    response_type: "code",
    redirect_uri: redirectUri,
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

export async function handleTikTokOAuthCallback(code: string, codeVerifier: string, redirectUri: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
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

interface CreatorInfo {
  privacyLevelOptions: string[];
}

/**
 * TikTok exige consultar esto antes de cada publicación (requisito de sus políticas, no
 * opcional): qué niveles de privacidad puede usar esta cuenta/app en este momento. Una app sin
 * auditar solo tiene disponible "SELF_ONLY"; en cuanto TikTok audite la app, empiezan a aparecer
 * también "MUTUAL_FOLLOW_FRIENDS"/"PUBLIC_TO_EVERYONE" aquí, sin más cambios en este código.
 */
async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const res = await fetch(CREATOR_INFO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(`TikTok rechazó la consulta de la cuenta: ${data.error?.message ?? res.statusText}`);
  }
  return { privacyLevelOptions: data.data?.privacy_level_options ?? ["SELF_ONLY"] };
}

/** El mejor nivel de privacidad disponible ahora mismo — público si la app ya está auditada por TikTok, si no, el máximo permitido (normalmente SELF_ONLY, visible solo para el propio dueño de la cuenta). */
function pickPrivacyLevel(options: string[]): string {
  const preference = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
  return preference.find((p) => options.includes(p)) ?? options[0] ?? "SELF_ONLY";
}

function buildCaption(title: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const caption = tags ? `${title}\n\n${tags}` : title;
  // TikTok trunca/rechaza captions de más de 2200 caracteres.
  return caption.slice(0, 2200);
}

/**
 * Publica el vídeo directamente en TikTok (Content Posting API) — ya no queda como borrador
 * manual en el inbox: sale como una publicación real desde el momento en que termina de subirse,
 * con la privacidad que permita la app ahora mismo (ver pickPrivacyLevel).
 */
export async function uploadShortToTikTok(
  params: UploadToTikTokParams
): Promise<{ publishId: string; status: "PUBLISHED"; privacyLevel: string }> {
  const accessToken = await refreshTokenIfNeeded();
  const stats = fs.statSync(params.filePath);
  const videoSize = stats.size;

  const creatorInfo = await queryCreatorInfo(accessToken);
  const privacyLevel = pickPrivacyLevel(creatorInfo.privacyLevelOptions);

  const initRes = await fetch(DIRECT_POST_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: buildCaption(params.title, params.hashtags),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
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

  return { publishId, status: "PUBLISHED", privacyLevel };
}
