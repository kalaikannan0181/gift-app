export type GalleryItem = {
  id: string;
  title: string;
  subtitle: string;
  by: string;
  url: string;
};

export const GALLERY_STORAGE_KEY = "galleryPhotos";
export const AUDIO_STORAGE_KEY = "backgroundAudio";

export const defaultGalleryItems: GalleryItem[] = [
  {
    id: "red-panda",
    title: "Red panda",
    subtitle: "Quiet moments in the canopy",
    by: "Xiangkun ZHU",
    url: "https://images.unsplash.com/photo-1656899367728-cf0194bf3aeb?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=700&h=1000",
  },
  {
    id: "lion",
    title: "The lion",
    subtitle: "A study in untamed stillness",
    by: "Luke Tanis",
    url: "https://images.unsplash.com/photo-1511216113906-8f57bb83e776?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=700&h=1000",
  },
  {
    id: "elephant",
    title: "Forest spirit",
    subtitle: "Between the leaves and light",
    by: "Geranimo",
    url: "https://images.unsplash.com/photo-1549366021-9f761d450615?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=700&h=1000",
  },
  {
    id: "fox",
    title: "Winter fox",
    subtitle: "A flash of fire in the snow",
    by: "Jeremy Hynes",
    url: "https://images.unsplash.com/photo-1639182946622-7de9d7efa6b4?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=700&h=1000",
  },
  {
    id: "owl",
    title: "Night watch",
    subtitle: "Keeper of the quiet hours",
    by: "Daniel Mačura",
    url: "https://images.unsplash.com/photo-1604605152447-1fcea1a333f3?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=700&h=1000",
  },
  {
    id: "wild-gaze",
    title: "Wild gaze",
    subtitle: "Stories written in amber",
    by: "Alexander Andrews",
    url: "https://images.unsplash.com/photo-1557008075-7f2c5efa4cfd?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=700&h=1000",
  },
];

export function getGalleryItems(): GalleryItem[] {
  if (typeof window === "undefined") return defaultGalleryItems;

  try {
    const saved = window.localStorage.getItem(GALLERY_STORAGE_KEY);
    if (!saved) return defaultGalleryItems;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : defaultGalleryItems;
  } catch {
    return defaultGalleryItems;
  }
}

export const DEFAULT_AUDIO_URL = "/audio/track.mp3";

export function saveGalleryItems(items: GalleryItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn("localStorage quota exceeded or write failed for gallery items:", err);
    try {
      // Keep only items without huge data URLs in localStorage as fallback
      const leanItems = items.slice(0, 12).map((item) => {
        if (item.url.startsWith("data:") && item.url.length > 200000) {
          return { ...item, url: "" };
        }
        return item;
      });
      window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(leanItems));
    } catch {
      // Ignore secondary storage failure
    }
  }
}

export function normalizeAudioUrl(value: string | null | undefined): string {
  if (!value) return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  // Support local relative paths, blob URLs, and data URLs
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  try {
    const parsed = new URL(
      trimmed,
      typeof window !== "undefined" ? window.location.origin : "http://localhost:8443",
    );
    const hostname = parsed.hostname.toLowerCase();
    const isBlockedPlaceholder =
      hostname === "example.com" ||
      trimmed.includes("your-6-min-audio") ||
      trimmed.includes("example.com");

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return isBlockedPlaceholder ? "" : trimmed;
  } catch {
    return "";
  }
}

export function getAudioUrl(): string {
  if (typeof window === "undefined") return DEFAULT_AUDIO_URL;

  const rawAudioUrl = window.localStorage.getItem(AUDIO_STORAGE_KEY) ?? "";
  const normalized = normalizeAudioUrl(rawAudioUrl);
  if (!normalized && rawAudioUrl) {
    try {
      window.localStorage.removeItem(AUDIO_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return normalized || DEFAULT_AUDIO_URL;
}

export const VIDEO_STORAGE_KEY = "featuredVideo";

export function normalizeVideoUrl(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const isBlocked =
      hostname === "example.com" ||
      trimmed.includes("your-6-min-video") ||
      trimmed.includes("example.com");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return isBlocked ? "" : trimmed;
  } catch {
    return "";
  }
}

export function getVideoUrl(): string {
  if (typeof window === "undefined") return "";
  const raw = window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? "";
  const normalized = normalizeVideoUrl(raw);
  if (!normalized && raw) {
    try {
      window.localStorage.removeItem(VIDEO_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return normalized;
}

export function saveVideoUrl(url: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizeVideoUrl(url);
  try {
    if (!normalized) {
      window.localStorage.removeItem(VIDEO_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(VIDEO_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn("Could not save video URL to localStorage:", err);
  }
}

export function saveAudioUrl(url: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizeAudioUrl(url);
  try {
    if (!normalized) {
      window.localStorage.removeItem(AUDIO_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AUDIO_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn("Could not save audio URL to localStorage:", err);
  }
}
