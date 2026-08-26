"""Recuperación puntual de un borrado accidental: 17 trabajos DONE se marcaron como eliminados
por error el 2026-08-26 hacia las 11:00 UTC (confirmado con el usuario). Este script deshace el
borrado en storage/app.db (la copia ya restaurada por el paso anterior del workflow) usando como
referencia la base de datos de un commit anterior al borrado, que el paso que llama a este script
ya ha dejado en disco. Solo toca las filas de los IDs indicados; no hace nada más.

Uso: python3 recover_deleted_jobs.py <ruta-app.db-antigua> <id1> <id2> ...
"""

import sqlite3
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("Uso: recover_deleted_jobs.py <old-app.db> <id1> [id2 ...]")
        return 1

    old_db_path = sys.argv[1]
    ids = sys.argv[2:]

    old = sqlite3.connect(old_db_path)
    new = sqlite3.connect("storage/app.db")
    oc = old.cursor()
    nc = new.cursor()

    for job_id in ids:
        oc.execute(
            "SELECT sourceFilePath, bottomVideoFilePath, coverImagePath FROM Job WHERE id=?",
            (job_id,),
        )
        row = oc.fetchone()
        if row is None:
            print(f"[recuperación] AVISO: {job_id} no está en la base de datos antigua, se omite")
            continue
        source_path, bottom_path, cover_path = row
        nc.execute(
            "UPDATE Job SET deletedAt=NULL, sourceFilePath=?, bottomVideoFilePath=?, coverImagePath=? "
            "WHERE id=?",
            (source_path, bottom_path, cover_path, job_id),
        )
        print(f"[recuperación] {job_id}: filas actualizadas = {nc.rowcount}")

    new.commit()
    old.close()
    new.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
