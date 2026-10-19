// Sample Data OS for OS_MOCK and tests. Owner: S2.
import type { DataOs, DataOsContent } from "@/lib/os/dataos/types";

const day = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

export const MOCK_STORIES: DataOsContent[] = [
  { id: "story-setter", thumbnailUrl: null, caption: "Claude built my setter", topic: "AI setter", postedAt: day(2), permalink: null },
  { id: "story-scripts", thumbnailUrl: null, caption: "The 12 DM scripts I actually use", topic: "DM scripts", postedAt: day(1), permalink: null },
];

export const mockDataOs: DataOs = {
  async status() {
    return { connected: true, mode: "mock" };
  },
  async storyFor(ref) {
    return MOCK_STORIES.find((s) => s.id === ref.storyId) ?? MOCK_STORIES[0];
  },
  async contentByMediaId(mediaId) {
    return MOCK_STORIES.find((s) => s.id === mediaId) ?? null;
  },
  async recentStories(days) {
    const since = Date.now() - days * 86400_000;
    return MOCK_STORIES.filter((s) => !s.postedAt || new Date(s.postedAt).getTime() >= since);
  },
};
