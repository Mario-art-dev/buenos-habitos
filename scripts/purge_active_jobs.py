"""Borrado puntual pedido por el usuario: vaciar de golpe todo lo que esté activo ahora mismo
(en cola/procesando y también lo ya terminado), EXCEPTO los 17 vídeos recién recuperados del
borrado accidental de la sesión #109 (ver recover_deleted_jobs.py) — pedido explícito: esos se
quedan, todo lo demás activo se borra. Deja tal cual lo que ya estuviera en la papelera de antes.
Reproduce exactamente el mismo borrado "de papelera" que hace el botón individual de la web (ver
DELETE en src/app/api/jobs/[id]/route.ts): borra los archivos del trabajo en disco y marca
deletedAt en su fila en vez de borrarla, para que siga apareciendo en /deleted.

Uso: python3 purge_active_jobs.py
"""

import shutil
import sqlite3
import time
from pathlib import Path

KEEP_IDS = {
    "cmt8wfp9a0000cydwxk3c7lpx", "cmt8zx3ww0000e1l2jpy89oi9", "cmt901tu40002e1l2npjkxrza",
    "cmt902on00003e1l26oqwgtrw", "cmt905dbq0004e1l2113tl6a8", "cmt907c930005e1l2z5fyvjya",
    "cmt908g890006e1l22cziwipy", "cmt9091rq0007e1l2xxbsesiv", "cmt90t4p0000ae1l2m9fahjef",
    "cmt90tsaz000be1l20uq45ut6", "cmt911x6c000de1l2hq585vzj", "cmt913mzc000fe1l208fj1ryt",
    "cmt9151vr000he1l2br7ii88a", "cmt918jur000ie1l2dly0n3co", "cmt919c6g000je1l2q4ttl9yu",
    "cmt96x9ow000ne1l2nvmo1v18", "cmt96zmbj000oe1l2xr5aor3u",
}


def main() -> int:
    db_path = Path("storage/app.db")
    jobs_root = Path("storage/jobs")

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT id, status FROM Job WHERE deletedAt IS NULL")
    rows = [r for r in cur.fetchall() if r[0] not in KEEP_IDS]

    now_ms = int(time.time() * 1000)
    for job_id, status in rows:
        job_dir = jobs_root / job_id
        shutil.rmtree(job_dir, ignore_errors=True)
        cur.execute(
            "UPDATE Job SET deletedAt=?, sourceFilePath=NULL, bottomVideoFilePath=NULL, "
            "coverImagePath=NULL WHERE id=?",
            (now_ms, job_id),
        )
        print(f"[borrado] {job_id} (estaba {status}): archivos borrados, deletedAt puesto")

    con.commit()
    con.close()
    print(f"[borrado] total: {len(rows)} trabajos movidos a la papelera")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
