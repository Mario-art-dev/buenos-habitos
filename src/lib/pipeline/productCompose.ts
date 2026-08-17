import fs from "fs";
import path from "path";
import { getAIProvider, type AIImage } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import { contentLanguageName } from "@/lib/lang";
import { extractFrameAt } from "./clip";
import { tmpDir } from "@/lib/storagePaths";

export interface ProductAssetInput {
  filePath: string;
  type: "image" | "video";
  order: number;
}

export interface ProductScript {
  title: string;
  description: string;
  hashtags: string[];
  viralityScore: number;
  viralityReason: string;
  hook: string;
  segmentScripts: string[]; // mismo orden que assets
  cta: string;
}

const SYSTEM_PROMPT = `Eres un guionista publicitario del canal "${config.channel.name}" (${config.channel.niche}),
especializado en vídeos cortos de recomendación/publicidad de producto para TikTok e Instagram/YouTube Shorts,
con enlace de afiliado. Escribes SIEMPRE con tu propia voz, dando tu opinión y experiencia sobre el producto —
nunca copias frases de otro anuncio, como mucho te inspiras en su estructura/ritmo si se te indica. No inventes
afirmaciones médicas o legales falsas, y deja claro que es contenido publicitario/patrocinado (transparencia
legal). Escribe TODO el guion (gancho, frases por segmento, CTA, título, descripción, hashtags) en
${contentLanguageName()}. Respondes EXCLUSIVAMENTE con JSON válido, sin markdown.`;

function mediaTypeFor(filePath: string): AIImage["mediaType"] {
  return filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

async function assetToImage(jobId: string, asset: ProductAssetInput, index: number): Promise<AIImage | null> {
  try {
    if (asset.type === "image") {
      const buf = fs.readFileSync(asset.filePath);
      return { base64: buf.toString("base64"), mediaType: mediaTypeFor(asset.filePath) };
    }
    const framePath = path.join(tmpDir(jobId), `product_frame_${index}.jpg`);
    await extractFrameAt(asset.filePath, 1, framePath);
    const buf = fs.readFileSync(framePath);
    return { base64: buf.toString("base64"), mediaType: "image/jpeg" };
  } catch {
    return null;
  }
}

function cleanJson(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
}

/** Genera el guion completo (gancho, frase por foto/clip, CTA) y los metadatos de un vídeo de producto. */
export async function generateProductScript(params: {
  jobId: string;
  productName: string;
  productLink: string | null;
  referenceAdUrl: string | null;
  assets: ProductAssetInput[];
}): Promise<ProductScript> {
  const provider = getAIProvider();
  // Con presupuesto de tokens limitado (capas gratuitas como Groq) cada foto ya cuesta ~1600
  // tokens de por sí, así que mandar todas las fotos de un producto con muchas revienta el
  // límite por petición antes incluso de dejar sitio para la respuesta. Se limitan a las 2
  // primeras en ese caso (el vídeo final sigue usando TODAS las fotos; solo cambia cuántas ve
  // la IA para escribir el guion, y las que no ve se quedan con una frase genérica de relleno).
  const assetsForAI =
    config.ai.tokensPerMinute > 0 ? params.assets.slice(0, 2) : params.assets;
  const images: AIImage[] = [];
  for (let i = 0; i < assetsForAI.length; i++) {
    const img = await assetToImage(params.jobId, assetsForAI[i], i);
    if (img) images.push(img);
  }

  const raw = await provider.chatJson({
    system: SYSTEM_PROMPT,
    prompt: `Producto: "${params.productName}".
${params.productLink ? `Enlace de compra/afiliado: ${params.productLink}` : ""}
${
  params.referenceAdUrl
    ? `Te inspiras SOLO en la estructura/ritmo de este anuncio existente (no copies frases literales): ${params.referenceAdUrl}`
    : ""
}
Tienes ${images.length} fotos/clips del producto adjuntas, EN ORDEN de aparición en el vídeo${
      images.length < params.assets.length
        ? ` (el vídeo final usará ${params.assets.length} en total, pero solo hace falta que narres estas)`
        : ""
    }.

Escribe el guion completo de un vídeo publicitario corto (estilo TikTok/Shorts) de este producto:
- "hook": 1 frase inicial (máx 12 palabras) que enganche en el primer segundo.
- "segmentScripts": array de ${images.length} frases, UNA por cada foto/clip EN EL MISMO ORDEN, narrando
  qué se ve y por qué mola/sirve, con tu voz personal (nada de listar características técnicas, cuéntalo natural).
- "cta": 1 frase final de llamada a la acción mencionando que el enlace está en la descripción/bio para comprarlo.
- "title": título corto para el vídeo (máx 70 caracteres).
- "description": descripción del vídeo (2-3 frases), dejando claro que es contenido publicitario/con enlace de
  afiliado (transparencia legal), adaptada al canal ${config.channel.name}.
- "hashtags": 8 a 12 hashtags sin el símbolo #, incluyendo alguno de publicidad (como "publicidad" o "ad") y
  otros de producto/nicho.
- "viralityScore": 0-100, probabilidad de que este vídeo funcione bien.
- "viralityReason": 1 frase explicando por qué.

Devuelve SOLO este JSON:
{"hook":"...","segmentScripts":["...","..."],"cta":"...","title":"...","description":"...","hashtags":["..."],
"viralityScore":number,"viralityReason":"..."}`,
    images: images.length ? images : undefined,
    // Los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan una parte fija y considerable
    // del presupuesto de tokens "pensando" por dentro aunque se oculte del resultado final. Aquí
    // el margen no puede ser tan grande como en otras llamadas porque cada foto adjunta ya cuesta
    // ~1600 tokens de por sí (de ahí el límite de fotos de arriba).
    maxTokens: 3_000,
  });

  const parsed = JSON.parse(cleanJson(raw)) as Partial<ProductScript>;

  const segmentScripts = Array.isArray(parsed.segmentScripts) ? parsed.segmentScripts.slice() : [];
  while (segmentScripts.length < params.assets.length) {
    segmentScripts.push("Mira esto de cerca.");
  }

  return {
    title: parsed.title?.slice(0, 100) ?? params.productName,
    description: parsed.description ?? "",
    hashtags: parsed.hashtags ?? [],
    viralityScore: Math.max(0, Math.min(100, Math.round(parsed.viralityScore ?? 50))),
    viralityReason: parsed.viralityReason ?? "",
    hook: parsed.hook?.trim() || "Esto que tengo aquí te va a encantar.",
    segmentScripts: segmentScripts.slice(0, params.assets.length),
    cta: parsed.cta?.trim() || "Tienes el enlace para comprarlo en la descripción.",
  };
}
