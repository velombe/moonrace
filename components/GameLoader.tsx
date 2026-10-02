"use client";

import dynamic from "next/dynamic";

// Three.js needs the browser, so the game is never server-rendered.
const GameClient = dynamic(() => import("./GameClient"), {
  ssr: false,
  loading: () => <div className="loading" style={{ position: "fixed" }}>Preparing the launch pad</div>,
});

export default function GameLoader() {
  return <GameClient />;
}
