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

/**
 * Scored force-directed graph layout shared across views that need the same
 * link-distance / charge / collision behavior (e.g. multiple gallery-style UIs).
 */
export type GraphSimulationNode = SimulationNodeDatum & { id: string }

export type GraphScoreLink<N extends GraphSimulationNode> = SimulationLinkDatum<N> & {
  score: number
}

const ALPHA = 0.9
const ALPHA_DECAY = 0.025
const VELOCITY_DECAY = 0.35
const CHARGE_STRENGTH = -420
const COLLIDE_RADIUS = 82
const COLLIDE_STRENGTH = 0.92

const NUDGE_ALPHA_CAP = 0.1
const NUDGE_ALPHA_BUMP = 0.014

export function createGraphSimulation<N extends GraphSimulationNode>(
  nodes: N[],
  links: GraphScoreLink<N>[],
  size: { w: number; h: number },
): Simulation<N, undefined> {
  return forceSimulation(nodes)
    .alpha(ALPHA)
    .alphaDecay(ALPHA_DECAY)
    .velocityDecay(VELOCITY_DECAY)
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
    .force("center", forceCenter(size.w / 2, size.h / 2))
    .force(
      "link",
      forceLink<N, GraphScoreLink<N>>(links)
        .id((d) => d.id)
        .distance((d) => Math.max(300, 560 - Math.min(220, d.score * 22)))
        .strength((d) => Math.min(0.22, 0.05 + d.score / 62)),
    )
    .force("collide", forceCollide(COLLIDE_RADIUS).strength(COLLIDE_STRENGTH))
}

/** Gentle reheat while interacting (camera/orbit); initial load uses full alpha from {@link createGraphSimulation}. */
export function nudgeGraphSimulation<N extends GraphSimulationNode>(
  sim: Simulation<N, undefined> | null,
): void {
  if (!sim) return
  const next = Math.min(NUDGE_ALPHA_CAP, sim.alpha() + NUDGE_ALPHA_BUMP)
  sim.alpha(next)
  sim.restart()
}
