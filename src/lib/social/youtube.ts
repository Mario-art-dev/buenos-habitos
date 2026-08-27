import fs from "fs";
import { google } from "googleapis";
import { config } from "@/lib/config";
import { getAccount, saveAccount } from "./accounts";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function newOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, redirectUri);
}

export function getYouTubeAuthUrl(redirectUri: string): string {
  const client = newOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleYouTubeOAuthCallback(code: string, redirectUri: string): Promise<void> {
  const client = newOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const youtube = google.youtube({ version: "v3", auth: client });
  const channelRes = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channel = channelRes.data.items?.[0];

  await saveAccount({
    platform: "YOUTUBE",
    accountName: channel?.snippet?.title ?? null,
    accountId: channel?.id ?? null,
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? null,
  });
}

async function getAuthorizedClient() {
  const account = await getAccount("YOUTUBE");
  if (!account) throw new Error("YouTube no está conectado. Ve a Ajustes para conectarlo.");

  const client = newOAuthClient();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken ?? undefined,
    expiry_date: account.expiresAt?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    await saveAccount({
      platform: "YOUTUBE",
      accountName: account.accountName,
      accountId: account.accountId,
      accessToken: tokens.access_token ?? account.accessToken,
      refreshToken: tokens.refresh_token ?? account.refreshToken,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : account.expiresAt,
      scope: tokens.scope ?? account.scope,
    });
  });

  return client;
}

export interface UploadToYouTubeParams {
  filePath: string;
  title: string;
  description: string;
  privacyStatus?: "public" | "unlisted" | "private";
}

// Pedido explícito: los hashtags son cosa de TikTok, en YouTube ni se generan ni se ponen (ni en
// tags ni en la descripción) — se sube solo con el título y la descripción tal cual.
export async function uploadShortToYouTube(params: UploadToYouTubeParams): Promise<{ videoId: string; url: string }> {
  const client = await getAuthorizedClient();
  const youtube = google.youtube({ version: "v3", auth: client });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: params.title.slice(0, 100),
        description: params.description.slice(0, 5000),
        categoryId: "24", // Entertainment
      },
      status: {
        privacyStatus: params.privacyStatus ?? "public",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(params.filePath),
    },
  });

  const videoId = res.data.id!;
  return { videoId, url: `https://youtube.com/shorts/${videoId}` };
}
