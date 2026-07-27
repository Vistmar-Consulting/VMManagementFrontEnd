// Regression guard for the attendee pickers in NewMeetingDialog.
//
// Bug (2026-07-27): the "Add Vistamar teammate…" dropdown was sourced from the
// `users` Firestore collection. A users/{uid} doc is only minted on that
// person's first sign-in (AuthContext), so teammates who had never logged into
// the app were silently missing from the scheduler — while Settings >
// Organizations (which reads organizations/vistamar/members) showed them fine.
//
// The dropdown is now sourced from organizations/vistamar/members, matching
// ManageGuestsDialog. These tests pin that wiring so it can't regress.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";

// --- Fixtures -------------------------------------------------------------
// The full Vistamar roster as it exists in organizations/vistamar/members.
// Note Bill and Hugo: present in the org directory, absent from `users` —
// exactly the people the bug hid.
const VM_MEMBERS = [
  { id: "adeemer@vistamarconsulting.com", name: "Andy Deemer", email: "adeemer@vistamarconsulting.com" },
  { id: "blewis@vistamarconsulting.com", name: "Bill Lewis", email: "blewis@vistamarconsulting.com" },
  { id: "ctucksherman@vistamarconsulting.com", name: "Cedric Tuck-Sherman", email: "ctucksherman@vistamarconsulting.com" },
  { id: "hfurth@vistamarconsulting.com", name: "Hugo Furth", email: "hfurth@vistamarconsulting.com" },
  { id: "srobinson@vistamarconsulting.com", name: "Scot Robinsons", email: "srobinson@vistamarconsulting.com" },
];

const CLIENT_MEMBERS = [
  { id: "dmorris@brynmawrdermatology.com", name: "Denni Morris", email: "dmorris@brynmawrdermatology.com" },
  { id: "dthompson@brynmawrdermatology.com", name: "Diana Thompson", email: "dthompson@brynmawrdermatology.com" },
];

// Only a subset of the team has ever signed in — this is what `users` holds.
// It must NOT drive the teammate dropdown any more.
const USERS = [
  { id: "uid-scot", displayName: "Scot Robinson", email: "srobinson@vistamarconsulting.com" },
  { id: "uid-andy", displayName: "Andy Deemer", email: "adeemer@vistamarconsulting.com" },
  { id: "uid-cedric", displayName: "Cedric Tuck-Sherman", email: "ctucksherman@vistamarconsulting.com" },
  { id: "uid-seo", displayName: "SEO Analytics", email: "seo@vistamarconsulting.com" },
];

const ORGS = [
  { id: "vistamar", name: "Vistamar", type: "internal" },
  { id: "bryn-mawr-dermatology", name: "Bryn Mawr Dermatology", type: "client" },
];

// --- Mocks ----------------------------------------------------------------
const useOrgMembersMock = vi.fn();
vi.mock("../../hooks/useOrgMembers.js", () => ({
  useOrgMembers: (slug) => useOrgMembersMock(slug),
}));

vi.mock("../../contexts/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { uid: "uid-andy", email: "adeemer@vistamarconsulting.com" } }),
}));

vi.mock("../../firebase.js", () => ({ db: {} }));

vi.mock("../../lib/meetingsApi.js", () => ({ createMeeting: vi.fn() }));

vi.mock("../../lib/orgMembers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  upsertOrgMember: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const NewMeetingDialog = (await import("../NewMeetingDialog.jsx")).default;

const theme = createTheme();

// A full dialog render (MUI Dialog + two x-date-pickers) runs ~5s in jsdom,
// right at the default 5000ms ceiling. Give every test in this file headroom.
vi.setConfig({ testTimeout: 30000 });

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>{ui}</LocalizationProvider>
    </ThemeProvider>,
  );
}

function renderDialog() {
  return wrap(<NewMeetingDialog orgs={ORGS} users={USERS} onClose={vi.fn()} />);
}

