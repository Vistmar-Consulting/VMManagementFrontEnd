import { describe, it, expect } from "vitest";
import { agendaRoomId } from "../agendaRoom.js";

const LONG_ID =
  "_60q30c1g60o30e1i60o4ac1g60rj8gpl88rj2c1h84s34h9g60s30c1g60o30c1g60q34d9k6d13aha275148g9g64o30c1g60o30c1g60o30c1g60o32c1g60o30c1g6sok8gq488p46c9o6cqjce1k70s3ih9n71338h2364sk4e1p6cog";

describe("agendaRoomId", () => {
  it("returns agenda:<id> unchanged for a normal Firestore id", () => {
    expect(agendaRoomId("ea74a0v5at8tqo46ka8mtth368")).toBe("agenda:ea74a0v5at8tqo46ka8mtth368");
  });

  it("leaves a recurring-suffixed id (still < limit) unchanged", () => {
    const id = "6295h9p4mu514u7fkqm0tgmr68_R20260521T183000";
    expect(agendaRoomId(id)).toBe(`agenda:${id}`);
  });

  it("bounds an abnormally long id to a stable, shorter room id", () => {
    const room = agendaRoomId(LONG_ID);
    expect(room.startsWith("agenda:")).toBe(true);
    expect(room.length).toBeLessThanOrEqual(100);
    // Stable: same input always maps to the same room (so it persists).
    expect(agendaRoomId(LONG_ID)).toBe(room);
  });

  it("maps different long ids to different rooms (no collision for distinct ids)", () => {
    expect(agendaRoomId("a".repeat(200))).not.toBe(agendaRoomId("b".repeat(200)));
  });

  it("handles empty / nullish input safely", () => {
    expect(agendaRoomId("")).toBe("agenda:");
    expect(agendaRoomId(undefined)).toBe("agenda:");
    expect(agendaRoomId(null)).toBe("agenda:");
  });
});
