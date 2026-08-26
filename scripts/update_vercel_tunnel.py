"""Actualiza la variable de entorno TUNNEL_URL del proyecto de Vercel con la URL del
túnel de Cloudflare de la sesión actual y dispara un redeploy (vía Deploy Hook) para que
el cambio surta efecto. Pensado para llamarse desde server.yml en cada arranque de sesión;
si falla, no debe tirar abajo el servidor real (el paso que lo llama es "no crítico").
"""

import json
import os
import sys
import urllib.error
import urllib.request


def call(base_url, token, method, path, qs, body=None):
    req = urllib.request.Request(
        f"{base_url}{path}{qs}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}


def main() -> int:
    token = os.environ.get("VERCEL_TOKEN", "")
    project = os.environ.get("VERCEL_PROJECT_ID", "")
    hook_url = os.environ.get("VERCEL_DEPLOY_HOOK_URL", "")
    team = os.environ.get("VERCEL_TEAM_ID", "").strip()
    tunnel_url = os.environ.get("TUNNEL_URL", "")

    if not token or not project or not hook_url or not tunnel_url:
        print("[vercel] Faltan variables necesarias, se omite este paso.")
        return 0

    base_url = "https://api.vercel.com"
    qs = f"?teamId={team}" if team else ""

    try:
        existing_id = None
        data = call(base_url, token, "GET", f"/v9/projects/{project}/env", qs)
        for env in data.get("envs", []):
            if env.get("key") == "TUNNEL_URL" and "production" in (env.get("target") or []):
                existing_id = env["id"]
                break

        if existing_id:
            call(base_url, token, "PATCH", f"/v9/projects/{project}/env/{existing_id}", qs, {"value": tunnel_url})
            print(f"[vercel] TUNNEL_URL actualizada -> {tunnel_url}")
        else:
            call(
                base_url,
                token,
                "POST",
                f"/v10/projects/{project}/env",
                qs,
                {"key": "TUNNEL_URL", "value": tunnel_url, "type": "encrypted", "target": ["production"]},
            )
            print(f"[vercel] TUNNEL_URL creada -> {tunnel_url}")

        urllib.request.urlopen(urllib.request.Request(hook_url, method="POST"), timeout=30)
        print("[vercel] Redeploy disparado")
    except urllib.error.HTTPError as exc:
        print(f"[vercel] Aviso: fallo actualizando Vercel ({exc.code}): {exc.read().decode()[:500]}")
    except Exception as exc:  # noqa: BLE001 - nunca debe tirar el workflow
        print(f"[vercel] Aviso: fallo actualizando Vercel: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