// Open an MUI Autocomplete by placeholder and return its rendered option labels.
function openOptions(placeholder) {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  // Scope to the Autocomplete's own listbox — the Organization <Select> also
  // renders a role="listbox" popup, so an unscoped getByRole would be ambiguous.
  const listbox = document.querySelector(".MuiAutocomplete-listbox");
  // Throw rather than return [] — a silently-empty list would make every
  // not.toContain() assertion below pass vacuously if the popup stops opening.
  if (!listbox) throw new Error(`Autocomplete "${placeholder}" did not open a listbox`);
  return within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent);
}

beforeEach(() => {
  useOrgMembersMock.mockReset();
  useOrgMembersMock.mockImplementation((slug) => {
    if (slug === "vistamar") return { data: VM_MEMBERS };
    if (slug === "bryn-mawr-dermatology") return { data: CLIENT_MEMBERS };
    return { data: [] };
  });
});

describe("NewMeetingDialog — Vistamar teammate dropdown", () => {
  it("reads the roster from organizations/vistamar/members", () => {
    renderDialog();
    expect(useOrgMembersMock).toHaveBeenCalledWith("vistamar");
  });

  it("lists every Vistamar org member, including those with no app account", () => {
    renderDialog();
    const options = openOptions("Add Vistamar teammate…");
    expect(options).toEqual([
      "Andy Deemer",
      "Bill Lewis",
      "Cedric Tuck-Sherman",
      "Hugo Furth",
      "Scot Robinsons",
    ]);
  });

  it("never offers a silent proxy as a teammate", () => {
    renderDialog();
    const options = openOptions("Add Vistamar teammate…");
    // seo@ exists in `users` but is the Fireflies guest mailbox, not a teammate.
    // The server prepends it to every event (api/meetings/_lib/attendee-helpers.js),
    // so it must never be pickable here.
    expect(options).not.toContain("SEO Analytics");
  });

  it("drops a teammate from the list once they are added as an attendee", () => {
    renderDialog();
    const input = screen.getByPlaceholderText("Add Vistamar teammate…");
    fireEvent.mouseDown(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);

    expect(openOptions("Add Vistamar teammate…")).not.toContain("Andy Deemer");
  });
});

describe("NewMeetingDialog — client attendee dropdown", () => {
  it("is disabled until an organization is picked", () => {
    renderDialog();
    expect(screen.getByPlaceholderText("Add client attendee…")).toBeDisabled();
  });

  it("lists that org's member directory for a client org", () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /organization/i }));
    fireEvent.click(screen.getByRole("option", { name: "Bryn Mawr Dermatology" }));

    expect(useOrgMembersMock).toHaveBeenCalledWith("bryn-mawr-dermatology");
    expect(openOptions("Add client attendee…")).toEqual([
      "Denni Morris",
      "Diana Thompson",
    ]);
  });

  it("stays disabled for a Vistamar-org meeting — that roster is the teammate list", () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /organization/i }));
    fireEvent.click(screen.getByRole("option", { name: "Vistamar" }));

    expect(screen.getByPlaceholderText("Add client attendee…")).toBeDisabled();
    // The client directory subscription must be short-circuited, not pointed at
    // vistamar — otherwise the teammate roster would list twice.
    expect(useOrgMembersMock).toHaveBeenCalledWith(null);
  });

  it("keeps the client Add button dead once the org switches to Vistamar", () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /organization/i }));
    fireEvent.click(screen.getByRole("option", { name: "Bryn Mawr Dermatology" }));

    // Select a client without adding them, then switch org.
    const clientInput = screen.getByPlaceholderText("Add client attendee…");
    fireEvent.mouseDown(clientInput);
    fireEvent.keyDown(clientInput, { key: "ArrowDown" });
    fireEvent.keyDown(clientInput, { key: "Enter" });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /organization/i }));
    fireEvent.click(screen.getByRole("option", { name: "Vistamar" }));

    // The stale pick must not be attachable to the Vistamar meeting.
    const addButtons = screen.getAllByRole("button", { name: "Add" });
    expect(addButtons[1]).toBeDisabled();
    expect(screen.queryByText("Denni Morris")).not.toBeInTheDocument();
  });
});
