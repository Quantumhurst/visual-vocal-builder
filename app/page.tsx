import { Suspense } from "react";
import CanvasHost from "../components/Canvas";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="boot-screen">
          <span className="boot-orbit" aria-hidden="true" />
          <p className="eyebrow">VVB-01 · ORBITAL FOUNDRY</p>
          <h1>Visual Vocal Builder</h1>
          <p>Booting the bridge…</p>
        </main>
      }
    >
      <CanvasHost />
    </Suspense>
  );
}
