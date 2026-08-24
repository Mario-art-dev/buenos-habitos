import { run } from "./pipeline/exec";
import { STORAGE_ROOT } from "./storagePaths";
import { config } from "./config";

export interface StorageQuotaStatus {
  usedBytes: number;
  warnBytes: number;
  blockBytes: number;
  isWarning: boolean; // por encima de warnBytes pero por debajo de blockBytes
  isBlocked: boolean; // por encima de blockBytes: no se pueden crear trabajos nuevos
}

/**
 * Tamaño real en disco de todo storage/ (vídeos, miniaturas, base de datos…), vía `du -sb` —
 * mucho más rápido que sumar `fs.stat` recorriendo miles de archivos a mano en JavaScript.
 * Si `du` no está disponible por lo que sea, se trata como "0 bytes usados" (nunca bloquea la
 * creación de trabajos por un fallo de esta comprobación en sí).
 */
export async function getStorageUsedBytes(): Promise<number> {
  try {
    const { stdout } = await run("du", ["-sb", STORAGE_ROOT]);
    const bytes = Number(stdout.split(/\s+/)[0]);
    return Number.isFinite(bytes) ? bytes : 0;
  } catch {
    return 0;
  }
}

export async function getStorageQuotaStatus(): Promise<StorageQuotaStatus> {
  const usedBytes = await getStorageUsedBytes();
  const { warnBytes, blockBytes } = config.storageQuota;
  return {
    usedBytes,
    warnBytes,
    blockBytes,
    isWarning: usedBytes >= warnBytes && usedBytes < blockBytes,
    isBlocked: usedBytes >= blockBytes,
  };
}

/**
 * Comprobación a llamar al principio de cada ruta que crea un trabajo nuevo (SINGLE/RANKING/
 * SPLIT/DOUBLE/PRODUCT/SONG, con o sin subida de archivo) — si el almacenamiento ya está al
 * límite, corta ANTES de descargar/procesar nada (que solo empeoraría las cosas) con un mensaje
 * claro para que el usuario publique o borre shorts antiguos primero.
 */
export async function assertStorageNotBlocked(): Promise<void> {
  const status = await getStorageQuotaStatus();
  if (status.isBlocked) {
    throw new Error(
      "Se ha alcanzado el límite de almacenamiento gratuito. Publica o borra shorts antiguos de la " +
        "galería para liberar hueco antes de crear uno nuevo."
    );
  }
}
