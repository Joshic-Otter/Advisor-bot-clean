export default async function handler(req, res) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = process.env.AIRTABLE_TABLE_NAME;
    const token = process.env.AIRTABLE_TOKEN;

    if (!baseId || !tableName || !token) {
      return res.status(500).json({
        ok: false,
        error: "missing_env",
        missing: [
          !baseId && "AIRTABLE_BASE_ID",
          !tableName && "AIRTABLE_TABLE_NAME",
          !token && "AIRTABLE_TOKEN",
        ].filter(Boolean)
      });
    }

    const h = { Authorization: `Bearer ${token}` };

    // 1) 看这条 PAT 能看到哪些 bases
    const basesResp = await fetch("https://api.airtable.com/v0/meta/bases", { headers: h });
    const basesText = await basesResp.text();

    // 2) 看目标 base 下有哪些表
    const tablesResp = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: h });
    const tablesText = await tablesResp.text();

    // 3) 直接读目标表的记录（只取状态 + 少量文本）
    const encodedTable = encodeURIComponent(tableName);
    const rowsResp = await fetch(`https://api.airtable.com/v0/${baseId}/${encodedTable}?maxRecords=1`, { headers: h });
    const rowsText = await rowsResp.text();

    return res.json({
      ok: true,
      env_seen: {
        AIRTABLE_BASE_ID: baseId,
        AIRTABLE_TABLE_NAME: tableName,
        AIRTABLE_TOKEN_prefix: token.slice(0, 6) + "...",
      },
      checks: {
        list_bases: { status: basesResp.status, body_sample: basesText.slice(0, 400) },
        list_tables: { status: tablesResp.status, body_sample: tablesText.slice(0, 400) },
        read_rows: { status: rowsResp.status, body_sample: rowsText.slice(0, 400) },
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e) });
  }
}
