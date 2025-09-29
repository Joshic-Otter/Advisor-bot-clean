const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_NAME || "KB Entries";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

function buildAirtableUrl(query) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`);
  const q = (query || "").replace(/"/g, '\\"');
  const formula = `OR(
    SEARCH(LOWER("${q}"), LOWER({Question}))>0,
    SEARCH(LOWER("${q}"), LOWER({Bottom Line}))>0,
    SEARCH(LOWER("${q}"), LOWER({Why}))>0,
    SEARCH(LOWER("${q}"), LOWER({Next Steps}))>0,
    SEARCH(LOWER("${q}"), LOWER({Heads Up}))>0,
    SEARCH(LOWER("${q}"), LOWER(ARRAYJOIN({Tags}, ",")))>0,
    SEARCH(LOWER("${q}"), LOWER({tags}))>0
  )`;
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");
  url.searchParams.set("sort[0][field]", "Last Reviewed On");
  url.searchParams.set("sort[0][direction]", "desc");
  return url.toString();
}

function pickField(f, names) {
  for (const n of names) {
    if (f[n] != null) return f[n];
  }
  return "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const body = req.body || {};
    const message = body.message || "";
    const debug = !!body.debug;
    if (!message) return res.status(400).json({ error: "message required" });

    if (!AIRTABLE_BASE || !AIRTABLE_TOKEN || !AIRTABLE_TABLE) {
      return res.status(500).json({
        error: "missing_env",
        missing: [
          !AIRTABLE_BASE && "AIRTABLE_BASE_ID",
          !AIRTABLE_TABLE && "AIRTABLE_TABLE_NAME",
          !AIRTABLE_TOKEN && "AIRTABLE_TOKEN",
        ].filter(Boolean),
      });
    }

    const r = await fetch(buildAirtableUrl(message), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: "airtable_error", status: r.status, body: text.slice(0, 800) });
    }

    const data = await r.json();
    if (!data.records?.length) {
      return res.json({
        answer: { bottom_line: "", why: "", next: "", heads_up: "", sources: [], effective_term: "", policy_id: "" },
        meta: { last_reviewed_on: "", last_reviewed_by: "", tags: [] },
        debug: debug ? { matched: false } : undefined
      });
    }

    const f = data.records[0].fields;

    const bottomLine = pickField(f, ["Bottom Line", "Bottom_Line", "bottom_line", "BottomLine"]);
    const why = pickField(f, ["Why", "why"]);
    const nextSteps = pickField(f, ["Next Steps", "Next_Steps", "next_steps", "NextSteps"]);
    const headsUp = pickField(f, ["Heads Up", "Heads_Up", "heads_up", "HeadsUp"]);
    const sourcesRaw = pickField(f, ["Sources", "Source", "sources"]);
    const effectiveTerm = pickField(f, ["Effective Term", "Effective_Term", "effective_term"]);
    const policyId = pickField(f, ["Policy ID", "Policy_Id", "policy_id"]);
    const lastReviewedBy = pickField(f, ["Last Reviewed By", "Last_Reviewed_By", "last_reviewed_by"]);
    const lastReviewedOn = pickField(f, ["Last Reviewed On", "Last_Reviewed_On", "last_reviewed_on"]);
    const tags = f.Tags || f.tags || [];

    const sources = Array.isArray(sourcesRaw)
      ? sourcesRaw
      : String(sourcesRaw).split(/;|\n|,/).map(s => s.trim()).filter(Boolean);

    const payload = {
      answer: {
        bottom_line: String(bottomLine || ""),
        why: String(why || ""),
        next: String(nextSteps || ""),
        heads_up: String(headsUp || ""),
        sources,
        effective_term: String(effectiveTerm || ""),
        policy_id: String(policyId || "")
      },
      meta: {
        last_reviewed_on: String(lastReviewedOn || ""),
        last_reviewed_by: String(lastReviewedBy || ""),
        tags: Array.isArray(tags) ? tags : String(tags).split(/;|,|\n/).map(t=>t.trim()).filter(Boolean)
      }
    };

    if (debug) {
      payload.debug = {
        matched: true,
        raw_fields_keys: Object.keys(f),
        raw_fields_sample: Object.fromEntries(Object.entries(f).slice(0, 12))
      };
    }

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
}
