import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force"
import type { Artwork, Connection } from "../types"
import { createRng } from "../lib/seed"
import styles from "./FloatingGallery.module.css"

type Node = {
  id: string
  x: number
  y: number
  vx?: number
  vy?: number
  driftPhase: number
  /** Depth in px along orbit local Z; layout stays 2D, links + billboards use this. */
  z: number
}

type SimNode = Node & SimulationNodeDatum
type SimLink = SimulationLinkDatum<SimNode> & { score: number }

type CSSVars = CSSProperties & Record<`--${string}`, string>

type Props = {
  artworks: Artwork[]
  connections: Connection[]
  seed?: string
  onSelect: (id: string) => void
}

/** Default orbit: spin (Y) + light pitch (X). Nodes billboard so thumbs stay readable. */
const INITIAL_TILT = { rx: -4, ry: 10 }
/** Max pitch of the whole graph. */
const MAX_TILT_X = 14
/** Gentle reheat of the force sim while orbiting or panning (initial load uses alpha 0.9). */
const NUDGE_SIM_ALPHA_CAP = 0.1
const NUDGE_SIM_ALPHA_BUMP = 0.014
const RESET_VIEW_MS = 900

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

/** Shortest signed delta from `fromDeg` to `toDeg` for smooth spin rewind. */
function shortestAngleDelta(fromDeg: number, toDeg: number) {
  let d = toDeg - fromDeg
  d = ((d % 360) + 360) % 360
  if (d > 180) d -= 360
  return d
}

function edgeSegmentStyle(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): { width: number; transform: string } {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 0.5) {
    return { width: 0.5, transform: `translate3d(${ax}px, ${ay}px, ${az}px)` }
  }
  const lenXY = Math.hypot(dx, dy)
  const yawDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  const pitchDeg =
    lenXY < 1e-5 ? (dz >= 0 ? -90 : 90) : ((-Math.atan2(dz, lenXY) * 180) / Math.PI)
  return {
    width: len,
    transform: `translate3d(${ax}px, ${ay}px, ${az}px) rotateZ(${yawDeg}deg) rotateY(${pitchDeg}deg)`,
  }
}

