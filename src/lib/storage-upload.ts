import * as tus from "tus-js-client";
import { projectId, publicAnonKey } from "../../utils/supabase/info";
import { supabase } from "./supabase";

export type UploadStage =
  | "idle"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "syncing"
  | "complete";

export type UploadProgressInfo = {
  percentage: number;
  stage: UploadStage;
  stageText: string;
  loaded: number;
  total: number;
  speed?: string;
};

export type UploadProgressCallback = (info: UploadProgressInfo) => void;

export type UploadMediaOptions = {
  objectPath?: string;
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
  onProgress?: UploadProgressCallback;
};

// Maximum supported media file size (500 MB)
export const MAX_MEDIA_FILE_SIZE = 500 * 1024 * 1024;
// Threshold above which chunked/resumable TUS upload is required (6 MB)
export const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatUploadError(error: unknown): string {
  if (!error) return "Unknown error occurred during media upload.";

  if (typeof error === "string") {
    return error;
  }

  const err = error as {
    status?: number;
    statusCode?: string | number;
    message?: string;
    error?: string;
    details?: string;
    originalError?: { status?: number; message?: string };
    responseText?: string;
  };

  const rawStatus =
    err.status ||
    (typeof err.statusCode === "number"
      ? err.statusCode
      : parseInt(String(err.statusCode || ""), 10)) ||
    err.originalError?.status;

  const rawMessage =
    err.message ||
    err.error ||
    err.details ||
    err.responseText ||
    (error instanceof Error ? error.message : JSON.stringify(error));

  const lower = rawMessage.toLowerCase();

  // 1. HTTP 413 / Payload Too Large
  if (
    rawStatus === 413 ||
    lower.includes("413") ||
    lower.includes("payload too large") ||
    lower.includes("entity too large") ||
    lower.includes("maximum allowed size")
  ) {
    return `Payload Too Large (HTTP 413): The file exceeds Supabase Storage's size limits. For full-length 6-minute files, please verify your Supabase Storage bucket size limit is configured to at least 500MB in the Supabase Dashboard. [Details: ${rawMessage}]`;
  }

  // 2. RLS / 401 / 403 / Row-level security permissions
  if (
    rawStatus === 401 ||
    rawStatus === 403 ||
    lower.includes("row-level security") ||
    lower.includes("rls") ||
    lower.includes("permission denied") ||
    lower.includes("unauthorized") ||
    lower.includes("jwt") ||
    lower.includes("token")
  ) {
    return `Access Denied (Storage RLS / Auth): Upload was blocked by Row-Level Security policies or your admin session expired. Please sign out, log back in, or check Storage bucket INSERT/UPDATE policies. [Details: ${rawMessage}]`;
  }

  // 3. Storage Bucket Not Found (404)
  if (
    rawStatus === 404 ||
    lower.includes("bucket not found") ||
    lower.includes("not found")
  ) {
    return `Storage Bucket Not Found (404): The destination bucket does not exist in your Supabase project. Verify the bucket exists and is public. [Details: ${rawMessage}]`;
  }

  // 4. Network Timeout / Connection reset
  if (
    lower.includes("timeout") ||
    lower.includes("aborterror") ||
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("connection reset")
  ) {
    return `Network / Timeout Error: Upload connection was interrupted. Please check your internet connectivity. If using resumable upload, retry will attempt to resume from the last saved chunk. [Details: ${rawMessage}]`;
  }

  return `Upload Failed: ${rawMessage}`;
}

async function getAuthToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || publicAnonKey;
  } catch {
    return publicAnonKey;
  }
}

/**
 * Resumable chunked upload using TUS protocol for large media files (up to 500MB).
 * Uploads in 6MB chunks to Supabase Storage with real-time percentage progress.
 */
