import type { SeriesFlowData } from "@/api/client";

interface Props {
  data: SeriesFlowData;
}

function SignalBadge({ type, text }: { type: "warning" | "info"; text: string }) {
  const base = "flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-sm";
  if (type === "warning") {
    return (
      <div className={`${base} bg-amber-50 text-amber-800 border border-amber-200`}>
        <span className="mt-0.5 shrink-0">⚠</span>
        <span>{text}</span>
      </div>
    );
  }
  return (
    <div className={`${base} bg-blue-50 text-blue-800 border border-blue-200`}>
      <span className="mt-0.5 shrink-0">ℹ</span>
      <span>{text}</span>
    </div>
  );
}

export function SeriesFlowPanel({ data }: Props) {
  if (!data.games.length) return null;

  const { games, signals, opponent, next_game_num } = data;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">
          Series Flow — G{next_game_num} vs {opponent}
        </h3>
        <span className="text-xs text-gray-500">Last {games.length} game{games.length > 1 ? "s" : ""}</span>
      </div>

      {/* Shot profile table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left py-1 pr-3 font-medium">Category</th>
              {games.map((g) => (
                <th key={g.game_num} className="text-center py-1 px-2 font-medium">
                  G{g.game_num} <span className="text-gray-400 font-normal">{g.result}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            <tr>
              <td className="py-1.5 pr-3 text-gray-600">Team 3PT</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 tabular-nums">
                  {g.team_3pt_made}/{g.team_3pt_att}
                  <span className="text-gray-400 ml-1">({g.team_3pt_pct}%)</span>
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-gray-600">Team Paint</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 tabular-nums">
                  {g.team_paint_made}/{g.team_paint_att}
                  <span className="text-gray-400 ml-1">({g.team_paint_pct}%)</span>
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-gray-600">Team FTA</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 tabular-nums">
                  {g.team_ftm}/{g.team_fta}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gray-200">
              <td className="py-1.5 pr-3 text-gray-600">Player PTS</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 font-medium tabular-nums">
                  {g.player_pts}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-gray-600">Player FTA</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 tabular-nums">
                  {g.player_fta}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-gray-600">Player Q scoring</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 text-xs tabular-nums text-gray-700">
                  {g.player_q1}/{g.player_q2}/{g.player_q3}/
                  <span className={g.player_q4_pct <= 15 && g.player_pts >= 10 ? "text-amber-600 font-semibold" : ""}>
                    {g.player_q4}
                  </span>
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-gray-600">Minutes</td>
              {games.map((g) => (
                <td key={g.game_num} className="text-center py-1.5 px-2 tabular-nums text-gray-600">
                  {g.player_min}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Signals */}
      {signals.length > 0 && (
        <div className="space-y-1.5">
          {signals.map((s, i) => (
            <SignalBadge key={i} type={s.type} text={s.text} />
          ))}
        </div>
      )}
    </div>
  );
}
