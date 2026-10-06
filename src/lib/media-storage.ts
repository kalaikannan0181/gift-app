import type { GalleryItem } from "./gallery-storage";

const DB_NAME = "djoz_media_store";
const DB_VERSION = 1;

interface MediaRecord {
  id: string;
  type: "photo" | "audio" | "video";
  blob: Blob;
  name: string;
  mimeType: string;
  createdAt: number;
}

interface GalleryRecord extends GalleryItem {
  createdAt: number;
}

interface SiteRecord {
  key: string;
  value: string;
  createdAt: number;
}

const objectUrlCache = new Map<string, string>();

function getCachedUrl(id: string, blob: Blob): string {
  const existing = objectUrlCache.get(id);
  if (existing) return existing;
  const newUrl = URL.createObjectURL(blob);
  objectUrlCache.set(id, newUrl);
  return newUrl;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("media_blobs")) {
        db.createObjectStore("media_blobs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("gallery_records")) {
        db.createObjectStore("gallery_records", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("site_records")) {
        db.createObjectStore("site_records", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a media file Blob/File to persistent IndexedDB storage and returns a functional URL.
 */
export async function saveMediaBlob(
  id: string,
  type: "photo" | "audio" | "video",
  blob: Blob,
  name = "media_file",
): Promise<string> {
  try {
    const db = await openDB();
    const record: MediaRecord = {
      id,
      type,
      blob,
      name,
      mimeType: blob.type,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("media_blobs", "readwrite");
      const store = tx.objectStore("media_blobs");
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    return getCachedUrl(id, blob);
  } catch (err) {
    console.warn("Could not save blob to IndexedDB:", err);
    return URL.createObjectURL(blob);
  }
}

/**
 * Retrieves a persistent media blob by ID and generates an active URL.
 */
export async function getMediaBlobUrl(id: string): Promise<string | null> {
  try {
    const db = await openDB();
    const record = await new Promise<MediaRecord | undefined>((resolve, reject) => {
      const tx = db.transaction("media_blobs", "readonly");
      const store = tx.objectStore("media_blobs");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as MediaRecord | undefined);
      req.onerror = () => reject(req.error);
    });

    if (!record || !record.blob) return null;
    return getCachedUrl(id, record.blob);
  } catch {
    return null;
  }
}

/**
 * Saves a gallery item and its optional backing image blob to IndexedDB.
 */
export async function saveGalleryItemToDB(
  item: GalleryItem,
  originalBlob?: Blob,
): Promise<GalleryItem> {
  try {
    let finalUrl = item.url;
    if (originalBlob) {
      finalUrl = await saveMediaBlob(item.id, "photo", originalBlob, item.title);
    }

    const updatedItem: GalleryItem = { ...item, url: finalUrl };
    const db = await openDB();
    const record: GalleryRecord = {
      ...updatedItem,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("gallery_records", "readwrite");
      const store = tx.objectStore("gallery_records");
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    return updatedItem;
  } catch (err) {
    console.warn("Could not save gallery item to DB:", err);
    return item;
  }
}

/**
 * Reads all gallery items from IndexedDB, reconstructing active Blob URLs when needed.
 */
export async function getAllGalleryFromDB(): Promise<GalleryItem[]> {
  try {
    const db = await openDB();
    const records = await new Promise<GalleryRecord[]>((resolve, reject) => {
      const tx = db.transaction("gallery_records", "readonly");
      const store = tx.objectStore("gallery_records");
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as GalleryRecord[]) || []);
      req.onerror = () => reject(req.error);
    });

    if (!records || records.length === 0) return [];

    // Sort newest first
    records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Rehydrate blob URLs if they were local blobs
    const resolved: GalleryItem[] = [];
    for (const rec of records) {
      let activeUrl = rec.url;
      if (activeUrl.startsWith("blob:") || activeUrl.startsWith("local-media://")) {
        const reloadedUrl = await getMediaBlobUrl(rec.id);
        if (reloadedUrl) {
          activeUrl = reloadedUrl;
        }
      }
      resolved.push({
        id: rec.id,
        title: rec.title,
        subtitle: rec.subtitle,
        by: rec.by,
        url: activeUrl,
      });
    }

    return resolved;
  } catch {
    return [];
  }
}

/**
 * Removes a gallery item and its blob from IndexedDB.
 */
export async function deleteGalleryItemFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["gallery_records", "media_blobs"], "readwrite");
      tx.objectStore("gallery_records").delete(id);
      tx.objectStore("media_blobs").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    objectUrlCache.delete(id);
  } catch (err) {
    console.warn("Could not delete gallery item from DB:", err);
  }
}

/**
 * Saves a setting (audioUrl or videoUrl) and optional backing media blob to IndexedDB.
 */
export async function saveMediaSettingToDB(
  type: "audio" | "video",
  url: string,
  blob?: Blob,
): Promise<string> {
  try {
    let finalUrl = url;
    const mediaId = `setting_${type}`;
    if (blob) {
      finalUrl = await saveMediaBlob(mediaId, type, blob, `site_${type}`);
    }

    const db = await openDB();
    const record: SiteRecord = {
      key: type,
      value: finalUrl,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("site_records", "readwrite");
      const store = tx.objectStore("site_records");
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    return finalUrl;
  } catch (err) {
    console.warn(`Could not save ${type} setting to DB:`, err);
    return url;
  }
}

/**
 * Retrieves a media setting (audioUrl or videoUrl) from IndexedDB.
 */
export async function getMediaSettingFromDB(type: "audio" | "video"): Promise<string | null> {
  try {
    const mediaId = `setting_${type}`;
    const directBlobUrl = await getMediaBlobUrl(mediaId);
    if (directBlobUrl) return directBlobUrl;

    const db = await openDB();
    const record = await new Promise<SiteRecord | undefined>((resolve, reject) => {
      const tx = db.transaction("site_records", "readonly");
      const store = tx.objectStore("site_records");
      const req = store.get(type);
      req.onsuccess = () => resolve(req.result as SiteRecord | undefined);
      req.onerror = () => reject(req.error);
    });

    return record ? record.value : null;
  } catch {
    return null;
  }
}

/**
 * Compresses an image file for optimized web display and local storage safety.
 * Max dimension: 1280px, quality: 0.85. Typically produces 120KB-350KB output.
 */
export async function compressImageFile(
  file: File,
  maxDimension = 1280,
  quality = 0.85,
): Promise<{ blob: Blob; dataUrl: string }> {
  // If SVG or non-raster, return original as dataUrl
  if (file.type === "image/svg+xml") {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { blob: file, dataUrl };
  }

  return new Promise<{ blob: Blob; dataUrl: string }>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        // Fallback to original file
        const reader = new FileReader();
        reader.onload = () => resolve({ blob: file, dataUrl: reader.result as string });
        reader.readAsDataURL(file);
        return;
      }

      // Smooth resizing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(mimeType, quality);

      canvas.toBlob(
        (blob) => {
          resolve({
            blob: blob || file,
            dataUrl,
          });
        },
        mimeType,
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback
      const reader = new FileReader();
      reader.onload = () => resolve({ blob: file, dataUrl: reader.result as string });
      reader.onerror = () => resolve({ blob: file, dataUrl: "" });
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
}
