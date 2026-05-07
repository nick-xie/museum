import { useEffect, useMemo, useState } from "react"
import type { Artwork, Connection } from "../types"

type MuseumData = {
  artworks: Artwork[]
  byId: Map<string, Artwork>
  connections: Connection[]
}

export function useMuseumData() {
  const [artworks, setArtworks] = useState<Artwork[] | null>(null)
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [artRes, connRes] = await Promise.all([
          fetch("/data/artworks.json"),
          fetch("/data/connections.json"),
        ])

        if (!artRes.ok) throw new Error(`Failed to load artworks (${artRes.status})`)
        if (!connRes.ok) throw new Error(`Failed to load connections (${connRes.status})`)

        const [artJson, connJson] = (await Promise.all([
          artRes.json(),
          connRes.json(),
        ])) as [Artwork[], Connection[]]

        if (cancelled) return
        setArtworks(artJson)
        setConnections(connJson)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Failed to load data")
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const data = useMemo<MuseumData | null>(() => {
    if (!artworks || !connections) return null
    const byId = new Map(artworks.map((a) => [a.id, a]))
    return { artworks, byId, connections }
  }, [artworks, connections])

  return { data, error }
}

