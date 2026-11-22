import { useEffect, useState } from "react";
import { api } from "../api/client";

/** Key for "already have a bet on this player's stat". By name, not id: Best Bets saves
 *  ESPN ids and the player page saves NBA ids. */
export function betKey(playerName: string, prop: string): string {
  return `${playerName.toLowerCase()}|${prop}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** betKeys of today's saved slips (any line or side), plus a setter to mark new ones. */
export function useSavedBets() {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  useEffect(() => {
    const today = todayStr();
    api.listPicks()
      .then((picks) => setSaved((prev) => {
        const next = new Set(prev);
        for (const p of picks) if (p.game_date === today) next.add(betKey(p.player_name, p.prop));
        return next;
      }))
      .catch(() => {});
  }, []);
  const add = (playerName: string, prop: string) => setSaved((prev) => new Set(prev).add(betKey(playerName, prop)));
  return [saved, add] as const;
}
