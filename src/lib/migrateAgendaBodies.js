// src/lib/migrateAgendaBodies.js
// One-off, admin-run migration: converts legacy per-bullet subcollections
// (talkingPoints + notes per topic, openFloor per agenda) into the new HTML
// fields topic.bodyHtml / agenda.openFloorHtml. Idempotent: skips a topic/
// agenda that already has a non-empty body field. Old subcollections are left
// in place (reversible); a later cleanup pass deletes them.
import { collection, doc, getDocs, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { bulletsToHtml, mergeBodyHtml } from "./agendaHtml.js";

async function rows(path) {
  const snap = await getDocs(query(collection(db, ...path.split("/")), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => d.data());
}

export async function migrateAgendaBodies({ dryRun = true } = {}) {
  const agendas = await getDocs(collection(db, "agendas"));
  const report = { topics: 0, openFloors: 0, skipped: 0, dryRun };
  for (const a of agendas.docs) {
    const ad = a.data();
    // Open Floor
    if (!ad.openFloorHtml) {
      const of = await rows(`agendas/${a.id}/openFloor`);
      const html = bulletsToHtml(of);
      if (html) {
        report.openFloors++;
        if (!dryRun) await updateDoc(doc(db, "agendas", a.id), { openFloorHtml: html });
      }
    } else report.skipped++;
    // Topics
    const topics = await getDocs(collection(db, "agendas", a.id, "topics"));
    for (const tp of topics.docs) {
      if (tp.data().bodyHtml) { report.skipped++; continue; }
      const points = await rows(`agendas/${a.id}/topics/${tp.id}/talkingPoints`);
      const notes = await rows(`agendas/${a.id}/topics/${tp.id}/notes`);
      const html = mergeBodyHtml(points, notes);
      if (html) {
        report.topics++;
        if (!dryRun) await updateDoc(doc(db, "agendas", a.id, "topics", tp.id), { bodyHtml: html });
      }
    }
  }
  return report;
}
