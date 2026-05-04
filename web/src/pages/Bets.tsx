import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/api/client";
import type { BetPick, PickStats, BetResult } from "@/api/client";
import { EditPickModal } from "@/components/EditPickModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, ChevronDown, ChevronRight } from "lucide-react";

const inp = "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const sel = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function ResultSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className ?? sel}>
      <option value="">Result</option>
      <option value="WIN">WIN</option>
      <option value="LOSS">LOSS</option>
      <option value="PUSH">PUSH</option>
      <option value="VOID">VOID</option>
    </select>
  );
}

function GradeSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className ?? sel}>
      <option value="">Grade</option>
      <option value="STRONG">STRONG</option>
      <option value="LEAN">LEAN</option>
      <option value="SKIP">SKIP</option>
    </select>
  );
}

const PROPS = ["PTS","REB","AST","STL","BLK","3PT","3PA","FTM","2PM","PTS+REB+AST","PTS+REB","PTS+AST","AST+REB"];

const resultColor = (r: string | null) =>
  r === "WIN"  ? "text-emerald-600 dark:text-emerald-400 font-semibold" :
  r === "LOSS" ? "text-red-500 dark:text-red-400 font-semibold" :
  r === "PUSH" ? "text-muted-foreground" :
  r === "VOID" ? "text-gray" : "text-muted-foreground italic"

const gradeColor = (g: string | null) =>
  g === "STRONG" ? "bg-emerald-500 text-white" :
  g === "LEAN"   ? "bg-amber-400 text-black" :
  g === "SKIP"   ? "bg-muted text-muted-foreground" : "";

