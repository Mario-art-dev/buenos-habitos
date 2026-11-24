import { getAIProvider, type AIImage } from "@/lib/ai/provider";

// Modo Estudia: la IA convierte los apuntes del usuario en una serie de "TikToks" educativos en
// inglés. Dos pasos para que cada petición sea corta (el túnel corta a los ~100 s):
//  1) planLessons: lee el temario y lo reparte en lecciones (cuántas depende de lo largo que sea).
//  2) writeVideo: escribe el guion animado de UNA lección (escenas que el navegador reproduce).

export interface Lesson {
  title: string;
  keyFacts: string[];
}

export interface Plan {
  topic: string;
  lessons: Lesson[];
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as T;
}

export async function planLessons(params: {
  subject: string;
  topicHint?: string;
  text: string;
  images?: AIImage[];
  chunkInfo?: string;
}): Promise<Plan> {
  const words = params.text.split(/\s+/).filter(Boolean).length;
  const target = Math.max(2, Math.min(10, Math.round(words / 300) + (params.images?.length ?? 0)));
  const provider = await getAIProvider();
  const raw = await provider.chatJson({
    system:
      "You are a world-class teacher and viral TikTok educator. You split study material into " +
      "bite-sized lessons that, together, cover ABSOLUTELY EVERYTHING an exam could ask. " +
      "Never invent facts that are not supported by the material. Reply with JSON only.",
    prompt: `Subject: ${params.subject}
${params.topicHint ? `Topic name given by the student: ${params.topicHint}` : ""}
${params.chunkInfo ?? ""}
STUDY MATERIAL (may be in any language; photos of notes may be attached):
"""
${params.text || "(see attached images)"}
"""

Split this material into about ${target} lessons (fewer if the material is short, up to 12 if it is dense).
Each lesson = one TikTok video of 45-110 seconds. Together they must cover the WHOLE material: every
definition, date, formula, name, cause, consequence, step and example. Order them logically.

For each lesson list 3-8 "keyFacts": complete, precise facts copied/condensed from the material
(write them in English, keep exact numbers, names, formulas).

Return ONLY this JSON:
{"topic": "short English name of the whole topic", "lessons": [{"title": "catchy English lesson title", "keyFacts": ["..."]}]}`,
    images: params.images,
    maxTokens: 8_000,
  });
  const plan = parseJson<Plan>(raw);
  const lessons = (plan.lessons ?? [])
    .filter((l) => l && l.title && Array.isArray(l.keyFacts) && l.keyFacts.length)
    .slice(0, 12);
  if (!lessons.length) throw new Error("La IA no ha sacado lecciones de este material.");
  return { topic: plan.topic?.trim() || params.topicHint || params.subject, lessons };
}

const SCENE_TYPES = `The video is a "Draw My Life" style whiteboard animation: a hand draws everything live with
markers on white paper, and a STICK FIGURE (the narrator) reacts in every scene. Every scene may add:
  "mood": stick figure face/pose — one of happy|shocked|thinking|laughing|pointing|sad|cool|angry
  "say": a SHORT funny line the stick figure says in a comic speech bubble (<=7 words), optional
In on-screen texts wrap the 1-2 most important words in *asterisks* (they get a yellow highlighter).

Scene types (6-10 scenes, vary them, pick the ones that fit THIS content):
- {"type":"hook","text":"<=8 words shocking/funny opener","emoji":"🤯","mood":"shocked","say":"WAIT, WHAT?!","narration":"..."}   (always first)
- {"type":"explain","text":"short headline","bullets":["<=7 words"],"emoji":"🧠","mood":"pointing","narration":"..."}
- {"type":"analogy","text":"X is like Y","left":{"emoji":"🫀","label":"Heart"},"right":{"emoji":"🚒","label":"Fire pump"},"say":"...","narration":"..."}
- {"type":"list","text":"headline","items":[{"emoji":"1️⃣","text":"<=6 words"}],"narration":"..."}   (2-5 items)
- {"type":"compare","text":"A vs B","left":{"label":"A","emoji":"🐢","points":["<=5 words"]},"right":{"label":"B","emoji":"🐇","points":["..."]},"narration":"..."}
- {"type":"number","value":"1492","label":"what it means","emoji":"⛵","mood":"shocked","narration":"..."}   (dates, stats, formulas like "E=mc²")
- {"type":"timeline","text":"headline","items":[{"emoji":"🏛️","text":"753 BC — Rome founded"}],"narration":"..."}
- {"type":"mnemonic","acronym":"HOMES","words":["Huron","Ontario","Michigan","Erie","Superior"],"text":"memory trick","mood":"cool","narration":"..."}
- {"type":"story","text":"absurd mental image <=14 words","emojis":["🦖","🍕","🚀"],"mood":"laughing","say":"...","narration":"..."}   (a crazy, vivid, funny scene that encodes the fact)
- INTERACTIVE (the video waits for the viewer to tap):
  {"type":"quiz","question":"...","options":["A","B","C"],"answer":0,"explanation":"<=12 words","narration":"reads the question"}
  {"type":"choice","question":"funny 'what would YOU do?' or 'guess which one' question","choices":[{"emoji":"🅰️","text":"<=6 words","reaction":"funny reaction that also teaches the fact, <=18 words"}],"narration":"..."}   (2-3 choices)
  {"type":"reveal","text":"Guess what… (teaser)","hidden":"the surprising fact <=10 words","emoji":"💥","mood":"thinking","narration":"builds suspense, asks the viewer to tap"}
- {"type":"punchline","text":"<=10 word key takeaway","emoji":"🔥","mood":"cool","say":"...","narration":"..."}   (always last)

Every video MUST contain at least 2 interactive scenes (one "quiz" near the end + one "choice" or "reveal").`;

