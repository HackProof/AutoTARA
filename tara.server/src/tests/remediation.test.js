import assert from "node:assert/strict";
import { test } from "node:test";
import { getCountermeasures } from "../modules/catalog/remediation.service.js";
import { createApp } from "../app.js";

function database({
  schema = "vehicle_lang",
  available = true,
  fail = false,
  profiles = false,
  cost,
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail)
        throw Object.assign(new Error("private connection detail"), {
          code: "ECONNREFUSED",
        });
      if (sql.includes("information_schema.columns"))
        return { rows: [{ schema }] };
      if (sql.includes("information_schema.tables"))
        return {
          rows: available
            ? [
                { table_name: "mitre_mitigation" },
                { table_name: "mitre_technique_mitigation" },
                ...(profiles
                  ? [{ table_name: "mitre_mitigation_effect_profile" }]
                  : []),
              ]
            : [],
        };
      return {
        rows: [
          {
            mitigation_id: "M0800",
            name: "Authorization",
            description: "CM definition",
            url: "https://attack.mitre.org/mitigations/M0800/",
            technique_id: "T0800",
            relationship_id: "rel1",
            mapping_description: "Mapping one",
            source_row: 10,
            effect_profile: profiles
              ? {
                  cost,
                  effect_types: ["P", "D"],
                  basis: "User-definition review",
                  classification_status: "classified",
                  classification_source: "AutoTARA",
                  policy_id: "user-pdr-v1",
                }
              : null,
          },
          {
            mitigation_id: "M0800",
            name: "Authorization",
            description: "CM definition",
            technique_id: "T0830",
            relationship_id: "rel2",
            mapping_description: "Mapping two",
            source_row: 11,
            effect_profile: profiles
              ? {
                  cost,
                  effect_types: ["P", "D"],
                  basis: "User-definition review",
                  classification_status: "classified",
                  classification_source: "AutoTARA",
                  policy_id: "user-pdr-v1",
                }
              : null,
          },
        ],
      };
    },
  };
}

test("MITRE mappings deduplicate CMs, retain evidence and default P/R weights to one", async () => {
  const result = await getCountermeasures(database(), "vehicle_lang", [
    "T0800",
    "T0830",
    "T0837",
  ]);
  assert.equal(result.countermeasures.length, 1);
  const cm = result.countermeasures[0];
  assert.equal(cm.mappings.length, 2);
  assert.equal(cm.cost, null);
  assert.equal(cm.mappings[0].effects, null);
  assert.equal(cm.mappings[0].evidence.relationshipId, "rel1");
  assert.deepEqual(result.weights, { P: 1, R: 1 });
  assert.ok(!result.missingFields.includes("P/R weights"));
  assert.deepEqual(result.unmappedAvIds, ["T0837"]);
  assert.equal(result.mappingAvailable, true);
});

test("catalog availability is distinct from a missing mapping and schemas/values are quoted or bound", async () => {
  const missing = await getCountermeasures(
    database({ available: false }),
    "vehicle_lang",
    ["T0800"],
  );
  assert.equal(missing.mappingAvailable, false);
  assert.deepEqual(missing.countermeasures, []);
  assert.deepEqual(missing.unmappedAvIds, ["T0800"]);
  await assert.rejects(getCountermeasures(database(), "unknown", ["T0800"]), {
    status: 404,
  });
  const schema = 'valid"schema',
    db = database({ schema });
  await getCountermeasures(db, schema, ["T0800"]);
  assert.ok(
    db.calls.at(-1).sql.includes('"valid""schema".mitre_technique_mitigation'),
  );
  assert.deepEqual(db.calls.at(-1).params, [["T0800"]]);
});

