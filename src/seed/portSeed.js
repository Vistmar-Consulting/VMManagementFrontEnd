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
  runTransaction,
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

  // Pre-count children per archive parent — used to initialize
  // `nextSubitemNumber` on each parent doc as it's written.
  const childCountByParentArchiveId = {};
  for (const item of portable) {
    if (item.Parent_Item_Id != null) {
      childCountByParentArchiveId[item.Parent_Item_Id] =
        (childCountByParentArchiveId[item.Parent_Item_Id] || 0) + 1;
    }
  }

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

  // Per-org item counter (top-level I-N). After seeding, each org doc
  // gets `nextItemNumber` written atomically via Math.max so concurrent
  // live adds during a reseed are not clobbered.
  const itemCounters = {};   // { [orgSlug]: nextNumber }

  // Per-parent subitem counter (SI-N is unique within parent, not org).
  // Keyed by the parent's new Firestore doc id; written onto the parent
  // doc as `nextSubitemNumber` in the same batch.
  const subitemCountersByParentDocId = {};

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
      subitemCountersByParentDocId[parentId] =
        (subitemCountersByParentDocId[parentId] || 0) + 1;
      itemNumber = subitemCountersByParentDocId[parentId];
    }

    const ref = doc(db, "items", docId);
    const docData = {
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
    };
    // Top-level items that will have children get their subitem counter
    // pre-initialized so the first live-added SI starts at the right spot.
    if (parentId === null && hasChildren) {
      docData.nextSubitemNumber = (childCountByParentArchiveId[src.Id] || 0) + 1;
    }
    batch.set(ref, docData);
    opsInBatch += 1;
    if (opsInBatch >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  // Stamp `nextItemNumber` on each org doc transactionally with Math.max
  // semantics: if a concurrent live add already bumped the counter past
  // the seeded value, leave it alone — we never want the counter to go
  // backwards, which would collide with already-assigned itemNumbers.
  const orgSlugs = new Set(Object.keys(itemCounters));
  for (const slug of orgSlugs) {
    const orgRef = doc(db, "organizations", slug);
    const seeded = (itemCounters[slug] || 0) + 1;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orgRef);
      const current = snap.exists() ? (snap.data().nextItemNumber ?? 0) : 0;
      const merged = Math.max(current, seeded);
      tx.set(orgRef, { nextItemNumber: merged }, { merge: true });
    });
  }
  // Also initialize `nextItemNumber: 1` on orgs that got NO seeded items,
  // so a future first add starts cleanly. Same Math.max guard.
  for (const seed of CLIENT_ORG_SEEDS) {
    if (orgSlugs.has(seed.slug)) continue;
    const orgRef = doc(db, "organizations", seed.slug);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orgRef);
      const current = snap.exists() ? (snap.data().nextItemNumber ?? 0) : 0;
      const merged = Math.max(current, 1);
      tx.set(orgRef, { nextItemNumber: merged }, { merge: true });
    });
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
