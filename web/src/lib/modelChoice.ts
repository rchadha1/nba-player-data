import { useEffect, useState } from "react";

export type ModelChoice = "original" | "blend";

// Blend: each contract's chance = 90% model + 10% Kalshi's mid. Halfway test 2026-11-24:
// more accurate on all 5 nights, Solid+ profit better on 2 of 5. Pick logging stays on the original.
const BLEND_WEIGHT = 0.9;
const KEY = "modelChoice";
const EVENT = "modelchoice";

function read(): ModelChoice {
  try { return localStorage.getItem(KEY) === "blend" ? "blend" : "original"; } catch { return "original"; }
}

/** The model chosen in the nav bar (remembered per browser), its weight for evaluateBets, and a setter. */
export function useModelChoice() {
  const [choice, setChoice] = useState<ModelChoice>(read);
  useEffect(() => {
    const sync = () => setChoice(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const set = (c: ModelChoice) => {
    try { localStorage.setItem(KEY, c); } catch { /* still switches for this page view */ }
    setChoice(c);
    window.dispatchEvent(new Event(EVENT));
  };
  return { choice, weight: choice === "blend" ? BLEND_WEIGHT : 1, set };
}
