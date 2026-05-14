import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";

import { db } from "../firebase.js";
import { STATUS } from "../constants/itemStatuses.js";

// Marker field stamped on every doc this seeder writes so re-runs are
// idempotent. If we ever need to re-seed, delete by this field first.
const SEED_MARKER = "v1-bootstrap-2026-05-14";

// Sample item shapes — realistic-flavored, riffing on the kinds of work
// surfaced in the legacy SQL pm.Items (account access, migration tasks,
// SEO/analytics prep, client onboarding) but anonymized to the Vistamar
// internal org for V1 verification. Real client orgs land later.
const SAMPLES = [
  { title: "Quarterly SOP review — assign owners per playbook", statusId: STATUS.ASSIGNED, dueOffsetDays: 14 },
  { title: "Audit shared Drive permissions for departed contractors", statusId: STATUS.ASSIGNED, dueOffsetDays: 7 },
  { title: "Draft V2 Meetings spec — port from VMConsole archive", statusId: STATUS.ASSIGNED },
  { title: "Vercel project link for Management — pointed at origin/dev", statusId: STATUS.IN_PROGRESS, dueOffsetDays: 3 },
  { title: "Members admin page — promote / demote / deactivate UI", statusId: STATUS.IN_PROGRESS },
  { title: "Organization admin CRUD — accent picker + archive toggle", statusId: STATUS.IN_PROGRESS, onHold: true },
  { title: "Project Board drag-and-drop + fractional rank persistence", statusId: STATUS.REVIEW },
  { title: "Threaded comments — subcollection + author-only edit gate", statusId: STATUS.REVIEW },
  { title: "AuthContext bootstrap — client-side users/{uid} doc create", statusId: STATUS.DONE },
  { title: "Firestore V1 rules — deploy + verify via Playwright", statusId: STATUS.DONE },
  { title: "App shell — Router + theme port + sidebar + protected routes", statusId: STATUS.DONE },
];

// Returns the number of items written (0 if seeds already exist).
export async function seedSampleItems({ organizationId, createdBy }) {
  if (!organizationId) throw new Error("seedSampleItems: organizationId required");
  if (!createdBy) throw new Error("seedSampleItems: createdBy required");

  // Idempotency probe — skip if any seeded items already exist.
  const existing = await getDocs(
    query(collection(db, "items"), where("_seedMarker", "==", SEED_MARKER)),
  );
  if (!existing.empty) return 0;

  // Generate fractional rank order keys ascending across the batch.
  const orders = [];
  let prev = null;
  for (let i = 0; i < SAMPLES.length; i += 1) {
    const next = generateKeyBetween(prev, null);
    orders.push(next);
    prev = next;
  }

  const now = Date.now();
  const writes = SAMPLES.map((sample, i) => {
    const due = sample.dueOffsetDays
      ? new Date(now + sample.dueOffsetDays * 24 * 60 * 60 * 1000)
      : null;
    return addDoc(collection(db, "items"), {
      organizationId,
      parentId: null,
      hasChildren: false,
      type: "task",
      title: sample.title,
      description: "",
      statusId: sample.statusId,
      onHold: Boolean(sample.onHold),
      dueDate: due,
      assigneeId: createdBy,
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      order: orders[i],
      _seedMarker: SEED_MARKER,
    });
  });

  await Promise.all(writes);
  return SAMPLES.length;
}
