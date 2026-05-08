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

export function FloatingGallery({ artworks, connections, seed = "museum", onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const initialViewRef = useRef<{ pan: { x: number; y: number }; zoom: number } | null>(null)
  const dragState = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map())
  const [hovered, setHovered] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)

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
    }))

    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const links = connections
      .filter((c) => nodeById.has(c.source) && nodeById.has(c.target))
      .map((c) => ({ source: c.source, target: c.target, score: c.score }))

    return { nodes, links }
  }, [artworks, connections, seed])

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
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => Math.max(180, 360 - Math.min(180, d.score * 18)))
          .strength((d) => Math.min(0.28, 0.06 + d.score / 55)),
      )
      .force("collide", forceCollide(64).strength(0.9))

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
      cancelAnimationFrame(raf)
    }
  }, [nodes, links, size.w, size.h])

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
    const padding = size.w >= 1024 ? 380 : 240

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

  const fitToView = () => {
    const fit = getFitView()
    if (!fit) {
      setPan({ x: 0, y: 0 })
      setZoom(1)
      return
    }
    setZoom(fit.zoom)
    setPan(fit.pan)
  }

  const resetView = () => {
    if (initialViewRef.current) {
      setZoom(initialViewRef.current.zoom)
      setPan(initialViewRef.current.pan)
      return
    }
    fitToView()
  }

  useEffect(() => {
    if (initialViewRef.current) return
    if (positions.size < Math.max(2, artworks.length)) return
    const fit = getFitView()
    if (!fit) return
    initialViewRef.current = fit
    setZoom(fit.zoom)
    setPan(fit.pan)
  }, [positions, artworks.length, size.w, size.h, getFitView])

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!containerRef.current) return

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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest("[data-control='true']")) return
    if (target.closest("[data-node='true']")) return
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    }
    containerRef.current.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
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
      <div
        className={styles.world}
        style={{
          width: size.w,
          height: size.h,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
        }}
      >
        <svg className={styles.edges} width={size.w} height={size.h} aria-hidden="true">
          <defs>
            <filter id="edgeGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {connections.map((c) => {
            const a = positions.get(c.source)
            const b = positions.get(c.target)
            if (!a || !b) return null
            const op = edgeOpacity(c.source, c.target)
            const w = Math.max(1, Math.min(2.6, 0.7 + c.score / 7))
            return (
              <line
                key={`${c.source}__${c.target}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(195, 147, 255, 0.9)"
                strokeOpacity={op}
                strokeWidth={w}
                filter="url(#edgeGlow)"
              />
            )
          })}
        </svg>

        {artworks.map((a) => {
          const p = positions.get(a.id)
          if (!p) return null
          const drift = nodes.find((n) => n.id === a.id)?.driftPhase ?? 0

          return (
            <button
              key={a.id}
              type="button"
              data-node="true"
              className={styles.node}
              style={
                {
                  transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                  "--phase": `${drift}s`,
                } as CSSVars
              }
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
          )
        })}
      </div>

      <div className={styles.hint} data-control="true">
        <span>Drag to pan · Scroll to zoom · Click to enter a work.</span>
        <button type="button" data-control="true" className={styles.reset} onClick={resetView}>
          Reset View
        </button>
      </div>
    </div>
  )
}

