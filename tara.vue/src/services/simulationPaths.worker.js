import { findSimulationPaths } from './simulationPaths.js'

self.onmessage = ({ data }) => {
  try {
    self.postMessage(findSimulationPaths(data.tree, data.targetId, data.options))
  } catch (error) {
    self.postMessage({ error: error.message || 'Simulation path search failed.' })
  }
}
