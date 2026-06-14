// One-time admin endpoint: adds "Patios Leads" and "Pergolas Leads" tabs to the
// Prestige_Services_Tracker workbook by duplicating an existing lead tab (so all
// formatting, frozen header, status dropdown, and conditional formatting carry
// over), then clearing the sample data rows.
//
// Protected by a token. Call once:
//   curl "https://<deployment>/api/admin-setup?key=ps_setup_7f3a91"
// Safe to re-run — tabs that already exist are skipped.

const { getGoogleAccessToken } = require('../lib/google');

const SHEET_ID = '1xUt5eLvNKHQ6QmeAb88FNVTpPL1MEiWxAb5_szcfwss';
const SETUP_KEY = 'ps_setup_7f3a91';
const SOURCE_TAB = 'Other Leads';            // template to duplicate (same style as all lead tabs)
const NEW_TABS = ['Patios Leads', 'Pergolas Leads'];

async function api(token, method, path, body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

module.exports = async function handler(req, res) {
  if ((req.query.key || '') !== SETUP_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const token = await getGoogleAccessToken();

    // 1. Read sheet metadata
    const meta = await api(token, 'GET', `${SHEET_ID}?fields=sheets.properties`);
    const sheets = meta.sheets.map((s) => s.properties);
    const byTitle = Object.fromEntries(sheets.map((p) => [p.title, p]));

    const source = byTitle[SOURCE_TAB];
    if (!source) throw new Error(`Source tab "${SOURCE_TAB}" not found`);

    // 2. Find the header row in the source (row whose col A == "Date Added")
    const vr = await api(
      token, 'GET',
      `${SHEET_ID}/values/${encodeURIComponent(`${SOURCE_TAB}!A1:A20`)}`
    );
    const colA = (vr.values || []).map((r) => (r[0] || '').trim());
    const headerIdx = colA.findIndex((v) => v.toLowerCase() === 'date added');
    const headerRow = headerIdx === -1 ? 1 : headerIdx + 1; // 1-based

    const report = [];
    let insertIndex = source.index + 1;

    for (const name of NEW_TABS) {
      if (byTitle[name]) {
        report.push({ tab: name, status: 'already exists, skipped' });
        insertIndex++;
        continue;
      }

      // 3. Duplicate the source tab with all its formatting
      const dup = await api(token, 'POST', `${SHEET_ID}:batchUpdate`, {
        requests: [{
          duplicateSheet: {
            sourceSheetId: source.sheetId,
            insertSheetIndex: insertIndex,
            newSheetName: name,
          },
        }],
      });
      insertIndex++;

      // 4. Clear the duplicated sample data rows, keeping the header + formatting
      await api(
        token, 'POST',
        `${SHEET_ID}/values/${encodeURIComponent(`${name}!A${headerRow + 1}:K`)}:clear`
      );

      report.push({
        tab: name,
        status: 'created',
        sheetId: dup.replies[0].duplicateSheet.properties.sheetId,
      });
    }

    res.status(200).json({ ok: true, headerRow, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
