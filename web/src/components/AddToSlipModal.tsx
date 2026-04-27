import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BetEvaluation } from "@/lib/betEvaluator";

const inp = "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

const PROPS = ["PTS","REB","AST","STL","BLK","3PT","3PA","FTM","2PM","PTS+REB+AST","PTS+REB","PTS+AST","AST+REB"];

function toLocalDateStr(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  bet: BetEvaluation;
  playerId: string | null;
  playerName: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddToSlipModal({ bet, playerId, playerName, onClose, onAdded }: Props) {
  // Slip mode: existing or new
  const [slipMode, setSlipMode] = useState<"existing" | "new">("existing");
  const [existingSlips, setExistingSlips] = useState<{ label: string; game_date: string | null }[]>([]);

  // Playoff games + roster (new slip flow)
  const [playoffGames, setPlayoffGames] = useState<{
    id: string; label: string; game_date: string; completed: boolean;
    home_score: string; away_score: string; away_abbr: string; home_abbr: string;
  }[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [rosterPlayers, setRosterPlayers] = useState<{ name: string; team_abbr: string }[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    game_date:    todayStr(),
    game_label:   "",
    player_name:  playerName,
    prop:         bet.prop,
    line:         String(bet.line),
    pick:         (bet.direction === "over" ? "OVER" : "UNDER") as "OVER" | "UNDER",
    line_type:    "standard" as "standard" | "goblin" | "demon",
    grade:        bet.grade as "" | "STRONG" | "LEAN" | "SKIP",
    result:       "" as "" | "WIN" | "LOSS" | "PUSH",
    actual_value: "",
    notes:        "",
  });

  useEffect(() => {
    // Load existing slips (unique game_labels from current picks)
    api.listPicks().then(picks => {
      const seen = new Map<string, string | null>();
      for (const p of picks) {
        const key = p.game_label ?? "";
        if (key && !seen.has(key)) seen.set(key, p.game_date);
      }
      setExistingSlips(Array.from(seen.entries()).map(([label, game_date]) => ({ label, game_date })));
    }).catch(() => {});

    // Load playoff games for new slip flow
    api.getPlayoffGames().catch(() => []).then(g => setPlayoffGames(g ?? []));
  }, []);

  function handleExistingSlipSelect(label: string) {
    const slip = existingSlips.find(s => s.label === label);
    setForm(f => ({
      ...f,
      game_label: label,
      game_date:  slip?.game_date ?? f.game_date,
    }));
  }

  async function handleGameSelect(gameId: string) {
    setSelectedGameId(gameId);
    setRosterPlayers([]);
    setForm(f => ({ ...f, player_name: playerName }));

    const game = playoffGames.find(g => g.id === gameId);
    if (!game) return;
    setForm(f => ({ ...f, game_label: game.label, game_date: toLocalDateStr(game.game_date) }));

    setRosterLoading(true);
    try {
      const roster = await api.getGameRoster(gameId);
      const players = Object.values(roster).flatMap(team =>
        team.players.map(p => ({ name: p.name, team_abbr: team.abbr }))
      );
      setRosterPlayers(players);
      const match = players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
      if (match) setForm(f => ({ ...f, player_name: match.name }));
    } catch {
      setRosterPlayers([]);
    } finally {
      setRosterLoading(false);
    }
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!form.player_name || !form.line) return;
    setSaving(true);
    try {
      await api.createPick({
        game_date:       form.game_date    || undefined,
        game_label:      form.game_label   || undefined,
        player_id:       playerId          ?? undefined,
        player_name:     form.player_name,
        prop:            form.prop,
        line:            parseFloat(form.line),
        pick:            form.pick,
        line_type:       form.line_type,
        grade:           form.grade        || undefined,
        result:          form.result       || undefined,
        actual_value:    form.actual_value ? parseFloat(form.actual_value) : undefined,
        predicted_value: bet.expected,
        notes:           form.notes        || undefined,
      });
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md bg-background border border-border rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-sm">Add to Bet Slip</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 grid grid-cols-2 gap-2 overflow-y-auto">

          {/* Slip mode toggle */}
          <div className="col-span-2 flex rounded-md border border-input overflow-hidden text-sm">
            {(["existing", "new"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setSlipMode(mode)}
                className={cn(
                  "flex-1 py-1.5 font-medium transition-colors",
                  slipMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                {mode === "existing" ? "Existing Slip" : "New Slip"}
              </button>
            ))}
          </div>

          {slipMode === "existing" ? (
            <>
              {existingSlips.length === 0 ? (
                <p className="col-span-2 text-xs text-muted-foreground py-1">No existing slips found.</p>
              ) : (
                <select
                  className={cn(sel, "col-span-2")}
                  value={form.game_label}
                  onChange={e => handleExistingSlipSelect(e.target.value)}
                >
                  <option value="">— Choose a slip —</option>
                  {existingSlips.map(s => (
                    <option key={s.label} value={s.label}>
                      {s.label}{s.game_date ? ` · ${s.game_date}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : (
            <>
              {/* Playoff game dropdown */}
              <select
                className={cn(sel, "col-span-2")}
                value={selectedGameId}
                onChange={e => handleGameSelect(e.target.value)}
              >
                <option value="">— Select playoff game —</option>
                {playoffGames.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                    {g.completed ? ` (${g.away_score}–${g.home_score})` : ""}
                    {" · "}{toLocalDateStr(g.game_date)}
                  </option>
                ))}
              </select>

              <input className={cn(inp, "col-span-1")} type="date" value={form.game_date}
                onChange={e => setForm(f => ({ ...f, game_date: e.target.value }))} />

              <input className={cn(inp, "col-span-1")} placeholder="Slip name / game label"
                value={form.game_label}
                onChange={e => setForm(f => ({ ...f, game_label: e.target.value }))} />

              {/* Player selector */}
              {rosterPlayers.length > 0 ? (
                <select
                  className={cn(sel, "col-span-2")}
                  value={form.player_name}
                  onChange={e => setForm(f => ({ ...f, player_name: e.target.value }))}
                >
                  <option value="">— Select player —</option>
                  {Object.entries(
                    rosterPlayers.reduce<Record<string, string[]>>((acc, p) => {
                      (acc[p.team_abbr] ??= []).push(p.name);
                      return acc;
                    }, {})
                  ).map(([abbr, names]) => (
                    <optgroup key={abbr} label={abbr}>
                      {names.map(n => <option key={n} value={n}>{n}</option>)}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input
                  className={cn(inp, "col-span-2")}
                  placeholder={rosterLoading ? "Loading players…" : "Player name"}
                  value={form.player_name}
                  disabled={rosterLoading}
                  onChange={e => setForm(f => ({ ...f, player_name: e.target.value }))}
                />
              )}
            </>
          )}

          {/* Prop + line + direction (shared) */}
          <select className={sel} value={form.prop}
            onChange={e => setForm(f => ({ ...f, prop: e.target.value }))}>
            {PROPS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <input className={inp} type="number" placeholder="Line" step="0.5" value={form.line}
            onChange={e => setForm(f => ({ ...f, line: e.target.value }))} />

          <select className={sel} value={form.pick}
            onChange={e => setForm(f => ({ ...f, pick: e.target.value as "OVER" | "UNDER" }))}>
            <option value="OVER">OVER</option>
            <option value="UNDER">UNDER</option>
          </select>

          <select className={sel} value={form.line_type}
            onChange={e => setForm(f => ({ ...f, line_type: e.target.value as "standard" | "goblin" | "demon" }))}>
            <option value="standard">Standard</option>
            <option value="goblin">Goblin</option>
            <option value="demon">Demon</option>
          </select>

          <select className={sel} value={form.grade}
            onChange={e => setForm(f => ({ ...f, grade: e.target.value as "" | "STRONG" | "LEAN" | "SKIP" }))}>
            <option value="">Grade (opt)</option>
            <option value="STRONG">STRONG</option>
            <option value="LEAN">LEAN</option>
            <option value="SKIP">SKIP</option>
          </select>

          <select className={sel} value={form.result}
            onChange={e => setForm(f => ({ ...f, result: e.target.value as "" | "WIN" | "LOSS" | "PUSH" }))}>
            <option value="">Result (opt)</option>
            <option value="WIN">WIN</option>
            <option value="LOSS">LOSS</option>
            <option value="PUSH">PUSH</option>
          </select>

          <input className={inp} type="number" placeholder="Actual value (opt)" step="0.1"
            value={form.actual_value}
            onChange={e => setForm(f => ({ ...f, actual_value: e.target.value }))} />

          <input className={inp} placeholder="Notes (opt)" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

          <Button type="submit" disabled={saving || !form.player_name || !form.line} className="col-span-2 mt-1">
            {saving ? "Saving…" : "Add to Slip"}
          </Button>
        </form>
      </div>
    </div>
  );
}
