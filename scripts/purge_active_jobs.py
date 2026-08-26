"""Borrado puntual pedido por el usuario: vaciar de golpe todo lo que esté activo ahora mismo
(en cola/procesando y también lo ya terminado), dejando tal cual lo que ya estuviera en la
papelera. Reproduce exactamente el mismo borrado "de papelera" que hace el botón individual de la
web (ver DELETE en src/app/api/jobs/[id]/route.ts): borra los archivos del trabajo en disco y
marca deletedAt en su fila en vez de borrarla, para que siga apareciendo en /deleted.

Uso: python3 purge_active_jobs.py
"""

import shutil
import sqlite3
import time
from pathlib import Path


def main() -> int:
    db_path = Path("storage/app.db")
    jobs_root = Path("storage/jobs")

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT id, status FROM Job WHERE deletedAt IS NULL")
    rows = cur.fetchall()

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
