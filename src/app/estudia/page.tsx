import type { Metadata, Viewport } from "next";
import StudyApp from "./StudyApp";

export const metadata: Metadata = { title: "Estudia — TikToks para aprender" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

export default function EstudiaPage() {
  return <StudyApp />;
}
