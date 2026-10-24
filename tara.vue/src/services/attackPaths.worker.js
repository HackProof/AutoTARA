import { buildAttackGraph } from './attackGraph.js'
import { findAttackPaths } from './attackPaths.js'
import { sortAttackPathIndexes } from './attackPathMetrics.js'

self.onmessage = ({ data }) => {
  try {
    const graph = buildAttackGraph(data.snapshot, data.languageGraph, data.schema, data.catalogRows)
    const result = findAttackPaths(graph, data.options)
    const order = sortAttackPathIndexes(result)
    self.postMessage({
      graph,
      result: {
        ...result,
        paths: order.map((index) => result.paths[index]),
        metrics: order.map((index) => result.metrics[index]),
      },
    })
  } catch (error) {
    self.postMessage({ error: error.message || 'Attack path search failed.' })
  }
}
