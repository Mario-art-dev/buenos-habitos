import { spawn } from "child_process";

// Sin límite, un ffmpeg/yt-dlp colgado (red bloqueada a medias, proceso zombie...) deja la promesa
// sin resolver NUNCA — root cause real de clips que se quedan "pillados" en Regenerando para
// siempre: el que espera esta promesa (p.ej. regenerateRankingClip) nunca termina, así que
// renderPending se queda a true en la base de datos para siempre y el clip no se puede volver a
// tocar. 20 minutos es de sobra para cualquier llamada real de este proyecto (el vídeo más largo
// que se descarga/procesa tarda mucho menos), pero garantiza que SIEMPRE se acaba resolviendo o
// fallando, nunca colgado sin fin.
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

export function run(command: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `"${command} ${args.join(" ")}" no terminó en ${Math.round(timeoutMs / 60_000)} minutos (proceso colgado) — se ha matado.`
        )
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`No se pudo ejecutar "${command}": ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`"${command} ${args.join(" ")}" falló (código ${code}):\n${stderr.slice(-4000)}`));
      }
    });
  });
}
