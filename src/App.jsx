import { useEffect, useMemo, useState } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore";

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

const defaultCfg = {
  uma: [15, 5, -5, -15],
  oka: 30,
  returnPt: 30000,
};

function uid() {
  return Math.random().toString(36).slice(2, 11);
}

function fmtPt(n) {
  return (n > 0 ? "+" : "") + Number(n).toFixed(1);
}

function sortGames(list) {
  return [...list].sort((a, b) => {
    const at = a.createdAt || 0;
    const bt = b.createdAt || 0;
    return bt - at;
  });
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

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  const [activeLeagueId, setActiveLeagueId] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [leagueOwnerUid, setLeagueOwnerUid] = useState("");
  const [leagueMemberUids, setLeagueMemberUids] = useState([]);
  const [leagueAdminUids, setLeagueAdminUids] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState([]);
  const [leagueReady, setLeagueReady] = useState(false);
  const [leagueError, setLeagueError] = useState("");

  const canMember =
    !!user && !!activeLeagueId && leagueMemberUids.includes(user.uid);

  const canAdmin =
    !!user &&
    !!activeLeagueId &&
    (leagueOwnerUid === user.uid || leagueAdminUids.includes(user.uid));

  const tabs = [
    ["record", "記録"],
    ["history", "履歴"],
    ["stats", "成績"],
    ...(canAdmin ? [["settings", "設定"]] : []),
  ];

  useEffect(() => {
    if (!canAdmin && tab === "settings") {
      setTab("record");
    }
  }, [canAdmin, tab]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);

      setProfile(null);
      setDisplayName("");
      setProfileLoading(false);

      setActiveLeagueId("");
      setLeagueName("");
      setLeagueOwnerUid("");
      setLeagueMemberUids([]);
      setLeagueAdminUids([]);
      setMemberProfiles([]);
      setLeagueReady(false);
      setLeagueError("");

      setPlayers([]);
      setGames([]);
      setCfg(defaultCfg);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;

    async function loadProfile() {
      setProfileLoading(true);

      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error(e);
        setProfile(null);
        setLeagueError("プロフィールの読み込みに失敗しました。");
      } finally {
        setProfileLoading(false);
      }
    }

    loadProfile();
  }, [user]);

  useEffect(() => {
    if (!user || !profile) return;

    async function prepareLeague() {
      setLeagueReady(false);
      setLeagueError("");

      try {
        const params = new URLSearchParams(window.location.search);
        const inviteLeagueId = params.get("league");

        if (inviteLeagueId) {
          if (profile.activeLeagueId !== inviteLeagueId) {
            await joinLeague(inviteLeagueId);
            return;
          }

          await loadLeagueById(inviteLeagueId);
          return;
        }

        if (profile.activeLeagueId) {
          await loadLeagueById(profile.activeLeagueId);
          return;
        }

        setLeagueReady(true);
      } catch (e) {
        console.error(e);
        setLeagueError("リーグ情報の準備に失敗しました。");
        setActiveLeagueId("");
        setLeagueReady(true);
      }
    }

    prepareLeague();
  }, [user, profile]);

  useEffect(() => {
    if (!user || !activeLeagueId) return;

    const ref = doc(db, "leagues", activeLeagueId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setLeagueError("リーグが削除されたか、見つかりません。");
          setActiveLeagueId("");
          setLeagueName("");
          setLeagueOwnerUid("");
          setLeagueMemberUids([]);
          setLeagueAdminUids([]);
          setPlayers([]);
          setGames([]);
          setCfg(defaultCfg);
          setLeagueReady(true);
          return;
        }

        const data = snap.data();

        if (!data.memberUids?.includes(user.uid)) {
          setLeagueError("このリーグのメンバーではありません。");
          setActiveLeagueId("");
          setLeagueName("");
          setLeagueOwnerUid("");
          setLeagueMemberUids([]);
          setLeagueAdminUids([]);
          setPlayers([]);
          setGames([]);
          setCfg(defaultCfg);
          setLeagueReady(true);
          return;
        }

        const ownerUid = data.ownerUid || "";
        const adminUids =
          data.adminUids && data.adminUids.length > 0
            ? data.adminUids
            : ownerUid
            ? [ownerUid]
            : [];

        setLeagueName(data.name || "名称未設定のリーグ");
        setLeagueOwnerUid(ownerUid);
        setLeagueMemberUids(data.memberUids || []);
        setLeagueAdminUids(adminUids);
        setPlayers(data.players || []);
        setGames(sortGames(data.games || []));
        setCfg(data.cfg || defaultCfg);
        setLeagueReady(true);
        setLeagueError("");
      },
      (e) => {
        console.error(e);
        setLeagueError("リアルタイム同期に失敗しました。Firestoreルールを確認してください。");
        setLeagueReady(true);
      }
    );

    return () => unsub();
  }, [user, activeLeagueId]);

  useEffect(() => {
    if (!leagueMemberUids.length) {
      setMemberProfiles([]);
      return;
    }

    async function loadMemberProfiles() {
      try {
        const list = await Promise.all(
          leagueMemberUids.map(async (memberUid) => {
            const snap = await getDoc(doc(db, "users", memberUid));

            if (snap.exists()) {
              const data = snap.data();
              return {
                uid: memberUid,
                displayName: data.displayName || "名前未設定",
              };
            }

            return {
              uid: memberUid,
              displayName: "名前未設定",
            };
          })
        );

        setMemberProfiles(list);
      } catch (e) {
        console.error(e);
        setMemberProfiles(
          leagueMemberUids.map((memberUid) => ({
            uid: memberUid,
            displayName: "ユーザー",
          }))
        );
      }
    }

    loadMemberProfiles();
  }, [leagueMemberUids]);

  async function saveProfile() {
    if (!user) return;

    if (!displayName.trim()) {
      alert("ユーザー名を入力してください。");
      return;
    }

    const newProfile = {
      displayName: displayName.trim(),
      email: user.email,
      uid: user.uid,
      activeLeagueId: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await setDoc(doc(db, "users", user.uid), newProfile);
      setProfile(newProfile);
    } catch (e) {
      console.error(e);
      alert("ユーザー名の登録に失敗しました。");
    }
  }

  async function clearActiveLeague() {
    if (!user || !profile) return;

    const updatedProfile = {
      ...profile,
      activeLeagueId: "",
      updatedAt: Date.now(),
    };

    try {
      await setDoc(doc(db, "users", user.uid), updatedProfile, { merge: true });
      setProfile(updatedProfile);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadLeagueById(leagueId) {
    if (!user) return;

    setLeagueReady(false);
    setLeagueError("");

    try {
      const ref = doc(db, "leagues", leagueId);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setLeagueError("リーグが見つかりません。新しく作成してください。");
        setActiveLeagueId("");
        setLeagueName("");
        setLeagueOwnerUid("");
        setLeagueMemberUids([]);
        setLeagueAdminUids([]);
        setPlayers([]);
        setGames([]);
        setCfg(defaultCfg);
        await clearActiveLeague();
        setLeagueReady(true);
        return;
      }

      const data = snap.data();

      if (!data.memberUids?.includes(user.uid)) {
        setLeagueError("このリーグに参加していません。招待URLから参加してください。");
        setActiveLeagueId("");
        setLeagueName("");
        setLeagueOwnerUid("");
        setLeagueMemberUids([]);
        setLeagueAdminUids([]);
        setPlayers([]);
        setGames([]);
        setCfg(defaultCfg);
        await clearActiveLeague();
        setLeagueReady(true);
        return;
      }

      const ownerUid = data.ownerUid || "";
      const adminUids =
        data.adminUids && data.adminUids.length > 0
          ? data.adminUids
          : ownerUid
          ? [ownerUid]
          : [];

      if ((!data.adminUids || data.adminUids.length === 0) && ownerUid === user.uid) {
        await setDoc(
          ref,
          {
            adminUids,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }

      setActiveLeagueId(leagueId);
      setLeagueName(data.name || "名称未設定のリーグ");
      setLeagueOwnerUid(ownerUid);
      setLeagueMemberUids(data.memberUids || []);
      setLeagueAdminUids(adminUids);
      setPlayers(data.players || []);
      setGames(sortGames(data.games || []));
      setCfg(data.cfg || defaultCfg);
      setLeagueReady(true);
    } catch (e) {
      console.error(e);
      setLeagueError("リーグ情報の読み込みに失敗しました。Firestoreルールを確認してください。");
      setActiveLeagueId("");
      setLeagueName("");
      setLeagueOwnerUid("");
      setLeagueMemberUids([]);
      setLeagueAdminUids([]);
      setPlayers([]);
      setGames([]);
      setCfg(defaultCfg);
      setLeagueReady(true);
    }
  }

  async function createLeague(name) {
    if (!user || !profile) return;

    const cleanName = name.trim();
    if (!cleanName) {
      alert("リーグ名を入力してください。");
      return;
    }

    setLeagueReady(false);
    setLeagueError("");

    try {
      const leagueId = uid();

      const newLeague = {
        name: cleanName,
        ownerUid: user.uid,
        memberUids: [user.uid],
        adminUids: [user.uid],
        inviteEnabled: true,
        players: [],
        games: [],
        cfg: defaultCfg,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, "leagues", leagueId), newLeague);

      const updatedProfile = {
        ...profile,
        activeLeagueId: leagueId,
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, "users", user.uid), updatedProfile, { merge: true });

      setProfile(updatedProfile);
      setActiveLeagueId(leagueId);
      setLeagueName(cleanName);
      setLeagueOwnerUid(user.uid);
      setLeagueMemberUids([user.uid]);
      setLeagueAdminUids([user.uid]);
      setPlayers([]);
      setGames([]);
      setCfg(defaultCfg);
      setLeagueReady(true);
    } catch (e) {
      console.error(e);
      setLeagueError("リーグ作成に失敗しました。Firestoreルールを確認してください。");
      setLeagueReady(true);
    }
  }

  async function joinLeague(leagueId) {
    if (!user || !profile) return;

    setLeagueReady(false);
    setLeagueError("");

    try {
      const ref = doc(db, "leagues", leagueId);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setLeagueError("招待されたリーグが見つかりません。");
        setLeagueReady(true);
        return;
      }

      const data = snap.data();

      if (!data.inviteEnabled && !data.memberUids?.includes(user.uid)) {
        setLeagueError("このリーグの招待は無効です。");
        setLeagueReady(true);
        return;
      }

      if (!data.memberUids?.includes(user.uid)) {
        await updateDoc(ref, {
          memberUids: arrayUnion(user.uid),
          updatedAt: Date.now(),
        });
      }

      const updatedProfile = {
        ...profile,
        activeLeagueId: leagueId,
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, "users", user.uid), updatedProfile, { merge: true });
      setProfile(updatedProfile);

      await loadLeagueById(leagueId);
    } catch (e) {
      console.error(e);
      setLeagueError("リーグ参加に失敗しました。Firestoreルールを確認してください。");
      setActiveLeagueId("");
      setLeagueReady(true);
    }
  }

  async function saveGameToLeague(game) {
    if (!canMember || !activeLeagueId) {
      alert("保存するにはリーグ参加が必要です。");
      return;
    }

    try {
      setGames(sortGames([game, ...games]));

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        games: arrayUnion(game),
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("対局結果の保存に失敗しました。");
    }
  }

  async function deleteGame(gameId) {
    if (!canAdmin || !activeLeagueId) return;

    const nextGames = games.filter((g) => g.id !== gameId);

    try {
      setGames(nextGames);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        games: nextGames,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("履歴削除に失敗しました。");
    }
  }

  async function saveLeagueNameToDb(nextName) {
    if (!canAdmin || !activeLeagueId) return;

    const cleanName = nextName.trim();
    if (!cleanName) {
      alert("リーグ名を入力してください。");
      return;
    }

    try {
      setLeagueName(cleanName);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        name: cleanName,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("リーグ名の保存に失敗しました。");
    }
  }

  async function savePlayersToDb(nextPlayers) {
    if (!canAdmin || !activeLeagueId) return;

    try {
      setPlayers(nextPlayers);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        players: nextPlayers,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("プレイヤー情報の保存に失敗しました。");
    }
  }

  async function saveCfgToDb(nextCfg) {
    if (!canAdmin || !activeLeagueId) return;

    try {
      setCfg(nextCfg);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        cfg: nextCfg,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("ルール設定の保存に失敗しました。");
    }
  }

  async function resetLeagueData() {
    if (!canAdmin || !activeLeagueId) return;

    try {
      setPlayers([]);
      setGames([]);
      setCfg(defaultCfg);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        players: [],
        games: [],
        cfg: defaultCfg,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("データ初期化に失敗しました。");
    }
  }

  async function setAdminStatus(targetUid, shouldBeAdmin) {
    if (!canAdmin || !activeLeagueId) return;

    if (targetUid === leagueOwnerUid && !shouldBeAdmin) {
      alert("リーグ作成者の管理者権限は解除できません。");
      return;
    }

    const current = leagueAdminUids.length
      ? leagueAdminUids
      : leagueOwnerUid
      ? [leagueOwnerUid]
      : [];

    let nextAdminUids = shouldBeAdmin
      ? Array.from(new Set([...current, targetUid]))
      : current.filter((uid) => uid !== targetUid);

    if (leagueOwnerUid && !nextAdminUids.includes(leagueOwnerUid)) {
      nextAdminUids = [leagueOwnerUid, ...nextAdminUids];
    }

    try {
      setLeagueAdminUids(nextAdminUids);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        adminUids: nextAdminUids,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("権限変更に失敗しました。");
    }
  }

  const inviteUrl = activeLeagueId
    ? `${window.location.origin}${window.location.pathname}?league=${activeLeagueId}`
    : "";

  if (!authReady) {
    return (
      <>
        <BaseStyle />
        <div style={appBgStyle}>
          <div style={pageStyle}>
            <Header />
            <Card>
              <p style={centerMutedStyle}>読み込み中...</p>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <BaseStyle />

      <div style={appBgStyle}>
        <div style={pageStyle}>
          <Header />

          {!user ? (
            <LoginScreen />
          ) : profileLoading ? (
            <Card>
              <p style={centerMutedStyle}>プロフィール確認中...</p>
            </Card>
          ) : !profile ? (
            <ProfileSetup
              user={user}
              displayName={displayName}
              setDisplayName={setDisplayName}
              saveProfile={saveProfile}
            />
          ) : !leagueReady ? (
            <Card>
              <p style={centerMutedStyle}>リーグ情報を読み込み中...</p>
            </Card>
          ) : !activeLeagueId ? (
            <>
              <UserCard profile={profile} user={user} canAdmin={canAdmin} />

              {leagueError && (
                <Card>
                  <p style={errorTextStyle}>{leagueError}</p>
                </Card>
              )}

              <LeagueSetup createLeague={createLeague} />
            </>
          ) : (
            <>
              <UserCard profile={profile} user={user} canAdmin={canAdmin} />

              {leagueError && (
                <Card>
                  <p style={errorTextStyle}>{leagueError}</p>
                </Card>
              )}

              <LeagueInfo
                leagueName={leagueName}
                activeLeagueId={activeLeagueId}
                memberCount={leagueMemberUids.length}
                inviteUrl={inviteUrl}
                canAdmin={canAdmin}
              />

              <div style={tabGridStyle}>
                {tabs.map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    style={{
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
                <RecordTab
                  players={players}
                  saveGameToLeague={saveGameToLeague}
                  cfg={cfg}
                  canSaveGame={canMember}
                />
              )}

              {tab === "history" && (
                <HistoryTab
                  players={players}
                  games={games}
                  deleteGame={deleteGame}
                  canAdmin={canAdmin}
                />
              )}

              {tab === "stats" && <StatsTab players={players} games={games} />}

              {tab === "settings" && canAdmin && (
                <SettingsTab
                  players={players}
                  savePlayersToDb={savePlayersToDb}
                  cfg={cfg}
                  saveCfgToDb={saveCfgToDb}
                  leagueName={leagueName}
                  saveLeagueNameToDb={saveLeagueNameToDb}
                  leagueOwnerUid={leagueOwnerUid}
                  leagueAdminUids={leagueAdminUids}
                  memberProfiles={memberProfiles}
                  setAdminStatus={setAdminStatus}
                  resetLeagueData={resetLeagueData}
                  user={user}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function BaseStyle() {
  return (
    <style>{`
      *{box-sizing:border-box;margin:0;padding:0;}
      html, body, #root {
        width:100%;
        min-height:100vh;
        background:${C.bg};
      }
      body{
        overflow-x:hidden;
        color:${C.text};
        font-family:system-ui,'Noto Sans JP',sans-serif;
      }
      input{font-size:16px;}
      button{font-family:inherit;}
    `}</style>
  );
}

function Header() {
  return (
    <header style={{ textAlign: "center", marginBottom: 18 }}>
      <div style={{ fontSize: 26, color: C.gold, fontWeight: 700 }}>
        🀄 麻雀リーグ
      </div>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2 }}>
        MAHJONG LEAGUE TRACKER
      </div>
    </header>
  );
}

function LoginScreen() {
  return (
    <Card>
      <div style={{ textAlign: "center", padding: "18px 0" }}>
        <div style={titleStyle}>ログイン</div>
        <div style={descStyle}>
          麻雀リーグを利用するにはGoogleログインが必要です。
          <br />
          ログイン後に記録・履歴・成績・設定を利用できます。
        </div>
        <button onClick={() => signInWithPopup(auth, provider)} style={googleBtnStyle}>
          Googleでログイン
        </button>
      </div>
    </Card>
  );
}

function ProfileSetup({ user, displayName, setDisplayName, saveProfile }) {
  return (
    <Card>
      <div style={{ textAlign: "center", padding: "18px 0" }}>
        <div style={titleStyle}>ユーザー名登録</div>
        <div style={descStyle}>表示用のユーザー名を決めてください。</div>
        <div style={{ fontSize: 11, color: C.green, marginBottom: 12 }}>
          {user.email}
        </div>

        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例：みやけ"
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        <button onClick={saveProfile} style={googleBtnStyle}>
          登録して始める
        </button>
      </div>
    </Card>
  );
}

function UserCard({ profile, user, canAdmin }) {
  return (
    <Card>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          ログイン中
        </div>
        <div
          style={{
            fontSize: 18,
            color: C.gold,
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          {profile.displayName}
        </div>
        <div
          style={{
            display: "inline-block",
            fontSize: 11,
            color: canAdmin ? C.gold : C.muted,
            border: `1px solid ${canAdmin ? C.gold : C.border}`,
            borderRadius: 999,
            padding: "3px 10px",
            marginBottom: 12,
          }}
        >
          {canAdmin ? "管理者" : "一般ユーザー"}
        </div>
        <button onClick={() => signOut(auth)} style={loginBtnStyle}>
          ログアウト
        </button>
      </div>
    </Card>
  );
}

function LeagueSetup({ createLeague }) {
  const [name, setName] = useState("");

  return (
    <Card>
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div style={titleStyle}>リーグ作成</div>
        <div style={descStyle}>
          まずリーグを作成してください。
          <br />
          作成後、招待URLで友達を参加させられます。
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：みやけ麻雀会"
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        <button onClick={() => createLeague(name)} style={googleBtnStyle}>
          リーグを作成
        </button>
      </div>
    </Card>
  );
}

function LeagueInfo({ leagueName, activeLeagueId, memberCount, inviteUrl, canAdmin }) {
  async function copyInviteUrl() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      alert("招待URLをコピーしました。");
    } catch {
      alert(inviteUrl);
    }
  }

  return (
    <Card>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
          現在のリーグ
        </div>
        <div style={{ fontSize: 18, color: C.gold, fontWeight: 700 }}>
          {leagueName}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          ID: {activeLeagueId} / メンバー {memberCount}人
        </div>

        {canAdmin ? (
          <button onClick={copyInviteUrl} style={{ ...loginBtnStyle, marginTop: 12 }}>
            招待URLをコピー
          </button>
        ) : (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 12 }}>
            招待URLの共有は管理者のみ可能です。
          </div>
        )}
      </div>
    </Card>
  );
}

function RecordTab({ players, saveGameToLeague, cfg, canSaveGame }) {
  const [selected, setSelected] = useState([]);
  const [scores, setScores] = useState({});
  const [preview, setPreview] = useState(null);

  if (players.length < 4) {
    return (
      <Card>
        <p style={centerMutedStyle}>
          管理者が設定タブでプレイヤーを4人以上追加すると記録できます。
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

  async function saveGame() {
    if (!canSaveGame) {
      alert("保存するにはリーグ参加が必要です。");
      return;
    }

    const now = Date.now();

    const game = {
      id: uid(),
      date: new Date(now).toLocaleString("ja-JP"),
      createdAt: now,
      entries: preview,
    };

    await saveGameToLeague(game);

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
            {canSaveGame ? (
              <Btn onClick={saveGame}>保存する</Btn>
            ) : (
              <p style={centerSmallMutedStyle}>
                保存するにはリーグ参加が必要です。
              </p>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function HistoryTab({ players, games, deleteGame, canAdmin }) {
  if (games.length === 0) {
    return (
      <Card>
        <p style={centerMutedStyle}>まだ履歴がありません。</p>
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

          {canAdmin && (
            <button
              onClick={() => deleteGame(g.id)}
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
          )}
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
        <p style={centerMutedStyle}>プレイヤーがいません。</p>
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
                {s.n}半荘 / 平均順位 {s.avgRank} / トップ率 {s.topRate}% /
                四着率 {s.lastRate}%
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

function SettingsTab({
  players,
  savePlayersToDb,
  cfg,
  saveCfgToDb,
  leagueName,
  saveLeagueNameToDb,
  leagueOwnerUid,
  leagueAdminUids,
  memberProfiles,
  setAdminStatus,
  resetLeagueData,
  user,
}) {
  const [name, setName] = useState("");
  const [editingLeagueName, setEditingLeagueName] = useState(leagueName);

  useEffect(() => {
    setEditingLeagueName(leagueName);
  }, [leagueName]);

  function addPlayer() {
    if (!name.trim()) return;
    savePlayersToDb([...players, { id: uid(), name: name.trim() }]);
    setName("");
  }

  function removePlayer(playerId) {
    savePlayersToDb(players.filter((x) => x.id !== playerId));
  }

  function updateUma(index, value) {
    const uma = [...cfg.uma];
    uma[index] = Number(value);
    saveCfgToDb({ ...cfg, uma });
  }

  function updateOka(value) {
    saveCfgToDb({ ...cfg, oka: Number(value) });
  }

  function updateReturnPt(value) {
    saveCfgToDb({ ...cfg, returnPt: Number(value) });
  }

  return (
    <>
      <Card>
        <Label>リーグ設定</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={editingLeagueName}
            onChange={(e) => setEditingLeagueName(e.target.value)}
            placeholder="リーグ名"
            style={inputStyle}
          />
          <button
            onClick={() => saveLeagueNameToDb(editingLeagueName)}
            style={smallGoldButtonStyle}
          >
            保存
          </button>
        </div>
        <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>
          あなたはこのリーグの管理者です。
        </div>
      </Card>

      <Card>
        <Label>権限管理</Label>

        {memberProfiles.length === 0 ? (
          <p style={centerSmallMutedStyle}>メンバー情報を読み込み中...</p>
        ) : (
          memberProfiles.map((m) => {
            const isOwner = m.uid === leagueOwnerUid;
            const isAdmin = isOwner || leagueAdminUids.includes(m.uid);
            const isMe = m.uid === user.uid;

            return (
              <div
                key={m.uid}
                style={{
                  padding: "10px 0",
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {m.displayName}
                    {isMe ? "（自分）" : ""}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: isAdmin ? C.gold : C.muted,
                      marginTop: 3,
                    }}
                  >
                    {isOwner ? "作成者・管理者" : isAdmin ? "管理者" : "一般ユーザー"}
                  </div>
                </div>

                {isOwner ? (
                  <div style={{ fontSize: 11, color: C.muted }}>
                    解除不可
                  </div>
                ) : isAdmin ? (
                  <button
                    onClick={() => setAdminStatus(m.uid, false)}
                    style={smallDangerButtonStyle}
                  >
                    一般に戻す
                  </button>
                ) : (
                  <button
                    onClick={() => setAdminStatus(m.uid, true)}
                    style={smallGoldButtonStyle}
                  >
                    管理者にする
                  </button>
                )}
              </div>
            );
          })
        )}
      </Card>

      <Card>
        <Label>プレイヤー管理</Label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="プレイヤー名"
            style={inputStyle}
          />
          <button onClick={addPlayer} style={smallGoldButtonStyle}>
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
              onClick={() => removePlayer(p.id)}
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
              onChange={(e) => updateUma(i, e.target.value)}
              style={inputStyle}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 60, color: C.muted, paddingTop: 9 }}>オカ</div>
          <input
            type="number"
            value={cfg.oka}
            onChange={(e) => updateOka(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 60, color: C.muted, paddingTop: 9 }}>返し点</div>
          <input
            type="number"
            value={cfg.returnPt}
            onChange={(e) => updateReturnPt(e.target.value)}
            style={inputStyle}
          />
        </div>
      </Card>

      <Card>
        <Label>データ初期化</Label>
        <button
          onClick={() => {
            if (confirm("このリーグの全データを削除しますか？")) {
              resetLeagueData();
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
          このリーグの全データ削除
        </button>
      </Card>
    </>
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        width: "100%",
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

const appBgStyle = {
  minHeight: "100vh",
  background: C.bg,
};

const pageStyle = {
  width: "100%",
  maxWidth: 430,
  margin: "0 auto",
  padding: "18px 14px 40px",
};

const tabGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 6,
  marginBottom: 16,
};

const centerMutedStyle = {
  color: C.muted,
  textAlign: "center",
  padding: 20,
  lineHeight: 1.7,
};

const centerSmallMutedStyle = {
  color: C.muted,
  fontSize: 12,
  textAlign: "center",
  lineHeight: 1.7,
};

const errorTextStyle = {
  color: C.red,
  textAlign: "center",
  padding: 12,
  lineHeight: 1.7,
};

const titleStyle = {
  fontSize: 22,
  fontWeight: 700,
  color: C.gold,
  marginBottom: 8,
};

const descStyle = {
  fontSize: 13,
  color: C.muted,
  marginBottom: 18,
  lineHeight: 1.7,
};

const inputStyle = {
  flex: 1,
  width: "100%",
  padding: "9px 10px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: "#0a0a16",
  color: C.text,
};

const loginBtnStyle = {
  width: "100%",
  padding: 11,
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.panel,
  color: C.text,
  cursor: "pointer",
  fontWeight: 700,
};

const googleBtnStyle = {
  width: "100%",
  padding: 12,
  borderRadius: 8,
  border: `1px solid ${C.gold}`,
  background: "#20180a",
  color: C.gold,
  cursor: "pointer",
  fontWeight: 700,
};

const smallGoldButtonStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: `1px solid ${C.gold}`,
  background: C.surface,
  color: C.gold,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const smallDangerButtonStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: `1px solid ${C.red}`,
  background: "transparent",
  color: C.red,
  cursor: "pointer",
  whiteSpace: "nowrap",
};