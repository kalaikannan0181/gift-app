import {
  DEFAULT_AUDIO_URL,
  getGalleryItems,
  saveGalleryItems,
  defaultGalleryItems,
  normalizeAudioUrl,
  getAudioUrl,
  saveAudioUrl,
  normalizeVideoUrl,
  getVideoUrl,
  saveVideoUrl,
  type GalleryItem,
} from "./gallery-storage";
import { apiBase, publicAnonKey, supabase } from "./supabase";
import {
  uploadStorageMedia,
  type UploadProgressCallback,
  MAX_MEDIA_FILE_SIZE,
  formatBytes,
  formatUploadError,
} from "./storage-upload";
import {
  saveGalleryItemToDB,
  getAllGalleryFromDB,
  deleteGalleryItemFromDB,
  saveMediaSettingToDB,
  getMediaSettingFromDB,
  compressImageFile,
} from "./media-storage";

export { formatUploadError, formatBytes, MAX_MEDIA_FILE_SIZE };
export type { UploadProgressCallback, UploadProgressInfo } from "./storage-upload";

export type SiteSettings = {
  audioUrl: string;
  videoUrl: string;
  heroHeadline: string;
  heroSubtitle: string;
  audioPath?: string;
  videoPath?: string;
};

export type DiscographyRelease = {
  id: string;
  releaseTitle: string;
  trackTitle: string;
  artist: string;
  audioUrl: string;
  releaseUrl: string;
  coverArtUrl: string;
  releasedAt: string;
  sortOrder: number;
};

export type SiteContent = {
  gallery: GalleryItem[];
  remoteGallery: GalleryItem[];
  settings: SiteSettings;
  releases: DiscographyRelease[];
};

export type GalleryPhotoRow = {
  id: string | number;
  image_url: string;
  title?: string | null;
  subtitle?: string | null;
  photographer?: string | null;
  photographer_name?: string | null;
  by?: string | null;
};

type DiscographyReleaseRow = {
  id: string;
  release_title: string;
  track_title: string;
  artist?: string | null;
  audio_url?: string | null;
  release_url?: string | null;
  cover_art_url?: string | null;
  released_at?: string | null;
  sort_order?: number | null;
};

function discographyRowToRelease(row: DiscographyReleaseRow): DiscographyRelease {
  return {
    id: row.id,
    releaseTitle: row.release_title,
    trackTitle: row.track_title,
    artist: row.artist || "DJoz",
    audioUrl: row.audio_url || "",
    releaseUrl: row.release_url || "",
    coverArtUrl: row.cover_art_url || "",
    releasedAt: row.released_at || "",
    sortOrder: row.sort_order ?? 0,
  };
}

