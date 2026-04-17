import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
  FlatList,
} from "react-native";
import { api, PropAnalysis, Team } from "../api/client";

const PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT"];

interface Props {
  playerId: number;
  playerName: string;
}

export default function PropAnalyzerScreen({ playerId, playerName }: Props) {
  const [prop, setProp] = useState("PTS");
  const [line, setLine] = useState("");
  const [result, setResult] = useState<PropAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  // Matchup opponent
  const [teams, setTeams] = useState<Team[]>([]);
  const [opponent, setOpponent] = useState<Team | null>(null);
  const [teamPickerVisible, setTeamPickerVisible] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");

  useEffect(() => {
    api.getTeams().then(setTeams);
  }, []);

  const filteredTeams = teamSearch
    ? teams.filter((t) => t.display_name.toLowerCase().includes(teamSearch.toLowerCase()))
    : teams;

  async function analyze() {
    if (!line) return;
    setLoading(true);
    try {
      const data = await api.analyzeProp({
        player_id: playerId,
        prop,
        line: parseFloat(line),
        opponent: opponent?.display_name,
      });
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  const recColor =
    result?.recommendation === "OVER"
      ? "#16a34a"
      : result?.recommendation === "UNDER"
      ? "#dc2626"
      : "#6b7280";

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{playerName}</Text>

      {/* Opponent picker */}
      <Text style={styles.label}>Opponent (optional)</Text>
      <TouchableOpacity
        style={styles.teamPicker}
        onPress={() => setTeamPickerVisible(true)}
      >
        <Text style={opponent ? styles.teamPickerSelected : styles.teamPickerPlaceholder}>
          {opponent ? opponent.display_name : "All games — tap to filter by opponent"}
        </Text>
        {opponent && (
          <TouchableOpacity
            onPress={() => { setOpponent(null); setResult(null); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Prop selector */}
      <Text style={styles.label}>Prop</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {PROPS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.chip, prop === p && styles.chipActive]}
            onPress={() => { setProp(p); setResult(null); }}
          >
            <Text style={[styles.chipText, prop === p && styles.chipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Line</Text>
      <TextInput
        style={styles.input}
        value={line}
        onChangeText={setLine}
        keyboardType="decimal-pad"
        placeholder="e.g. 24.5"
      />

      <TouchableOpacity style={styles.button} onPress={analyze} disabled={loading || !line}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {opponent ? `Analyze vs ${opponent.short_name}` : "Analyze"}
          </Text>
        )}
      </TouchableOpacity>

      {result && (
        <View style={styles.result}>
          {result.opponent && (
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>vs {result.opponent}</Text>
              <Text style={styles.resultValue}>{result.games_found} games</Text>
            </View>
          )}
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Average {prop}</Text>
            <Text style={styles.resultValue}>{result.average}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Hit Rate vs {result.line}</Text>
            <Text style={styles.resultValue}>{(result.hit_rate * 100).toFixed(1)}%</Text>
          </View>
          <View style={[styles.recBadge, { backgroundColor: recColor }]}>
            <Text style={styles.recText}>{result.recommendation}</Text>
          </View>
        </View>
      )}

      {/* Team picker modal */}
      <Modal visible={teamPickerVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Opponent</Text>
            <TouchableOpacity onPress={() => { setTeamPickerVisible(false); setTeamSearch(""); }}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.modalSearch}
            placeholder="Search team…"
            value={teamSearch}
            onChangeText={setTeamSearch}
          />
          <FlatList
            data={filteredTeams}
            keyExtractor={(t) => t.abbreviation}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.teamRow, opponent?.abbreviation === item.abbreviation && styles.teamRowSelected]}
                onPress={() => {
                  setOpponent(item);
                  setResult(null);
                  setTeamPickerVisible(false);
                  setTeamSearch("");
                }}
              >
                <Text style={styles.teamName}>{item.display_name}</Text>
                <Text style={styles.teamAbbr}>{item.abbreviation}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 16 },
  label: { fontSize: 13, color: "#666", marginBottom: 6, marginTop: 12 },

  teamPicker: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
  },
  teamPickerPlaceholder: { color: "#999", fontSize: 15 },
  teamPickerSelected: { color: "#1a73e8", fontSize: 15, fontWeight: "600" },
  clearBtn: { color: "#999", fontSize: 16, paddingLeft: 8 },

  chipRow: { flexDirection: "row", marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  chipText: { color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },

  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 16 },
  button: { backgroundColor: "#1a73e8", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 16 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  result: { marginTop: 24, padding: 16, borderRadius: 12, backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb" },
  resultRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  resultLabel: { color: "#666", fontSize: 15 },
  resultValue: { fontSize: 15, fontWeight: "600" },
  recBadge: { marginTop: 12, borderRadius: 8, padding: 12, alignItems: "center" },
  recText: { color: "#fff", fontSize: 18, fontWeight: "700", letterSpacing: 1 },

  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderColor: "#eee" },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  modalClose: { color: "#1a73e8", fontSize: 16, fontWeight: "600" },
  modalSearch: { margin: 12, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 15 },
  teamRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: "#f3f4f6" },
  teamRowSelected: { backgroundColor: "#eff6ff" },
  teamName: { fontSize: 16 },
  teamAbbr: { fontSize: 13, color: "#999" },
});
