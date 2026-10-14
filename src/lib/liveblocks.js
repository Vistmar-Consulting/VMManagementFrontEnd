import { createElement } from "react";
import { LiveblocksProvider, RoomProvider, useRoom, useOthers, useSelf } from "@liveblocks/react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";

const RELOAD_KEY = "vm:staleReloadAt";

function reloadForNewVersion() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // storage unavailable — reload anyway
  }
  window.location.reload();
}

// v3: the global LiveblocksProvider takes the client options (authEndpoint) as
// PROPS and builds the client internally — it does NOT accept a pre-built
// `client` prop (that's the createLiveblocksContext(client) pattern). So the
// authEndpoint lives here and is passed straight to LiveblocksProvider.
const authEndpoint = async (room) => {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  let name = user.displayName || user.email || "User";
  let avatarColor = "#888888";
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const d = snap.data();
      name = d.displayName || name;
      avatarColor = d.avatarColor || avatarColor;
    }
  } catch {
    // non-fatal — fall back to auth.currentUser values
  }

  const res = await fetch("/api/liveblocks-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token, "X-Build-Id": __BUILD_ID__ },
    body: JSON.stringify({ room, name, avatarColor }),
  });
  // 426: a newer version is deployed. Reload onto it rather than edit with an
  // older editor schema. At most once a minute, so a lagging CDN can't loop.
  if (res.status === 426) reloadForNewVersion();
  if (!res.ok) throw new Error(`Liveblocks auth failed: ${res.status}`);
  return await res.json();
};

// Wrap any subtree that uses Liveblocks (RoomProvider must be inside this).
export function LiveblocksRoot({ children }) {
  return createElement(LiveblocksProvider, { authEndpoint }, children);
}

export { RoomProvider, useRoom, useOthers, useSelf };
