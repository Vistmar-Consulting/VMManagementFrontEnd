// One-shot reset: wipe the generic dev items, plant client orgs +
// per-org categories/tags + real archive items in their place. Callable
// from agent-browser via browser_evaluate while signed in as admin.
//
// Idempotent — re-running will WIPE existing items each time, then
// recreate from archiveData. Use with care.

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";

import { db } from "../firebase.js";
import {
  CLIENT_ORG_SEEDS,
  ORG_SLUG_BY_LEGACY_ID,
  PM_CATEGORIES,
  PM_ITEMS,
  PM_TAGS,
} from "./archiveData.js";

// Translate archive's hasChildren-via-parentId into a denormalized flag.
function deriveHasChildrenMap(archiveItems) {
  const childParents = new Set();
  for (const item of archiveItems) {
    if (item.Parent_Item_Id != null) childParents.add(item.Parent_Item_Id);
  }
  return childParents;
}

async function deleteAllItems() {
  const snap = await getDocs(collection(db, "items"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  return snap.size;
}

async function seedClientOrgs() {
  // Vistamar (internal) already exists — leave it alone except for sortOrder
  // which the chip-row ordering depends on.
  await setDoc(
    doc(db, "organizations", "vistamar"),
    { name: "Vistamar", sortOrder: 1 },
    { merge: true },
  );
  for (const org of CLIENT_ORG_SEEDS) {
    await setDoc(doc(db, "organizations", org.slug), {
      name: org.name,
      type: "client",
      accentColor: org.accentColor,
      active: true,
      archived: false,
      sortOrder: org.sortOrder,
      createdAt: serverTimestamp(),
    });
  }
}

async function seedCategories(categories) {
  // Top-level shared categories (no per-org scoping).
  for (const cat of categories) {
    await setDoc(doc(db, "categories", String(cat.Id)), {
      name: cat.Category_Name,
      color: cat.Category_Color,
      sortOrder: cat.Sort_Order,
      createdAt: serverTimestamp(),
    });
  }
}

async function seedTags(tags) {
  // Top-level shared tags.
  for (const tag of tags) {
    await setDoc(doc(db, "tags", String(tag.Id)), {
      name: tag.Tag_Name,
      color: tag.Tag_Color,
      createdAt: serverTimestamp(),
    });
  }
}

async function seedItems({ createdBy }) {
  // Filter to items whose Org_Id maps to a known slug.
  const portable = PM_ITEMS.filter((i) => ORG_SLUG_BY_LEGACY_ID[i.Org_Id]);
  const childParents = deriveHasChildrenMap(portable);

  // Generate fractional rank order keys ascending across the batch.
  const orders = [];
  let prev = null;
  for (let i = 0; i < portable.length; i += 1) {
    const next = generateKeyBetween(prev, null);
    orders.push(next);
    prev = next;
  }

  // Build a map of archive Id → new Firestore doc id so children can
  // reference their parents by the new id after creation.
  const idMap = new Map();
  for (const item of portable) {
    idMap.set(item.Id, doc(collection(db, "items")).id);
  }

  // Track per-org item / subitem number sequences. After seeding, each
  // org doc gets `nextItemNumber` and `nextSubitemNumber` so future
  // addItem / addSubitem transactions can increment from there.
  const itemCounters = {};   // { [orgSlug]: nextNumber }
  const subitemCounters = {};

  // Write in batches of 400 (Firestore commit limit is 500).
  let batch = writeBatch(db);
  let opsInBatch = 0;
  for (let i = 0; i < portable.length; i += 1) {
    const src = portable[i];
    const orgSlug = ORG_SLUG_BY_LEGACY_ID[src.Org_Id];
    const docId = idMap.get(src.Id);
    const parentId = src.Parent_Item_Id != null ? idMap.get(src.Parent_Item_Id) : null;
    const hasChildren = childParents.has(src.Id);
    const type = parentId === null && hasChildren ? "project" : "task";

    let itemNumber;
    if (parentId === null) {
      itemCounters[orgSlug] = (itemCounters[orgSlug] || 0) + 1;
      itemNumber = itemCounters[orgSlug];
    } else {
      subitemCounters[orgSlug] = (subitemCounters[orgSlug] || 0) + 1;
      itemNumber = subitemCounters[orgSlug];
    }

    const ref = doc(db, "items", docId);
    batch.set(ref, {
      organizationId: orgSlug,
      parentId,
      hasChildren,
      type,
      title: src.Item_Title,
      description: "",
      statusId: src.Status_Id,
      priorityId: src.Priority_Id ?? null,
      categoryId: src.Category_Id != null ? String(src.Category_Id) : null,
      tagIds: (src.Tag_Ids || []).map(String),
      onHold: src.Status_Id === 3,
      dueDate: src.Due_Date ? new Date(src.Due_Date) : null,
      completedAt: src.Completed_At ? new Date(src.Completed_At) : null,
      assigneeIds: [],
      itemNumber,
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      order: orders[i],
      _seedMarker: "port-seed-2026-05-14",
    });
    opsInBatch += 1;
    if (opsInBatch >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  // Stamp the next-number counters on each org doc so future adds can
  // continue the sequence atomically via runTransaction.
  const orgSlugs = new Set([
    ...Object.keys(itemCounters),
    ...Object.keys(subitemCounters),
  ]);
  for (const slug of orgSlugs) {
    await setDoc(
      doc(db, "organizations", slug),
      {
        nextItemNumber: (itemCounters[slug] || 0) + 1,
        nextSubitemNumber: (subitemCounters[slug] || 0) + 1,
      },
      { merge: true },
    );
  }
  // Also initialize counters on orgs that got NO items, so a future
  // first add starts at 1 cleanly without a missing-field race.
  for (const seed of CLIENT_ORG_SEEDS) {
    if (!orgSlugs.has(seed.slug)) {
      await setDoc(
        doc(db, "organizations", seed.slug),
        { nextItemNumber: 1, nextSubitemNumber: 1 },
        { merge: true },
      );
    }
  }

  return portable.length;
}

// Main entry point. Returns a summary object.
export async function runPortSeed({ createdBy }) {
  if (!createdBy) throw new Error("runPortSeed: createdBy (uid) required");

  const deleted = await deleteAllItems();
  await seedClientOrgs();
  await seedCategories(PM_CATEGORIES);
  await seedTags(PM_TAGS);
  const written = await seedItems({ createdBy });

  return {
    deletedItems: deleted,
    seededOrgs: CLIENT_ORG_SEEDS.length,
    seededCategories: PM_CATEGORIES.length,
    seededTags: PM_TAGS.length,
    seededItems: written,
  };
}
