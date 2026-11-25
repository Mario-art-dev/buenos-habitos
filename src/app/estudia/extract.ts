// Lee en el navegador los archivos que sube el usuario (PDF, Word, texto, fotos de apuntes) y
// los convierte en texto + imágenes JPEG para mandárselos a la IA. Las librerías de PDF y Word
// se cargan solo cuando hacen falta, desde cdnjs.

export interface StudyImage {
  base64: string;
  mediaType: "image/jpeg";
}

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("No se pudo cargar el lector de archivos."));
        document.head.appendChild(s);
      })
    );
  }
  return loaded.get(src)!;
}

function canvasToImage(canvas: HTMLCanvasElement): StudyImage {
  const url = canvas.toDataURL("image/jpeg", 0.82);
  return { base64: url.split(",")[1], mediaType: "image/jpeg" };
}

async function imageFileToJpeg(file: File): Promise<StudyImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`No se pudo abrir la foto ${file.name}`));
      el.src = url;
    });
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasToImage(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function readPdf(file: File): Promise<{ text: string; images: StudyImage[] }> {
  await loadScript(PDFJS);
  const pdfjs = (window as any).pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((i: any) => i.str).join(" ") + "\n\n";
  }
  // PDF escaneado (sin texto): se mandan las primeras páginas como fotos.
  const images: StudyImage[] = [];
  if (text.replace(/\s/g, "").length < 200) {
    for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      images.push(canvasToImage(canvas));
    }
    text = "";
  }
  return { text, images };
}

async function readDocx(file: File): Promise<string> {
  await loadScript(MAMMOTH);
  const res = await (window as any).mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return res.value as string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function extractFiles(files: File[]): Promise<{ text: string; images: StudyImage[] }> {
  let text = "";
  const images: StudyImage[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/.test(name)) {
      images.push(await imageFileToJpeg(file));
    } else if (name.endsWith(".pdf")) {
      const r = await readPdf(file);
      text += `\n\n# ${file.name}\n${r.text}`;
      images.push(...r.images);
    } else if (name.endsWith(".docx")) {
      text += `\n\n# ${file.name}\n${await readDocx(file)}`;
    } else {
      text += `\n\n# ${file.name}\n${await file.text()}`;
    }
  }
  return { text: text.trim(), images };
}

/** Divide el texto en exactamente `parts` partes de palabras iguales (cortes donde toque). */
export function splitIntoParts(text: string, parts: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const size = Math.ceil(words.length / parts);
  return Array.from({ length: parts }, (_, i) => words.slice(i * size, (i + 1) * size).join(" "));
}
