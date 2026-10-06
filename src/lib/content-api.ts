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
  validateMediaFile,
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

export function formatDatabaseError(
  error: unknown,
  context = "Database operation failed",
): string {
  if (!error) return `${context}: Unknown database error.`;
  if (typeof error === "string") return error;

  const err = error as {
    code?: string;
    message?: string;
    details?: string | null;
    hint?: string | null;
    status?: number;
    statusCode?: number | string;
  };

  const code = String(err.code || "").toUpperCase();
  const message =
    err.message || (error instanceof Error ? error.message : JSON.stringify(error));
  const lower = message.toLowerCase();

  // 1. RLS / 42501 or PostgREST row count error on mutation
  if (
    code === "42501" ||
    lower.includes("row-level security") ||
    lower.includes("violates row-level security") ||
    lower.includes("permission denied") ||
    (code === "PGRST116" && (lower.includes("0 rows") || lower.includes("coerce")))
  ) {
    return `Access Denied (RLS policy check failed): Your account lacks the 'admin' app_metadata role in Supabase Auth. Verify that user 'kalaikannan0181@gmail.com' has raw_app_meta_data = '{"role":"admin"}' in Supabase Auth, and sign out then back in to refresh your JWT admin claim. [Details: ${message}]`;
  }

  // 2. Table missing / 42P01
  if (
    code === "42P01" ||
    (lower.includes("does not exist") && lower.includes("relation"))
  ) {
    return `Database Table Missing (42P01): A required table does not exist in Supabase. Apply migration '20261006100000_admin_content.sql' in Supabase SQL editor. [Details: ${message}]`;
  }

  // 3. Column missing / 42703
  if (
    code === "42703" ||
    (lower.includes("column") && lower.includes("does not exist"))
  ) {
    return `Database Schema Column Missing (42703): Required column not found in table. Run migration '20261006100000_admin_content.sql' in Supabase. [Details: ${message}]`;
  }

  // 4. Session / JWT expired (PGRST301, 401, 403)
  if (
    code === "PGRST301" ||
    err.status === 401 ||
    lower.includes("jwt") ||
    lower.includes("session has expired") ||
    lower.includes("token is expired")
  ) {
    return `Admin Session Expired: Your Supabase session has expired. Please sign out and sign back in to renew your token. [Details: ${message}]`;
  }

  // 5. Network / connection
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("connection")
  ) {
    return `Network Error: Unable to reach the Supabase backend. Please check your network connection and verify VITE_SUPABASE_URL. [Details: ${message}]`;
  }

  const hint = err.hint ? ` (Hint: ${err.hint})` : "";
  const details = err.details ? ` [Details: ${err.details}]` : "";
  return `${context}: ${message}${hint}${details}`;
}

export { formatUploadError, formatBytes, MAX_MEDIA_FILE_SIZE, validateMediaFile };
export type { UploadProgressCallback, UploadProgressInfo } from "./storage-upload";

