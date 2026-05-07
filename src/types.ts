export type Artwork = {
  id: string
  title: string
  artist: string
  year?: number
  imageUrl: string
  museum?: string
  locationSeen?: string
  dateSeen?: string
  movement?: string[]
  themes?: string[]
  mood?: string[]
  colors?: string[]
  medium?: string
  personalTags?: string[]
  personalNote?: string
}

export type Connection = {
  source: string
  target: string
  score: number
  reasons: string[]
}

