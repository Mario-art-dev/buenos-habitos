import { getAIProvider, type AIImage } from "@/lib/ai/provider";

// Modo Estudia. Un documento se trocea en secciones; cada sección se analiza y de ahí salen
// los clips necesarios para explicarlo entero. Cada clip es INDEPENDIENTE (se entiende solo),
// con explicación lenta, ejemplos, diagramas, fechas, tablas y preguntas para tocar.

export interface ClipBrief {
  title: string;
  subject?: string;
  topic?: string;
  keyFacts: string[];
  sourceText: string;
}

const SCENE_TYPES = `The video is a "Draw My Life" style whiteboard lesson: a hand draws coloured markers on a white
board and a STICK FIGURE teacher explains slowly. Use these scene types (6-10 scenes):

- {"type":"hook","text":"<=8 words: a question that makes the viewer want the answer","emoji":"🤔","mood":"thinking","narration":"..."}   (always first)
- {"type":"explain","text":"headline","bullets":["<=8 words each, 2-4 bullets"],"narration":"..."}
- {"type":"example","text":"For example…","label":"a concrete, real example","emoji":"🍎","narration":"walk through the example step by step"}
- {"type":"diagram","text":"headline","svg":"<svg viewBox=\\"0 0 400 240\\">...</svg>","narration":"explain the diagram part by part"}
   The svg: ONLY elements rect, circle, ellipse, line, polyline, path, polygon, text, g. Use stroke="#1c1c1c" stroke-width="3" fill="none" or light fills. Text font-size 18-22. Max 12 elements. Draw boxes, arrows, cycles, labelled parts, flows, cause→effect.
- {"type":"table","text":"headline","headers":["A","B"],"rows":[["..","..."]],"narration":"..."}   (comparisons, data, dates)
- {"type":"timeline","text":"headline","items":[{"emoji":"📅","text":"1492 — date and what happened"}],"narration":"..."}   (dates and order of events)
- {"type":"number","value":"1492","label":"what it means","emoji":"📌","narration":"..."}   (a key date, number or formula)
- {"type":"mnemonic","acronym":"HOMES","words":["..."],"text":"memory trick","narration":"..."}
- {"type":"story","text":"vivid, funny mental image <=14 words","emojis":["🧬","🔬"],"narration":"..."}
- INTERACTIVE (the video waits for the viewer to tap an answer). Put one after every 2 explanation scenes, at least 3 per clip:
  {"type":"quiz","question":"checks the part just explained","options":["A","B","C"],"answer":0,"explanation":"<=14 words why","narration":"reads the question slowly"}
  {"type":"choice","question":"which one is correct / what happens next?","choices":[{"emoji":"🅰️","text":"<=8 words","reaction":"<=20 words explaining why"}],"narration":"..."}
  {"type":"reveal","text":"Think first…","hidden":"the answer <=12 words","emoji":"💡","narration":"asks the viewer to think, then tap"}
- {"type":"summary","text":"Remember:","bullets":["3-5 key facts, <=8 words each"],"narration":"recap slowly"}   (always last, before nothing else)

Narration rules: SLOW, clear, teacher voice. Short sentences of 6-14 words. Say the key words twice in
different ways. Never more than 25 words per narration line.`;

function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as T;
}

/** Paso 1 (por sección del documento): decide cuántos clips hacen falta y de qué trata cada uno. */
export async function planClips(params: {
  subject: string;
  topic: string;
  sectionText: string;
  sectionIndex: number;
  totalSections: number;
  images?: AIImage[];
}): Promise<ClipBrief[]> {
  const provider = await getAIProvider();
  const raw = await provider.chatJson({
    system:
      "You are an expert teacher planning study videos. You split material into self-contained clips: each " +
      "clip is understandable on its own, covers one idea completely and never relies on other clips. " +
      "Facts must come only from the material. Reply with JSON only.",
    prompt: `Subject: ${params.subject}${params.topic ? ` — Topic: ${params.topic}` : ""}
Section ${params.sectionIndex + 1} of ${params.totalSections} of the document.
${params.images?.length ? "Photos of notes or diagrams are attached: use them (dates, diagrams, examples)." : ""}

MATERIAL:
"""
${params.sectionText || "(see the attached photos)"}
"""

Decide how many clips this section needs to be explained COMPLETELY (1 clip for a small idea, up to 5 for dense
material). Each clip covers one coherent idea. For each clip give:
- "title": short English title
- "keyFacts": 4-10 complete facts from the material (names, dates, numbers, causes, steps, formulas), in English
- "sourceText": the exact part of the material this clip is based on (copy the relevant sentences, max 1500 chars)

Return ONLY: {"clips":[{"title":"...","keyFacts":["..."],"sourceText":"..."}]}`,
    images: params.images,
    maxTokens: 8_000,
  });
  const plan = parseJson<{ clips?: { title?: string; keyFacts?: string[]; sourceText?: string }[] }>(raw);
  return (plan.clips ?? [])
    .filter((c) => c && c.title && Array.isArray(c.keyFacts) && c.keyFacts.length)
    .map((c) => ({
      title: String(c.title).slice(0, 90),
      keyFacts: c.keyFacts!.map(String).slice(0, 10),
      sourceText: String(c.sourceText ?? "").slice(0, 2000),
      subject: params.subject,
      topic: params.topic,
    }));
}

/** Paso 2 (por clip): escribe el guion animado y explicado de UN clip. */
export async function writeVideo(params: {
  clip: ClipBrief;
  index: number;
  total: number;
  subject: string;
  topic: string;
  images?: AIImage[];
}): Promise<Record<string, unknown>> {
  const provider = await getAIProvider();
  const raw = await provider.chatJson({
    system:
      "You are a brilliant, patient teacher who makes 'Draw My Life' whiteboard lessons. You explain SLOWLY, " +
      "step by step, with concrete examples, diagrams, dates, tables and questions that check understanding. " +
      "English, simple B1-B2 words. Every fact comes from the material. Each lesson stands alone. Reply with JSON only.",
    prompt: `Subject: ${params.subject} — Topic: ${params.topic}
Clip ${params.index + 1} of ${params.total}: "${params.clip.title}". It must be understandable on its own.

Key facts to teach (ALL of them):
${params.clip.keyFacts.map((f) => `- ${f}`).join("\n")}

Source material:
"""
${params.clip.sourceText || "(see the attached photos)"}
"""

Write ONE lesson video of at most 2 minutes:
- "narration" total: 150-230 words (slow teaching pace). Explain WHY, not only WHAT.
- Include at least one "example" scene and at least one "diagram" or "table" or "timeline" scene when the material allows it.
- Include at least 3 interactive scenes (quiz / choice / reveal), spread through the video.
- Use the narrator's voice: "Let's slow down here…", "Look at this part…", "Here is the key idea…".

${SCENE_TYPES}

Return ONLY this JSON:
{"title":"English title <=60 chars","caption":"short caption with 1 emoji","palette":"marker colour: red|blue|green|orange|purple","scenes":[...],"hashtags":["#tag"],"takeaway":"one sentence","keyFacts":["..."]}`,
    images: params.clip.sourceText ? undefined : params.images,
    maxTokens: 8_000,
  });
  const script = parseJson<Record<string, unknown>>(raw);
  const scenes = Array.isArray(script.scenes)
    ? (script.scenes as Record<string, unknown>[]).filter((s) => s && typeof s.type === "string")
    : [];
  if (scenes.length < 3) throw new Error("La IA devolvió un guion demasiado corto. Se reintentará.");
  script.scenes = scenes.slice(0, 14);
  return script;
}
