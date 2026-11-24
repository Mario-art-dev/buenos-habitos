import type { Metadata, Viewport } from "next";
import { Patrick_Hand, Permanent_Marker } from "next/font/google";
import StudyApp from "./StudyApp";

const hand = Patrick_Hand({ weight: "400", subsets: ["latin"], variable: "--font-hand", display: "swap" });
const marker = Permanent_Marker({ weight: "400", subsets: ["latin"], variable: "--font-marker", display: "swap" });

export const metadata: Metadata = { title: "Estudia — TikToks para aprender" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

export default function EstudiaPage() {
  return (
    <div className={`${hand.variable} ${marker.variable}`}>
      <StudyApp />
    </div>
  );
}
