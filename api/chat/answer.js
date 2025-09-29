const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_NAME || "KB Entries";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

function buildAirtableUrl(query) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`);
  const q = (query || "").replace(/"/g, '\\"');
  const formula = `OR(
    SEARCH(LOWER("${q}"), LOWER({Question}))>0,
    SEARCH(LOWER("${q}"), LOWER({Bottom_Line}))>0,
    SEARCH(LOWER("${q}"), LOWER(ARRAYJOIN({Tags}, ",")))>0
  )`;
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");
  url.searchParams.set("sort[0][field]", "Last_Reviewed_On");
  url.searchParams.set("sort[0][direction]", "desc");
  return url.toString();
}

function missingVars() {
  const miss = [];
  if (!AIRTABLE_BASE) miss.push("AIRTABLE_BASE_ID");
  if (!AIRTABLE_TOKEN) miss.push("AIRTABLE_TOKEN");
  if (!AIRTABLE_TABLE) miss.push("AIRTABLE_TABLE_NAME");
  return miss;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    let message = "";
    try { message = (req.body && req.body.message) || ""; } catch {}
    if (!message) return res.status(400).json({ error: "message required" });

    const miss = missingVars();
    if (miss.length) return res.status(500).json({ error: "missing_env", missing: miss });

    const r = await fetch(buildAirtableUrl(message), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: "airtable_error", status: r.status, body: text.slice(0, 800) });
    }

    const data = await r.json();
    if (!data.records?.length) {
      return res.json({
        answer: {
          bottom_line: "I’m not certain from the KB.",
          why: "No matching entry in the knowledge base.",
          next: "Try different keywords or contact advising.",
          heads_up: "Policies vary by term; verify official pages.",
          sources: []
        }
      });
    }

    const f = data.records[0].fields;
    const sourcesRaw = f.Sources ?? "";
    const sources = Array.isArray(sourcesRaw)
      ? sourcesRaw
      : String(sourcesRaw).split(/;|\n|,/).map(s => s.trim()).filter(Boolean);

    return res.json({
      answer: {
        bottom_line: f.Bottom_Line || "",
        why: f.Why || "",
        next: f.Next_Steps || "",
        heads_up: f.Heads_Up || "",
        sources,
        effective_term: f.Effective_Term || "",
        policy_id: f.Policy_Id || ""
      },
      meta: {
        last_reviewed_on: f.Last_Reviewed_On || "",
        last_reviewed_by: f.Last_Reviewed_By || "",
        tags: f.Tags || []
      }
    });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
}
