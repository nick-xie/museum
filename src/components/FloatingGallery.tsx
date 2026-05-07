import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
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
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map())
  const [hovered, setHovered] = useState<string | null>(null)

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
      .force("charge", forceManyBody().strength(-48))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => Math.max(90, 190 - Math.min(120, d.score * 12)))
          .strength((d) => Math.min(0.35, 0.08 + d.score / 40)),
      )
      .force("collide", forceCollide(36).strength(0.85))

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

  return (
    <div ref={containerRef} className={styles.stage}>
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
            className={styles.node}
            style={
              {
                transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                "--phase": `${drift}s`,
              } as CSSVars
            }
            onClick={() => onSelect(a.id)}
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

      <div className={styles.hint}>
        Hover to reveal constellations. Click to enter a work.
      </div>
    </div>
  )
}

