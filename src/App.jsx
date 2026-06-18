import { useEffect, useMemo, useState } from "react";
import { auth, provider, db } from "./firebase";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInAnonymously,
  linkWithPopup,
} from "firebase/auth";
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
  uma: [30, 10, -10, -30],
  oka: 20,
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

function getProfileLeagueIds(profile) {
  const ids = [
    ...(Array.isArray(profile?.leagueIds) ? profile.leagueIds : []),
    profile?.activeLeagueId,
  ].filter(Boolean);

  return Array.from(new Set(ids));
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
  const [selectedPlayerId, setSelectedPlayerId] = useState("");

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
  const [leagueSummaries, setLeagueSummaries] = useState([]);
  const [leagueSummariesLoading, setLeagueSummariesLoading] = useState(false);

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
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

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
      setLeagueSummaries([]);
      setLeagueSummariesLoading(false);

      setPlayers([]);
      setGames([]);
      setCfg(defaultCfg);
      setSelectedPlayerId("");
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
    if (!user || !profile) {
      setLeagueSummaries([]);
      setLeagueSummariesLoading(false);
      return;
    }

    const leagueIds = getProfileLeagueIds(profile);

    if (leagueIds.length === 0) {
      setLeagueSummaries([]);
      setLeagueSummariesLoading(false);
      return;
    }

    let cancelled = false;

    async function loadLeagueSummaries() {
      setLeagueSummariesLoading(true);

      try {
        const list = await Promise.all(
          leagueIds.map(async (leagueId) => {
            const snap = await getDoc(doc(db, "leagues", leagueId));

            if (!snap.exists()) return null;

            const data = snap.data();

            if (!data.memberUids?.includes(user.uid)) return null;

            return {
              id: leagueId,
              name: data.name || "名称未設定のリーグ",
              memberCount: data.memberUids?.length || 0,
              isOwner: data.ownerUid === user.uid,
              isAdmin:
                data.ownerUid === user.uid ||
                (Array.isArray(data.adminUids) && data.adminUids.includes(user.uid)),
            };
          })
        );

        if (!cancelled) {
          setLeagueSummaries(list.filter(Boolean));
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setLeagueSummaries([]);
        }
      } finally {
        if (!cancelled) {
          setLeagueSummariesLoading(false);
        }
      }
    }

    loadLeagueSummaries();

    return () => {
      cancelled = true;
    };
  }, [user, profile, activeLeagueId, leagueName, leagueMemberUids.length]);

  useEffect(() => {
    if (!user || !profile) return;

    async function prepareLeague() {
      setLeagueReady(false);
      setLeagueError("");

      try {
        const params = new URLSearchParams(window.location.search);
        const inviteLeagueId = params.get("league");
        const profileLeagueIds = getProfileLeagueIds(profile);

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

        if (profileLeagueIds.length === 1) {
          await switchLeague(profileLeagueIds[0]);
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
      email: user.email || "",
      uid: user.uid,
      activeLeagueId: "",
      leagueIds: [],
      authProvider: user.isAnonymous ? "anonymous" : "google",
      linkedToGoogle: !user.isAnonymous,
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


  async function updateOwnDisplayName(nextName) {
    if (!user || !profile) return;

    const cleanName = nextName.trim();

    if (!cleanName) {
      alert("ユーザー名を入力してください。");
      return;
    }

    const now = Date.now();

    const updatedProfile = {
      ...profile,
      displayName: cleanName,
      updatedAt: now,
    };

    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          displayName: cleanName,
          updatedAt: now,
        },
        { merge: true }
      );

      setProfile(updatedProfile);

      setMemberProfiles((prev) =>
        prev.map((m) =>
          m.uid === user.uid
            ? {
                ...m,
                displayName: cleanName,
              }
            : m
        )
      );
    } catch (e) {
      console.error(e);
      alert("ユーザー名の変更に失敗しました。");
    }
  }


  async function signInAsGuest() {
    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.error(e);
      alert("ゲストログインに失敗しました。Firebase Authenticationで匿名ログインが有効か確認してください。");
    }
  }

  async function linkGuestWithGoogle() {
    if (!user || !user.isAnonymous) return;

    try {
      provider.setCustomParameters({
        prompt: "select_account",
      });

      const result = await linkWithPopup(user, provider);
      const linkedUser = result.user;
      const now = Date.now();

      const updatedProfile = {
        ...profile,
        email: linkedUser.email || "",
        authProvider: "google",
        linkedToGoogle: true,
        updatedAt: now,
      };

      await setDoc(
        doc(db, "users", linkedUser.uid),
        {
          email: linkedUser.email || "",
          authProvider: "google",
          linkedToGoogle: true,
          updatedAt: now,
        },
        { merge: true }
      );

      setUser(linkedUser);
      setProfile(updatedProfile);

      alert("Google連携が完了しました。今後はGoogleログインで同じデータを使えます。");
    } catch (e) {
      console.error(e);

      if (
        e.code === "auth/credential-already-in-use" ||
        e.code === "auth/email-already-in-use"
      ) {
        alert(
          "このGoogleアカウントは既に別のユーザーで使われています。別のGoogleアカウントで連携してください。"
        );
        return;
      }

      alert("Google連携に失敗しました。もう一度お試しください。");
    }
  }

  async function clearActiveLeague(removeLeagueId = "") {
    if (!user || !profile) return;

    const now = Date.now();
    const nextLeagueIds = removeLeagueId
      ? getProfileLeagueIds(profile).filter((id) => id !== removeLeagueId)
      : getProfileLeagueIds(profile);

    const updatedProfile = {
      ...profile,
      activeLeagueId: "",
      leagueIds: nextLeagueIds,
      updatedAt: now,
    };

    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          activeLeagueId: "",
          leagueIds: nextLeagueIds,
          updatedAt: now,
        },
        { merge: true }
      );

      setProfile(updatedProfile);
      setActiveLeagueId("");
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
        await clearActiveLeague(leagueId);
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
        await clearActiveLeague(leagueId);
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

  async function switchLeague(leagueId) {
    if (!user || !profile || !leagueId) return;

    if (leagueId === activeLeagueId) return;

    const now = Date.now();
    const nextLeagueIds = Array.from(
      new Set([...getProfileLeagueIds(profile), leagueId])
    );

    const updatedProfile = {
      ...profile,
      activeLeagueId: leagueId,
      leagueIds: nextLeagueIds,
      updatedAt: now,
    };

    try {
      setLeagueReady(false);
      setLeagueError("");

      await setDoc(
        doc(db, "users", user.uid),
        {
          activeLeagueId: leagueId,
          leagueIds: nextLeagueIds,
          updatedAt: now,
        },
        { merge: true }
      );

      setProfile(updatedProfile);
      setSelectedPlayerId("");
      setTab("record");
      await loadLeagueById(leagueId);
    } catch (e) {
      console.error(e);
      setLeagueError("リーグ切替に失敗しました。");
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
      const now = Date.now();
      const nextLeagueIds = Array.from(
        new Set([...getProfileLeagueIds(profile), leagueId])
      );

      const newLeague = {
        name: cleanName,
        ownerUid: user.uid,
        memberUids: [user.uid],
        adminUids: [user.uid],
        inviteEnabled: true,
        players: [],
        games: [],
        cfg: defaultCfg,
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(doc(db, "leagues", leagueId), newLeague);

      const updatedProfile = {
        ...profile,
        activeLeagueId: leagueId,
        leagueIds: nextLeagueIds,
        updatedAt: now,
      };

      await setDoc(
        doc(db, "users", user.uid),
        {
          activeLeagueId: leagueId,
          leagueIds: nextLeagueIds,
          updatedAt: now,
        },
        { merge: true }
      );

      setProfile(updatedProfile);
      setActiveLeagueId(leagueId);
      setLeagueName(cleanName);
      setLeagueOwnerUid(user.uid);
      setLeagueMemberUids([user.uid]);
      setLeagueAdminUids([user.uid]);
      setPlayers([]);
      setGames([]);
      setCfg(defaultCfg);
      setTab("record");
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

      const now = Date.now();
      const nextLeagueIds = Array.from(
        new Set([...getProfileLeagueIds(profile), leagueId])
      );

      const updatedProfile = {
        ...profile,
        activeLeagueId: leagueId,
        leagueIds: nextLeagueIds,
        updatedAt: now,
      };

      await setDoc(
        doc(db, "users", user.uid),
        {
          activeLeagueId: leagueId,
          leagueIds: nextLeagueIds,
          updatedAt: now,
        },
        { merge: true }
      );

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

    const savedGame = {
      ...game,
      createdByUid: user.uid,
      createdByName: profile?.displayName || "名前未設定",
    };

    try {
      setGames(sortGames([savedGame, ...games]));

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        games: arrayUnion(savedGame),
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("対局結果の保存に失敗しました。");
    }
  }

  async function updateGameInLeague(updatedGame) {
    if (!canAdmin || !activeLeagueId) return;

    const now = Date.now();

    const editedGame = {
      ...updatedGame,
      editedAt: now,
      editedDate: new Date(now).toLocaleString("ja-JP"),
      editedByUid: user.uid,
      editedByName: profile?.displayName || "管理者",
    };

    const nextGames = sortGames(
      games.map((g) => (g.id === editedGame.id ? editedGame : g))
    );

    try {
      setGames(nextGames);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        games: nextGames,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("対局履歴の編集に失敗しました。");
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

  async function removeMemberFromLeague(targetUid) {
    if (!canAdmin || !activeLeagueId) return;

    if (targetUid === leagueOwnerUid) {
      alert("リーグ作成者は削除できません。");
      return;
    }

    if (targetUid === user.uid) {
      alert("自分自身は削除できません。");
      return;
    }

    const currentAdminUids = leagueAdminUids.length
      ? leagueAdminUids
      : leagueOwnerUid
      ? [leagueOwnerUid]
      : [];

    const nextMemberUids = leagueMemberUids.filter((uid) => uid !== targetUid);
    let nextAdminUids = currentAdminUids.filter((uid) => uid !== targetUid);

    if (leagueOwnerUid && !nextAdminUids.includes(leagueOwnerUid)) {
      nextAdminUids = [leagueOwnerUid, ...nextAdminUids];
    }

    const nextMemberProfiles = memberProfiles.filter((m) => m.uid !== targetUid);

    try {
      setLeagueMemberUids(nextMemberUids);
      setLeagueAdminUids(nextAdminUids);
      setMemberProfiles(nextMemberProfiles);

      await updateDoc(doc(db, "leagues", activeLeagueId), {
        memberUids: nextMemberUids,
        adminUids: nextAdminUids,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert("ユーザー削除に失敗しました。");
    }
  }

  const inviteUrl = activeLeagueId
    ? `${window.location.origin}${window.location.pathname}?league=${activeLeagueId}`
    : "";

  const mainPanelClassName =
    tab === "record" || tab === "stats" || tab === "playerDetail"
      ? "desktop-main desktop-main-wide"
      : "desktop-main";

  if (!authReady) {
    return (
      <>
        <BaseStyle />
        <div style={appBgStyle}>
          <div className="app-page">
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
        <div className={activeLeagueId ? "app-page app-page-wide" : "app-page"}>
          <Header />

          {!user ? (
            <LoginScreen signInAsGuest={signInAsGuest} />
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
              <UserCard
                profile={profile}
                user={user}
                canAdmin={canAdmin}
                updateDisplayName={updateOwnDisplayName}
                linkGuestWithGoogle={linkGuestWithGoogle}
              />

              {leagueError && (
                <Card>
                  <p style={errorTextStyle}>{leagueError}</p>
                </Card>
              )}

              <LeagueSwitcher
                leagueSummaries={leagueSummaries}
                leagueSummariesLoading={leagueSummariesLoading}
                activeLeagueId={activeLeagueId}
                switchLeague={switchLeague}
                createLeague={createLeague}
              />
            </>
          ) : (
            <div className="desktop-shell">
              <aside className="desktop-sidebar">
                <UserCard
                  profile={profile}
                  user={user}
                  canAdmin={canAdmin}
                  updateDisplayName={updateOwnDisplayName}
                  linkGuestWithGoogle={linkGuestWithGoogle}
                />

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

                <LeagueSwitcher
                  leagueSummaries={leagueSummaries}
                  leagueSummariesLoading={leagueSummariesLoading}
                  activeLeagueId={activeLeagueId}
                  switchLeague={switchLeague}
                  createLeague={createLeague}
                />

                <TabNav
                  tabs={tabs}
                  tab={tab}
                  setTab={setTab}
                  clearSelectedPlayer={() => setSelectedPlayerId("")}
                />
              </aside>

              <main className={mainPanelClassName}>
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
                    cfg={cfg}
                    updateGameInLeague={updateGameInLeague}
                    deleteGame={deleteGame}
                    canAdmin={canAdmin}
                  />
                )}

                {tab === "stats" && (
                  <StatsTab
                    players={players}
                    games={games}
                    openPlayerDetail={(playerId) => {
                      setSelectedPlayerId(playerId);
                      setTab("playerDetail");
                    }}
                  />
                )}

                {tab === "playerDetail" && (
                  <PlayerDetailTab
                    playerId={selectedPlayerId}
                    players={players}
                    games={games}
                    goBack={() => {
                      setSelectedPlayerId("");
                      setTab("stats");
                    }}
                  />
                )}

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
                    removeMemberFromLeague={removeMemberFromLeague}
                    resetLeagueData={resetLeagueData}
                    user={user}
                  />
                )}
              </main>
            </div>
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

      .app-page{
        width:100%;
        max-width:430px;
        margin:0 auto;
        padding:18px 14px 40px;
      }

      .desktop-shell{
        width:100%;
      }

      .desktop-sidebar,
      .desktop-main{
        width:100%;
      }

      .score-input-row{
        display:flex;
        gap:8px;
        margin-bottom:8px;
      }

      .score-input-label{
        width:80px;
        color:${C.muted};
        padding-top:9px;
        flex:none;
      }

      .record-player-list{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
      }

      @media (min-width: 900px){
        .app-page.app-page-wide{
          max-width:1180px;
          padding:24px 28px 60px;
        }

        .app-page.app-page-wide header{
          margin-bottom:24px;
        }

        .desktop-shell{
          display:grid;
          grid-template-columns:340px minmax(0, 760px);
          gap:24px;
          align-items:start;
          justify-content:center;
        }

        .desktop-sidebar{
          position:sticky;
          top:24px;
        }

        .desktop-main{
          min-width:0;
        }

        .desktop-main-wide{
          max-width:760px;
        }

        .record-player-list{
          gap:10px;
        }

        .record-player-list button{
          padding:10px 18px !important;
        }

        .score-input-row{
          display:grid;
          grid-template-columns:110px minmax(0, 1fr);
          align-items:center;
          gap:12px;
          margin-bottom:12px;
        }

        .score-input-label{
          width:auto;
          padding-top:0;
          font-size:15px;
        }

        .score-input-row input{
          padding:12px 14px !important;
          font-size:18px;
        }
      }

      @media (min-width: 1200px){
        .app-page.app-page-wide{
          max-width:1260px;
        }

        .desktop-shell{
          grid-template-columns:360px minmax(0, 840px);
          gap:28px;
        }

        .desktop-main-wide{
          max-width:840px;
        }
      }
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

function LoginScreen({ signInAsGuest }) {
  async function signInWithGoogle() {
    try {
      provider.setCustomParameters({
        prompt: "select_account",
      });
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      alert("Googleログインに失敗しました。ChromeまたはSafariで開いて再度お試しください。");
    }
  }

  const features = [
    ["リーグ共有", "招待URLでメンバーを追加し、仲間内の麻雀成績を共有管理できます。"],
    ["点数記録", "半荘ごとの素点を入力するだけで、順位点・オカ・ウマ込みのポイントを自動計算します。"],
    ["成績集計", "総合ランキング、平均順位、トップ率、四着率、個人成績を自動で集計します。"],
    ["スマホ・PC対応", "対局中はスマホで素早く入力、あとからPCで履歴や成績を確認できます。"],
  ];

  return (
    <>
      <Card>
        <section style={{ textAlign: "center", padding: "18px 0 8px" }}>
          <div
            style={{
              display: "inline-block",
              color: C.gold,
              border: `1px solid ${C.gold}`,
              borderRadius: 999,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            麻雀の点数記録・成績集計・リーグ管理
          </div>

          <h1
            style={{
              color: C.gold,
              fontSize: 28,
              lineHeight: 1.35,
              marginBottom: 12,
            }}
          >
            麻雀リーグ管理アプリ
          </h1>

          <p
            style={{
              color: C.text,
              fontSize: 14,
              lineHeight: 1.8,
              marginBottom: 14,
            }}
          >
            仲間内の麻雀成績をクラウドで管理。
            <br />
            対局結果、総合ランキング、個人成績、トップ率、四着率を自動集計できます。
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 16,
            }}
          >
            <MiniStat label="対応" value="スマホ・PC" />
            <MiniStat label="共有" value="招待URL" />
            <MiniStat label="集計" value="自動計算" />
            <MiniStat label="開始" value="ゲスト可" />
          </div>

          <button onClick={signInWithGoogle} style={googleBtnStyle}>
            Googleでログイン
          </button>

          <button
            onClick={signInAsGuest}
            style={{ ...loginBtnStyle, marginTop: 10 }}
          >
            ゲストではじめる
          </button>

          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: C.muted,
              lineHeight: 1.7,
            }}
          >
            GoogleログインはChromeまたはSafariで開いてください。
            <br />
            LINE・Instagram等のアプリ内ブラウザではログインできない場合があります。
          </div>
        </section>
      </Card>

      <Card>
        <h2 style={sectionHeadingStyle}>できること</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {features.map(([title, body]) => (
            <div
              key={title}
              style={{
                background: C.panel,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div style={{ color: C.gold, fontWeight: 700, marginBottom: 5 }}>
                {title}
              </div>
              <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.7 }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 style={sectionHeadingStyle}>主な機能</h2>
        <ul style={seoListStyle}>
          <li>リーグ作成・複数リーグ切替</li>
          <li>招待URLによるメンバー参加</li>
          <li>ゲスト利用・Googleログイン・Google連携</li>
          <li>半荘ごとの点数記録とポイント自動計算</li>
          <li>総合ランキング・個人成績・順位率の自動集計</li>
          <li>履歴編集、入力者記録、管理者権限、ユーザー管理</li>
        </ul>
      </Card>

      <Card>
        <h2 style={sectionHeadingStyle}>こんな人向け</h2>
        <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.8 }}>
          友人同士の麻雀会、社内麻雀リーグ、月間ランキング、継続的な成績管理に使えます。
          紙やスプレッドシートで管理していた点数・順位・成績を、スマホからすぐに記録できます。
        </p>
      </Card>
    </>
  );
}

function ProfileSetup({ user, displayName, setDisplayName, saveProfile }) {
  return (
    <Card>
      <div style={{ textAlign: "center", padding: "18px 0" }}>
        <div style={titleStyle}>ユーザー名登録</div>
        <div style={descStyle}>表示用のユーザー名を決めてください。</div>
        <div
          style={{
            fontSize: 11,
            color: user.isAnonymous ? C.gold : C.green,
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          {user.isAnonymous ? "ゲスト利用中" : user.email}
          {user.isAnonymous && (
            <>
              <br />
              Google連携すると、このデータを引き継げます。
            </>
          )}
        </div>

        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例：麻雀太郎"
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        <button onClick={saveProfile} style={googleBtnStyle}>
          登録して始める
        </button>
      </div>
    </Card>
  );
}

function UserCard({
  profile,
  user,
  canAdmin,
  updateDisplayName,
  linkGuestWithGoogle,
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.displayName || "");
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);

  const isGuest = !!user?.isAnonymous;

  useEffect(() => {
    setName(profile.displayName || "");
  }, [profile.displayName]);

  async function saveName() {
    const cleanName = name.trim();

    if (!cleanName) {
      alert("ユーザー名を入力してください。");
      return;
    }

    try {
      setSaving(true);
      await updateDisplayName(cleanName);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkGoogle() {
    try {
      setLinking(true);
      await linkGuestWithGoogle();
    } finally {
      setLinking(false);
    }
  }

  async function handleSignOut() {
    if (isGuest) {
      const ok = confirm(
        "ゲストユーザーでログアウトすると、このブラウザで同じデータに戻れない場合があります。ログアウトしますか？"
      );

      if (!ok) return;
    }

    await signOut(auth);
  }

  return (
    <Card>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          ログイン中
        </div>

        {!editing ? (
          <>
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

            <button
              onClick={() => setEditing(true)}
              style={{
                border: "none",
                background: "transparent",
                color: C.muted,
                cursor: "pointer",
                fontSize: 11,
                marginBottom: 8,
              }}
            >
              ユーザー名を変更
            </button>
          </>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ユーザー名"
              style={{ ...inputStyle, marginBottom: 8, textAlign: "center" }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                onClick={() => {
                  setName(profile.displayName || "");
                  setEditing(false);
                }}
                disabled={saving}
                style={smallMutedFullButtonStyle}
              >
                キャンセル
              </button>
              <button
                onClick={saveName}
                disabled={saving}
                style={smallGoldFullButtonStyle}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            display: "inline-block",
            fontSize: 11,
            color: isGuest ? C.gold : canAdmin ? C.gold : C.muted,
            border: `1px solid ${isGuest || canAdmin ? C.gold : C.border}`,
            borderRadius: 999,
            padding: "3px 10px",
            marginBottom: 8,
          }}
        >
          {isGuest ? "ゲストユーザー" : canAdmin ? "管理者" : "一般ユーザー"}
        </div>

        {isGuest && (
          <div
            style={{
              background: "#20180a",
              border: `1px solid ${C.gold}`,
              color: C.gold,
              borderRadius: 10,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.7,
              marginBottom: 12,
              textAlign: "left",
            }}
          >
            ゲスト利用中です。ブラウザデータ削除・端末変更・ログアウトをすると、
            同じデータに戻れない場合があります。
            <button
              onClick={handleLinkGoogle}
              disabled={linking}
              style={{ ...googleBtnStyle, marginTop: 10, padding: 10 }}
            >
              {linking ? "連携中..." : "Googleに連携してデータを保存"}
            </button>
          </div>
        )}

        <button onClick={handleSignOut} style={loginBtnStyle}>
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
          placeholder="例：麻雀会"
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

function LeagueSwitcher({
  leagueSummaries,
  leagueSummariesLoading,
  activeLeagueId,
  switchLeague,
  createLeague,
}) {
  const [newLeagueName, setNewLeagueName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreateLeague() {
    const cleanName = newLeagueName.trim();

    if (!cleanName) {
      alert("リーグ名を入力してください。");
      return;
    }

    try {
      setCreating(true);
      await createLeague(cleanName);
      setNewLeagueName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <Label>リーグ切替</Label>

      {leagueSummariesLoading ? (
        <p style={centerSmallMutedStyle}>参加リーグを読み込み中...</p>
      ) : leagueSummaries.length === 0 ? (
        <p style={centerSmallMutedStyle}>参加中のリーグはまだありません。</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {leagueSummaries.map((league) => {
            const active = league.id === activeLeagueId;

            return (
              <button
                key={league.id}
                onClick={() => switchLeague(league.id)}
                disabled={active}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${active ? C.gold : C.border}`,
                  background: active ? "#20180a" : C.panel,
                  color: active ? C.gold : C.text,
                  cursor: active ? "default" : "pointer",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {active ? "現在：" : ""}
                  {league.name}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                  メンバー {league.memberCount}人
                  {league.isOwner ? " / 作成者" : league.isAdmin ? " / 管理者" : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          borderTop: `1px solid ${C.border}`,
          marginTop: 12,
          paddingTop: 12,
        }}
      >
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
          新しいリーグを作成
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newLeagueName}
            onChange={(e) => setNewLeagueName(e.target.value)}
            placeholder="例：週末麻雀会"
            style={inputStyle}
          />
          <button
            onClick={handleCreateLeague}
            disabled={creating}
            style={smallGoldButtonStyle}
          >
            {creating ? "作成中" : "作成"}
          </button>
        </div>
      </div>
    </Card>
  );
}

function TabNav({ tabs, tab, setTab, clearSelectedPlayer }) {
  return (
    <div style={tabGridStyle}>
      {tabs.map(([k, v]) => (
        <button
          key={k}
          onClick={() => {
            setTab(k);
            if (k !== "playerDetail") clearSelectedPlayer();
          }}
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
  );
}

function RecordTab({ players, saveGameToLeague, cfg, canSaveGame }) {
  const activePlayers = useMemo(
    () => players.filter((p) => !p.hidden),
    [players]
  );

  const [selected, setSelected] = useState([]);
  const [scores, setScores] = useState({});
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const activeIds = activePlayers.map((p) => p.id);
    setSelected((prev) => prev.filter((id) => activeIds.includes(id)));
  }, [activePlayers]);

  if (activePlayers.length < 4) {
    return (
      <Card>
        <p style={centerMutedStyle}>
          管理者が設定タブで表示中のプレイヤーを4人以上にすると記録できます。
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
        <div className="record-player-list">
          {activePlayers.map((p) => {
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
        <Card className="record-score-card">
          <Label>点数入力</Label>
          {selected.map((id) => {
            const p = players.find((x) => x.id === id);
            return (
              <div key={id} className="score-input-row">
                <div className="score-input-label">
                  {p?.name}
                </div>
                <input
                  type="number"
                  step="100"
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

function HistoryTab({
  players,
  games,
  cfg,
  updateGameInLeague,
  deleteGame,
  canAdmin,
}) {
  const [editingGameId, setEditingGameId] = useState("");

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
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.6 }}>
            <div>{g.date}</div>
            <div>入力: {g.createdByName || "不明"}</div>
            {g.editedByName && (
              <div>
                編集: {g.editedByName} / {g.editedDate || ""}
              </div>
            )}
          </div>

          {editingGameId === g.id ? (
            <EditGameForm
              game={g}
              players={players}
              cfg={cfg}
              onCancel={() => setEditingGameId("")}
              onSave={async (updatedGame) => {
                await updateGameInLeague(updatedGame);
                setEditingGameId("");
              }}
            />
          ) : (
            <>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    onClick={() => setEditingGameId(g.id)}
                    style={smallGoldFullButtonStyle}
                  >
                    編集
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("この対局履歴を削除しますか？")) {
                        deleteGame(g.id);
                      }
                    }}
                    style={smallDangerFullButtonStyle}
                  >
                    削除
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

function EditGameForm({ game, players, cfg, onCancel, onSave }) {
  const [scores, setScores] = useState(() => {
    const obj = {};
    game.entries.forEach((e) => {
      obj[e.playerId] = e.score;
    });
    return obj;
  });

  const allFilled = game.entries.every(
    (e) => scores[e.playerId] !== "" && scores[e.playerId] !== undefined
  );

  const total = allFilled
    ? game.entries.reduce((a, e) => a + Number(scores[e.playerId]), 0)
    : null;

  function saveEdit() {
    if (!allFilled) {
      alert("全員分の点数を入力してください。");
      return;
    }

    const entries = game.entries.map((e) => ({
      playerId: e.playerId,
      score: Number(scores[e.playerId]),
    }));

    const recalculated = calcPoints(entries, cfg);

    onSave({
      ...game,
      entries: recalculated,
    });
  }

  return (
    <div
      style={{
        background: "#101020",
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
        点数を編集
      </div>

      {game.entries.map((e) => {
        const p = players.find((x) => x.id === e.playerId);
        return (
          <div key={e.playerId} className="score-input-row">
            <div className="score-input-label">
              {p?.name || "不明"}
            </div>
            <input
              type="number"
              step="100"
              value={scores[e.playerId] || ""}
              onChange={(ev) =>
                setScores({ ...scores, [e.playerId]: ev.target.value })
              }
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button onClick={onCancel} style={smallMutedFullButtonStyle}>
          キャンセル
        </button>
        <button onClick={saveEdit} style={smallGoldFullButtonStyle}>
          保存
        </button>
      </div>
    </div>
  );
}

function StatsTab({ players, games, openPlayerDetail }) {
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
      .filter((p) => !p.hidden || p.n > 0)
      .sort((a, b) => b.totalPt - a.totalPt);
  }, [players, games]);

  return (
    <Card>
      <Label>総合ランキング</Label>
      {stats.length === 0 ? (
        <p style={centerMutedStyle}>プレイヤーがいません。</p>
      ) : (
        stats.map((s, i) => (
          <button
            key={s.id}
            onClick={() => openPlayerDetail(s.id)}
            style={{
              width: "100%",
              padding: "12px 0",
              border: "none",
              borderBottom: `1px solid ${C.border}`,
              background: "transparent",
              color: C.text,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>
                {i + 1}位　{s.name}
                {s.hidden ? "（非表示中）" : ""}
              </div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
                {s.n}半荘 / 平均順位 {s.avgRank} / トップ率 {s.topRate}% /
                四着率 {s.lastRate}%
              </div>
              <div style={{ fontSize: 11, color: C.gold, marginTop: 2 }}>
                詳細を見る →
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
          </button>
        ))
      )}
    </Card>
  );
}

function PlayerDetailTab({ playerId, players, games, goBack }) {
  const player = players.find((p) => p.id === playerId);

  const entries = useMemo(() => {
    return games
      .flatMap((g) =>
        g.entries
          .filter((e) => e.playerId === playerId)
          .map((e) => ({
            ...e,
            gameId: g.id,
            date: g.date,
            createdAt: g.createdAt || 0,
            createdByName: g.createdByName || "不明",
            opponents: g.entries
              .filter((x) => x.playerId !== playerId)
              .map((x) => players.find((p) => p.id === x.playerId)?.name || "不明"),
          }))
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [games, playerId, players]);

  if (!player) {
    return (
      <Card>
        <p style={centerMutedStyle}>プレイヤーが見つかりません。</p>
        <button onClick={goBack} style={loginBtnStyle}>
          ランキングに戻る
        </button>
      </Card>
    );
  }

  const n = entries.length;
  const totalPt = entries.reduce((a, e) => a + e.pt, 0);
  const avgPt = n ? totalPt / n : 0;
  const avgRank = n ? entries.reduce((a, e) => a + e.rank + 1, 0) / n : 0;

  const rankCounts = [0, 1, 2, 3].map(
    (rank) => entries.filter((e) => e.rank === rank).length
  );

  const rate = (count) => (n ? Math.round((count / n) * 100) : 0);

  const scores = entries.map((e) => Number(e.score));
  const pts = entries.map((e) => Number(e.pt));

  const maxScore = n ? Math.max(...scores) : "-";
  const minScore = n ? Math.min(...scores) : "-";
  const maxPt = n ? Math.max(...pts) : "-";
  const minPt = n ? Math.min(...pts) : "-";

  const recent = entries.slice(0, 10);

  return (
    <>
      <Card>
        <button
          onClick={goBack}
          style={{
            border: "none",
            background: "transparent",
            color: C.muted,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          ← ランキングに戻る
        </button>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
            個人成績
          </div>
          <div style={{ fontSize: 24, color: C.gold, fontWeight: 700 }}>
            {player.name}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            {n}半荘 {player.hidden ? " / 非表示中" : ""}
          </div>
        </div>
      </Card>

      <Card>
        <Label>総合成績</Label>
        <div style={detailGridStyle}>
          <MiniStat
            label="総ポイント"
            value={fmtPt(Math.round(totalPt * 10) / 10)}
            strong
          />
          <MiniStat
            label="平均ポイント"
            value={n ? fmtPt(Math.round(avgPt * 10) / 10) : "-"}
          />
          <MiniStat
            label="平均順位"
            value={n ? Math.round(avgRank * 100) / 100 : "-"}
          />
          <MiniStat label="対局数" value={`${n}半荘`} />
        </div>
      </Card>

      <Card>
        <Label>順位率</Label>
        <div style={detailGridStyle}>
          <MiniStat label="トップ率" value={`${rate(rankCounts[0])}%`} />
          <MiniStat label="二着率" value={`${rate(rankCounts[1])}%`} />
          <MiniStat label="三着率" value={`${rate(rankCounts[2])}%`} />
          <MiniStat label="四着率" value={`${rate(rankCounts[3])}%`} />
        </div>
      </Card>

      <Card>
        <Label>最高・最低</Label>
        <div style={detailGridStyle}>
          <MiniStat
            label="最高得点"
            value={n ? `${Number(maxScore).toLocaleString()}点` : "-"}
          />
          <MiniStat
            label="最低得点"
            value={n ? `${Number(minScore).toLocaleString()}点` : "-"}
          />
          <MiniStat
            label="最高pt"
            value={n ? fmtPt(Math.round(maxPt * 10) / 10) : "-"}
          />
          <MiniStat
            label="最低pt"
            value={n ? fmtPt(Math.round(minPt * 10) / 10) : "-"}
          />
        </div>
      </Card>

      <Card>
        <Label>直近成績</Label>
        {recent.length === 0 ? (
          <p style={centerMutedStyle}>まだ対局履歴がありません。</p>
        ) : (
          recent.map((e) => (
            <div
              key={e.gameId}
              style={{
                padding: "10px 0",
                borderBottom: `1px solid ${C.border}`,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>
                  {e.rank + 1}位 / {Number(e.score).toLocaleString()}点
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                  {e.date}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                  入力: {e.createdByName}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                  対戦: {e.opponents.join("・")}
                </div>
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: e.pt >= 0 ? C.green : C.red,
                }}
              >
                {fmtPt(e.pt)}
              </div>
            </div>
          ))
        )}
      </Card>
    </>
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
  removeMemberFromLeague,
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
    savePlayersToDb([
      ...players,
      {
        id: uid(),
        name: name.trim(),
        hidden: false,
        createdAt: Date.now(),
      },
    ]);
    setName("");
  }

  function setPlayerHidden(playerId, hidden) {
    savePlayersToDb(
      players.map((p) =>
        p.id === playerId
          ? {
              ...p,
              hidden,
              updatedAt: Date.now(),
            }
          : p
      )
    );
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
        <div style={{ color: C.muted, fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
          ログインユーザー削除は、このリーグの参加メンバーから外す操作です。
        </div>
      </Card>

      <Card>
        <Label>ログインユーザー管理</Label>

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

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  {isOwner ? (
                    <div style={{ fontSize: 11, color: C.muted }}>
                      変更不可
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

                  {!isOwner && !isMe && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `${m.displayName}をこのリーグから削除しますか？\n削除後、このユーザーはリーグを見られなくなります。`
                          )
                        ) {
                          removeMemberFromLeague(m.uid);
                        }
                      }}
                      style={smallDangerButtonStyle}
                    >
                      ユーザー削除
                    </button>
                  )}
                </div>
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
              alignItems: "center",
              gap: 8,
              padding: "9px 0",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <div>
              <div>{p.name}</div>
              {p.hidden && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  非表示中
                </div>
              )}
            </div>

            {p.hidden ? (
              <button
                onClick={() => setPlayerHidden(p.id, false)}
                style={smallGoldButtonStyle}
              >
                再表示
              </button>
            ) : (
              <button
                onClick={() => setPlayerHidden(p.id, true)}
                style={smallDangerButtonStyle}
              >
                非表示
              </button>
            )}
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

function Card({ children, className = "" }) {
  return (
    <div
      className={className}
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

function MiniStat({ label, value, strong }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: strong ? 19 : 16,
          fontWeight: 700,
          color:
            typeof value === "string" && value.startsWith("+")
              ? C.green
              : typeof value === "string" && value.startsWith("-")
              ? C.red
              : C.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}


const sectionHeadingStyle = {
  color: C.gold,
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 12,
};

const seoListStyle = {
  color: C.muted,
  fontSize: 13,
  lineHeight: 1.9,
  paddingLeft: 18,
};

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

const detailGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 8,
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

const smallGoldFullButtonStyle = {
  width: "100%",
  marginTop: 8,
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${C.gold}`,
  background: C.surface,
  color: C.gold,
  cursor: "pointer",
};

const smallDangerFullButtonStyle = {
  width: "100%",
  marginTop: 8,
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${C.red}`,
  background: "transparent",
  color: C.red,
  cursor: "pointer",
};

const smallMutedFullButtonStyle = {
  width: "100%",
  marginTop: 8,
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
};