export function FloatingGallery({ artworks, connections, seed = "museum", onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const initialViewRef = useRef<{
    pan: { x: number; y: number }
    zoom: number
    tilt: { rx: number; ry: number }
  } | null>(null)
  const dragState = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    moved: boolean
  } | null>(null)
  const rotateState = useRef<{
    pointerId: number
    startX: number
    startY: number
    startRx: number
    startRy: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const resetAnimRafRef = useRef<number | null>(null)
  const latestViewRef = useRef({
    pan: { x: 0, y: 0 },
    zoom: 1,
    tilt: { ...INITIAL_TILT },
  })
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map())
  const [hovered, setHovered] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  /** Orbit tilt in degrees (CSS rotateX / rotateY on the constellation). */
  const [tilt, setTilt] = useState(() => ({ ...INITIAL_TILT }))

  latestViewRef.current = { pan: { ...pan }, zoom, tilt: { ...tilt } }

  useEffect(() => {
    return () => {
      if (resetAnimRafRef.current != null) cancelAnimationFrame(resetAnimRafRef.current)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      setSize({ w: cr.width, h: cr.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { nodes, links } = useMemo(() => {
    const rng = createRng(seed)
    const nodes: Node[] = artworks.map((a) => ({
      id: a.id,
      x: rng.float(0.2, 0.8),
      y: rng.float(0.2, 0.8),
      driftPhase: rng.float(0, Math.PI * 2),
      z: rng.float(-140, 140),
    }))

    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const links = connections
      .filter((c) => nodeById.has(c.source) && nodeById.has(c.target))
      .map((c) => ({ source: c.source, target: c.target, score: c.score }))

    return { nodes, links }
  }, [artworks, connections, seed])

  const depthById = useMemo(() => new Map(nodes.map((n) => [n.id, n.z])), [nodes])

  useEffect(() => {
    if (!containerRef.current) return
    if (!nodes.length) return

    // Clone nodes so the simulation can mutate them.
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n, x: n.x * size.w, y: n.y * size.h }))
    const simLinks: SimLink[] = links.map((l) => ({ ...l }))

    const sim = forceSimulation(simNodes)
      .alpha(0.9)
      .alphaDecay(0.025)
      .velocityDecay(0.35)
      .force("charge", forceManyBody().strength(-420))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => Math.max(300, 560 - Math.min(220, d.score * 22)))
          .strength((d) => Math.min(0.22, 0.05 + d.score / 62)),
      )
      .force("collide", forceCollide(82).strength(0.92))

    simRef.current = sim

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(() => {
        const m = new Map<string, { x: number; y: number }>()
        for (const n of simNodes) m.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
        setPositions(m)
      })
    }

    sim.on("tick", tick)
    return () => {
      sim.stop()
      if (simRef.current === sim) simRef.current = null
      cancelAnimationFrame(raf)
    }
  }, [nodes, links, size.w, size.h])

  const nudgeLayout = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    const next = Math.min(NUDGE_SIM_ALPHA_CAP, sim.alpha() + NUDGE_SIM_ALPHA_BUMP)
    sim.alpha(next)
    sim.restart()
  }, [])

  const edgeOpacity = (a: string, b: string) => {
    if (!hovered) return 0.22
    if (hovered === a || hovered === b) return 0.8
    return 0.08
  }

  const clampZoom = (z: number) => Math.max(0.6, Math.min(2.4, z))

  const getFitView = useCallback(() => {
    if (!positions.size || size.w <= 0 || size.h <= 0) return null

    const pts = [...positions.values()]
    const minX = Math.min(...pts.map((p) => p.x))
    const maxX = Math.max(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y))
    const maxY = Math.max(...pts.map((p) => p.y))

    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)
    const padding = size.w >= 1024 ? 420 : 280

    const nextZoom = clampZoom(
      Math.min((size.w - padding) / spanX, (size.h - padding) / spanY),
    )

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    return {
      zoom: nextZoom,
      pan: {
        x: size.w / 2 - centerX * nextZoom,
        y: size.h / 2 - centerY * nextZoom,
      },
    }
  }, [positions, size.w, size.h])

  const cancelResetAnimation = useCallback(() => {
    if (resetAnimRafRef.current != null) {
      cancelAnimationFrame(resetAnimRafRef.current)
      resetAnimRafRef.current = null
    }
  }, [])

  const animateViewTo = useCallback(
    (to: { pan: { x: number; y: number }; zoom: number; tilt: { rx: number; ry: number } }) => {
      cancelResetAnimation()
      const from = {
        pan: { ...latestViewRef.current.pan },
        zoom: latestViewRef.current.zoom,
        tilt: { ...latestViewRef.current.tilt },
      }
      const start = performance.now()
      const ryDelta = shortestAngleDelta(from.tilt.ry, to.tilt.ry)

      const step = (now: number) => {
        const t = Math.min(1, (now - start) / RESET_VIEW_MS)
        const e = easeOutCubic(t)
        setPan({
          x: from.pan.x + (to.pan.x - from.pan.x) * e,
          y: from.pan.y + (to.pan.y - from.pan.y) * e,
        })
        setZoom(from.zoom + (to.zoom - from.zoom) * e)
        setTilt({
          rx: from.tilt.rx + (to.tilt.rx - from.tilt.rx) * e,
          ry: from.tilt.ry + ryDelta * e,
        })
        if (t < 1) {
          resetAnimRafRef.current = requestAnimationFrame(step)
        } else {
          resetAnimRafRef.current = null
          setPan({ ...to.pan })
          setZoom(to.zoom)
          setTilt({ ...to.tilt })
        }
      }
      resetAnimRafRef.current = requestAnimationFrame(step)
    },
    [cancelResetAnimation],
  )

  const resetView = () => {
    if (initialViewRef.current) {
      animateViewTo(initialViewRef.current)
      return
    }
    const fit = getFitView()
    if (!fit) {
      animateViewTo({ pan: { x: 0, y: 0 }, zoom: 1, tilt: { ...INITIAL_TILT } })
      return
    }
    animateViewTo({ ...fit, tilt: { ...INITIAL_TILT } })
  }

  useEffect(() => {
    if (initialViewRef.current) return
    if (positions.size < Math.max(2, artworks.length)) return
    const fit = getFitView()
    if (!fit) return
    initialViewRef.current = { ...fit, tilt: { ...INITIAL_TILT } }
    setZoom(fit.zoom)
    setPan(fit.pan)
  }, [positions, artworks.length, size.w, size.h, getFitView])

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!containerRef.current) return
    cancelResetAnimation()

    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const nextZoom = clampZoom(zoom + delta)
    const ratio = nextZoom / zoom

    setPan((prev) => ({
      x: cx - (cx - prev.x) * ratio,
      y: cy - (cy - prev.y) * ratio,
    }))
    setZoom(nextZoom)
  }

  const clampTiltX = (rx: number) => Math.max(-MAX_TILT_X, Math.min(MAX_TILT_X, rx))

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest("[data-control='true']")) return
    if (target.closest("[data-node='true']")) return

    cancelResetAnimation()

    if (e.shiftKey) {
      rotateState.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRx: tilt.rx,
        startRy: tilt.ry,
      }
      nudgeLayout()
    } else {
      dragState.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        moved: false,
      }
      nudgeLayout()
    }
    containerRef.current.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rot = rotateState.current
    if (rot && rot.pointerId === e.pointerId) {
      const dx = e.clientX - rot.startX
      const dy = e.clientY - rot.startY
      if (Math.abs(dx) + Math.abs(dy) > 4) suppressClickRef.current = true
      setTilt({
        rx: clampTiltX(rot.startRx - dy * 0.2),
        ry: rot.startRy + dx * 0.45,
      })
      nudgeLayout()
      return
    }

    const drag = dragState.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true
      suppressClickRef.current = true
    }

    setPan({
      x: drag.startPanX + dx,
      y: drag.startPanY + dy,
    })
    nudgeLayout()
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rot = rotateState.current
    if (rot && rot.pointerId === e.pointerId) {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId)
      }
      rotateState.current = null
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      return
    }

    const drag = dragState.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (containerRef.current?.hasPointerCapture(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId)
    }
    dragState.current = null
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  return (
    <div
      ref={containerRef}
      className={styles.stage}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={styles.perspective}>
        <div
          className={styles.world}
          style={{
            width: size.w,
            height: size.h,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
        >
          <div
            className={styles.orbit}
            style={{
              width: size.w,
              height: size.h,
              transform: `rotateY(${tilt.ry}deg) rotateX(${tilt.rx}deg)`,
            }}
          >
            {connections.map((c) => {
              const a = positions.get(c.source)
              const b = positions.get(c.target)
              if (!a || !b) return null
              if (!depthById.has(c.source) || !depthById.has(c.target)) return null
              const za = depthById.get(c.source) ?? 0
              const zb = depthById.get(c.target) ?? 0
              const op = edgeOpacity(c.source, c.target)
              const h = Math.max(1.2, Math.min(2.8, 0.85 + c.score / 7))
              const { width, transform } = edgeSegmentStyle(a.x, a.y, za, b.x, b.y, zb)
              return (
                <div
                  key={`${c.source}__${c.target}`}
                  className={styles.edge3d}
                  style={
                    {
                      width,
                      height: h,
                      opacity: op,
                      transform,
                    } as CSSProperties
                  }
                  aria-hidden
                />
              )
            })}

            {artworks.map((a) => {
              const p = positions.get(a.id)
              if (!p) return null
              const meta = nodes.find((n) => n.id === a.id)
              const drift = meta?.driftPhase ?? 0
              const z = meta?.z ?? 0

              return (
                <div
                  key={a.id}
                  className={styles.nodeAnchor}
                  style={{ transform: `translate3d(${p.x}px, ${p.y}px, ${z}px)` }}
                >
                  <div
                    className={styles.nodeFace}
                    style={{
                      transform: `rotateX(${-tilt.rx}deg) rotateY(${-tilt.ry}deg)`,
                    }}
                  >
                    <button
                      type="button"
                      data-node="true"
                      className={styles.node}
                      style={{ "--phase": `${drift}s` } as CSSVars}
                      onClick={() => {
                        if (!suppressClickRef.current) onSelect(a.id)
                      }}
                      onPointerEnter={() => setHovered(a.id)}
                      onPointerLeave={() => setHovered(null)}
                    >
                      <span className={styles.thumb}>
                        <img src={a.imageUrl} alt={`${a.title} by ${a.artist}`} draggable={false} />
                      </span>
                      <span className={styles.label}>
                        <span className={styles.title}>{a.title}</span>
                        <span className={styles.meta}>{a.artist}</span>
                      </span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className={styles.hint} data-control="true">
        <span>
          Drag to pan · Shift+drag to orbit · Scroll to zoom · Works face you as you turn.
        </span>
        <button type="button" data-control="true" className={styles.reset} onClick={resetView}>
          Reset View
        </button>
      </div>
    </div>
  )
}

