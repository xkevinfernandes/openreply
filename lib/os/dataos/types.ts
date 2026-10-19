// Data OS: the external content system (stories, posts). A separate
// connection, never tables copied in. Wave-0 contract; owner: S2.

export interface DataOsContent {
  id: string;
  thumbnailUrl: string | null;
  caption: string | null;
  topic: string | null;
  postedAt: string | null;
  permalink: string | null;
}

export interface DataOsStatus {
  connected: boolean;
  /** "mock" | "http" */
  mode: string;
  error?: string | null;
}

export interface DataOs {
  status(): Promise<DataOsStatus>;
  /** The story a story reply points at (Zernio gives storyId and the CDN asset_id). */
  storyFor(ref: { storyId: string | null; assetId: string | null; at: string | null }): Promise<DataOsContent | null>;
  contentByMediaId(mediaId: string): Promise<DataOsContent | null>;
  recentStories(days: number): Promise<DataOsContent[]>;
}
