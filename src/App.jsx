import { useEffect, useMemo, useState } from "react";

const C = {
  bg: "#0e0e1a",
  surface: "#161628",
  panel: "#1e1e38",
  border: "#2e2e50",
  accent: "#e8455a",
  gold: "#f5c542",
  green: "#4ade80",
  red: "#f87171",
  text: "#e8e8f0",
  muted: "#7878a0",
};

const SKEY = "mahjong-league-v1";

const defaultCfg = {
  uma: [15, 5, -5, -15],
  oka: 30,
  returnPt: 30000,
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function fmtPt(n) {
  return (n > 0 ? "+" : "") + Number(n).toFixed(1);
}

function calcPoints(entries, cfg) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);

  const result = entries.map((e) => {
    const rank = sorted.findIndex((s) => s.playerId === e.playerId);
    const pt =
      Math.round(((e.score - cfg.returnPt) / 1000 + cfg.uma[rank]) * 10) / 10;
    return { ...e, rank, pt };
  });

  const first = result.find((e) => e.rank === 0);
  first.pt = Math.round((first.pt + cfg.oka) * 10) / 10;

  const sum = result.reduce((a, e) => a + e.pt, 0);
  first.pt = Math.round((first.pt - sum) * 10) / 10;

  return result;
}

export default function App() {
  const [tab, setTab] = useState("record");
  const [players, setPlayers] = useState([]);
  const [games, setGames] = useState([]);
  const [cfg, setCfg] = useState(defaultCfg);

  useEffect(() => {
    const saved = localStorage.getItem(SKEY);
    if (saved) {
      const data = JSON.parse(saved);
      setPlayers(data.players || []);
      setGames(data.games || []);
      setCfg(data.cfg || defaultCfg);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SKEY, JSON.stringify({ players, games, cfg }));
  }, [players, games, cfg]);

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${C.bg};color:${C.text};font-family:system-ui,'Noto Sans JP',sans-serif;}
        input{font-size:16px;}
        button{font-family:inherit;}
      `}</style>

      <div style={{ maxWidth: 460, margin: "0 auto", padding: "18px 14px 80px" }}>
        <header style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 26, color: C.gold, fontWeight: 700 }}>
            🀄 麻雀リーグ
          </div>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2 }}>
            MAHJONG LEAGUE TRACKER
          </div>
        </header>

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[
            ["record", "記録"],
            ["history", "履歴"],
            ["stats", "成績"],
            ["settings", "設定"],
          ].map(([k, v]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                border: `1px solid ${tab === k ? C.accent : C.border}`,
                background: tab === k ? C.panel : C.surface,
                color: tab === k ? C.text : C.muted,
                cursor: "pointer",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {tab === "record" && (
          <RecordTab players={players} games={games} setGames={setGames} cfg={cfg} />
        )}
        {tab === "history" && (
          <HistoryTab players={players} games={games} setGames={setGames} />
        )}
        {tab === "stats" && <StatsTab players={players} games={games} />}
        {tab === "settings" && (
          <SettingsTab
            players={players}
            setPlayers={setPlayers}
            cfg={cfg}
            setCfg={setCfg}
            setGames={setGames}
          />
        )}
      </div>
    </>
  );
}

function RecordTab({ players, games, setGames, cfg }) {
  const [selected, setSelected] = useState([]);
  const [scores, setScores] = useState({});
  const [preview, setPreview] = useState(null);

  if (players.length < 4) {
    return (
      <Card>
        <p style={{ color: C.muted, textAlign: "center", padding: 20 }}>
          設定タブでプレイヤーを4人以上追加してください。
        </p>
      </Card>
    );
  }

  const allFilled =
    selected.length === 4 &&
    selected.every((id) => scores[id] !== "" && scores[id] !== undefined);

  const total = allFilled
    ? selected.reduce((a, id) => a + Number(scores[id]), 0)
    : null;

  function toggle(id) {
    setPreview(null);
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
    } else if (selected.length < 4) {
      setSelected([...selected, id]);
    }
  }

  function calculate() {
    const entries = selected.map((id) => ({
      playerId: id,
      score: Number(scores[id]),
    }));
    setPreview(calcPoints(entries, cfg));
  }

  function saveGame() {
    const game = {
      id: uid(),
      date: new Date().toLocaleString("ja-JP"),
      entries: preview,
    };
    setGames([game, ...games]);
    setSelected([]);
    setScores({});
    setPreview(null);
  }

  return (
    <>
      <Card>
        <Label>参加者選択（{selected.length}/4）</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {players.map((p) => {
            const active = selected.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: `1px solid ${active ? C.accent : C.border}`,
                  background: active ? "#2a0e14" : C.surface,
                  color: active ? C.accent : C.muted,
                  cursor: "pointer",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </Card>

      {selected.length === 4 && (
        <Card>
          <Label>点数入力</Label>
          {selected.map((id) => {
            const p = players.find((x) => x.id === id);
            return (
              <div key={id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 80, color: C.muted, paddingTop: 9 }}>
                  {p?.name}
                </div>
                <input
                  type="number"
                  placeholder="32000"
                  value={scores[id] || ""}
                  onChange={(e) => {
                    setScores({ ...scores, [id]: e.target.value });
                    setPreview(null);
                  }}
                  style={inputStyle}
                />
              </div>
            );
          })}

          {total !== null && (
            <div
              style={{
                textAlign: "right",
                fontSize: 12,
                color: total === 100000 ? C.green : C.red,
                marginBottom: 8,
              }}
            >
              合計: {total.toLocaleString()}点
            </div>
          )}

          <Btn disabled={!allFilled} onClick={calculate}>
            ポイント計算
          </Btn>
        </Card>
      )}

      {preview && (
        <Card>
          <Label>計算結果</Label>
          {[...preview]
            .sort((a, b) => a.rank - b.rank)
            .map((e) => {
              const p = players.find((x) => x.id === e.playerId);
              return (
                <ResultRow
                  key={e.playerId}
                  rank={e.rank}
                  name={p?.name}
                  score={e.score}
                  pt={e.pt}
                />
              );
            })}

          <div style={{ marginTop: 12 }}>
            <Btn onClick={saveGame}>保存する</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

function HistoryTab({ players, games, setGames }) {
  if (games.length === 0) {
    return (
      <Card>
        <p style={{ color: C.muted, textAlign: "center", padding: 20 }}>
          まだ履歴がありません。
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Label>対局履歴</Label>
      {games.map((g) => (
        <div
          key={g.id}
          style={{
            padding: "12px 0",
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
            {g.date}
          </div>
          {[...g.entries]
            .sort((a, b) => a.rank - b.rank)
            .map((e) => {
              const p = players.find((x) => x.id === e.playerId);
              return (
                <ResultRow
                  key={e.playerId}
                  rank={e.rank}
                  name={p?.name || "不明"}
                  score={e.score}
                  pt={e.pt}
                />
              );
            })}
          <button
            onClick={() => setGames(games.filter((x) => x.id !== g.id))}
            style={{
              marginTop: 8,
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: `1px solid ${C.red}`,
              background: "transparent",
              color: C.red,
              cursor: "pointer",
            }}
          >
            削除
          </button>
        </div>
      ))}
    </Card>
  );
}

function StatsTab({ players, games }) {
  const stats = useMemo(() => {
    return players
      .map((p) => {
        const entries = games.flatMap((g) =>
          g.entries.filter((e) => e.playerId === p.id)
        );
        const n = entries.length;
        const totalPt = entries.reduce((a, e) => a + e.pt, 0);
        const wins = entries.filter((e) => e.rank === 0).length;
        const lasts = entries.filter((e) => e.rank === 3).length;
        const avgRank = n
          ? entries.reduce((a, e) => a + e.rank + 1, 0) / n
          : 0;

        return {
          ...p,
          n,
          totalPt: Math.round(totalPt * 10) / 10,
          avgPt: n ? Math.round((totalPt / n) * 10) / 10 : 0,
          avgRank: n ? Math.round(avgRank * 100) / 100 : "-",
          topRate: n ? Math.round((wins / n) * 100) : 0,
          lastRate: n ? Math.round((lasts / n) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalPt - a.totalPt);
  }, [players, games]);

  return (
    <Card>
      <Label>総合ランキング</Label>
      {stats.length === 0 ? (
        <p style={{ color: C.muted, textAlign: "center", padding: 20 }}>
          プレイヤーがいません。
        </p>
      ) : (
        stats.map((s, i) => (
          <div
            key={s.id}
            style={{
              padding: "12px 0",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>
                {i + 1}位　{s.name}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {s.n}半荘 / 平均順位 {s.avgRank} / トップ率 {s.topRate}% / 四着率{" "}
                {s.lastRate}%
              </div>
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: s.totalPt >= 0 ? C.green : C.red,
              }}
            >
              {fmtPt(s.totalPt)}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

function SettingsTab({ players, setPlayers, cfg, setCfg, setGames }) {
  const [name, setName] = useState("");

  function addPlayer() {
    if (!name.trim()) return;
    setPlayers([...players, { id: uid(), name: name.trim() }]);
    setName("");
  }

  return (
    <>
      <Card>
        <Label>プレイヤー管理</Label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="プレイヤー名"
            style={inputStyle}
          />
          <button
            onClick={addPlayer}
            style={{
              padding: "0 14px",
              borderRadius: 8,
              border: `1px solid ${C.gold}`,
              background: C.surface,
              color: C.gold,
              cursor: "pointer",
            }}
          >
            追加
          </button>
        </div>

        {players.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "9px 0",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <span>{p.name}</span>
            <button
              onClick={() => setPlayers(players.filter((x) => x.id !== p.id))}
              style={{
                border: "none",
                background: "transparent",
                color: C.red,
                cursor: "pointer",
              }}
            >
              削除
            </button>
          </div>
        ))}
      </Card>

      <Card>
        <Label>ルール設定</Label>
        {["1位", "2位", "3位", "4位"].map((label, i) => (
          <div key={label} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 60, color: C.muted, paddingTop: 9 }}>
              {label}
            </div>
            <input
              type="number"
              value={cfg.uma[i]}
              onChange={(e) => {
                const uma = [...cfg.uma];
                uma[i] = Number(e.target.value);
                setCfg({ ...cfg, uma });
              }}
              style={inputStyle}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 60, color: C.muted, paddingTop: 9 }}>オカ</div>
          <input
            type="number"
            value={cfg.oka}
            onChange={(e) => setCfg({ ...cfg, oka: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 60, color: C.muted, paddingTop: 9 }}>返し点</div>
          <input
            type="number"
            value={cfg.returnPt}
            onChange={(e) =>
              setCfg({ ...cfg, returnPt: Number(e.target.value) })
            }
            style={inputStyle}
          />
        </div>
      </Card>

      <Card>
        <Label>データ初期化</Label>
        <button
          onClick={() => {
            if (confirm("全データを削除しますか？")) {
              setPlayers([]);
              setGames([]);
              localStorage.removeItem(SKEY);
            }
          }}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${C.red}`,
            background: "transparent",
            color: C.red,
            cursor: "pointer",
          }}
        >
          全データ削除
        </button>
      </Card>
    </>
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        color: C.gold,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 1,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: 11,
        borderRadius: 8,
        border: "none",
        background: disabled ? C.border : C.accent,
        color: C.text,
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ResultRow({ rank, name, score, pt }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "7px 0",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div>
        <div style={{ fontWeight: 700 }}>
          {rank + 1}位　{name}
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {Number(score).toLocaleString()}点
        </div>
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 17,
          color: pt >= 0 ? C.green : C.red,
        }}
      >
        {fmtPt(pt)}
      </div>
    </div>
  );
}

const inputStyle = {
  flex: 1,
  width: "100%",
  padding: "9px 10px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: "#0a0a16",
  color: C.text,
};