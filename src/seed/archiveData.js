// Verbatim ports of pmItems.js constants from
// ~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/pmItems.js
//
// Used ONLY by src/seed/portSeed.js — the one-shot reset that wipes the
// generic dev-seed items and replants the board with real archive data.
// Not imported at runtime by the app.
//
// Field names kept in archive's SQL PascalCase here; portSeed.js does the
// camelCase translation + Org_Id integer → slug mapping during write.

// ---------------------------------------------------------------------------
// PRIORITIES — used as enum values on items.priorityId (numeric, matches
// Console's pm.Priorities SQL table for trivial future migration).
// ---------------------------------------------------------------------------
export const PM_PRIORITIES = [
  { Id: 1, Priority_Name: "Critical", Priority_Color: "#f44336", Sort_Order: 1 },
  { Id: 2, Priority_Name: "High",     Priority_Color: "#ff9800", Sort_Order: 2 },
  { Id: 3, Priority_Name: "Medium",   Priority_Color: "#fdd835", Sort_Order: 3 },
  { Id: 4, Priority_Name: "Low",      Priority_Color: "#4caf50", Sort_Order: 4 },
];

// ---------------------------------------------------------------------------
// CATEGORIES — shared across all orgs (Org_Id stripped from archive).
// The archive's per-org Org_Id 2 scoping was Console-era; V1 unified to
// global per Andy 2026-05-27. Column-header filter popovers reduce to
// values used by currently-visible items; row cells show the full list.
// ---------------------------------------------------------------------------
export const PM_CATEGORIES = [
  { Id: 1, Category_Name: "GBP",                 Category_Color: "#5c6bc0", Sort_Order: 1 },
  { Id: 2, Category_Name: "Content & Social",    Category_Color: "#8d6e63", Sort_Order: 2 },
  { Id: 3, Category_Name: "Website",             Category_Color: "#00897b", Sort_Order: 3 },
  { Id: 4, Category_Name: "SEO",                 Category_Color: "#546e7a", Sort_Order: 4 },
  { Id: 5, Category_Name: "Reviews",             Category_Color: "#ad1457", Sort_Order: 5 },
  { Id: 6, Category_Name: "PPC",                 Category_Color: "#6d4c41", Sort_Order: 6 },
  { Id: 7, Category_Name: "Reporting",           Category_Color: "#00695c", Sort_Order: 7 },
  { Id: 8, Category_Name: "Provider Onboarding", Category_Color: "#37474f", Sort_Order: 8 },
];

// ---------------------------------------------------------------------------
// TAGS — shared across all orgs.
// ---------------------------------------------------------------------------
export const PM_TAGS = [
  { Id: 1, Tag_Name: "Q2",             Tag_Color: "#1565c0" },
  { Id: 2, Tag_Name: "client-facing",  Tag_Color: "#c62828" },
  { Id: 3, Tag_Name: "recurring",      Tag_Color: "#00838f" },
  { Id: 4, Tag_Name: "blocked",        Tag_Color: "#e65100" },
  { Id: 5, Tag_Name: "quick-win",      Tag_Color: "#2e7d32" },
];

// ---------------------------------------------------------------------------
// Preset color palette for the Color picker in Category + Tag dialogs.
// Tailwind-inspired 500-weight colors — modern, evenly-distributed across
// the spectrum, and play nicely with the pastel pill system (getPillBg
// lightens by 72% so even saturated colors end up airy on the row chip).
// Category and Tag share the same preset palette — users can still pick
// any color via the free-form picker; presets are just quick-picks.
// ---------------------------------------------------------------------------
const MODERN_PRESET_COLORS = [
  "#64748b", // slate
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f43f5e", // rose
];

export const CATEGORY_COLORS = MODERN_PRESET_COLORS;
export const TAG_COLORS = MODERN_PRESET_COLORS;

