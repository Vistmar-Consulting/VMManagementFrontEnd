import { createElement } from "react";
import { createClient } from "@liveblocks/client";
import { LiveblocksProvider, RoomProvider, useRoom, useOthers, useSelf } from "@liveblocks/react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";

const client = createClient({
  authEndpoint: async (room) => {
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
      headers: { "Content-Type": "application/json", "X-User-Token": token },
      body: JSON.stringify({ room, name, avatarColor }),
    });
    if (!res.ok) throw new Error(`Liveblocks auth failed: ${res.status}`);
    return await res.json();
  },
});

// Wrap any subtree that uses Liveblocks (RoomProvider must be inside this).
export function LiveblocksRoot({ children }) {
  return createElement(LiveblocksProvider, { client }, children);
}

export { RoomProvider, useRoom, useOthers, useSelf };
