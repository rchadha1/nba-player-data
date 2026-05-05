import { useState } from "react";
import { X } from "lucide-react";
import { api } from "@/api/client";
import type { BetPick, BetResult } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PROPS } from "@/lib/constants";

const inp = "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";


interface Props {
  pick: BetPick;
  onClose: () => void;
  onSaved: () => void;
}

export function EditPickModal({ pick, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    player_name:  pick.player_name,
    prop:         pick.prop,
    line:         String(pick.line),
    pick_dir:     pick.pick as "OVER" | "UNDER",
    line_type:    pick.line_type as "standard" | "goblin" | "demon",
    grade:        (pick.grade ?? "") as "STRONG" | "LEAN" | "SKIP" | "",
    result:       (pick.result ?? "") as BetResult | "",
    actual_value: pick.actual_value != null ? String(pick.actual_value) : "",
    notes:        pick.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updatePick(pick.id, {
        player_name:  form.player_name  || undefined,
        prop:         form.prop,
        line:         parseFloat(form.line),
        pick:         form.pick_dir,
        line_type:    form.line_type,
        grade:        form.grade        || undefined,
        result:       form.result       || undefined,
        actual_value: form.actual_value ? parseFloat(form.actual_value) : undefined,
        notes:        form.notes        || undefined,
      });
      onSaved();
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
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-sm">Edit Pick</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 grid grid-cols-2 gap-2 overflow-y-auto">
          <input className={cn(inp, "col-span-2")} placeholder="Player name" value={form.player_name}
            onChange={e => setForm(f => ({ ...f, player_name: e.target.value }))} />

          <select className={sel} value={form.prop}
            onChange={e => setForm(f => ({ ...f, prop: e.target.value }))}>
            {PROPS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <input className={inp} type="number" placeholder="Line" step="0.5" value={form.line}
            onChange={e => setForm(f => ({ ...f, line: e.target.value }))} />

          <select className={sel} value={form.pick_dir}
            onChange={e => setForm(f => ({ ...f, pick_dir: e.target.value as "OVER" | "UNDER" }))}>
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
            onChange={e => setForm(f => ({ ...f, grade: e.target.value as "STRONG" | "LEAN" | "SKIP" | "" }))}>
            <option value="">Grade</option>
            <option value="STRONG">STRONG</option>
            <option value="LEAN">LEAN</option>
            <option value="SKIP">SKIP</option>
          </select>

          <select className={sel} value={form.result}
            onChange={e => setForm(f => ({ ...f, result: e.target.value as BetResult | "" }))}>
            <option value="">Result</option>
            <option value="WIN">WIN</option>
            <option value="LOSS">LOSS</option>
            <option value="PUSH">PUSH</option>
            <option value="VOID">VOID</option>
          </select>

          <input className={inp} type="number" placeholder="Actual value" step="0.1" value={form.actual_value}
            onChange={e => setForm(f => ({ ...f, actual_value: e.target.value }))} />

          <input className={cn(inp, "col-span-2")} placeholder="Notes (opt)" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

          <Button type="submit" disabled={saving} className="col-span-2 mt-1">
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </form>
      </div>
    </div>
  );
}
