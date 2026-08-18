import type { Metadata } from "next";
import { GameShell } from "./components/GameShell";

export const metadata: Metadata = {
  title: "Crafty — The Crucible",
  description: "Craft maps, shape rare equipment, and survive escalating monster waves in a browser-based action RPG.",
};

export default function Home() {
  return <GameShell />;
}
