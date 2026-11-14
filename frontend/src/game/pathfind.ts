import type { Vec } from './types'

/**
 * A* on a uniform 4-connected grid — binary-heap open list over integer
 * node ids (y*maxX+x), typed-array g/parent/closed so no strings or
 * per-node objects are allocated. `walkable(x,y)` decides passability.
 * Returns tile centers as waypoints, or null when unreachable.
 * Deterministic: ties on f resolve by lowest node id.
 */
export function findPath(
  from: Vec,
  to: Vec,
  walkable: (x: number, y: number) => boolean,
  maxX: number,
  maxY: number,
): Vec[] | null {
  const sx = Math.floor(from.x)
  const sy = Math.floor(from.y)
  const tx = Math.floor(to.x)
  const ty = Math.floor(to.y)
  if (sx === tx && sy === ty) return []
  if (!walkable(tx, ty)) return null

  const n = maxX * maxY
  const g = new Float64Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const h = (x: number, y: number) => Math.abs(x - tx) + Math.abs(y - ty)

  // Heap entries are immutable priority snapshots packed as f*n + id
  // (g and h are integers, so f is too). Ordering by the packed key is
  // exactly ordering by (f, id). When a node's g improves we push a new
  // entry — the stale one keeps its old key, pops strictly later, and is
  // discarded by `closed`. A live-f[] comparator would silently reorder
  // existing entries on every decrease-key and corrupt the pop order.
  const heap: number[] = []
  const swap = (i: number, j: number) => {
    const t = heap[i]
    heap[i] = heap[j]
    heap[j] = t
  }
  const siftUp = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[i] >= heap[p]) break
      swap(i, p)
      i = p
    }
  }
  const siftDown = (i: number) => {
    for (;;) {
      let m = i
      const l = 2 * i + 1
      const r = l + 1
      if (l < heap.length && heap[l] < heap[m]) m = l
      if (r < heap.length && heap[r] < heap[m]) m = r
      if (m === i) return
      swap(i, m)
      i = m
    }
  }

  const start = sy * maxX + sx
  const target = ty * maxX + tx
  g[start] = 0
  heap.push(h(sx, sy) * n + start)

  while (heap.length) {
    const cur = heap[0] % n
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      siftDown(0)
    }
    if (closed[cur]) continue // stale heap entry — a better g won since
    closed[cur] = 1
    const cx = cur % maxX
    const cy = (cur / maxX) | 0
    if (cur === target) {
      const path: Vec[] = []
      for (let k = cur; k !== start; k = parent[k])
        path.push({ x: (k % maxX) + 0.5, y: ((k / maxX) | 0) + 0.5 })
      return path.reverse()
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= maxX || ny >= maxY) continue
      if (!walkable(nx, ny)) continue
      const ni = ny * maxX + nx
      if (closed[ni]) continue
      const ng = g[cur] + 1
      if (ng < g[ni]) {
        g[ni] = ng
        parent[ni] = cur
        heap.push((ng + h(nx, ny)) * n + ni)
        siftUp(heap.length - 1)
      }
    }
  }
  return null
}
