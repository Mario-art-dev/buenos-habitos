/** Convierte cualquier foto (incluido HEIC/HEIF de iPhone) a un JPEG razonable para subir: el
 *  servidor solo sabe procesar JPEG/PNG/WebP, y una foto de fototeca a resolución completa puede
 *  pesar varios MB, con más riesgo de que la subida falle en una conexión móvil floja. */
export async function toUploadableJpeg(file: File, maxDim = 2400, quality = 0.85): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen"))), "image/jpeg", quality)
    );
    return new File([blob], "cover.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
