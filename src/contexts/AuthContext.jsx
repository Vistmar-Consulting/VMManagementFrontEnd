import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../firebase.js";

const REQUIRED_EMAIL_DOMAIN = "vistamarconsulting.com";

const AuthContext = createContext(null);

// Pastel avatar palette — deterministic-by-uid pick. Real palette + per-user
// override lives in Member Management (V1, later slice). This is the first-sign-in
// default so the user has a non-null avatarColor from minute one.
const AVATAR_PALETTE = [
  "#a8d8ea", "#aa96da", "#fcbad3", "#ffd3b6",
  "#a8e6cf", "#dcedc1", "#ffaaa5", "#bee5d3",
];

function pickAvatarColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash * 31) + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function splitName(displayName, email) {
  const fromName = (displayName || "").trim();
  if (fromName.includes(" ")) {
    const parts = fromName.split(/\s+/);
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }
  if (fromName) return { firstName: fromName, lastName: "" };
  const local = email.split("@")[0];
  return { firstName: local, lastName: "" };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let profileUnsubscribe = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (profileUnsubscribe) {
        profileUnsubscribe();
        profileUnsubscribe = null;
      }

      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setError(null);
        setLoading(false);
        return;
      }

      // Domain enforcement — defense in depth alongside Firestore rules.
      // If a non-vistamarconsulting.com Google account makes it through
      // (e.g., user picks the wrong account from the chooser), sign them
      // out immediately and surface an actionable error.
      const email = (firebaseUser.email || "").toLowerCase();
      if (!email.endsWith(`@${REQUIRED_EMAIL_DOMAIN}`)) {
        await firebaseSignOut(auth);
        setError(new Error(
          `Sign-in is restricted to @${REQUIRED_EMAIL_DOMAIN} accounts. `
          + `(You signed in with ${firebaseUser.email || "an unknown email"}.)`
        ));
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setError(null);

      const userRef = doc(db, "users", firebaseUser.uid);

      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const { firstName, lastName } = splitName(
            firebaseUser.displayName,
            firebaseUser.email,
          );
          await setDoc(userRef, {
            email: firebaseUser.email,
            displayName:
              firebaseUser.displayName
              || `${firstName} ${lastName}`.trim()
              || firebaseUser.email,
            firstName,
            lastName,
            avatarColor: pickAvatarColor(firebaseUser.uid),
            role: "member",
            active: true,
            joinedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        setError(err);
        setLoading(false);
        return;
      }

      profileUnsubscribe = onSnapshot(
        userRef,
        (snap) => {
          setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    });

    return () => {
      authUnsubscribe();
      if (profileUnsubscribe) profileUnsubscribe();
    };
  }, []);

  // Sign-in is initiated by the GIS button on the SignIn page (it calls
  // signInWithCredential directly). AuthContext only owns onAuthStateChanged
  // + signOut.
  const signOut = () => firebaseSignOut(auth);

  const isAdmin = profile?.role === "admin" && profile?.active === true;

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, error, isAdmin, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
