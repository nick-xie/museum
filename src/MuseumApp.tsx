import { useMemo, useState } from "react"
import { FloatingGallery } from "./components/FloatingGallery"
import { ArtworkDetail } from "./components/ArtworkDetail"
import { useMuseumData } from "./lib/useMuseumData"
import styles from "./MuseumApp.module.css"

export default function MuseumApp() {
  const { data, error } = useMuseumData()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const seed = useMemo(() => {
    const d = new Date()
    // A "slightly different each visit" seed that still feels stable within a day.
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
  }, [])

  if (error) {
    return (
      <div className={styles.center}>
        <div className={styles.card}>
          <div className={styles.h1}>Museum failed to load</div>
          <div className={styles.p}>{error}</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.center}>
        <div className={styles.card}>
          <div className={styles.h1}>Loading…</div>
          <div className={styles.p}>Preparing the constellation.</div>
        </div>
      </div>
    )
  }

  const selected = selectedId ? data.byId.get(selectedId) : undefined

  return (
    <div className={styles.root}>
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.topLeft}>
        <div className={styles.brand}>Personal Digital Museum</div>
        <div className={styles.sub}>Wander. Notice. Remember.</div>
      </div>

      <FloatingGallery
        artworks={data.artworks}
        connections={data.connections}
        seed={seed}
        onSelect={(id) => setSelectedId(id)}
      />

      {selected ? (
        <ArtworkDetail
          artwork={selected}
          connections={data.connections}
          getArtwork={(id) => data.byId.get(id)}
          onClose={() => setSelectedId(null)}
          onSelect={(id) => setSelectedId(id)}
        />
      ) : null}
    </div>
  )
}

