import { AnimatePresence, motion } from "framer-motion"
import type { Artwork, Connection } from "../types"
import styles from "./ArtworkDetail.module.css"

type Props = {
  artwork: Artwork
  connections: Connection[]
  getArtwork: (id: string) => Artwork | undefined
  onClose: () => void
  onSelect: (id: string) => void
}

function uniq<T>(arr: T[]) {
  return [...new Set(arr)]
}

export function ArtworkDetail({ artwork, connections, getArtwork, onClose, onSelect }: Props) {
  const related = connections
    .filter((c) => c.source === artwork.id || c.target === artwork.id)
    .map((c) => {
      const otherId = c.source === artwork.id ? c.target : c.source
      return { otherId, score: c.score, reasons: c.reasons }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  const tags = uniq([
    ...(artwork.themes || []),
    ...(artwork.mood || []),
    ...(artwork.colors || []),
    ...(artwork.movement || []),
    ...(artwork.personalTags || []),
  ]).slice(0, 18)

  return (
    <AnimatePresence>
      <motion.div
        className={styles.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        className={styles.shell}
        role="dialog"
        aria-modal="true"
        aria-label={`${artwork.title} detail`}
        initial={{ opacity: 0, scale: 0.985, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.985, y: 10 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <div className={styles.imageWrap}>
          <motion.img
            key={artwork.id}
            src={artwork.imageUrl}
            alt={`${artwork.title} by ${artwork.artist}`}
            className={styles.image}
            initial={{ scale: 1.02, opacity: 0.9 }}
            animate={{ scale: 1.06, opacity: 1 }}
            transition={{ duration: 14, ease: "easeInOut" }}
          />
          <div className={styles.vignette} />
        </div>

        <div className={styles.panel}>
          <div className={styles.header}>
            <div>
              <div className={styles.title}>{artwork.title}</div>
              <div className={styles.subtitle}>
                {artwork.artist}
                {artwork.year ? <span className={styles.dot}>·</span> : null}
                {artwork.year ?? null}
              </div>
            </div>
            <button type="button" className={styles.close} onClick={onClose}>
              Close
            </button>
          </div>

          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Museum</div>
              <div className={styles.metaValue}>{artwork.museum ?? "—"}</div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Seen</div>
              <div className={styles.metaValue}>
                {artwork.locationSeen ?? "—"}
                {artwork.dateSeen ? <span className={styles.dim}> ({artwork.dateSeen})</span> : null}
              </div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Medium</div>
              <div className={styles.metaValue}>{artwork.medium ?? "—"}</div>
            </div>
          </div>

          {artwork.personalNote ? (
            <div className={styles.note}>
              <div className={styles.metaLabel}>Personal note</div>
              <div className={styles.noteText}>{artwork.personalNote}</div>
            </div>
          ) : null}

          {tags.length ? (
            <div className={styles.tags}>
              {tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          {related.length ? (
            <div className={styles.related}>
              <div className={styles.relatedHeader}>Nearby works</div>
              <div className={styles.relatedStrip}>
                {related.map((r) => {
                  const other = getArtwork(r.otherId)
                  if (!other) return null
                  return (
                    <button
                      key={other.id}
                      type="button"
                      className={styles.relatedItem}
                      onClick={() => onSelect(other.id)}
                      title={r.reasons.join(", ")}
                    >
                      <img src={other.imageUrl} alt={other.title} />
                      <div className={styles.relatedText}>
                        <div className={styles.relatedTitle}>{other.title}</div>
                        <div className={styles.relatedMeta}>{other.artist}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