function uploadViaTusResumable(
  bucket: string,
  objectPath: string,
  file: File,
  contentType: string,
  cacheControl: string,
  upsert: boolean,
  onProgress?: UploadProgressCallback,
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const token = await getAuthToken();
      let lastBytes = 0;
      let lastTime = performance.now();
      let currentSpeed = "";

      const upload = new tus.Upload(file, {
        endpoint: `https://${projectId}.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000],
        headers: {
          apikey: publicAnonKey,
          Authorization: `Bearer ${token}`,
          "x-upsert": String(upsert),
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: bucket,
          objectName: objectPath,
          contentType,
          cacheControl,
        },
        chunkSize: 6 * 1024 * 1024, // 6 MB chunks
        onError: (err) => {
          reject(err);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const now = performance.now();
          const timeElapsed = (now - lastTime) / 1000;
          if (timeElapsed >= 0.4) {
            const bytesDiff = bytesUploaded - lastBytes;
            const speedPerSec = bytesDiff / timeElapsed;
            currentSpeed = `${formatBytes(speedPerSec)}/s`;
            lastBytes = bytesUploaded;
            lastTime = now;
          }

          const pct = Math.min(
            99,
            Math.max(1, Math.round((bytesUploaded / bytesTotal) * 100)),
          );
          onProgress?.({
            percentage: pct,
            stage: "uploading",
            stageText: `Uploading media (${pct}%)...`,
            loaded: bytesUploaded,
            total: bytesTotal,
            speed: currentSpeed,
          });
        },
        onSuccess: () => {
          resolve();
        },
      });

      // Resume from previous upload if available
      upload
        .findPreviousUploads()
        .then((previousUploads) => {
          if (previousUploads.length > 0) {
            upload.resumeFromPreviousUpload(previousUploads[0]);
          }
          upload.start();
        })
        .catch(() => {
          upload.start();
        });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Standard upload with XMLHttpRequest for files <= 6MB, providing real-time progress events.
 */
function uploadViaStandardXhr(
  bucket: string,
  objectPath: string,
  file: File,
  contentType: string,
  cacheControl: string,
  upsert: boolean,
  onProgress?: UploadProgressCallback,
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const token = await getAuthToken();
      const xhr = new XMLHttpRequest();
      const cleanPath = objectPath.replace(/^\/+/, "");
      xhr.open(
        "POST",
        `https://${projectId}.supabase.co/storage/v1/object/${bucket}/${cleanPath}`,
      );

      xhr.setRequestHeader("apikey", publicAnonKey);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("x-upsert", String(upsert));
      xhr.setRequestHeader("cache-control", `max-age=${cacheControl}`);
      xhr.setRequestHeader("content-type", contentType);

      let lastBytes = 0;
      let lastTime = performance.now();
      let currentSpeed = "";

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const now = performance.now();
          const timeElapsed = (now - lastTime) / 1000;
          if (timeElapsed >= 0.3) {
            const bytesDiff = event.loaded - lastBytes;
            const speedPerSec = bytesDiff / timeElapsed;
            currentSpeed = `${formatBytes(speedPerSec)}/s`;
            lastBytes = event.loaded;
            lastTime = now;
          }

          const pct = Math.min(
            99,
            Math.max(1, Math.round((event.loaded / event.total) * 100)),
          );
          onProgress?.({
            percentage: pct,
            stage: "uploading",
            stageText: `Uploading media (${pct}%)...`,
            loaded: event.loaded,
            total: event.total,
            speed: currentSpeed,
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          let parsedMessage = xhr.statusText;
          try {
            const parsed = JSON.parse(xhr.responseText);
            parsedMessage =
              parsed.message || parsed.error || parsed.error_description || xhr.statusText;
          } catch {
            // retain statusText
          }
          reject({
            status: xhr.status,
            message: parsedMessage,
            responseText: xhr.responseText,
          });
        }
      };

      xhr.onerror = () => {
        reject(
          new Error("Network connection error during file upload. Check your connection."),
        );
      };

      xhr.ontimeout = () => {
        reject(new Error("Upload request timed out. Please retry."));
      };

      xhr.send(file);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Universal media upload function:
 * - Supports large files up to 500MB
 * - Automatically selects TUS resumable chunked upload if file > 6MB
 * - Uses standard upload with progress if file <= 6MB
 * - Sets upsert: true and cacheControl: '3600'
 * - Emits staged progress indicators
 * - Returns the Supabase public storage URL
 */
export async function uploadStorageMedia(
  bucket: "music" | "videos" | "photos",
  file: File,
  options: UploadMediaOptions = {},
): Promise<{ objectPath: string; publicUrl: string }> {
  // 1. Validation
  if (file.size > MAX_MEDIA_FILE_SIZE) {
    throw new Error(
      `File size exceeds 500 MB limit. Selected file is ${formatBytes(file.size)}.`,
    );
  }

  const {
    cacheControl = "3600",
    upsert = true,
    onProgress,
  } = options;

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  let defaultContentType = file.type;
  if (!defaultContentType) {
    if (extension === "mp3") defaultContentType = "audio/mpeg";
    else if (extension === "wav") defaultContentType = "audio/wav";
    else if (extension === "ogg") defaultContentType = "audio/ogg";
    else if (extension === "mp4") defaultContentType = "video/mp4";
    else if (extension === "webm") defaultContentType = "video/webm";
    else defaultContentType = "application/octet-stream";
  }

  const contentType = options.contentType || defaultContentType;
  const cleanName = file.name.replace(/[^\w.-]/g, "_");
  const objectPath =
    options.objectPath || `${crypto.randomUUID()}-${cleanName}`;

  // Stage 1: Preparing
  onProgress?.({
    percentage: 1,
    stage: "preparing",
    stageText: "Preparing media upload...",
    loaded: 0,
    total: file.size,
  });

  // Stage 2: Uploading (TUS resumable for >6MB, XHR for <=6MB)
  if (file.size > RESUMABLE_UPLOAD_THRESHOLD) {
    try {
      await uploadViaTusResumable(
        bucket,
        objectPath,
        file,
        contentType,
        cacheControl,
        upsert,
        onProgress,
      );
    } catch (tusError) {
      console.warn(
        "TUS resumable upload encountered an issue, attempting standard storage upload fallback:",
        tusError,
      );
      // Fallback to standard Supabase upload if TUS is blocked by proxy
      const { error: fallbackError } = await supabase.storage
        .from(bucket)
        .upload(objectPath, file, {
          contentType,
          cacheControl,
          upsert,
        });
      if (fallbackError) {
        throw fallbackError;
      }
    }
  } else {
    try {
      await uploadViaStandardXhr(
        bucket,
        objectPath,
        file,
        contentType,
        cacheControl,
        upsert,
        onProgress,
      );
    } catch (xhrError) {
      console.warn(
        "XHR upload failed, attempting Supabase SDK upload fallback:",
        xhrError,
      );
      const { error: fallbackError } = await supabase.storage
        .from(bucket)
        .upload(objectPath, file, {
          contentType,
          cacheControl,
          upsert,
        });
      if (fallbackError) {
        throw fallbackError;
      }
    }
  }

  // Stage 3: Finalizing public URL
  onProgress?.({
    percentage: 99,
    stage: "finalizing",
    stageText: "Finalizing public URL...",
    loaded: file.size,
    total: file.size,
  });

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(objectPath);

  const publicUrl = publicUrlData.publicUrl;

  return { objectPath, publicUrl };
}