export function galleryPhotoToItem(
  photo: GalleryPhotoRow,
  metadata: { title?: string; subtitle?: string; photographer?: string } = {},
): GalleryItem {
  return {
    id: String(photo.id),
    title: photo.title || metadata.title || "Gallery photo",
    subtitle: photo.subtitle || metadata.subtitle || "",
    by:
      photo.photographer_name ||
      photo.photographer ||
      photo.by ||
      metadata.photographer ||
      "DJoz",
    url: photo.image_url,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Your session has expired");
  return {
    apikey: publicAnonKey,
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

export async function fetchSiteContent(): Promise<SiteContent> {
  let cloudGallery: GalleryItem[] = [];
  let cloudSettings: {
    audio_url?: string | null;
    background_music_url?: string | null;
    floating_video_url?: string | null;
    hero_headline?: string | null;
    hero_subtitle?: string | null;
  } | null = null;
  let releases: DiscographyRelease[] = [];

  const [settingsResult, galleryResult, releaseResult] = await Promise.all([
    supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("gallery_photos").select("*"),
    supabase
      .from("discography_releases")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("released_at", { ascending: false }),
  ]);

  if (settingsResult.error) throw settingsResult.error;
  if (galleryResult.error) throw galleryResult.error;
  if (releaseResult.error) throw releaseResult.error;

  if (Array.isArray(galleryResult.data)) {
    cloudGallery = (galleryResult.data as GalleryPhotoRow[]).map((photo) =>
      galleryPhotoToItem(photo),
    );
  }

  if (settingsResult.data) {
    cloudSettings = settingsResult.data as {
      audio_url?: string | null;
      background_music_url?: string | null;
      floating_video_url?: string | null;
      hero_headline?: string | null;
      hero_subtitle?: string | null;
    };
  }

  if (Array.isArray(releaseResult.data)) {
    releases = (releaseResult.data as DiscographyReleaseRow[]).map(
      discographyRowToRelease,
    );
  }

  // Retrieve items from IndexedDB and localStorage
  const idbGallery = await getAllGalleryFromDB();
  const localGallery = getGalleryItems();
  const galleryMap = new Map<string, GalleryItem>();

  // 1. Local storage items
  for (const item of localGallery) {
    if (item.url) galleryMap.set(item.id, item);
  }
  // 2. IndexedDB items (higher priority for local blobs)
  for (const item of idbGallery) {
    if (item.url) galleryMap.set(item.id, item);
  }
  // 3. Cloud items
  for (const item of cloudGallery) {
    if (item.url) galleryMap.set(item.id, item);
  }

  const mergedGallery = Array.from(galleryMap.values());
  const finalGallery =
    mergedGallery.length > 0 ? mergedGallery : defaultGalleryItems;

  // Resolve audio URL
  const rawAudio =
    cloudSettings?.background_music_url ?? cloudSettings?.audio_url ?? "";
  const isOldSample = rawAudio.includes("track-1791214624508.ogg");
  const idbAudio = await getMediaSettingFromDB("audio");
  const localAudio = getAudioUrl();
  const audioUrl =
    idbAudio ||
    (!isOldSample && normalizeAudioUrl(rawAudio)
      ? normalizeAudioUrl(rawAudio)
      : localAudio || DEFAULT_AUDIO_URL);

  // Resolve video URL
  const rawVideo = cloudSettings?.floating_video_url ?? "";
  const idbVideo = await getMediaSettingFromDB("video");
  const localVideo = getVideoUrl();
  const videoUrl = idbVideo || normalizeVideoUrl(rawVideo) || localVideo;

  return {
    gallery: finalGallery,
    remoteGallery: cloudGallery,
    settings: {
      audioUrl: audioUrl || DEFAULT_AUDIO_URL,
      videoUrl,
      heroHeadline: cloudSettings?.hero_headline?.trim() || "Feel the heart beats",
      heroSubtitle:
        cloudSettings?.hero_subtitle?.trim() || "Let the rhythm move through you.",
    },
    releases,
  };
}

export async function saveSiteSettings(settings: SiteSettings) {
  const { data, error } = await supabase
    .from("site_settings")
    .upsert(
      {
        id: 1,
        background_music_url: settings.audioUrl.trim(),
        floating_video_url: settings.videoUrl.trim(),
        hero_headline: settings.heroHeadline.trim(),
        hero_subtitle: settings.heroSubtitle.trim(),
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateGalleryItem(
  id: string,
  values: Pick<GalleryItem, "title" | "subtitle" | "by" | "url">,
) {
  const { data, error } = await supabase
    .from("gallery_photos")
    .update({
      image_url: values.url.trim(),
      title: values.title.trim(),
      subtitle: values.subtitle.trim(),
      photographer_name: values.by.trim(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return galleryPhotoToItem(data as GalleryPhotoRow);
}

export type DiscographyReleaseInput = Omit<DiscographyRelease, "id"> & {
  id?: string;
};

export async function saveDiscographyRelease(
  release: DiscographyReleaseInput,
) {
  const values = {
    release_title: release.releaseTitle.trim(),
    track_title: release.trackTitle.trim(),
    artist: release.artist.trim() || "DJoz",
    audio_url: release.audioUrl.trim(),
    release_url: release.releaseUrl.trim(),
    cover_art_url: release.coverArtUrl.trim(),
    released_at: release.releasedAt || null,
    sort_order: release.sortOrder,
  };
  const query = release.id
    ? supabase.from("discography_releases").update(values).eq("id", release.id)
    : supabase.from("discography_releases").insert(values);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return discographyRowToRelease(data as DiscographyReleaseRow);
}

export async function deleteDiscographyRelease(id: string) {
  const { error } = await supabase
    .from("discography_releases")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function uploadReleaseAsset(
  bucket: "music" | "photos",
  file: File,
) {
  if (file.size > MAX_MEDIA_FILE_SIZE) {
    throw new Error(`File exceeds the 500 MB limit (${formatBytes(file.size)}).`);
  }
  const objectPath = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const { publicUrl } = await uploadStorageMedia(bucket, file, {
    objectPath,
    contentType: file.type || undefined,
    upsert: false,
    cacheControl: "3600",
  });
  return publicUrl;
}

export async function uploadGalleryItem(formData: FormData): Promise<{ item: GalleryItem }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose an image first.");

  // If user didn't enter a title, use clean formatted file name
  const rawTitle = String(formData.get("title") ?? "").trim();
  const title =
    rawTitle ||
    file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ") ||
    "Memory photo";
  const subtitle = String(formData.get("subtitle") ?? "").trim();
  const photographer =
    String(formData.get("photographer") ?? "").trim() || "DJoz";
  const objectPath = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;

  // Optimize image for fast rendering and safe persistent storage
  const compressed = await compressImageFile(file);

  const { data: upload, error: uploadError } = await supabase.storage
    .from("photos")
    .upload(objectPath, compressed.blob, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage
    .from("photos")
    .getPublicUrl(upload.path);
  if (!publicUrlData.publicUrl) {
    throw new Error("Supabase Storage did not return a public image URL.");
  }

  const { data: row, error: insertError } = await supabase
    .from("gallery_photos")
    .insert({
      image_url: publicUrlData.publicUrl,
      title,
      subtitle,
      photographer_name: photographer,
    })
    .select("*")
    .single();
  if (insertError) {
    await supabase.storage.from("photos").remove([upload.path]);
    throw insertError;
  }

  const item = galleryPhotoToItem(row as GalleryPhotoRow);
  await saveGalleryItemToDB(item);
  const currentItems = getGalleryItems();
  saveGalleryItems([item, ...currentItems.filter((existing) => existing.id !== item.id)]);
  return { item };
}

export async function deleteGalleryItem(id: string) {
  const { error } = await supabase.from("gallery_photos").delete().eq("id", id);
  if (error) throw error;
  await deleteGalleryItemFromDB(id);
  saveGalleryItems(getGalleryItems().filter((photo) => photo.id !== id));
  return { success: true };
}

export async function uploadMedia(
  type: "music" | "video",
  file: File,
  onProgress?: UploadProgressCallback,
) {
  if (file.size > MAX_MEDIA_FILE_SIZE) {
    throw new Error(
      `File exceeds the 500 MB limit. Selected file is ${formatBytes(file.size)}.`,
    );
  }

  if (type === "music") {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["mp3", "wav", "ogg", "mpeg"].includes(extension)) {
      throw new Error("Choose an MP3, WAV, OGG, or MPEG audio file.");
    }

    const fileName = `track-${Date.now()}.${extension === "mpeg" ? "mp3" : extension}`;
    // Force audio/mpeg for mp3/mpeg so it doesn't get flagged as video/mpeg
    const contentType =
      extension === "mp3" || extension === "mpeg"
        ? "audio/mpeg"
        : extension === "wav"
          ? "audio/wav"
          : "audio/ogg";

    const { publicUrl } = await uploadStorageMedia("music", file, {
      objectPath: fileName,
      contentType,
      upsert: true,
      cacheControl: "3600",
      onProgress,
    });

    onProgress?.({
      percentage: 100,
      stage: "syncing",
      stageText: "Saving audio settings...",
      loaded: file.size,
      total: file.size,
    });

    const activeAudioUrl = publicUrl;
    const { error: settingsError } = await supabase
      .from("site_settings")
      .update({ background_music_url: activeAudioUrl })
      .eq("id", 1);
    if (settingsError) throw settingsError;
    saveAudioUrl(activeAudioUrl);
    await saveMediaSettingToDB("audio", activeAudioUrl);

    onProgress?.({
      percentage: 100,
      stage: "complete",
      stageText: "Music published successfully!",
      loaded: file.size,
      total: file.size,
    });

    return {
      settings: { audioUrl: activeAudioUrl, videoUrl: "" },
    };
  }

  if (type === "video") {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["mp4", "webm"].includes(extension)) {
      throw new Error("Choose an MP4 or WebM video file.");
    }

    const objectPath = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const contentType =
      file.type || (extension === "webm" ? "video/webm" : "video/mp4");

    const { publicUrl } = await uploadStorageMedia("videos", file, {
      objectPath,
      contentType,
      upsert: true,
      cacheControl: "3600",
      onProgress,
    });

    onProgress?.({
      percentage: 100,
      stage: "syncing",
      stageText: "Saving video settings...",
      loaded: file.size,
      total: file.size,
    });

    const activeVideoUrl = publicUrl;
    const { error: settingsError } = await supabase
      .from("site_settings")
      .update({ floating_video_url: activeVideoUrl })
      .eq("id", 1);
    if (settingsError) throw settingsError;
    saveVideoUrl(activeVideoUrl);
    await saveMediaSettingToDB("video", activeVideoUrl);

    onProgress?.({
      percentage: 100,
      stage: "complete",
      stageText: "Video published successfully!",
      loaded: file.size,
      total: file.size,
    });

    return {
      settings: { audioUrl: "", videoUrl: activeVideoUrl },
    };
  }

  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${apiBase}/media/${type}`, {
    method: "POST",
    headers: await authHeaders(),
    body: formData,
  });
  return parseResponse<{ settings: SiteSettings }>(response);
}
