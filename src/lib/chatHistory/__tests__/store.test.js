import { describe, expect, it } from "vitest";
import { ChatTooLargeError, INTERRUPTED_NOTICE, MAX_TURN_BYTES, chatTitle, restoreTurns, sortChats, turnDoc } from "../store.js";

const user = (text) => ({ role: "user", content: text });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }] });

describe("chat history store", () => {
  it("titles a chat by its first question, on one line, at most 60 characters", () => {
    expect(chatTitle("  what is\nblocked?  ")).toBe("what is blocked?");
    const long = chatTitle("x".repeat(80));
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
  });

  it("stores messages as JSON, nested arrays and all", () => {
    const messages = [user("q"), { role: "assistant", content: [{ type: "tool_use", input: { ids: [["a"]] } }] }];
    const d = turnDoc({ index: 0, status: "done", messages, entry: { user: "q" } });
    expect(JSON.parse(d.messagesJson)).toEqual(messages);
  });

  it("refuses an exchange too large for one Firestore document", () => {
    const big = "é".repeat(MAX_TURN_BYTES / 2 + 1); // 2 bytes each in UTF-8
    expect(() => turnDoc({ index: 0, status: "done", messages: [user(big)], entry: {} })).toThrow(ChatTooLargeError);
  });

  it("restores turns in order; a running turn is shown interrupted and left out of the model history", () => {
    const t = (index, status, messages, entry) => turnDoc({ index, status, messages, entry });
    const out = restoreTurns([
      t(2, "running", [user("c")], { user: "c" }),
      t(0, "done", [user("a"), assistant("A")], { user: "a", reply: "A" }),
      t(1, "error", [user("b")], { user: "b", error: "Failed to fetch" }),
    ]);
    expect(out.history).toEqual([user("a"), assistant("A"), user("b")]);
    expect(out.entries.map((e) => e.user)).toEqual(["a", "b", "c"]);
    expect(out.entries[2].notice).toBe(INTERRUPTED_NOTICE);
    expect(out.entries[1].error).toBe("Failed to fetch");
  });

  it("lists chats newest first, a just-saved one on top", () => {
    const at = (ms) => ({ toMillis: () => ms });
    const sorted = sortChats([{ id: "old", updatedAt: at(1) }, { id: "pending", updatedAt: null }, { id: "new", updatedAt: at(2) }]);
    expect(sorted.map((c) => c.id)).toEqual(["pending", "new", "old"]);
  });
});
