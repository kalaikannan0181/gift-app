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
import { apiBase, supabase } from "./supabase";
import { publicAnonKey } from "../../utils/supabase/info";
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
  audioPath?: string;
  videoPath?: string;
};

export type SiteContent = {
  gallery: GalleryItem[];
  settings: SiteSettings;
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
  } | null = null;

  try {
    const [settingsResult, galleryResult] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("gallery_photos").select("*"),
    ]);

    if (!galleryResult.error && Array.isArray(galleryResult.data)) {
      cloudGallery = (galleryResult.data as GalleryPhotoRow[]).map((photo) =>
        galleryPhotoToItem(photo),
      );
    }

    if (!settingsResult.error && settingsResult.data) {
      cloudSettings = settingsResult.data as {
        audio_url?: string | null;
        background_music_url?: string | null;
        floating_video_url?: string | null;
      };
    }
  } catch (err) {
    console.warn("Unable to fetch remote content from Supabase:", err);
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
    settings: {
      audioUrl: audioUrl || DEFAULT_AUDIO_URL,
      videoUrl,
    },
  };
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

  let finalUrl = "";

  // 1. Try uploading to Supabase Storage & Database
  try {
    const { data: upload, error: uploadError } = await supabase.storage
      .from("photos")
      .upload(objectPath, compressed.blob, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "3600",
      });

    if (!uploadError && upload) {
      const { data: publicUrlData } = supabase.storage
        .from("photos")
        .getPublicUrl(upload.path);

      if (publicUrlData?.publicUrl) {
        finalUrl = publicUrlData.publicUrl;
        await supabase.from("gallery_photos").insert({
          image_url: finalUrl,
          title,
          subtitle,
          photographer_name: photographer,
        });
      }
    }
  } catch (err) {
    console.warn("Supabase photo upload encountered error, falling back to local storage:", err);
  }

  // 2. If cloud upload was not possible (e.g. RLS / offline), use local data/blob URL
  if (!finalUrl) {
    finalUrl = compressed.dataUrl || URL.createObjectURL(compressed.blob);
  }

  const newItem: GalleryItem = {
    id: `photo-${Date.now()}`,
    title,
    subtitle,
    by: photographer,
    url: finalUrl,
  };

  // 3. Save to IndexedDB (survives refreshes, full storage quota)
  const savedItem = await saveGalleryItemToDB(newItem, compressed.blob);

  // 4. Save to localStorage with quota protection
  const currentItems = getGalleryItems();
  const updatedItems = [savedItem, ...currentItems.filter((item) => item.id !== savedItem.id)];
  saveGalleryItems(updatedItems);

  return { item: savedItem };
}

export async function deleteGalleryItem(id: string) {
  // Remove from IndexedDB
  await deleteGalleryItemFromDB(id);

  // Remove from local storage
  const currentItems = getGalleryItems();
  const updatedItems = currentItems.filter((photo) => photo.id !== id);
  saveGalleryItems(updatedItems);

  // Also try deleting from Supabase
  try {
    await supabase.from("gallery_photos").delete().eq("id", id);
  } catch {
    // Continue even if Supabase delete fails
  }
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

    // 1. Save blob to IndexedDB so it's always locally accessible and persistent
    const localDbUrl = await saveMediaSettingToDB("audio", "", file);

    let publicUrl = "";
    try {
      const res = await uploadStorageMedia("music", file, {
        objectPath: fileName,
        contentType,
        upsert: true,
        cacheControl: "3600",
        onProgress,
      });
      publicUrl = res.publicUrl;
    } catch (storageErr) {
      console.warn("Cloud storage upload failed, saving audio locally:", storageErr);
      publicUrl = localDbUrl || URL.createObjectURL(file);
    }

    onProgress?.({
      percentage: 100,
      stage: "syncing",
      stageText: "Saving audio settings...",
      loaded: file.size,
      total: file.size,
    });

    const activeAudioUrl = publicUrl || localDbUrl;
    saveAudioUrl(activeAudioUrl);
    await saveMediaSettingToDB("audio", activeAudioUrl, file);

    try {
      await supabase
        .from("site_settings")
        .update({
          background_music_url: activeAudioUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
    } catch (dbErr) {
      console.warn("Could not update site_settings table:", dbErr);
    }

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

    // 1. Save blob to IndexedDB so it's always locally accessible and persistent
    const localDbUrl = await saveMediaSettingToDB("video", "", file);

    let publicUrl = "";
    try {
      const res = await uploadStorageMedia("videos", file, {
        objectPath,
        contentType,
        upsert: true,
        cacheControl: "3600",
        onProgress,
      });
      publicUrl = res.publicUrl;
    } catch (storageErr) {
      console.warn("Cloud storage upload failed, saving video locally:", storageErr);
      publicUrl = localDbUrl || URL.createObjectURL(file);
    }

    onProgress?.({
      percentage: 100,
      stage: "syncing",
      stageText: "Saving video settings...",
      loaded: file.size,
      total: file.size,
    });

    const activeVideoUrl = publicUrl || localDbUrl;
    saveVideoUrl(activeVideoUrl);
    await saveMediaSettingToDB("video", activeVideoUrl, file);

    try {
      await supabase
        .from("site_settings")
        .update({
          floating_video_url: activeVideoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
    } catch (dbErr) {
      console.warn("Could not update site_settings table:", dbErr);
    }

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
