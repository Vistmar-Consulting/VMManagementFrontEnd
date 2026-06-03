import { createContext, useContext, useCallback, useRef, useMemo } from "react";

const FlushRegistryContext = createContext(null);

export function CollabFlushRegistryProvider({ children }) {
  const flushersRef = useRef(new Set());

  const register = useCallback((fn) => {
    flushersRef.current.add(fn);
    return () => flushersRef.current.delete(fn);
  }, []);

  const flushAll = useCallback(async () => {
    await Promise.all([...flushersRef.current].map((fn) => {
      try { return Promise.resolve(fn()); } catch { return Promise.resolve(); }
    }));
  }, []);

  const value = useMemo(() => ({ register, flushAll }), [register, flushAll]);
  return <FlushRegistryContext.Provider value={value}>{children}</FlushRegistryContext.Provider>;
}

export function useCollabFlushRegistry() {
  return useContext(FlushRegistryContext) || { register: () => () => {}, flushAll: async () => {} };
}
