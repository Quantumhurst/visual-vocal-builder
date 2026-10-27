import { Suspense } from "react";
import CanvasHost from "../components/Canvas";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
          <h1>Visual Vocal Builder</h1>
          <p>Loading the canvas…</p>
        </main>
      }
    >
      <CanvasHost />
    </Suspense>
  );
}
