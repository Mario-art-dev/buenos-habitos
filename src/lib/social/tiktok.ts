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
    // TikTok exige Content-Type JSON en esta llamada aunque no lleve campos — sin un body real
    // ("{}"), algunas cuentas reciben un rechazo genérico de su validador de esquema en vez de un
    // error claro (visto en real: "The string did not match the expected pattern.").
    body: "{}",
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(`TikTok rechazó la consulta de la cuenta: ${data.error?.message || JSON.stringify(data.error ?? data)}`);
  }
  return { privacyLevelOptions: data.data?.privacy_level_options ?? ["SELF_ONLY"] };
}

/** El mejor nivel de privacidad disponible ahora mismo — público si la app ya está auditada por TikTok, si no, el máximo permitido (normalmente SELF_ONLY, visible solo para el propio dueño de la cuenta). */
function pickPrivacyLevel(options: string[]): string {
  const preference = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
  return preference.find((p) => options.includes(p)) ?? options[0] ?? "SELF_ONLY";
}

/** Un hashtag válido para TikTok: sin espacios/saltos de línea/almohadillas de más ni símbolos raros. */
function sanitizeHashtag(raw: string): string | null {
  const cleaned = raw
    .replace(/^#+/, "")
    .trim()
    .replace(/[\s#]+/g, "");
  return cleaned ? `#${cleaned}` : null;
}

function buildCaption(title: string, hashtags: string[]): string {
  // Un hashtag mal formado (con espacios, vacío, o repetido) puede hacer que TikTok rechace toda
  // la publicación con un error genérico de validación (visto en real: "The string did not match
  // the expected pattern."), así que se limpian aquí antes de mandarlos, no solo al mostrarlos.
  const seen = new Set<string>();
  const tags = hashtags
    .map(sanitizeHashtag)
    .filter((h): h is string => {
      if (!h || seen.has(h.toLowerCase())) return false;
      seen.add(h.toLowerCase());
      return true;
    })
    .join(" ");
  const caption = tags ? `${title}\n\n${tags}` : title;
  // TikTok trunca/rechaza captions de más de 2200 caracteres.
  return caption.slice(0, 2200);
}

const MIN_CHUNK_BYTES = 5 * 1024 * 1024; // 5MB — mínimo que admite TikTok por trozo
const MAX_CHUNK_BYTES = 64 * 1024 * 1024; // 64MB — máximo que admite TikTok por trozo normal
const MAX_FINAL_CHUNK_BYTES = 128 * 1024 * 1024; // el ÚLTIMO trozo puede llegar hasta aquí

/**
 * Calcula cómo trocear el vídeo para el init de TikTok (visto en real: "The chunk size is
 * invalid" al mandar chunk_size = tamaño entero del vídeo para clips de más de 64MB, el máximo que
 * admite TikTok por trozo). Para vídeos de hasta 128MB basta un solo trozo (el último trozo real
 * puede llegar hasta ese tamaño aunque el "chunk_size" declarado esté limitado a 64MB); solo hace
 * falta partir de verdad en varias peticiones PUT para vídeos todavía más grandes.
 */
function planChunks(videoSize: number): { chunkSize: number; totalChunkCount: number; ranges: [number, number][] } {
  if (videoSize <= MIN_CHUNK_BYTES || videoSize <= MAX_CHUNK_BYTES) {
    return { chunkSize: videoSize, totalChunkCount: 1, ranges: [[0, videoSize - 1]] };
  }
  if (videoSize <= MAX_FINAL_CHUNK_BYTES) {
    return { chunkSize: MAX_CHUNK_BYTES, totalChunkCount: 1, ranges: [[0, videoSize - 1]] };
  }
  const chunkSize = MAX_CHUNK_BYTES;
  let totalChunkCount = Math.floor(videoSize / chunkSize);
  const remainder = videoSize - totalChunkCount * chunkSize;
  if (remainder > 0 && chunkSize + remainder > MAX_FINAL_CHUNK_BYTES) totalChunkCount += 1;
  const ranges: [number, number][] = [];
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const end = i === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1;
    ranges.push([start, end]);
  }
  return { chunkSize, totalChunkCount, ranges };
}

/**
 * Publica el vídeo directamente en TikTok (Content Posting API) — ya no queda como borrador
 * manual en el inbox: sale como una publicación real desde el momento en que termina de subirse,
 * con la privacidad que permita la app ahora mismo (ver pickPrivacyLevel).
 */
export async function uploadShortToTikTok(
  params: UploadToTikTokParams
): Promise<{ publishId: string; status: "PUBLISHED"; privacyLevel: string }> {
  // Cada paso envuelto por separado con su propio contexto: un error nativo sin más (p.ej. "The
  // string did not match the expected pattern.", visto en real) no dice nada de en qué paso de
  // los 4 pasó — con esto, el mensaje que le llega al usuario siempre dice cuál de ellos fue.
  let accessToken: string;
  try {
    accessToken = await refreshTokenIfNeeded();
  } catch (err) {
    throw new Error(`Fallo renovando la conexión con TikTok: ${(err as Error).message}`);
  }

  const stats = fs.statSync(params.filePath);
  const videoSize = stats.size;
  const chunkPlan = planChunks(videoSize);

  let privacyLevel: string;
  try {
    const creatorInfo = await queryCreatorInfo(accessToken);
    privacyLevel = pickPrivacyLevel(creatorInfo.privacyLevelOptions);
  } catch (err) {
    throw new Error(`Fallo consultando la cuenta de TikTok: ${(err as Error).message}`);
  }

  const tryInit = async (level: string) => {
    const initRes = await fetch(DIRECT_POST_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: buildCaption(params.title, params.hashtags),
          privacy_level: level,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: chunkPlan.chunkSize,
          total_chunk_count: chunkPlan.totalChunkCount,
        },
      }),
    });
    const initData = await initRes.json();
    const ok = initRes.ok && initData.error?.code === "ok";
    return { ok, code: initData.error?.code as string | undefined, initData, initRes };
  };

  let publishId: string;
  let uploadUrl: string;
  try {
    let result = await tryInit(privacyLevel);
    // Aunque creator_info/query diga que hay una opción mejor disponible, TikTok puede seguir
    // rechazando el init con "unaudited_client_can_only_post_to_private_accounts" mientras la app
    // no esté auditada de verdad — visto en real. Si pasa, se reintenta una sola vez forzando
    // SELF_ONLY (privado) en vez de fallar directamente.
    if (!result.ok && result.code === "unaudited_client_can_only_post_to_private_accounts" && privacyLevel !== "SELF_ONLY") {
      privacyLevel = "SELF_ONLY";
      result = await tryInit(privacyLevel);
    }
    if (!result.ok) {
      const { initData, initRes } = result;
      throw new Error(initData.error?.message || JSON.stringify(initData.error ?? initData) || initRes.statusText);
    }
    publishId = result.initData.data.publish_id;
    uploadUrl = result.initData.data.upload_url;
  } catch (err) {
    throw new Error(`TikTok rechazó iniciar la subida: ${(err as Error).message}`);
  }

  try {
    const fileBuffer = fs.readFileSync(params.filePath);
    // Normalmente es un solo trozo (todo el archivo en una petición); solo se divide en varias
    // peticiones PUT de verdad para vídeos de más de 128MB, siguiendo los rangos de planChunks.
    for (const [start, end] of chunkPlan.ranges) {
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        },
        body: fileBuffer.subarray(start, end + 1),
      });
      if (!uploadRes.ok) {
        throw new Error(`código ${uploadRes.status} en el trozo ${start}-${end}`);
      }
    }
  } catch (err) {
    throw new Error(`Fallo subiendo el archivo de vídeo a TikTok: ${(err as Error).message}`);
  }

  return { publishId, status: "PUBLISHED", privacyLevel };
}
