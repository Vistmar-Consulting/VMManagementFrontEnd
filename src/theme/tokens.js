// Shared editorial design tokens (copper / cream "Guide" palette).
//
// Canonical palette per docs/AGENDA_DETAIL_PAGE_REFERENCE.md §3. Previously
// duplicated inline in Calendar.jsx and AgendaDetail.jsx (each carried a
// "will hoist to a shared module" TODO). Hoisted here 2026-05-29 (v0.2.3.b)
// so the Fireflies components (PastMeetingsCard, MeetingDetailModal) can reuse
// the same tokens without re-declaring them.
//
// Convention: copper = recurring / brand primary; purple = ad-hoc; grey = past;
// green = positive; amber = pending; red = destructive.

export const t = {
  ink: "#1a1a2e", // headings
  ink2: "#3d3d5c", // body
  ink3: "#6b6b8a", // muted / secondary
  cream: "#faf8f5", // panel bg
  cream2: "#f0ede8", // chip bg
  cream3: "#e8e4dd", // borders / dashed
  copper: "#b87333", // accent for recurring + primary CTAs
  copperLight: "#d4a574",
  copperFaint: "rgba(184,115,51,0.08)", // today-cell / active highlight
  blue: "#376fd0", // draft / notes label
  green: "#2e7d32",
  red: "#c62828",
  amber: "#ef6c00",
  purple: "#5e35b1", // accent for ad-hoc / upcoming
  purpleLight: "#ede7f6",
  serif: "'Playfair Display', Georgia, serif", // titles + section labels
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

export default t;