export type SiteSettings = {
  audioUrl: string;
  audioName: string;
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

function extractStorageObjectPath(fileUrl: string): string | null {
  if (!fileUrl) return null;

  try {
    const parsed = new URL(fileUrl);
    const path = parsed.pathname;
    if (!path.includes("/storage/v1/object/public/")) return null;

    const match = path.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
    if (!match) return null;

    const objectPath = decodeURIComponent(match[1]).replace(/^\/+/, "");
    return objectPath || null;
  } catch {
    return null;
  }
}

export async function deleteStorageObject(bucket: string, fileUrl: string) {
  if (!fileUrl) return;

  try {
    const parsed = new URL(fileUrl);
    const bucketSegment = parsed.pathname.split("/storage/v1/object/public/")[1]?.split("/")[0];
    if (!parsed.hostname.includes("supabase.co") || !bucketSegment || bucketSegment !== bucket) {
      return;
    }

    const objectPath = extractStorageObjectPath(fileUrl);
    if (!objectPath) return;

    const { error } = await supabase.storage.from(bucket).remove([objectPath]);
    if (error) {
      const message = (error as { message?: string }).message || "";
      if (!/not found|no such object|does not exist|object.*not.*exist/i.test(message)) {
        console.warn(`Unable to delete Supabase object from bucket "${bucket}":`, error);
      }
    }
  } catch {
    // Ignore external URLs or malformed paths.
  }
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
    background_music_name?: string | null;
    floating_video_url?: string | null;
    hero_headline?: string | null;
    hero_subtitle?: string | null;
  } | null = null;
  let releases: DiscographyRelease[] = [];

  const [settingsResult, galleryResult, releaseResult] = await Promise.all([
    supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("gallery_photos")
      .select("*")
      .order("created_at", { ascending: false }),
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
      background_music_name?: string | null;
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
      : localAudio || "");

  // Resolve video URL
  const rawVideo = cloudSettings?.floating_video_url ?? "";
  const idbVideo = await getMediaSettingFromDB("video");
  const localVideo = getVideoUrl();
  const videoUrl = idbVideo || normalizeVideoUrl(rawVideo) || localVideo;

  return {
    gallery: finalGallery,
    remoteGallery: cloudGallery,
    settings: {
      audioUrl: rawAudio ? (normalizeAudioUrl(rawAudio) || rawAudio) : (audioUrl || ""),
      audioName: cloudSettings?.background_music_name?.trim() || "",
      videoUrl: rawVideo ? (normalizeVideoUrl(rawVideo) || rawVideo) : (videoUrl || ""),
      heroHeadline: cloudSettings?.hero_headline?.trim() || "Feel the heart beats",
      heroSubtitle:
        cloudSettings?.hero_subtitle?.trim() || "Let the rhythm move through you.",
    },
    releases,
  };
}

export async function saveSiteSettings(settings: SiteSettings) {
  const previous = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
  const previousAudioUrl = previous.data?.background_music_url || "";
  const previousVideoUrl = previous.data?.floating_video_url || "";

  const nextAudioUrl = settings.audioUrl.trim();
  const nextVideoUrl = settings.videoUrl.trim();

  const { data, error } = await supabase
    .from("site_settings")
    .upsert(
      {
        id: 1,
        background_music_url: nextAudioUrl,
        background_music_name: settings.audioName.trim(),
        floating_video_url: nextVideoUrl,
        hero_headline: settings.heroHeadline.trim(),
        hero_subtitle: settings.heroSubtitle.trim(),
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();
  if (error) throw error;

  if (nextAudioUrl && nextAudioUrl !== previousAudioUrl) {
    saveAudioUrl(nextAudioUrl);
    void saveMediaSettingToDB("audio", nextAudioUrl);
  }
  if (nextVideoUrl && nextVideoUrl !== previousVideoUrl) {
    saveVideoUrl(nextVideoUrl);
    void saveMediaSettingToDB("video", nextVideoUrl);
  }

  if (previousAudioUrl && previousAudioUrl !== nextAudioUrl) {
    void deleteStorageObject("music", previousAudioUrl);
  }
  if (previousVideoUrl && previousVideoUrl !== nextVideoUrl) {
    void deleteStorageObject("videos", previousVideoUrl);
  }

  return data;
}

export async function saveAudioName(audioName: string) {
  const { error } = await supabase
    .from("site_settings")
    .upsert(
      { id: 1, background_music_name: audioName.trim() },
      { onConflict: "id" },
    );
  if (error) throw error;
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
  const item = galleryPhotoToItem(data as GalleryPhotoRow);
  void saveGalleryItemToDB(item);
  const currentItems = getGalleryItems();
  saveGalleryItems(currentItems.map((photo) => (photo.id === item.id ? item : photo)));
  return item;
}

export type DiscographyReleaseInput = Omit<DiscographyRelease, "id"> & {
  id?: string;
};

export async function saveDiscographyRelease(
  release: DiscographyReleaseInput,
) {
  const previousRelease = release.id
    ? await supabase.from("discography_releases").select("audio_url, cover_art_url").eq("id", release.id).maybeSingle()
    : null;

  const values = {
    release_title: release.releaseTitle.trim(),
    track_title: release.trackTitle.trim(),
    artist: release.artist.trim() || "DJoz",
    audio_url: release.audioUrl.trim(),
    release_url: release.releaseUrl.trim(),
    cover_art_url: release.coverArtUrl.trim(),
    released_at: release.releasedAt || null,
    sort_order: Number.isFinite(release.sortOrder) ? release.sortOrder : 0,
  };
  const query = release.id
    ? supabase.from("discography_releases").update(values).eq("id", release.id)
    : supabase.from("discography_releases").insert(values);
  const { data, error } = await query.select("*").single();
  if (error) throw error;

  const next = discographyRowToRelease(data as DiscographyReleaseRow);
  const previousAudio = previousRelease.data?.audio_url || "";
  const previousCover = previousRelease.data?.cover_art_url || "";

  if (previousAudio && previousAudio !== next.audioUrl) {
    void deleteStorageObject("music", previousAudio);
  }
  if (previousCover && previousCover !== next.coverArtUrl) {
    void deleteStorageObject("photos", previousCover);
  }

  return next;
}

export async function deleteDiscographyRelease(id: string) {
  const release = await supabase.from("discography_releases").select("audio_url, cover_art_url").eq("id", id).maybeSingle();
  if (release.error) throw release.error;

  const { data, error } = await supabase
    .from("discography_releases")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "Unable to delete release: permission denied by Row-Level Security (admin role required) or release not found.",
    );
  }

  if (release.data?.audio_url) {
    void deleteStorageObject("music", release.data.audio_url);
  }
  if (release.data?.cover_art_url) {
    void deleteStorageObject("photos", release.data.cover_art_url);
  }
}

export async function uploadReleaseAsset(
  bucket: "music" | "photos",
  file: File,
) {
  const validation = validateMediaFile(bucket, file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  const objectPath = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const { publicUrl } = await uploadStorageMedia(bucket, file, {
    objectPath,
    contentType: file.type || undefined,
    upsert: true,
    cacheControl: "3600",
  });
  return publicUrl;
}

export async function uploadGalleryItem(formData: FormData): Promise<{ item: GalleryItem }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose an image first.");

  const validation = validateMediaFile("photos", file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

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
  const contentType = compressed.blob.type || "image/jpeg";

  const { data: upload, error: uploadError } = await supabase.storage
    .from("photos")
    .upload(objectPath, compressed.blob, {
      contentType,
      upsert: true,
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
  const photo = await supabase.from("gallery_photos").select("image_url").eq("id", id).maybeSingle();
  if (photo.error) throw photo.error;

  const { data, error } = await supabase
    .from("gallery_photos")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "Unable to delete gallery photo: permission denied by Row-Level Security (admin role required) or photo not found.",
    );
  }

  if (photo.data?.image_url) {
    void deleteStorageObject("photos", photo.data.image_url);
  }

  await deleteGalleryItemFromDB(id);
  saveGalleryItems(getGalleryItems().filter((photo) => photo.id !== id));
  return { success: true };
}

export async function uploadMedia(
  type: "music" | "video",
  file: File,
  onProgress?: UploadProgressCallback,
  audioName?: string,
) {
  const validation = validateMediaFile(type === "music" ? "music" : "videos", file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (type === "music") {
    const extension = file.name.split(".").pop()?.toLowerCase() || "mp3";
    const displayName =
      audioName?.trim() || file.name.replace(/\.[^/.]+$/, "").trim();
    const fileName = `track-${Date.now()}.${extension === "mpeg" ? "mp3" : extension}`;
    let contentType = file.type || "audio/mpeg";
    if (extension === "mp3" || extension === "mpeg") contentType = "audio/mpeg";
    else if (extension === "wav") contentType = "audio/wav";
    else if (extension === "ogg") contentType = "audio/ogg";
    else if (extension === "m4a") contentType = "audio/mp4";

    const previousSettings = await supabase
      .from("site_settings")
      .select("background_music_url")
      .eq("id", 1)
      .maybeSingle();
    const previousUrl = previousSettings.data?.background_music_url || "";

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
      stageText: "Saving audio settings in Supabase...",
      loaded: file.size,
      total: file.size,
    });

    const activeAudioUrl = publicUrl;
    const { error: settingsError } = await supabase
      .from("site_settings")
      .upsert(
        {
          id: 1,
          background_music_url: activeAudioUrl,
          background_music_name: displayName,
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (settingsError) throw settingsError;
    saveAudioUrl(activeAudioUrl);
    await saveMediaSettingToDB("audio", activeAudioUrl);

    if (previousUrl && previousUrl !== activeAudioUrl) {
      void deleteStorageObject("music", previousUrl);
    }

    onProgress?.({
      percentage: 100,
      stage: "complete",
      stageText: "Music published successfully!",
      loaded: file.size,
      total: file.size,
    });

    return {
      settings: { audioUrl: activeAudioUrl, audioName: displayName, videoUrl: "" },
    };
  }

  if (type === "video") {
    const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const objectPath = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const contentType =
      file.type || (extension === "webm" ? "video/webm" : "video/mp4");

    const previousSettings = await supabase
      .from("site_settings")
      .select("floating_video_url")
      .eq("id", 1)
      .maybeSingle();
    const previousUrl = previousSettings.data?.floating_video_url || "";

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
      stageText: "Saving video settings in Supabase...",
      loaded: file.size,
      total: file.size,
    });

    const activeVideoUrl = publicUrl;
    const { error: settingsError } = await supabase
      .from("site_settings")
      .upsert(
        { id: 1, floating_video_url: activeVideoUrl },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (settingsError) throw settingsError;
    saveVideoUrl(activeVideoUrl);
    await saveMediaSettingToDB("video", activeVideoUrl);

    if (previousUrl && previousUrl !== activeVideoUrl) {
      void deleteStorageObject("videos", previousUrl);
    }

    onProgress?.({
      percentage: 100,
      stage: "complete",
      stageText: "Video published successfully!",
      loaded: file.size,
      total: file.size,
    });

    return {
      settings: { audioUrl: "", audioName: "", videoUrl: activeVideoUrl },
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
