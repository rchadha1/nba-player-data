import { useState } from "react";
import { api, PropAnalysis } from "../api/client";

const PROPS = ["PTS", "REB", "AST", "STL", "BLK", "FG3M"];

interface Props {
  playerId: number;
  playerName: string;
}

export default function PropAnalyzer({ playerId, playerName }: Props) {
  const [prop, setProp] = useState("PTS");
  const [line, setLine] = useState("");
  const [lastN, setLastN] = useState(10);
  const [result, setResult] = useState<PropAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    if (!line) return;
    setLoading(true);
    try {
      const data = await api.analyzeProp({
        player_id: playerId,
        prop,
        line: parseFloat(line),
        last_n_games: lastN,
      });
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  const recColor =
    result?.recommendation === "OVER"
      ? "green"
      : result?.recommendation === "UNDER"
      ? "red"
      : "gray";

  return (
    <div>
      <h2>{playerName} — Prop Analyzer</h2>

      <select value={prop} onChange={(e) => setProp(e.target.value)}>
        {PROPS.map((p) => <option key={p}>{p}</option>)}
      </select>

      <input
        type="number"
        placeholder="Line (e.g. 24.5)"
        value={line}
        onChange={(e) => setLine(e.target.value)}
      />

      <select value={lastN} onChange={(e) => setLastN(Number(e.target.value))}>
        {[5, 10, 15, 20].map((n) => (
          <option key={n} value={n}>Last {n} games</option>
        ))}
      </select>

      <button onClick={analyze} disabled={loading}>
        {loading ? "Analyzing..." : "Analyze"}
      </button>

      {result && (
        <div>
          <p>Average: <strong>{result.average}</strong></p>
          <p>Hit Rate: <strong>{(result.hit_rate * 100).toFixed(1)}%</strong></p>
          <p>
            Recommendation:{" "}
            <strong style={{ color: recColor }}>{result.recommendation}</strong>
          </p>
          <p style={{ fontSize: 12, color: "#666" }}>
            Last {result.last_n_games} values: [{result.game_values.join(", ")}]
          </p>
        </div>
      )}
    </div>
  );
}