// ---------------------------------------------------------------------------
// Markdown → simple React nodes (bold, headers, bullets only)
// ---------------------------------------------------------------------------
function MdReport({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("## "))  return <h2 key={i} className="text-base font-bold mt-3 mb-1">{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-3 mb-1 text-primary">{line.slice(4)}</h3>;
        if (line === "---")           return <hr key={i} className="border-border my-3" />;
        if (line.startsWith("- ")) {
          const inner = line.slice(2).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
          return <li key={i} className="ml-4 list-disc text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: inner }} />;
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        // Bold spans inside regular lines
        const boldified = line.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
        const isStatLine = /^\d+ PTS/.test(line.trim());
        return (
          <p key={i}
            className={cn("text-xs", isStatLine ? "font-mono text-muted-foreground" : "")}
            dangerouslySetInnerHTML={{ __html: boldified }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis modal
// ---------------------------------------------------------------------------
function AnalysisModal({ gameLabel, gameDate, onClose }: {
  gameLabel: string;
  gameDate: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [report, setReport]   = useState<string | null>(null);
  const [error, setError]     = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.analyzeGame({ game_label: gameLabel, game_date: gameDate || undefined })
      .then(r => {
        if (r.error && !r.report) setError(r.error);
        else setReport(r.report);
      })
      .catch(() => setError("Failed to load analysis. Try again."))
      .finally(() => setLoading(false));
  }, [gameLabel, gameDate]);

  // Close on backdrop click
  function onBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onBackdrop}
    >
      <div
        ref={panelRef}
        className="relative w-full max-w-2xl max-h-[85vh] bg-background border border-border rounded-2xl shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-sm">{gameLabel} — Analysis</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 flex-1">
          {loading && (
            <div className="flex justify-center py-16">
              <span className="h-7 w-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {report && <MdReport text={report} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
function toLocalDateStr(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Bets() {
  const [picks, setPicks]     = useState<BetPick[]>([]);
  const [stats, setStats]     = useState<PickStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [analysis, setAnalysis] = useState<{ gameLabel: string; gameDate: string } | null>(null);

  // Playoff games dropdown
  const [playoffGames, setPlayoffGames] = useState<{ id: string; label: string; game_date: string; completed: boolean; home_score: string; away_score: string; away_abbr: string; home_abbr: string }[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");

  // Roster for selected game: [{name, team_abbr}]
  const [rosterPlayers, setRosterPlayers] = useState<{ name: string; team_abbr: string }[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  const [form, setForm] = useState({
    game_date:    (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
    game_label:   "",
    player_name:  "",
    prop:         "PTS",
    line:         "",
    pick:         "OVER" as "OVER" | "UNDER",
    result:       "" as BetResult | "",
    actual_value: "",
    line_type:    "standard" as "standard" | "goblin" | "demon",
    grade:        "" as "" | "STRONG" | "LEAN" | "SKIP",
    notes:        "",
  });

  const [slipMode, setSlipMode] = useState<"existing" | "new">("new");
  const notesRef = useRef<HTMLInputElement>(null);

  const [editPick, setEditPick] = useState<BetPick | null>(null);

  async function load() {
    setLoading(true);
    const [p, s] = await Promise.all([api.listPicks(), api.getPickStats()]);
    setPicks(p);
    setStats(s);
    setLoading(false);
  }

  useEffect(() => {
    load();
    api.getPlayoffGames().then(setPlayoffGames).catch(() => {});
  }, []);

  async function handleGameSelect(gameId: string, rosterOnly = false) {
    setSelectedGameId(gameId);
    setRosterPlayers([]);
    if (!rosterOnly) {
      setForm(f => ({ ...f, player_name: "" }));
      const game = playoffGames.find(g => g.id === gameId);
      if (game) setForm(f => ({ ...f, game_label: game.label, game_date: toLocalDateStr(game.game_date) }));
    }

    if (gameId) {
      setRosterLoading(true);
      try {
        const roster = await api.getGameRoster(gameId);
        const players = Object.values(roster).flatMap(team =>
          team.players.map(p => ({ name: p.name, team_abbr: team.abbr }))
        );
        setRosterPlayers(players);
      } catch {
        setRosterPlayers([]);
      } finally {
        setRosterLoading(false);
      }
    }
  }

  async function handleCreate(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!form.player_name || !form.line) return;
    setSaving(true);
    await api.createPick({
      game_date:    form.game_date   || undefined,
      game_label:   form.game_label  || undefined,
      player_name:  form.player_name,
      prop:         form.prop,
      line:         parseFloat(form.line),
      pick:         form.pick,
      result:       form.result       || undefined,
      actual_value: form.actual_value ? parseFloat(form.actual_value) : undefined,
      line_type:    form.line_type,
      grade:        form.grade        || undefined,
      notes:        notesRef.current?.value || undefined,
    });
    if (notesRef.current) notesRef.current.value = "";
    setForm(f => ({ ...f, player_name: "", line: "", actual_value: "", result: "", grade: "" }));
    await load();
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this pick?")) return;
    await api.deletePick(id);
    await load();
  }

  const pending = picks.filter(p => !p.result);
  const settled = picks.filter(p =>  p.result);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Bet Picks</h1>

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground mt-1">Total settled</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-emerald-600">
                {stats.win_rate != null ? `${Math.round(stats.win_rate * 100)}%` : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {stats.wins}W / {stats.losses}L{stats.voids > 0 ? ` · ${stats.voids} void` : ""}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">By grade</div>
              {Object.entries(stats.by_grade).map(([g, s]) => (
                <div key={g} className="flex items-center justify-between text-xs py-0.5">
                  <span className={cn("px-1.5 py-0.5 rounded font-semibold", gradeColor(g))}>{g || "none"}</span>
                  <span>{s.win_rate != null ? `${Math.round(s.win_rate * 100)}%` : "—"} ({s.total})</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">By prop</div>
              {Object.entries(stats.by_prop).map(([p, s]) => (
                <div key={p} className="flex items-center justify-between text-xs py-0.5">
                  <span className="font-mono">{p}</span>
                  <span className="text-muted-foreground">
                    {s.wins}W {s.losses}L
                    {s.win_rate != null && (
                      <span className={cn("ml-1.5 font-semibold", s.win_rate >= 0.55 ? "text-emerald-500" : s.win_rate < 0.45 ? "text-red-400" : "")}>
                        {Math.round(s.win_rate * 100)}%
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {stats && Object.keys(stats.by_prop_pick).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Prop Direction Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-2 font-semibold">Prop</th>
                    <th className="px-3 py-2 font-semibold text-center">OVER W</th>
                    <th className="px-3 py-2 font-semibold text-center">OVER L</th>
                    <th className="px-3 py-2 font-semibold text-center">OVER %</th>
                    <th className="px-3 py-2 font-semibold text-center">UNDER W</th>
                    <th className="px-3 py-2 font-semibold text-center">UNDER L</th>
                    <th className="px-3 py-2 font-semibold text-center">UNDER %</th>
                    <th className="px-3 py-2 font-semibold text-center">Total %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.by_prop_pick).map(([prop, dirs]) => {
                    const over  = dirs["OVER"]  ?? { wins: 0, losses: 0, total: 0, win_rate: null };
                    const under = dirs["UNDER"] ?? { wins: 0, losses: 0, total: 0, win_rate: null };
                    const totalW = over.wins + under.wins;
                    const totalL = over.losses + under.losses;
                    const totalT = totalW + totalL;
                    const totalRate = totalT ? totalW / totalT : null;
                    const pct = (r: number | null) => r != null ? `${Math.round(r * 100)}%` : "—";
                    const rateClass = (r: number | null) =>
                      r == null ? "text-muted-foreground" : r >= 0.55 ? "text-emerald-500 font-semibold" : r < 0.45 ? "text-red-400 font-semibold" : "";
                    return (
                      <tr key={prop} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono font-semibold">{prop}</td>
                        <td className="px-3 py-2 text-center">{over.wins}</td>
                        <td className="px-3 py-2 text-center">{over.losses}</td>
                        <td className={cn("px-3 py-2 text-center", rateClass(over.win_rate))}>{pct(over.win_rate)}</td>
                        <td className="px-3 py-2 text-center">{under.wins}</td>
                        <td className="px-3 py-2 text-center">{under.losses}</td>
                        <td className={cn("px-3 py-2 text-center", rateClass(under.win_rate))}>{pct(under.win_rate)}</td>
                        <td className={cn("px-3 py-2 text-center", rateClass(totalRate))}>{pct(totalRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Add Pick</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {/* Slip mode toggle */}
            <div className="col-span-2 sm:col-span-3 flex rounded-md border border-input overflow-hidden text-sm">
              {(["existing", "new"] as const).map(mode => (
                <button key={mode} type="button" onClick={() => { setSlipMode(mode); if (mode === "existing") load(); }}
                  className={cn("flex-1 py-1.5 font-medium transition-colors",
                    slipMode === mode ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                  )}>
                  {mode === "existing" ? "Add to Existing Slip" : "New Slip"}
                </button>
              ))}
            </div>

            {slipMode === "existing" ? (
              <select
                className={cn(sel, "col-span-2 sm:col-span-3")}
                value={form.game_label && form.game_date ? `${form.game_label}||${form.game_date}` : form.game_label}
                onChange={e => {
                  const [label, date] = e.target.value.split("||");
                  setForm(f => ({ ...f, game_label: label, game_date: date ?? f.game_date }));
                  const match = playoffGames.find(g => g.label === label);
                  if (match) handleGameSelect(match.id, true);
                  else setRosterPlayers([]);
                }}
              >
                <option value="">— Choose existing slip —</option>
                {Array.from(
                  new Map(
                    picks
                      .filter(p => p.game_label)
                      .map(p => {
                        const compositeKey = p.game_date ? `${p.game_label}||${p.game_date}` : p.game_label!;
                        return [compositeKey, { label: p.game_label!, date: p.game_date }] as const;
                      })
                  ).entries()
                ).map(([key, { label, date }]) => (
                  <option key={key} value={key}>{label}{date ? ` · ${date}` : ""}</option>
                ))}
              </select>
            ) : (
              <>
                <select
                  className={cn(sel, "col-span-2 sm:col-span-2")}
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
                <input className={inp} type="date" value={form.game_date}
                  onChange={e => setForm(f => ({ ...f, game_date: e.target.value }))} />
              </>
            )}

            {/* Player selector — dropdown when roster loaded, text fallback */}
            {rosterPlayers.length > 0 ? (
              <select
                className={cn(sel, "col-span-2 sm:col-span-1")}
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
                className={cn(inp, "col-span-2 sm:col-span-1")}
                placeholder={rosterLoading ? "Loading players…" : "Player name"}
                value={form.player_name}
                disabled={rosterLoading}
                onChange={e => setForm(f => ({ ...f, player_name: e.target.value }))}
              />
            )}
            <select className={sel} value={form.prop} onChange={e => setForm(f => ({ ...f, prop: e.target.value }))}>
              {PROPS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className={inp} type="number" placeholder="Line" step="0.5" value={form.line}
              onChange={e => setForm(f => ({ ...f, line: e.target.value }))} />
            <select className={sel} value={form.pick} onChange={e => setForm(f => ({ ...f, pick: e.target.value as "OVER" | "UNDER" }))}>
              <option value="OVER">OVER</option>
              <option value="UNDER">UNDER</option>
            </select>
            <select className={sel} value={form.line_type} onChange={e => setForm(f => ({ ...f, line_type: e.target.value as "standard" | "goblin" | "demon" }))}>
              <option value="standard">Standard</option>
              <option value="goblin">Goblin</option>
              <option value="demon">Demon</option>
            </select>
            <GradeSelect value={form.grade} onChange={v => setForm(f => ({ ...f, grade: v as "" | "STRONG" | "LEAN" | "SKIP" }))} />
            <ResultSelect value={form.result} onChange={v => setForm(f => ({ ...f, result: v as BetResult | "" }))} />
            <input className={inp} type="number" placeholder="Actual value (opt)" step="0.1" value={form.actual_value}
              onChange={e => setForm(f => ({ ...f, actual_value: e.target.value }))} />
            <input className={cn(inp, "col-span-2 sm:col-span-1")} placeholder="Notes (opt)" ref={notesRef} defaultValue="" />
            <Button type="submit" disabled={saving} className="col-span-2 sm:col-span-3">
              {saving ? "Saving…" : "Add Pick"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pending ({pending.length})</h2>
          <PickTable picks={pending} onEdit={setEditPick} onDelete={handleDelete}
            onAnalyze={(label, date) => setAnalysis({ gameLabel: label, gameDate: date })} />
        </div>
      )}

      {settled.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Settled ({settled.length})</h2>
          <PickTable picks={settled} onEdit={setEditPick} onDelete={handleDelete}
            onAnalyze={(label, date) => setAnalysis({ gameLabel: label, gameDate: date })} />
        </div>
      )}

      {analysis && (
        <AnalysisModal
          gameLabel={analysis.gameLabel}
          gameDate={analysis.gameDate}
          onClose={() => setAnalysis(null)}
        />
      )}

      {editPick && (
        <EditPickModal
          pick={editPick}
          onClose={() => setEditPick(null)}
          onSaved={() => { setEditPick(null); load(); }}
        />
      )}
    </div>
  );
}

function PickTable({ picks, onEdit, onDelete, onAnalyze }: {
  picks: BetPick[];
  onEdit: (pick: BetPick) => void;
  onDelete: (id: number) => void;
  onAnalyze: (gameLabel: string, gameDate: string) => void;
}) {
  const { isPremium } = useAuth();
  const groups: Record<string, BetPick[]> = {};
  for (const p of picks) {
    const key = p.game_label
      ? (p.game_date ? `${p.game_label} · ${p.game_date}` : p.game_label)
      : (p.game_date || "No game");
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([game, gpicks]) => {
        const wins     = gpicks.filter(p => p.result === "WIN").length;
        const losses   = gpicks.filter(p => p.result === "LOSS").length;
        const nSettled = wins + losses;
        const gameDate  = gpicks.find(p => p.game_date)?.game_date ?? "";
        const gameLabel = gpicks.find(p => p.game_label)?.game_label ?? game;
        const isCollapsed = !!collapsed[game];
        return (
          <div key={game} className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-muted/50 flex items-center justify-between border-b gap-2">
              <button onClick={() => toggle(game)} className="flex items-center gap-1.5 text-sm font-semibold truncate hover:text-primary transition-colors">
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                {game}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                {nSettled > 0 && <span className="text-xs text-muted-foreground">{wins}W / {losses}L</span>}
                {nSettled > 0 && isPremium && (
                  <button
                    onClick={() => onAnalyze(gameLabel, gameDate)}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    Analyze
                  </button>
                )}
              </div>
            </div>
            {!isCollapsed && <div className="divide-y divide-border">
              {gpicks.map(pick => (
                <div key={pick.id} className="px-4 py-2.5 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {pick.grade && (
                      <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded", gradeColor(pick.grade))}>
                        {pick.grade}
                      </span>
                    )}
                    {pick.line_type !== "standard" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 font-semibold uppercase">
                        {pick.line_type}
                      </span>
                    )}
                    <span className="font-semibold text-sm">{pick.player_name}</span>
                    <span className="text-sm">{pick.pick} {pick.line} {pick.prop}</span>
                    <span className={cn("text-sm ml-auto", resultColor(pick.result))}>
                      {pick.result ?? "pending"}
                      {pick.actual_value != null && ` (${pick.actual_value})`}
                    </span>
                  </div>
                  {pick.notes && <p className="text-xs text-muted-foreground pl-1">{pick.notes}</p>}

                  <div className="flex gap-2 mt-0.5">
                    <button onClick={() => onEdit(pick)}
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => onDelete(pick.id)}
                      className="text-xs text-red-400 hover:text-red-600 underline-offset-2 hover:underline">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>}
          </div>
        );
      })}
    </div>
  );
}