export async function writeVideo(params: {
  subject: string;
  topic: string;
  lesson: Lesson;
  index: number;
  total: number;
}): Promise<Record<string, unknown>> {
  const provider = await getAIProvider();
  const raw = await provider.chatJson({
    system:
      "You are the most addictive educational TikTok creator on Earth and you make 'Draw My Life' " +
      "style whiteboard videos: a hand draws stick figures and doodles while a funny, warm narrator " +
      "tells the lesson as a STORY in first person ('So there I was…', 'Imagine you're…'). You write " +
      "in ENGLISH (simple B1-B2 words) and you make facts impossible to forget with comic references " +
      "everyone knows (memes, movies, video games, school life, TikTok trends, celebrities, food, " +
      "group chats, Monday mornings…), absurd mental images, exaggerated analogies, jokes, memory " +
      "tricks and questions the viewer answers by tapping. References are only mentioned, never the " +
      "main content. Every fact must be accurate and come from the key facts given. Reply with JSON only.",
    prompt: `Subject: ${params.subject} — Topic: ${params.topic}
Video ${params.index + 1} of ${params.total}: "${params.lesson.title}"
Key facts this video MUST teach (all of them):
${params.lesson.keyFacts.map((f) => `- ${f}`).join("\n")}

Write the script for one vertical animated video of 45-110 seconds (max 2 minutes).
"narration" is what the voice says in that scene: spoken, punchy, 12-40 words, total 130-260 words.
Tell it like a Draw My Life story: the narrator talks to the viewer, is funny and dramatic, and uses
at least 2 comic references (e.g. "this enzyme is the Gordon Ramsay of your stomach"). On-screen texts
must be SHORT. Emojis are the doodles (they get drawn on the paper). Start with a hook in the first 2
seconds (shocking fact, crazy question or joke). Include an absurd mental image ("story") or analogy
and a memory trick when useful. Choose the scene types that best fit the content (dates → timeline/number,
processes → list, contrasts → compare...).

${SCENE_TYPES}

Return ONLY this JSON:
{"title":"catchy title <=60 chars","caption":"TikTok-style caption with 1 emoji","palette":"marker color, one of red|blue|green|orange|purple|pink","scenes":[...],"hashtags":["#tag1","#tag2","#tag3"],"takeaway":"one-sentence summary"}`,
    maxTokens: 8_000,
  });
  const script = parseJson<Record<string, unknown>>(raw);
  const scenes = Array.isArray(script.scenes)
    ? (script.scenes as Record<string, unknown>[]).filter((s) => s && typeof s.type === "string")
    : [];
  if (scenes.length < 2) throw new Error("La IA devolvió un guion vacío.");
  script.scenes = scenes.slice(0, 12);
  script.keyFacts = params.lesson.keyFacts;
  return script;
}
