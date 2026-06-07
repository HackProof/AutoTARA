const THREAT_ANALYSIS_TYPES = new Set([
  'actor',
  'process',
  'store',
  'data store',
  'datastore'
]);

export const normalizeAssetType = (type) => String(type || '')
  .replace(/^tm\./i, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export const isThreatAnalysisAssetType = (type) =>
  THREAT_ANALYSIS_TYPES.has(normalizeAssetType(type));

export const isThreatAnalysisCellData = (data) =>
  isThreatAnalysisAssetType(data?.type);
