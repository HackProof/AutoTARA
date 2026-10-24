import { Router } from "express";
import { getAttackSteps, listLangSchemas } from "./catalog.service.js";
import { getCountermeasures } from "./remediation.service.js";

const validName = (name) =>
  typeof name === "string" && name.trim() && name.length <= 256;

export function createCatalogRouter({ database }) {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json({ schemas: await listLangSchemas(database) });
  });
  router.post("/:schema/countermeasures", async (req, res) => {
    const ids = req.body?.techniqueIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 1000 ||
      ids.some(
        (id) => typeof id !== "string" || !/^T[0-9]{4}(\.[0-9]{3})?$/.test(id),
      )
    ) {
      return res
        .status(400)
        .json({ error: "Provide between 1 and 1000 MITRE Technique IDs." });
    }
    res.json(
      await getCountermeasures(database, req.params.schema, [...new Set(ids)]),
    );
  });
  router.post("/:schema/attack-steps", async (req, res) => {
    const assetTypes = req.body?.assetTypes;
    if (
      !Array.isArray(assetTypes) ||
      !assetTypes.length ||
      assetTypes.length > 1000 ||
      assetTypes.some((name) => !validName(name))
    ) {
      return res
        .status(400)
        .json({ error: "Provide between 1 and 1000 MAL asset type names." });
    }
    const assetParents = req.body.assetParents;
    if (
      assetParents !== undefined &&
      (assetParents === null ||
        typeof assetParents !== "object" ||
        Array.isArray(assetParents) ||
        Object.keys(assetParents).length > 10000 ||
        Object.entries(assetParents).some(
          ([name, parent]) =>
            !validName(name) ||
            !(parent === null || parent === "" || validName(parent)),
        ))
    ) {
      return res.status(400).json({
        error:
          "Provide MAL asset parent names, using null or an empty string for roots.",
      });
    }
    const attackSteps = await getAttackSteps(
      database,
      req.params.schema,
      [...new Set(assetTypes)],
      assetParents,
    );
    res.json({ schema: req.params.schema, attackSteps });
  });
  return router;
}
