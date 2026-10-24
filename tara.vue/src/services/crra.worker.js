import { selectCountermeasures } from './crra.js'

self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result: selectCountermeasures(data.vectors, data.candidates, data.strategy, data.sort),
    })
  } catch (error) {
    self.postMessage({ error: error.message || 'Countermeasure selection failed.' })
  }
}
