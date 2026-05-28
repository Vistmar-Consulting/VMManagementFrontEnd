// api/meetings/_lib/relay-mail.js
//
// Postmark HTTPS client for the VM-path of the dual-send Meetings architecture.
// Delivers HTML mail and optional RFC5545 `.ics` attachments to Gmail (VM
// coworkers whose primary mailbox is Google Workspace), bypassing M365's
// internal-tenant-routing short-circuit that would otherwise drop invites
// into Outlook shadow mailboxes.
//
// Client-bound mail still goes through graph-mail.js (Graph sendMail).
//
// Spec: docs/specs/2026-04-23-cross-tenant-invite-delivery-design.md

import { getPostmarkToken } from "./keyvault.js";

const POSTMARK_URL = "https://api.postmarkapp.com/email";
// FROM address for VM-path (Postmark) relay. Sender must be verified in Postmark.
// Using adeemer@ rather than meetings@ because meetings@ has no public-MX mailbox
// (Google Workspace mailbox was deleted 2026-04-08; M365 mailbox only accepts
// internal-tenant delivery). adeemer@ is verified; recipients see "Andrew Deemer"
// as sender — acceptable for VM-internal invites. Client-path mail still uses
// meetings@ via Graph sendMail (graph-mail.js) — that path is unaffected.
const FROM = "adeemer@vistamarconsulting.com";

export async function sendRelay({ to, subject, htmlBody, textBody, icsBody, icsMethod }) {
  const token = await getPostmarkToken();
  const override = process.env.MEETINGS_DEV_OVERRIDE_TO;
  const actualTo = override ? override : to;

  const body = {
    From: FROM,
    To: actualTo,
    Subject: subject,
    HtmlBody: htmlBody,
    TextBody: textBody != null ? textBody : stripHtml(htmlBody),
    MessageStream: "outbound",
  };

  if (icsBody) {
    body.Attachments = [
      {
        Name: "invite.ics",
        Content: Buffer.from(icsBody).toString("base64"),
        ContentType: `text/calendar; method=${icsMethod}; charset=utf-8; name="invite.ics"`,
      },
    ];
  }

  const res = await fetch(POSTMARK_URL, {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": token,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark failed (${res.status}): ${text}`);
  }
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