test("HTTP contract validates technique IDs and returns scoped candidates; failures hide private details", async () => {
  const db = database({ profiles: true, cost: 3 });
  const server = createApp({ database: db }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/lang-schemas/vehicle_lang/countermeasures`;
  const post = (techniqueIds) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ techniqueIds }),
    });
  try {
    for (const invalid of [
      undefined,
      null,
      [],
      [""],
      ["M0800"],
      ["T0800; DROP TABLE"],
      [2],
      ["T0800.1"],
      Array(1001).fill("T0800"),
    ])
      assert.equal((await post(invalid)).status, 400);
    const valid = await post(["T0800", "T0800", "T0830.001"]);
    assert.equal(valid.status, 200);
    const result = await valid.json();
    assert.equal(result.countermeasures.length, 1);
    assert.equal(result.countermeasures[0].cost, 3);
    assert.ok(!result.missingFields.includes("cost score"));
    assert.deepEqual(db.calls.at(-1).params, [["T0800", "T0830.001"]]);
    db.query = database({ fail: true }).query;
    const failed = await post(["T0800"]);
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("private connection detail"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CM profiles supply P/D/R defaults with provenance without manufacturing confidence or scores", async () => {
  const db = database({ profiles: true });
  const result = await getCountermeasures(db, "vehicle_lang", [
    "T0800",
    "T0830",
  ]);
  assert.ok(
    db.calls
      .at(-1)
      .sql.includes('LEFT JOIN "vehicle_lang".mitre_mitigation_effect_profile'),
  );
  assert.equal(result.effectDefaultsAvailable, true);
  assert.deepEqual(result.missingEffectCmIds, []);
  assert.ok(
    !result.missingFields.some((field) => field.includes("classification")),
  );
  const cm = result.countermeasures[0];
  assert.equal(cm.cost, null);
  assert.deepEqual(cm.defaultEffects, [
    { type: "P", level: "" },
    { type: "D", level: "" },
  ]);
  assert.equal(cm.effectProfile.scope, "countermeasure");
  assert.equal(cm.mappings[0].basis, "User-definition review");
  assert.equal(cm.mappings[0].effectScope, "countermeasure");
  assert.equal(cm.mappings[0].evidence.source, "MITRE ATT&CK ICS");
  assert.equal(cm.mappings[0].source, "CM default (AutoTARA classification)");
  const legacy = await getCountermeasures(database(), "vehicle_lang", [
    "T0800",
  ]);
  assert.equal(legacy.effectDefaultsAvailable, false);
  assert.deepEqual(legacy.missingEffectCmIds, ["M0800"]);
  assert.ok(legacy.missingFields.includes("P/D/R classification"));
});

test("explicit no-effect profile remains an empty classification, not missing data", async () => {
  const db = database({ profiles: true });
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    const result = await query(sql, params);
    if (sql.includes("AS effect_profile"))
      result.rows = result.rows.map((row) => ({
        ...row,
        mitigation_id: "M0816",
        effect_profile: {
          effect_types: [],
          classification_status: "not_applicable",
          basis: "No effective mitigation",
          classification_source: "AutoTARA",
        },
      }));
    return result;
  };
  const result = await getCountermeasures(db, "vehicle_lang", ["T0800"]);
  assert.deepEqual(result.countermeasures[0].defaultEffects, []);
  assert.deepEqual(result.countermeasures[0].mappings[0].effects, []);
  assert.equal(
    result.countermeasures[0].effectProfile.status,
    "not_applicable",
  );
  assert.deepEqual(result.missingEffectCmIds, []);
  assert.ok(
    !result.missingFields.some((field) => field.includes("classification")),
  );
});

test('DB effect and confidence populate each mapping and only absent values are reported missing', async () => {
  const db = database({ profiles: true })
  const query = db.query.bind(db)
  db.query = async (...args) => {
    const result = await query(...args)
    for (const row of result.rows) {
      if (row.effect_profile) row.effect_profile.confidence = 'M'
    }
    return result
  }
  const result = await getCountermeasures(db, 'vehicle_lang', ['T0800'])
  assert.equal(result.countermeasures[0].effectProfile.confidence, 'M')
  assert.deepEqual(result.countermeasures[0].defaultEffects, [
    { type: 'P', level: 'M' },
    { type: 'D', level: 'M' },
  ])
  assert.ok(result.countermeasures[0].mappings.every((mapping) =>
    mapping.effects.every((effect) => effect.level === 'M')))
  assert.deepEqual(result.missingFields, ['cost score'])
  const missing = await getCountermeasures(database({ profiles: true }), 'vehicle_lang', ['T0800'])
  assert.ok(missing.missingFields.includes('effect level / confidence'))
  assert.equal(missing.countermeasures[0].defaultEffects[0].level, '')
})

test('DB implementation costs are returned as numeric defaults and only missing costs are reported', async () => {
  for (const cost of [1, 2, 3, 4, 5]) {
    const result = await getCountermeasures(database({ profiles: true, cost }), 'vehicle_lang', ['T0800'])
    assert.equal(result.countermeasures[0].cost, cost)
    assert.ok(!result.missingFields.includes('cost score'))
  }
  // Older profiles without a cost column and invalid values remain unassessed.
  for (const cost of [undefined, null, 0, 6, 2.5, '3']) {
    const result = await getCountermeasures(database({ profiles: true, cost }), 'vehicle_lang', ['T0800'])
    assert.equal(result.countermeasures[0].cost, null)
    assert.ok(result.missingFields.includes('cost score'))
  }
  const db = database({ profiles: true, cost: 4 })
  const query = db.query.bind(db)
  db.query = async (...args) => {
    const result = await query(...args)
    if (args[0].includes('AS effect_profile')) {
      result.rows[1].mitigation_id = 'M0801'
      result.rows[1].effect_profile.cost = null
    }
    return result
  }
  const mixed = await getCountermeasures(db, 'vehicle_lang', ['T0800', 'T0830'])
  assert.deepEqual(mixed.countermeasures.map((cm) => cm.cost), [4, null])
  assert.ok(mixed.missingFields.includes('cost score'))
})
