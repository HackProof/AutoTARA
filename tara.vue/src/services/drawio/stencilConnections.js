import { createAssociationMatcher } from '../associations.js'

// During a connection/reconnection the anchored endpoint takes precedence over
// selection. Include concrete catalog types even if none are on the canvas yet.
export function getStencilConnectionContext(languageGraph, selection, connectionFeedback) {
  if (!languageGraph) return null
  const source = connectionFeedback
    ? {
        type: connectionFeedback.sourceAssetType,
        label: connectionFeedback.sourceLabel,
      }
    : selection?.dfdShape && !selection.isEdge
      ? { type: selection.assetType, label: selection.label }
      : null
  const matcher = createAssociationMatcher(languageGraph)
  if (!source || !matcher.hasAsset(source.type)) return null
  return {
    sourceAssetType: source.type,
    sourceLabel: source.label || source.type,
    compatibleAssetTypes: new Set(
      languageGraph.assets
        .filter(
          (asset) =>
            !asset.isAbstract && !asset.is_abstract && matcher.canConnect(source.type, asset.name),
        )
        .map((asset) => asset.name),
    ),
  }
}