// ---------------------------------------------------------------------------
// ITEMS — full archive PM_ITEMS verbatim. All Org_Id 2 (Unio).
// Tag_Ids only present where the archive included them.
// ---------------------------------------------------------------------------
export const PM_ITEMS = [
  // PROJECT 1: Monthly GBP Audit — April 2026
  { Id: 1,  Parent_Item_Id: null, Org_Id: 2, Item_Title: "Monthly GBP Audit — April 2026", Assigned_Member_Ids: [1, 4], Status_Id: 2, Priority_Id: 2, Category_Id: 1, Due_Date: "2026-04-30T00:00:00Z", Sort_Order: 0 },
  { Id: 2,  Parent_Item_Id: 1,    Org_Id: 2, Item_Title: "GI-Solvang — resolve GBP verification with Google Support", Assigned_Member_Ids: [1], Status_Id: 3, Priority_Id: 1, Category_Id: 1, Tag_Ids: [1, 2], Due_Date: "2026-03-20T00:00:00Z", Sort_Order: 0 },
  { Id: 3,  Parent_Item_Id: 1,    Org_Id: 2, Item_Title: "GI-Newport Beach — update description with gastroenterologist keywords", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: 3, Category_Id: 1, Tag_Ids: [1, 5], Due_Date: "2026-04-10T00:00:00Z", Sort_Order: 0 },
  { Id: 4,  Parent_Item_Id: 1,    Org_Id: 2, Item_Title: "GI-Rancho Bernardo — verify NAP after rank improvement to #2", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: 3, Category_Id: 1, Due_Date: "2026-04-12T00:00:00Z", Sort_Order: 0 },
  { Id: 5,  Parent_Item_Id: 1,    Org_Id: 2, Item_Title: "GI-Mountain View — review photos and content quality", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: 4, Category_Id: 1, Due_Date: "2026-04-15T00:00:00Z", Sort_Order: 0 },
  { Id: 6,  Parent_Item_Id: 1,    Org_Id: 2, Item_Title: "GI-Thousand Oaks — verify Google Business attributes are complete", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: 4, Category_Id: 1, Due_Date: "2026-04-15T00:00:00Z", Sort_Order: 0 },

  // PROJECT 2: Q2 Google Ads Proposal
  { Id: 10, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Q2 Google Ads Proposal — Shift to Geo-Targeted Terms", Assigned_Member_Ids: [1, 4], Status_Id: 2, Priority_Id: 2, Category_Id: 6, Due_Date: "2026-04-10T00:00:00Z", Sort_Order: 0 },
  { Id: 11, Parent_Item_Id: 10,   Org_Id: 2, Item_Title: "Pull Q1 cost-per-acquisition breakdown by location", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: null, Category_Id: 6, Due_Date: "2026-04-05T00:00:00Z", Sort_Order: 0 },
  { Id: 12, Parent_Item_Id: 10,   Org_Id: 2, Item_Title: "Draft budget reallocation — generic terms to geo-targeted", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: null, Category_Id: 6, Due_Date: "2026-04-08T00:00:00Z", Sort_Order: 0 },
  { Id: 13, Parent_Item_Id: 10,   Org_Id: 2, Item_Title: "Send proposal to Clayton and Natalie for approval", Assigned_Member_Ids: [4], Status_Id: 1, Priority_Id: null, Category_Id: 6, Due_Date: "2026-04-10T00:00:00Z", Sort_Order: 0 },

  // PROJECT 3: Provider Onboarding — Los Gatos New Hires
  { Id: 20, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Provider Onboarding — Los Gatos New Hires", Assigned_Member_Ids: [1, 3], Status_Id: 3, Priority_Id: 2, Category_Id: 8, Due_Date: "2026-04-15T00:00:00Z", Sort_Order: 0 },
  { Id: 21, Parent_Item_Id: 20,   Org_Id: 2, Item_Title: "Collect headshots and CVs from HR", Assigned_Member_Ids: [3], Status_Id: 3, Priority_Id: 2, Category_Id: 8, Due_Date: "2026-04-04T00:00:00Z", Sort_Order: 0 },
  { Id: 22, Parent_Item_Id: 20,   Org_Id: 2, Item_Title: "Draft provider bios for website", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: null, Category_Id: 8, Due_Date: "2026-04-10T00:00:00Z", Sort_Order: 0 },
  { Id: 23, Parent_Item_Id: 20,   Org_Id: 2, Item_Title: "Create GBP listings for new providers", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: null, Category_Id: 1, Due_Date: "2026-04-12T00:00:00Z", Sort_Order: 0 },
  { Id: 24, Parent_Item_Id: 20,   Org_Id: 2, Item_Title: "Schedule video interviews with Dr. Shirazi and Dr. Fuller", Assigned_Member_Ids: [1, 5], Status_Id: 1, Priority_Id: null, Category_Id: 8, Due_Date: "2026-04-08T00:00:00Z", Sort_Order: 0 },

  // PROJECT 4: Unio Rebranding
  { Id: 30, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Unio Rebranding — Marketing Materials Impact Assessment", Assigned_Member_Ids: [1, 2, 3], Status_Id: 2, Priority_Id: 2, Category_Id: 2, Due_Date: "2026-04-22T00:00:00Z", Sort_Order: 0 },
  { Id: 31, Parent_Item_Id: 30,   Org_Id: 2, Item_Title: "Audit current marketing materials against new brand guidelines", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: null, Category_Id: 2, Due_Date: "2026-04-08T00:00:00Z", Sort_Order: 0 },
  { Id: 32, Parent_Item_Id: 30,   Org_Id: 2, Item_Title: "Update email templates with new Unio branding", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: null, Category_Id: 2, Due_Date: "2026-04-15T00:00:00Z", Sort_Order: 0 },
  { Id: 33, Parent_Item_Id: 30,   Org_Id: 2, Item_Title: "Identify website pages requiring visual refresh", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: null, Category_Id: 3, Due_Date: "2026-04-18T00:00:00Z", Sort_Order: 0 },

  // PROJECT 5: rater8 Review Optimization
  { Id: 40, Parent_Item_Id: null, Org_Id: 2, Item_Title: "rater8 Review Optimization — Low Volume Locations", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: 3, Category_Id: 5, Due_Date: null, Sort_Order: 0 },
  { Id: 41, Parent_Item_Id: 40,   Org_Id: 2, Item_Title: "Investigate Solvang — 0 reviews in 3 months", Assigned_Member_Ids: [1], Status_Id: 3, Priority_Id: 2, Category_Id: 5, Due_Date: "2026-04-05T00:00:00Z", Sort_Order: 0 },
  { Id: 42, Parent_Item_Id: 40,   Org_Id: 2, Item_Title: "Monitor Newport Beach focus mode results", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: 4, Category_Id: 5, Due_Date: "2026-04-15T00:00:00Z", Sort_Order: 0 },
  { Id: 43, Parent_Item_Id: 40,   Org_Id: 2, Item_Title: "Compile monthly review volume report for all locations", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: 3, Category_Id: 5, Due_Date: "2026-04-30T00:00:00Z", Sort_Order: 0 },

  // STANDALONE TASKS — Active
  { Id: 50, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Draft colonoscopy prep FAQ page", Assigned_Member_Ids: [1, 10], Status_Id: 4, Priority_Id: 3, Category_Id: 3, Due_Date: "2026-04-10T00:00:00Z", Sort_Order: 0 },
  { Id: 51, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Send consolidated KPI dashboard to Clayton for feedback", Assigned_Member_Ids: [4], Status_Id: 1, Priority_Id: 3, Category_Id: 7, Due_Date: "2026-04-08T00:00:00Z", Sort_Order: 0 },
  { Id: 52, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Create email sequence for CyberKnife white paper downloaders", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: 3, Category_Id: 2, Due_Date: "2026-04-15T00:00:00Z", Sort_Order: 0 },
  { Id: 53, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Demo SERP Aggregate view at next biweekly meeting", Assigned_Member_Ids: [4], Status_Id: 1, Priority_Id: 3, Category_Id: 7, Due_Date: "2026-04-10T00:00:00Z", Sort_Order: 0 },
  { Id: 54, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Respond to 1-star review — Kearny Mesa", Assigned_Member_Ids: [1], Status_Id: 1, Priority_Id: 2, Category_Id: 5, Due_Date: "2026-04-03T00:00:00Z", Sort_Order: 0 },
  { Id: 55, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Update webpage content for GI-Thousand Oaks", Assigned_Member_Ids: [1], Status_Id: 2, Priority_Id: 3, Category_Id: 3, Due_Date: "2026-04-12T00:00:00Z", Sort_Order: 0 },
  { Id: 56, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Reach out to Kerry Parker about ZocDoc usage and attribution metrics", Assigned_Member_Ids: [1, 9], Status_Id: 1, Priority_Id: 3, Category_Id: 7, Due_Date: "2026-04-08T00:00:00Z", Sort_Order: 0 },
  { Id: 57, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Contact City of San Diego re: CyberKnife permitting issues", Assigned_Member_Ids: [9], Status_Id: 3, Priority_Id: 2, Category_Id: 2, Due_Date: "2026-03-25T00:00:00Z", Sort_Order: 0 },

  // AI-CREATED (Pending status — kept in archive for parity, mapped to Assigned for V1 since Pending isn't in V1 board)
  { Id: 70, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Follow up with Clayton on KPI dashboard feedback", Assigned_Member_Ids: [4], Status_Id: 6, Priority_Id: 3, Category_Id: 7, Due_Date: "2026-04-08T00:00:00Z", Sort_Order: 0 },
  { Id: 71, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Discuss social media posts and email campaign ideas with David", Assigned_Member_Ids: [1, 3], Status_Id: 6, Priority_Id: null, Category_Id: 2, Due_Date: null, Sort_Order: 0 },
  { Id: 72, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Schedule provider photo sessions for updated GBP listings", Assigned_Member_Ids: [1], Status_Id: 6, Priority_Id: null, Category_Id: 1, Due_Date: null, Sort_Order: 0 },
  { Id: 73, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Get low-level Zoho account to learn the platform", Assigned_Member_Ids: [1], Status_Id: 6, Priority_Id: 4, Category_Id: 7, Due_Date: null, Sort_Order: 0 },

  // COMPLETED — Status_Id 5
  { Id: 60, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Set up SERP tracking for all 47 Unio locations", Assigned_Member_Ids: [4], Status_Id: 5, Priority_Id: 2, Category_Id: 4, Due_Date: "2026-03-10T00:00:00Z", Completed_At: "2026-03-09T00:00:00Z", Sort_Order: 0 },
  { Id: 61, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Published gastroenterology service page — Thousand Oaks", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 3, Due_Date: "2026-03-26T00:00:00Z", Completed_At: "2026-03-26T15:00:00Z", Sort_Order: 0 },
  { Id: 62, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Verified NAP consistency for 4 new GI locations", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 1, Due_Date: "2026-03-27T00:00:00Z", Completed_At: "2026-03-27T12:00:00Z", Sort_Order: 0 },
  { Id: 63, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Sent Q1 PPC performance summary to Natalie", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 6, Due_Date: "2026-03-30T00:00:00Z", Completed_At: "2026-03-30T11:00:00Z", Sort_Order: 0 },
  { Id: 64, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Updated rater8 solicitation config for Solvang", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 5, Due_Date: "2026-03-29T00:00:00Z", Completed_At: "2026-03-29T14:00:00Z", Sort_Order: 0 },
  { Id: 65, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Set Newport Beach listing to focus mode", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 4, Category_Id: 5, Due_Date: "2026-03-27T00:00:00Z", Completed_At: "2026-03-27T21:00:00Z", Sort_Order: 0 },
  { Id: 66, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Updated GBP descriptions for Rancho Bernardo and Newport Beach", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 1, Due_Date: "2026-03-28T00:00:00Z", Completed_At: "2026-03-28T16:00:00Z", Sort_Order: 0 },
  { Id: 67, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Send active provider list with NPI numbers to David", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 8, Due_Date: "2026-03-22T00:00:00Z", Completed_At: "2026-03-22T14:00:00Z", Sort_Order: 0 },
  { Id: 68, Parent_Item_Id: null, Org_Id: 2, Item_Title: "Touch base with Tam Rossini re: Ventura acquisition patient comms", Assigned_Member_Ids: [1], Status_Id: 5, Priority_Id: 3, Category_Id: 2, Due_Date: "2026-03-18T00:00:00Z", Completed_At: "2026-03-15T10:00:00Z", Sort_Order: 0 },
];

// ---------------------------------------------------------------------------
// CLIENT ORG SLUG MAP — only items belonging to these Org_Ids get seeded.
// Items whose Org_Id is not in this map are skipped per Andy's directive
// ("they belong to clients not yet onboarded to Management").
// ---------------------------------------------------------------------------
export const ORG_SLUG_BY_LEGACY_ID = {
  2:  "unio",
  3:  "bryn-mawr",
  5:  "golden-vision",
  15: "id-care",
};

export const CLIENT_ORG_SEEDS = [
  { slug: "unio",          name: "Unio",          accentColor: "#1976d2" }, // placeholder
  { slug: "bryn-mawr",     name: "Bryn Mawr",     accentColor: "#7e57c2" }, // placeholder
  { slug: "golden-vision", name: "Golden Vision", accentColor: "#ef6c00" }, // placeholder
  { slug: "id-care",       name: "ID Care",       accentColor: "#2e7d32" }, // placeholder
];
