const center = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
const expand = (rect, padding) => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2,
})
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Boundary travel is allowed; crossing the padded interior is not.
function crosses(a, b, rect) {
  let low = 0,
    high = 1
  for (const [axis, size] of [
    ['x', 'width'],
    ['y', 'height'],
  ]) {
    const min = rect[axis] + 1e-6,
      max = rect[axis] + rect[size] - 1e-6
    const delta = b[axis] - a[axis]
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] <= min || a[axis] >= max) return false
    } else {
      const first = (min - a[axis]) / delta,
        last = (max - a[axis]) / delta
      low = Math.max(low, Math.min(first, last))
      high = Math.min(high, Math.max(first, last))
      if (low >= high) return false
    }
  }
  return low < high
}
const clear = (a, b, obstacles) => !obstacles.some((rect) => crosses(a, b, rect))
function simplify(points) {
  const result = []
  for (const point of points) {
    const last = result.at(-1),
      before = result.at(-2)
    if (last && point.x === last.x && point.y === last.y) continue
    if (
      before &&
      ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))
    )
      result.pop()
    result.push(point)
  }
  return result
}
function ports(rect, toward, padding) {
  const margin = Math.min(16, rect.width / 4, rect.height / 4)
  const x = Math.max(rect.x + margin, Math.min(rect.x + rect.width - margin, toward.x))
  const y = Math.max(rect.y + margin, Math.min(rect.y + rect.height - margin, toward.y))
  return [
    { x: rect.x - padding - 1, y },
    { x: rect.x + rect.width + padding + 1, y },
    { x, y: rect.y - padding - 1 },
    { x, y: rect.y + rect.height + padding + 1 },
  ]
}

class Queue {
  items = []
  push(item) {
    let index = this.items.length
    this.items.push(item)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.items[parent].score <= item.score) break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = item
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()
    if (this.items.length) {
      let index = 0
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score)
          child++
        if (last.score <= this.items[child].score) break
        this.items[index] = this.items[child]
        index = child
      }
      this.items[index] = last
    }
    return first
  }
}

// Floating ends are projected onto each shape's perimeter by mxGraph. These
// intermediate points only guide a connection around other shapes and labels.
export function routeSimulationConnection(source, target, obstacles, { padding = 16 } = {}) {
  const from = center(source),
    to = center(target)
  const padded = obstacles.map((rect) => expand(rect, padding))
  if (clear(from, to, padded)) return []
  const blocked = [...padded, expand(source, padding), expand(target, padding)]
  const starts = ports(source, to, padding).filter((point) =>
    clear(from, point, [...padded, expand(target, padding)]),
  )
  const ends = ports(target, from, padding).filter((point) =>
    clear(to, point, [...padded, expand(source, padding)]),
  )
  if (!starts.length || !ends.length) return []

  // Most connections need at most one bend. Try these before searching the
  // obstacle visibility grid, keeping large simulation results responsive.
  let best = null,
    bestCost = Infinity
  for (const start of starts)
    for (const end of ends) {
      for (const middle of [
        { x: start.x, y: end.y },
        { x: end.x, y: start.y },
      ]) {
        const path = simplify([start, middle, end])
        if (path.slice(1).some((point, index) => !clear(path[index], point, blocked))) continue
        const cost =
          distance(from, start) +
          distance(end, to) +
          path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0) +
          path.length * padding
        if (cost < bestCost) {
          best = path
          bestCost = cost
        }
      }
    }
  if (best) return best

  // A* over horizontal/vertical obstacle boundaries. Nodes are visited lazily;
  // no full grid is allocated. This also routes around multiple staggered boxes.
  const xs = [
    ...new Set(
      [...starts, ...ends]
        .map((point) => point.x)
        .concat(blocked.flatMap((rect) => [rect.x, rect.x + rect.width])),
    ),
  ].sort((a, b) => a - b)
  const ys = [
    ...new Set(
      [...starts, ...ends]
        .map((point) => point.y)
        .concat(blocked.flatMap((rect) => [rect.y, rect.y + rect.height])),
    ),
  ].sort((a, b) => a - b)
  const xIndex = new Map(xs.map((x, index) => [x, index])),
    yIndex = new Map(ys.map((y, index) => [y, index]))
  const goals = new Map(
    ends.map((point) => [
      xIndex.get(point.x) * ys.length + yIndex.get(point.y),
      distance(point, to),
    ]),
  )
  const heuristic = (point) =>
    Math.min(
      ...ends.map(
        (end) => Math.abs(point.x - end.x) + Math.abs(point.y - end.y) + distance(end, to),
      ),
    )
  const queue = new Queue(),
    costs = new Map(),
    previous = new Map()
  for (const point of starts) {
    const x = xIndex.get(point.x),
      y = yIndex.get(point.y),
      key = (x * ys.length + y) * 3
    const cost = distance(from, point)
    costs.set(key, cost)
    queue.push({ key, x, y, direction: 0, cost, score: cost + heuristic(point) })
  }
  while (queue.items.length) {
    const current = queue.pop()
    if (costs.get(current.key) !== current.cost) continue
    const point = { x: xs[current.x], y: ys[current.y] }
    if (goals.has(current.x * ys.length + current.y)) {
      const path = [point]
      let key = current.key
      while (previous.has(key)) {
        key = previous.get(key)
        const index = Math.floor(key / 3)
        path.push({ x: xs[Math.floor(index / ys.length)], y: ys[index % ys.length] })
      }
      return simplify(path.reverse())
    }
    for (const [dx, dy, direction] of [
      [-1, 0, 1],
      [1, 0, 1],
      [0, -1, 2],
      [0, 1, 2],
    ]) {
      const x = current.x + dx,
        y = current.y + dy
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue
      const next = { x: xs[x], y: ys[y] }
      if (!clear(point, next, blocked)) continue
      const cost =
        current.cost +
        distance(point, next) +
        (current.direction && current.direction !== direction ? padding : 0)
      const key = (x * ys.length + y) * 3 + direction
      if (cost >= (costs.get(key) ?? Infinity)) continue
      costs.set(key, cost)
      previous.set(key, current.key)
      queue.push({ key, x, y, direction, cost, score: cost + heuristic(next) })
    }
  }
  // Overlapping user-moved shapes may leave no open corridor. Keep the edge
  // visible so the user can separate those shapes or adjust its route manually.
  return []
}
