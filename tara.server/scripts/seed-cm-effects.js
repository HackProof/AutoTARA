import { readFile } from "node:fs/promises";
import { createDatabasePool } from "../src/config/db.js";
import { syncMitreEffectSources } from "./lib/mitre-effect-csv.js";

// Refresh local MITRE effect CSVs, then use the same defaults as initialization.
const database = createDatabasePool();
const connection = await database.connect();
try {
  const sql = await readFile(
    new URL("../../db/sql/06-effect-profiles.sql", import.meta.url),
    "utf8",
  );
  await connection.query("BEGIN");
  await syncMitreEffectSources(connection);
  await connection.query(sql);
  const { rows } = await connection.query(`
    SELECT classification_status, effect_types, count(*)::int AS count
    FROM vehicle_lang.mitre_mitigation_effect_profile
    GROUP BY classification_status, effect_types ORDER BY effect_types
  `);
  const { rows: missing } = await connection.query(`
    SELECT c.mitigation_id FROM vehicle_lang.mitre_mitigation c
    JOIN vehicle_lang_source.mitre_effects e ON e."ID" = c.mitigation_id
      AND e.effect IS NOT NULL
    LEFT JOIN vehicle_lang.mitre_mitigation_effect_profile p USING (mitigation_id)
    WHERE p.mitigation_id IS NULL ORDER BY c.mitigation_id
  `);
  if (missing.length)
    throw new Error(
      `CM defaults need review for: ${missing.map((row) => row.mitigation_id).join(", ")}`,
    );
  await connection.query("COMMIT");
  console.log(
    JSON.stringify({
      profiles: rows.reduce((sum, row) => sum + row.count, 0),
      groups: rows,
      missing: [],
    }),
  );
} catch (error) {
  await connection.query("ROLLBACK");
  throw error;
} finally {
  connection.release();
  await database.end();
}
