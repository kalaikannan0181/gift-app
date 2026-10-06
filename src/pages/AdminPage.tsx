import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  deleteGalleryItem,
  fetchSiteContent,
  uploadGalleryItem,
  uploadMedia,
  formatBytes,
  formatUploadError,
  MAX_MEDIA_FILE_SIZE,
  type SiteSettings,
  type UploadProgressInfo,
} from "../lib/content-api";
import type { GalleryItem } from "../lib/gallery-storage";
import { getGalleryItems, defaultGalleryItems } from "../lib/gallery-storage";
import { supabase } from "../lib/supabase";

function AdminIcon({
  children,
  className = "h-5 w-5",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const icons = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 4 4 2-2 5 5" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="m17 10 4-2v8l-4-2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  arrow: <path d="m15 18-6-6 6-6" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
};

const emptySettings: SiteSettings = { audioUrl: "", videoUrl: "" };

type NoticeState = {
  text: string;
  isError: boolean;
};

type ActiveUploadProgress = UploadProgressInfo & {
  type: "music" | "video" | "photo";
};

export default function AdminPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<GalleryItem[]>(getGalleryItems);
  const [settings, setSettings] = useState<SiteSettings>(emptySettings);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicPreview, setMusicPreview] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [photographer, setPhotographer] = useState("");
  const [uploadProgress, setUploadProgress] =
    useState<ActiveUploadProgress | null>(null);

  const showNotice = (text: string, isError = false) => {
    setNotice({ text, isError });
  };

  const onSelectPhoto = (file: File | null) => {
    if (photoPreview) {
      try {
        URL.revokeObjectURL(photoPreview);
      } catch {
        // ignore
      }
    }
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }
    setPhotoFile(file);
    try {
      const preview = URL.createObjectURL(file);
      setPhotoPreview(preview);
    } catch {
      // ignore
    }
    if (!title.trim()) {
      const formatted = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/[-_]/g, " ")
        .trim();
      if (formatted) setTitle(formatted);
    }
  };

  const onSelectMusic = (file: File | null) => {
    if (musicPreview) {
      try {
        URL.revokeObjectURL(musicPreview);
      } catch {
        // ignore
      }
    }
    if (!file) {
      setMusicFile(null);
      setMusicPreview(null);
      return;
    }
    if (file.size > MAX_MEDIA_FILE_SIZE) {
      showNotice(`File exceeds 500 MB limit (${formatBytes(file.size)}).`, true);
      return;
    }
    setMusicFile(file);
    try {
      setMusicPreview(URL.createObjectURL(file));
    } catch {
      // ignore
    }
  };

  const onSelectVideo = (file: File | null) => {
    if (videoPreview) {
      try {
        URL.revokeObjectURL(videoPreview);
      } catch {
        // ignore
      }
    }
    if (!file) {
      setVideoFile(null);
      setVideoPreview(null);
      return;
    }
    if (file.size > MAX_MEDIA_FILE_SIZE) {
      showNotice(`File exceeds 500 MB limit (${formatBytes(file.size)}).`, true);
      return;
    }
    setVideoFile(file);
    try {
      setVideoPreview(URL.createObjectURL(file));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      if (musicPreview) URL.revokeObjectURL(musicPreview);
    };
  }, [photoPreview, videoPreview, musicPreview]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        navigate("/admin/login", { replace: true });
        return;
      }
      if (data.session.user.app_metadata?.role !== "admin") {
        await supabase.auth.signOut();
        navigate("/admin/login?error=unauthorized", { replace: true });
        return;
      }
      setEmail(data.session.user.email ?? "Admin");
      try {
        const content = await fetchSiteContent();
        if (!active) return;
        setPhotos(content.gallery);
        setSettings(content.settings);
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : "Unable to load data",
          true,
        );
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (!notice) return;
    // Keep error notices visible for 10 seconds for detailed reading, success for 3.6s
    const timeoutDuration = notice.isError ? 10000 : 3600;
    const timeout = window.setTimeout(() => setNotice(null), timeoutDuration);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const uploadSelectedMedia = async (type: "music" | "video") => {
    const file = type === "music" ? musicFile : videoFile;
    if (!file) {
      showNotice(`Choose a ${type} file first.`, true);
      return;
    }

    if (file.size > MAX_MEDIA_FILE_SIZE) {
      showNotice(
        `File exceeds 500 MB limit (${formatBytes(file.size)}). Please choose a file up to 500MB.`,
        true,
      );
      return;
    }

    setBusy(type);
    setUploadProgress({
      type,
      percentage: 1,
      stage: "preparing",
      stageText: "Initializing upload session...",
      loaded: 0,
      total: file.size,
    });

    try {
      const result = await uploadMedia(type, file, (progressInfo) => {
        setUploadProgress({
          type,
          ...progressInfo,
        });
      });

      setSettings((current) =>
        type === "video"
          ? { ...current, videoUrl: result.settings.videoUrl }
          : { ...current, audioUrl: result.settings.audioUrl },
      );

      if (type === "music") {
        setMusicFile(null);
        setMusicPreview(null);
      } else {
        setVideoFile(null);
        setVideoPreview(null);
      }

      showNotice(
        `${type === "music" ? "Music track" : "Featured video"} is now live (${formatBytes(file.size)}).`,
        false,
      );
    } catch (error) {
      const actionableError = formatUploadError(error);
      console.error(`Upload failed for ${type}:`, error);
      showNotice(actionableError, true);
    } finally {
      setBusy("");
      setUploadProgress(null);
    }
  };

  const handlePhotoUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!photoFile) {
      showNotice("Choose an image first.", true);
      return;
    }
    const derivedTitle =
      title.trim() ||
      photoFile.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ") ||
      "Memory photo";
    const formData = new FormData();
    formData.append("file", photoFile);
    formData.append("title", derivedTitle);
    formData.append("subtitle", subtitle);
    formData.append("photographer", photographer);
    setBusy("photo");
    try {
      const result = await uploadGalleryItem(formData);
      setPhotos((current) => [
        result.item,
        ...current.filter((photo) => photo.id !== result.item.id),
      ]);
      onSelectPhoto(null);
      setTitle("");
      setSubtitle("");
      setPhotographer("");
      showNotice("Memory uploaded and added to 3D gallery.", false);
    } catch (error) {
      const actionableError = formatUploadError(error);
      console.error("Photo upload error:", error);
      showNotice(actionableError, true);
    } finally {
      setBusy("");
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(id);
    try {
      await deleteGalleryItem(id);
      setPhotos((current) => current.filter((photo) => photo.id !== id));
      showNotice("Memory deleted.", false);
    } catch (error) {
      const actionableError = formatUploadError(error);
      console.error("Delete error:", error);
      showNotice(actionableError, true);
    } finally {
      setBusy("");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login", { replace: true });
  };

  if (loading) {
    return (
      <div
        className="route-fallback"
        role="status"
        aria-label="Loading dashboard"
      >
        <span />
      </div>
    );
  }

  return (
    <main className="admin-shell min-h-screen text-white">
      <aside className="admin-sidebar">
        <Link to="/" className="admin-logo">
          DJ<span>o</span>z
        </Link>
        <div className="admin-label">Workspace</div>
        <nav className="admin-nav" aria-label="Admin sections">
          <a href="#overview" className="active">
            <AdminIcon>{icons.grid}</AdminIcon>Dashboard
          </a>
          <a href="#gallery-settings">
            <AdminIcon>{icons.image}</AdminIcon>Gallery
          </a>
          <a href="#media-settings">
            <AdminIcon>{icons.music}</AdminIcon>Media
          </a>
        </nav>
        <Link to="/" className="admin-back">
          <AdminIcon className="h-4 w-4">{icons.arrow}</AdminIcon>
          Back to experience
        </Link>
      </aside>

      <section className="admin-main">
        <header className="admin-header" id="overview">
          <div>
            <p>DJoz control room</p>
            <h1>Site Dashboard</h1>
            <span>Signed in as {email}</span>
          </div>
          <div className="admin-header-actions">
            <Link to="/" className="admin-preview-button">
              View live page ↗
            </Link>
            <button className="admin-logout" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <div className="admin-stats">
          <article>
            <span>Gallery memories</span>
            <strong>{photos.length.toString().padStart(2, "0")}</strong>
            <small>Cloud-hosted cards</small>
          </article>
          <article>
            <span>Background music</span>
            <strong className="status-value">
              <i className={settings.audioUrl ? "online" : ""} />
              {settings.audioUrl ? "Live" : "Not set"}
            </strong>
            <small>Supabase Storage (streaming)</small>
          </article>
          <article>
            <span>Featured video</span>
            <strong className="status-value">
              <i className={settings.videoUrl ? "online" : ""} />
              {settings.videoUrl ? "Live" : "Not set"}
            </strong>
            <small>Supabase Storage (byte-range streaming)</small>
          </article>
        </div>

        <div className="admin-grid">
          <div className="admin-controls">
            {/* MUSIC SECTION */}
            <section className="admin-panel" id="media-settings">
              <div className="admin-panel-heading">
                <span className="admin-panel-icon">
                  <AdminIcon>{icons.music}</AdminIcon>
                </span>
                <div>
                  <h2>Background Music Track</h2>
                  <p>MP3, WAV, OGG or MPEG · Up to 500 MB (Resumable stream)</p>
                </div>
              </div>
              <label
                className={`admin-dropzone ${musicPreview ? "admin-dropzone-has-file" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = event.dataTransfer.files[0] ?? null;
                  onSelectMusic(dropped);
                }}
              >
                <input
                  type="file"
                  accept=".mp3,.wav,.ogg,.mpeg,audio/mpeg,audio/wav,audio/ogg"
                  onChange={(event) => {
                    onSelectMusic(event.target.files?.[0] ?? null);
                  }}
                />
                <AdminIcon>{icons.upload}</AdminIcon>
                <strong>
                  {musicFile
                    ? `${musicFile.name} (${formatBytes(musicFile.size)})`
                    : "Choose audio file"}
                </strong>
                <span>
                  Drop here or click to browse · Supports full-length 6-min audio
                </span>
              </label>

              {/* REAL-TIME PREVIEW OF SELECTED LOCAL AUDIO */}
              {musicPreview && (
                <div className="admin-selection-preview">
                  <div className="admin-preview-header">
                    <div className="admin-preview-tag">
                      <span className="admin-upload-dot" />
                      <span>Ready to publish · Selected track preview</span>
                    </div>
                    <button
                      type="button"
                      className="admin-clear-button"
                      onClick={() => onSelectMusic(null)}
                    >
                      Clear
                    </button>
                  </div>
                  <audio
                    className="admin-audio"
                    src={musicPreview}
                    controls
                    preload="auto"
                  />
                </div>
              )}

              {/* CURRENTLY PUBLISHED LIVE AUDIO */}
              {settings.audioUrl && !musicPreview && (
                <div className="admin-live-media">
                  <span className="admin-media-badge">Live background audio</span>
                  <audio
                    className="admin-audio"
                    src={settings.audioUrl}
                    preload="metadata"
                    controls
                  />
                </div>
              )}

              {/* REAL-TIME PROGRESS INDICATOR FOR AUDIO */}
              {uploadProgress && uploadProgress.type === "music" && (
                <div
                  className="admin-upload-card"
                  role="progressbar"
                  aria-valuenow={uploadProgress.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Audio upload progress"
                >
                  <div className="admin-upload-header">
                    <div className="admin-upload-stage">
                      <span className="admin-upload-dot" />
                      <span>{uploadProgress.stageText}</span>
                    </div>
                    <span className="admin-upload-pct">
                      {uploadProgress.percentage}%
                    </span>
                  </div>
                  <div className="admin-upload-track">
                    <div
                      className="admin-upload-fill"
                      style={{
                        width: `${Math.max(uploadProgress.percentage, 2)}%`,
                      }}
                    />
                  </div>
                  <div className="admin-upload-meta">
                    <span>
                      {formatBytes(uploadProgress.loaded)} /{" "}
                      {formatBytes(uploadProgress.total)}
                    </span>
                    {uploadProgress.speed && (
                      <span className="admin-upload-speed">
                        {uploadProgress.speed}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                className="admin-primary-button"
                onClick={() => uploadSelectedMedia("music")}
                disabled={
                  busy !== "" ||
                  !musicFile ||
                  musicFile.size > MAX_MEDIA_FILE_SIZE
                }
              >
                {busy === "music" && (
                  <span className="admin-spinner" aria-hidden="true" />
                )}
                {busy === "music"
                  ? uploadProgress?.stageText || "Uploading track…"
                  : "Upload and publish music"}
              </button>
            </section>

            {/* VIDEO SECTION */}
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <span className="admin-panel-icon">
                  <AdminIcon>{icons.video}</AdminIcon>
                </span>
                <div>
                  <h2>Floating video</h2>
                  <p>MP4 or WebM · Up to 500 MB (Resumable stream)</p>
                </div>
              </div>
              <label
                className={`admin-dropzone ${videoPreview ? "admin-dropzone-has-file" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = event.dataTransfer.files[0] ?? null;
                  onSelectVideo(dropped);
                }}
              >
                <input
                  type="file"
                  accept=".mp4,.webm,video/mp4,video/webm"
                  onChange={(event) => {
                    onSelectVideo(event.target.files?.[0] ?? null);
                  }}
                />
                <AdminIcon>{icons.upload}</AdminIcon>
                <strong>
                  {videoFile
                    ? `${videoFile.name} (${formatBytes(videoFile.size)})`
                    : "Choose video file"}
                </strong>
                <span>
                  Drop here or click to browse · Supports full-length 6-min video
                </span>
              </label>

              {/* REAL-TIME PREVIEW OF SELECTED LOCAL VIDEO */}
              {videoPreview && (
                <div className="admin-selection-preview">
                  <div className="admin-preview-header">
                    <div className="admin-preview-tag">
                      <span className="admin-upload-dot" />
                      <span>Ready to publish · Selected video preview</span>
                    </div>
                    <button
                      type="button"
                      className="admin-clear-button"
                      onClick={() => onSelectVideo(null)}
                    >
                      Clear
                    </button>
                  </div>
                  <video
                    className="admin-video-preview"
                    src={videoPreview}
                    preload="metadata"
                    playsInline
                    controls
                  />
                </div>
              )}

              {/* CURRENTLY PUBLISHED LIVE VIDEO */}
              {settings.videoUrl && !videoPreview && (
                <div className="admin-live-media">
                  <span className="admin-media-badge">Live published video</span>
                  <video
                    className="admin-video-preview"
                    src={settings.videoUrl}
                    preload="metadata"
                    playsInline
                    controls
                  />
                </div>
              )}

              {/* REAL-TIME PROGRESS INDICATOR FOR VIDEO */}
              {uploadProgress && uploadProgress.type === "video" && (
                <div
                  className="admin-upload-card"
                  role="progressbar"
                  aria-valuenow={uploadProgress.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Video upload progress"
                >
                  <div className="admin-upload-header">
                    <div className="admin-upload-stage">
                      <span className="admin-upload-dot" />
                      <span>{uploadProgress.stageText}</span>
                    </div>
                    <span className="admin-upload-pct">
                      {uploadProgress.percentage}%
                    </span>
                  </div>
                  <div className="admin-upload-track">
                    <div
                      className="admin-upload-fill"
                      style={{
                        width: `${Math.max(uploadProgress.percentage, 2)}%`,
                      }}
                    />
                  </div>
                  <div className="admin-upload-meta">
                    <span>
                      {formatBytes(uploadProgress.loaded)} /{" "}
                      {formatBytes(uploadProgress.total)}
                    </span>
                    {uploadProgress.speed && (
                      <span className="admin-upload-speed">
                        {uploadProgress.speed}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                className="admin-primary-button"
                onClick={() => uploadSelectedMedia("video")}
                disabled={
                  busy !== "" ||
                  !videoFile ||
                  videoFile.size > MAX_MEDIA_FILE_SIZE
                }
              >
                {busy === "video" && (
                  <span className="admin-spinner" aria-hidden="true" />
                )}
                {busy === "video"
                  ? uploadProgress?.stageText || "Uploading video…"
                  : "Upload and publish video"}
              </button>
            </section>

            {/* GALLERY SECTION */}
            <section className="admin-panel" id="gallery-settings">
              <div className="admin-panel-heading">
                <span className="admin-panel-icon">
                  <AdminIcon>{icons.image}</AdminIcon>
                </span>
                <div>
                  <h2>Add memory photo</h2>
                  <p>Upload a new carousel card</p>
                </div>
              </div>
              <form className="admin-form" onSubmit={handlePhotoUpload}>
                <label
                  className={`admin-dropzone ${photoPreview ? "admin-dropzone-has-file" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dropped = event.dataTransfer.files[0] ?? null;
                    onSelectPhoto(dropped);
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      onSelectPhoto(event.target.files?.[0] ?? null)
                    }
                  />
                  {photoPreview ? (
                    <div className="admin-dropzone-image-wrap">
                      <img
                        src={photoPreview}
                        alt="Selected memory preview"
                        className="admin-dropzone-image"
                      />
                      <div className="admin-dropzone-overlay">
                        <strong>{photoFile?.name}</strong>
                        <span>
                          {photoFile ? formatBytes(photoFile.size) : ""} · Click or drop to change
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <AdminIcon>{icons.upload}</AdminIcon>
                      <strong>Choose an image</strong>
                      <span>Drop here or click · JPG, PNG or WebP</span>
                    </>
                  )}
                </label>
                {photoPreview && (
                  <div className="admin-preview-actions">
                    <button
                      type="button"
                      className="admin-clear-button"
                      onClick={() => onSelectPhoto(null)}
                    >
                      Clear selected image
                    </button>
                  </div>
                )}
                <label className="admin-field">
                  <span>Memory title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Memory title (auto-fills from file name)"
                  />
                </label>
                <label className="admin-field">
                  <span>Subtitle</span>
                  <input
                    value={subtitle}
                    onChange={(event) => setSubtitle(event.target.value)}
                    placeholder="A moment suspended in color"
                  />
                </label>
                <label className="admin-field">
                  <span>Photographer</span>
                  <input
                    value={photographer}
                    onChange={(event) => setPhotographer(event.target.value)}
                    placeholder="Creator name (default: DJoz)"
                  />
                </label>
                {busy === "photo" && (
                  <div className="admin-upload-progress">
                    <span />
                  </div>
                )}
                <button
                  className="admin-primary-button"
                  type="submit"
                  disabled={busy !== "" || !photoFile}
                >
                  {busy === "photo" ? "Uploading…" : "Upload to 3D gallery"}
                </button>
              </form>
            </section>
          </div>

          <section className="admin-gallery-panel">
            <div className="admin-gallery-heading">
              <div>
                <p>Memory cards</p>
                <h2>Live gallery</h2>
              </div>
              <span>{photos.length} active</span>
            </div>
            {photos.length === 0 ? (
              <div className="admin-empty">
                <AdminIcon className="h-7 w-7">{icons.image}</AdminIcon>
                <h3>No cloud memories yet</h3>
                <p>Upload your first image using the form.</p>
              </div>
            ) : (
              <div className="admin-memory-grid">
                {photos.map((photo, index) => (
                  <article className="admin-memory-card" key={photo.id}>
                    <div className="admin-memory-image">
                      <img
                        src={photo.url}
                        alt={photo.title}
                        onError={(e) => {
                          const fallback = defaultGalleryItems[index % defaultGalleryItems.length]?.url;
                          if (fallback && e.currentTarget.src !== fallback) {
                            e.currentTarget.src = fallback;
                          }
                        }}
                      />
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <button
                        type="button"
                        disabled={busy !== ""}
                        onClick={() => handleDelete(photo.id)}
                        aria-label={`Delete ${photo.title}`}
                      >
                        <AdminIcon className="h-4 w-4">
                          {icons.trash}
                        </AdminIcon>
                      </button>
                    </div>
                    <div className="admin-memory-copy">
                      <h3>{photo.title}</h3>
                      <p>{photo.subtitle}</p>
                      <small>Photo by {photo.by}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      {/* ACTIONABLE NOTIFICATION TOAST */}
      {notice && (
        <aside
          className={`admin-notice is-visible ${notice.isError ? "is-error" : ""}`}
          role={notice.isError ? "alert" : "status"}
          aria-live="polite"
        >
          <div className="admin-notice-content">
            <span className="admin-notice-text">{notice.text}</span>
            <button
              type="button"
              className="admin-notice-close"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </aside>
      )}
    </main>
  );
}
