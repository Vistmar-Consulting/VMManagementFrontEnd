// Fireflies GraphQL client.
//
// Ported verbatim from Console archive src/pages/pages/Agenda.jsx:109-205
// (firefliesQuery + the three queries + timestamp helpers). The Bearer key is
// public-by-design (every browser session sends it); in dev we go through the
// Vite /fireflies-api proxy purely to dodge CORS, in prod we hit Fireflies
// directly. See vite.config.js for the proxy.
//
// Plan: Fireflies Business plan (60 req/min, unlimited storage — upgraded
// 2026-04-06). The aggressive localStorage caching in the card/modal keeps us
// well under the throttle in practice.

const FIREFLIES_URL = import.meta.env.DEV
  ? "/fireflies-api/graphql"
  : "https://api.fireflies.ai/graphql";

const FIREFLIES_KEY = import.meta.env.VITE_FIREFLIES_KEY;

export async function firefliesQuery(query, variables = {}) {
  const res = await fetch(FIREFLIES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIREFLIES_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Fireflies API error: ${res.status} — ${errBody}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export const GQL_MEETING_LIST = `
  query Transcripts($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {
      id title date duration
      participants
      meeting_attendees { email displayName }
    }
  }
`;

export const GQL_MEETING_DETAIL = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id title date duration
      summary {
        overview short_overview bullet_gist
        action_items outline shorthand_bullet
        keywords topics_discussed
      }
    }
  }
`;

export const GQL_TRANSCRIPT_SENTENCES = `
  query TranscriptSentences($transcriptId: String!) {
    transcript(id: $transcriptId) {
      duration
      sentences {
        index
        speaker_name
        text
        start_time
        end_time
      }
      speakers {
        id
        name
      }
    }
  }
`;

// Parse "(47:45 - 52:00)" → { start: 2865, end: 3120 }
// Parse "(06:27)" → { start: 387, end: 387 }
export function parseTimestampRange(text) {
  const rangeMatch = text.match(/\((\d+):(\d+)(?::(\d+))?\s*-\s*(\d+):(\d+)(?::(\d+))?\)/);
  if (rangeMatch) {
    const start = rangeMatch[3]
      ? parseInt(rangeMatch[1]) * 3600 + parseInt(rangeMatch[2]) * 60 + parseInt(rangeMatch[3])
      : parseInt(rangeMatch[1]) * 60 + parseInt(rangeMatch[2]);
    const end = rangeMatch[6]
      ? parseInt(rangeMatch[4]) * 3600 + parseInt(rangeMatch[5]) * 60 + parseInt(rangeMatch[6])
      : parseInt(rangeMatch[4]) * 60 + parseInt(rangeMatch[5]);
    return { start, end };
  }
  const singleMatch = text.match(/\((\d+):(\d+)(?::(\d+))?\)/);
  if (singleMatch) {
    const secs = singleMatch[3]
      ? parseInt(singleMatch[1]) * 3600 + parseInt(singleMatch[2]) * 60 + parseInt(singleMatch[3])
      : parseInt(singleMatch[1]) * 60 + parseInt(singleMatch[2]);
    return { start: secs, end: secs };
  }
  return null;
}

export function formatTimestamp(secs) {
  const s = Math.round(parseFloat(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
