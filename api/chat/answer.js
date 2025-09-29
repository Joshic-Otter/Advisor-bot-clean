// api/chat/answer.js
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_NAME || "KB Entries";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

function buildAirtableUrl(query) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`);
  const q = (query || "").replace(/"/g, '\\"');

  // 模糊匹配 Question / Bottom_Line / Tags 三个字段（大小写不敏感）
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

// 取字段的安全函数：严格用正确大小写，若没有再尝试常见误写
function getField(f, name, fallbacks = []) {
  if (f[name] != null) return f[name];
  for (const alt of fallbacks) {
    if (f[alt] != null) return f[alt];
  }
  return "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const message = (req.body && req.body.message) || "";
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
        answer: {
          bottom_line: "I couldn’t find a matching KB entry.",
          why: "No KB record matched your keywords.",
          next: "Try a different phrasing or ask an advisor.",
          heads_up: "Policies vary by term; verify official pages.",
          sources: [],
          effective_term: "",
          policy_id: "",
        },
        meta: { last_reviewed_on: "", last_reviewed_by: "", tags: [] },
      });
    }

    const f = data.records[0].fields;

    // 严格字段名（与你的 Airtable 一致）
    const bottomLine = getField(f, "Bottom_Line", ["Bottom_line", "bottom_line"]);
    const why = getField(f, "Why");
    const nextSteps = getField(f, "Next_Steps", ["Next_steps", "next_steps"]);
    const headsUp = getField(f, "Heads_Up", ["Heads_up", "heads_up"]);
    const sourcesRaw = getField(f, "Sources");
    const effectiveTerm = getField(f, "Effective_Term", ["Effective_term", "effective_term"]);
    const policyId = getField(f, "Policy_Id", ["Policy_ID", "policy_id"]);
    const lastReviewedBy = getField(f, "Last_Reviewed_By");
    const lastReviewedOn = getField(f, "Last_Reviewed_On");
    const tags = f.Tags || [];

    const sources = Array.isArray(sourcesRaw)
      ? sourcesRaw
      : String(sourcesRaw).split(/;|\n|,/).map(s => s.trim()).filter(Boolean);

    return res.json({
      answer: {
        bottom_line: bottomLine || "",
        why: why || "",
        next: nextSteps || "",
        heads_up: headsUp || "",
        sources,
        effective_term: effectiveTerm || "",
        policy_id: policyId || "",
      },
      meta: {
        last_reviewed_on: lastReviewedOn || "",
        last_reviewed_by: lastReviewedBy || "",
        tags,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
}
