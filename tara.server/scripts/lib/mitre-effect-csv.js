import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

const columns = ["ID", "STIX ID", "name", "effect", "confidence", "cost", "reason"];
const files = [
  "mapping_table/ics-attack-v20.0-mitigation_effect-mapping.csv",
  "mapping_table/enterprise-attack-v20.0-mitigations-effect-mapping.csv",
];

export async function readMitreEffectCsv() {
  const rows = (await Promise.all(files.map(async (csvFile) => {
    const csv = await readFile(new URL(`../../../db/data/${csvFile}`, import.meta.url), "utf8");
    return parse(csv, {
      bom: true,
      columns(header) {
        if (header.length !== columns.length || header.some((value, i) => value !== columns[i]))
          throw new Error(`Unexpected MITRE effect CSV columns: ${csvFile}`);
        return header;
      },
      skip_empty_lines: true,
    }).map((row) => ({
      csv_file: csvFile,
      ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === "" ? null : value])),
    }));
  }))).flat();
  const ids = new Set();
  for (const row of rows) {
    if (!row.ID || !row["STIX ID"] || !row.name || ids.has(row.ID)
        || !/^[1-5]$/.test(row.cost ?? "")
        || (row.effect !== null && (!["P", "D", "R"].includes(row.effect)
          || !["L", "M", "H"].includes(row.confidence) || !row.reason?.trim())))
      throw new Error(`Invalid or duplicate MITRE effect CSV row: ${row.csv_file}: ${row.ID}`);
    ids.add(row.ID);
  }
  return rows;
}

// Call inside the seed transaction. Updating in place retains source_row references.
export async function syncMitreEffectSources(connection) {
  const rows = await readMitreEffectCsv();
  const payload = JSON.stringify(rows);
  await connection.query("SELECT pg_advisory_xact_lock(817155, 192)");
  const { rows: invalid } = await connection.query(`
    SELECT e."ID" FROM jsonb_to_recordset($1::jsonb)
      AS e(csv_file text, "ID" text, "STIX ID" text, name text)
    LEFT JOIN vehicle_lang.mitre_mitigation c ON c.mitigation_id = e."ID"
    WHERE c.mitigation_id IS NULL OR c.stix_id IS DISTINCT FROM e."STIX ID"
       OR c.name IS DISTINCT FROM e.name
       OR (SELECT count(*) FROM vehicle_lang_source.mitre_effects s WHERE s."ID" = e."ID") > 1
       OR EXISTS (SELECT FROM vehicle_lang_source.mitre_effects s
                  WHERE s."ID" = e."ID" AND s.csv_file IS DISTINCT FROM e.csv_file)
  `, [payload]);
  if (invalid.length)
    throw new Error(`MITRE effect CSV/catalog mismatch: ${invalid.map((row) => row.ID).join(", ")}`);
  await connection.query(`
    MERGE INTO vehicle_lang_source.mitre_effects s
    USING jsonb_to_recordset($1::jsonb)
      AS e(csv_file text, "ID" text, "STIX ID" text, name text, effect text, confidence text, cost text, reason text)
    ON s."ID" = e."ID" AND s.csv_file = e.csv_file
    WHEN MATCHED THEN UPDATE SET
      "STIX ID" = e."STIX ID", name = e.name, effect = e.effect,
      confidence = e.confidence, cost = e.cost, reason = e.reason
    WHEN NOT MATCHED THEN INSERT (csv_file, "ID", "STIX ID", name, effect, confidence, cost, reason)
      VALUES (e.csv_file, e."ID", e."STIX ID", e.name, e.effect, e.confidence, e.cost, e.reason)
  `, [payload]);
}
