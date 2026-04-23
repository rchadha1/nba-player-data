import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { BetPick, PickStats } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inp = "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const sel = "h-9 rounded-md border border-input bg-background px-3 text-sm";

const PROPS = ["PTS","REB","AST","STL","BLK","3PT","3PA","FTM","PTS+REB+AST","PTS+REB","PTS+AST","AST+REB"];

const resultColor = (r: string | null) =>
  r === "WIN"  ? "text-emerald-600 dark:text-emerald-400 font-semibold" :
  r === "LOSS" ? "text-red-500 dark:text-red-400 font-semibold" :
  r === "PUSH" ? "text-muted-foreground" : "text-muted-foreground italic";

const gradeColor = (g: string | null) =>
  g === "STRONG" ? "bg-emerald-500 text-white" :
  g === "LEAN"   ? "bg-amber-400 text-black" :
  g === "SKIP"   ? "bg-muted text-muted-foreground" : "";

export default function Bets() {
  const [picks, setPicks]     = useState<BetPick[]>([]);
  const [stats, setStats]     = useState<PickStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [form, setForm] = useState({
    game_date:    new Date().toISOString().slice(0, 10),
    game_label:   "",
    player_name:  "",
    prop:         "PTS",
    line:         "",
    pick:         "OVER" as "OVER" | "UNDER",
    result:       "" as "" | "WIN" | "LOSS" | "PUSH",
    actual_value: "",
    line_type:    "standard" as "standard" | "goblin" | "demon",
    grade:        "" as "" | "STRONG" | "LEAN" | "SKIP",
    notes:        "",
  });

  const [editId,     setEditId]     = useState<number | null>(null);
  const [editResult, setEditResult] = useState<"WIN" | "LOSS" | "PUSH" | "">("");
  const [editActual, setEditActual] = useState("");

  async function load() {
    setLoading(true);
    const [p, s] = await Promise.all([api.listPicks(), api.getPickStats()]);
    setPicks(p);
    setStats(s);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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
      notes:        form.notes        || undefined,
    });
    setForm(f => ({ ...f, player_name: "", line: "", actual_value: "", notes: "", result: "", grade: "" }));
    await load();
    setSaving(false);
  }

  async function handleUpdateResult(id: number) {
    if (!editResult) return;
    await api.updatePick(id, {
      result:       editResult,
      actual_value: editActual ? parseFloat(editActual) : undefined,
    });
    setEditId(null); setEditResult(""); setEditActual("");
    await load();
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
              <div className="text-xs text-muted-foreground mt-1">{stats.wins}W / {stats.losses}L</div>
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
              {Object.entries(stats.by_prop).slice(0, 6).map(([p, s]) => (
                <div key={p} className="flex items-center justify-between text-xs py-0.5">
                  <span className="font-mono">{p}</span>
                  <span>{s.win_rate != null ? `${Math.round(s.win_rate * 100)}%` : "—"} ({s.total})</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Add Pick</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input className={cn(inp, "col-span-2 sm:col-span-3")} placeholder="Game label (e.g. Pistons vs Magic G2)"
              value={form.game_label} onChange={e => setForm(f => ({ ...f, game_label: e.target.value }))} />
            <input className={inp} type="date" value={form.game_date}
              onChange={e => setForm(f => ({ ...f, game_date: e.target.value }))} />
            <input className={inp} placeholder="Player name" value={form.player_name}
              onChange={e => setForm(f => ({ ...f, player_name: e.target.value }))} />
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
            <select className={sel} value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value as "" | "STRONG" | "LEAN" | "SKIP" }))}>
              <option value="">Grade (opt)</option>
              <option value="STRONG">STRONG</option>
              <option value="LEAN">LEAN</option>
              <option value="SKIP">SKIP</option>
            </select>
            <select className={sel} value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value as "" | "WIN" | "LOSS" | "PUSH" }))}>
              <option value="">Result (opt)</option>
              <option value="WIN">WIN</option>
              <option value="LOSS">LOSS</option>
              <option value="PUSH">PUSH</option>
            </select>
            <input className={inp} type="number" placeholder="Actual value (opt)" step="0.1" value={form.actual_value}
              onChange={e => setForm(f => ({ ...f, actual_value: e.target.value }))} />
            <input className={cn(inp, "col-span-2 sm:col-span-1")} placeholder="Notes (opt)" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
          <PickTable picks={pending} editId={editId} editResult={editResult} editActual={editActual}
            onEdit={id => { setEditId(id); setEditResult(""); setEditActual(""); }}
            onEditResult={setEditResult} onEditActual={setEditActual}
            onSaveResult={handleUpdateResult} onDelete={handleDelete} />
        </div>
      )}

      {settled.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Settled ({settled.length})</h2>
          <PickTable picks={settled} editId={editId} editResult={editResult} editActual={editActual}
            onEdit={id => { setEditId(id); setEditResult(""); setEditActual(""); }}
            onEditResult={setEditResult} onEditActual={setEditActual}
            onSaveResult={handleUpdateResult} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}

function PickTable({ picks, editId, editResult, editActual, onEdit, onEditResult, onEditActual, onSaveResult, onDelete }: {
  picks: BetPick[];
  editId: number | null;
  editResult: string;
  editActual: string;
  onEdit: (id: number) => void;
  onEditResult: (v: "WIN" | "LOSS" | "PUSH" | "") => void;
  onEditActual: (v: string) => void;
  onSaveResult: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const groups: Record<string, BetPick[]> = {};
  for (const p of picks) {
    const key = p.game_label || p.game_date || "No game";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([game, gpicks]) => {
        const wins   = gpicks.filter(p => p.result === "WIN").length;
        const losses = gpicks.filter(p => p.result === "LOSS").length;
        const nSettled = wins + losses;
        return (
          <div key={game} className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-muted/50 flex items-center justify-between border-b">
              <span className="text-sm font-semibold">{game}</span>
              {nSettled > 0 && <span className="text-xs text-muted-foreground">{wins}W / {losses}L</span>}
            </div>
            <div className="divide-y divide-border">
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

                  {editId === pick.id ? (
                    <div className="flex gap-2 items-center mt-1 flex-wrap">
                      <select value={editResult} onChange={e => onEditResult(e.target.value as "WIN" | "LOSS" | "PUSH" | "")}
                        className="h-8 text-xs rounded border border-input bg-background px-2">
                        <option value="">Result</option>
                        <option value="WIN">WIN</option>
                        <option value="LOSS">LOSS</option>
                        <option value="PUSH">PUSH</option>
                      </select>
                      <input type="number" placeholder="Actual" step="0.1" value={editActual}
                        onChange={e => onEditActual(e.target.value)}
                        className="h-8 text-xs w-24 rounded border border-input bg-background px-2" />
                      <Button size="sm" className="h-8 text-xs" onClick={() => onSaveResult(pick.id)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onEdit(-1)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-0.5">
                      <button onClick={() => onEdit(pick.id)}
                        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                        {pick.result ? "Edit result" : "Set result"}
                      </button>
                      <button onClick={() => onDelete(pick.id)}
                        className="text-xs text-red-400 hover:text-red-600 underline-offset-2 hover:underline">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
