import api from '../api/client.js'

async function postReport(action, body, signal) {
  try {
    const { data } = await api.post(`/v1/reports/${action}`, body, {
      signal,
      timeout: 190000,
    })
    return data
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(
      error.response?.data?.error ||
        (error.code === 'ECONNABORTED'
          ? 'Report request timed out. Please retry.'
          : error.message || 'Cannot reach the report server. Start tara.server and try again.'),
      { cause: error },
    )
  }
}

async function streamReport(action, body, signal, onEvent) {
  const timeout = AbortSignal.timeout(190000)
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let reader
  try {
    const response = await fetch(api.getUri({ url: `/v1/reports/${action}` }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: combinedSignal,
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Report request failed (HTTP ${response.status}).`)
    }
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const data = await response.json()
      onEvent({ type: 'status', status: 'buffered' })
      onEvent({
        type: 'text',
        text: JSON.stringify(data.verification || data.scenario, null, 2) || '',
      })
      return data
    }
    if (!response.headers.get('Content-Type')?.includes('text/event-stream') || !response.body)
      throw new Error('The report server did not return a response stream.')

    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result
    let completed = false
    function consume(frame) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) return
      let event
      try {
        event = JSON.parse(data)
      } catch {
        throw new Error('The report server returned an invalid response stream.')
      }
      if (
        !event ||
        typeof event.type !== 'string' ||
        (event.type === 'delta' && typeof event.delta !== 'string') ||
        (event.type === 'text' && typeof event.text !== 'string')
      )
        throw new Error('The report server returned an invalid response stream.')
      if (event.type === 'error') throw new Error(event.error || 'Report generation failed.')
      if (event.type === 'result') {
        result = event.result
        completed = true
      } else onEvent(event)
    }
    while (!completed) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let boundary
      while ((boundary = buffer.match(/\r?\n\r?\n/))) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        consume(frame)
        if (completed) break
      }
      if (done) {
        if (!completed && buffer.trim()) consume(buffer)
        break
      }
    }
    if (!completed) throw new Error('The report response ended before completion. Please retry.')
    return result
  } catch (error) {
    if (timeout.aborted && !signal?.aborted)
      throw new Error('Report request timed out. Please retry.', { cause: error })
    throw error
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}

export async function requestScenarioReport(action, input, { draft, signal, onEvent } = {}) {
  const body = { input, ...(draft ? { draft } : {}) }
  const data = onEvent
    ? await streamReport(action, body, signal, onEvent)
    : await postReport(action, body, signal)
  if (
    !data?.scenario ||
    !data.model ||
    !data.createdAt ||
    (action === 'verify' && !data.verification)
  )
    throw new Error('The report server returned an invalid result.')
  return data
}

export async function previewScenarioReport(action, input, { draft, signal } = {}) {
  const data = await postReport(
    'preview',
    { action, input, stream: true, ...(draft ? { draft } : {}) },
    signal,
  )
  if (
    !Array.isArray(data?.input) ||
    data.input.length !== 2 ||
    !['system', 'user'].every(
      (role, index) =>
        data.input[index]?.role === role && typeof data.input[index].content === 'string',
    ) ||
    data.text?.format?.type !== 'json_schema' ||
    !data.text.format.schema
  )
    throw new Error('The report server returned an invalid prompt preview.')
  return data
}
