// src/lib/agendaHtml.js
// Pure HTML helpers for agenda rich bodies. No React, no Firestore.
// Single source of HTML composition for read-only render, archival, export,
// email, and (future) AI input.
import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["p", "br", "ul", "ol", "li", "strong", "em", "u", "a", "span"];
const ALLOWED_ATTR = ["href", "target", "rel", "style"];

function escapeText(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bulletsToHtml(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<ul>${items.map((it) => `<li>${escapeText(it?.text)}</li>`).join("")}</ul>`;
}

export function sanitizeHtml(html) {
  if (!html) return "";
  return DOMPurify.sanitize(String(html), { ALLOWED_TAGS, ALLOWED_ATTR, ADD_ATTR: ["target"] });
}

export function mergeBodyHtml(talkingPoints, notes) {
  return `${bulletsToHtml(talkingPoints)}${bulletsToHtml(notes)}`;
}

// Compose the Overview document: the pre-brief body, then each topic's title +
// body (sorted), then the open-floor body. Excludes Mini Project Boards.
// `inlineStyles` => email/export variant. NOTE: topic docs in this codebase
// store the title in `name`; accept either `title` or `name` so real docs and
// test fixtures both render.
export function composeAgendaHtml(agenda, topics, { inlineStyles = false } = {}) {
  const sorted = [...(topics || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const h2 = inlineStyles
    ? 'style="font-family:Georgia,serif;font-size:18px;margin:18px 0 6px;"'
    : 'class="agenda-topic-title"';
  const wrap = inlineStyles ? 'style="font-family:Arial,sans-serif;color:#1a1a2e;"' : "";
  const pbHtml = sanitizeHtml(agenda?.preBriefHtml);
  const preBrief = pbHtml ? `<section><h2 ${h2}>Pre-Brief</h2>${pbHtml}</section>` : "";
  const topicBlocks = sorted
    .map((t) => `<section><h2 ${h2}>${escapeText(t.title ?? t.name)}</h2>${sanitizeHtml(t.bodyHtml)}</section>`)
    .join("");
  const ofHtml = sanitizeHtml(agenda?.openFloorHtml);
  const openFloor = ofHtml ? `<section><h2 ${h2}>Open Floor</h2>${ofHtml}</section>` : "";
  return `<article ${wrap}>${preBrief}${topicBlocks}${openFloor}</article>`;
}
