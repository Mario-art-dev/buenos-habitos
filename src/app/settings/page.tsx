import { Suspense } from "react";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="mb-6 text-xl font-bold">Ajustes — Cuentas conectadas</h1>
      <Suspense>
        <SettingsClient />
      </Suspense>
    </div>
  );
}
