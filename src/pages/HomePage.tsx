import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  getAudioUrl,
  getVideoUrl,
  getGalleryItems,
  normalizeAudioUrl,
  defaultGalleryItems,
  type GalleryItem,
} from "../lib/gallery-storage";
import {
  fetchSiteContent,
  galleryPhotoToItem,
  type DiscographyRelease,
  type GalleryPhotoRow,
} from "../lib/content-api";
import { supabase } from "../lib/supabase";

const navigation = [
  "Home",
  "About",
  "Discography",
  "Tours",
  "Videos",
  "Pages",
  "Contact",
];

const waveBars = [
  18, 30, 22, 42, 55, 36, 67, 48, 28, 58, 76, 44, 62, 34, 52, 72, 46, 64,
  38, 56, 26, 48, 68, 40, 59, 32, 46, 24, 38, 18,
];

type IconProps = {
  name: string;
  className?: string;
  filled?: boolean;
};

function Icon({ name, className = "", filled = false }: IconProps) {
  const paths: Record<string, React.ReactNode> = {
    facebook: (
      <path d="M14 8h3V4h-3c-3.3 0-5 2-5 5v2H6v4h3v7h4v-7h3.2l.8-4h-4V9c0-.7.3-1 1-1Z" />
    ),
    twitter: (
      <path d="M20.8 7.1v.6c0 6.1-4.6 13.1-13.1 13.1-2.6 0-5-.8-7-2.1h1.1c2.2 0 4.1-.7 5.7-2a4.6 4.6 0 0 1-4.3-3.2 4.5 4.5 0 0 0 2.1-.1 4.6 4.6 0 0 1-3.7-4.5c.6.3 1.3.5 2.1.6a4.6 4.6 0 0 1-1.4-6.1 13.1 13.1 0 0 0 9.5 4.8 4.6 4.6 0 0 1 7.8-4.2c1-.2 1.9-.6 2.7-1a4.6 4.6 0 0 1-2 2.5c.9-.1 1.7-.3 2.5-.7-.6.9-1.2 1.6-2 2.3Z" />
    ),
    instagram: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.1" />
        <circle cx="17.4" cy="6.7" r="1" className="fill-current" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
      </>
    ),
    heart: (
      <path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z" />
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1.4" className="fill-current" />
        <circle cx="12" cy="12" r="1.4" className="fill-current" />
        <circle cx="19" cy="12" r="1.4" className="fill-current" />
      </>
    ),
    previous: (
      <>
        <path d="M6 5v14" />
        <path d="m19 6-10 6 10 6V6Z" className="fill-current" />
      </>
    ),
    next: (
      <>
        <path d="M18 5v14" />
        <path d="m5 6 10 6-10 6V6Z" className="fill-current" />
      </>
    ),
    play: <path d="m9 7 8 5-8 5V7Z" className="fill-current" />,
    pause: (
      <>
        <rect x="8" y="7" width="3" height="10" rx="1" className="fill-current" />
        <rect x="13" y="7" width="3" height="10" rx="1" className="fill-current" />
      </>
    ),
    equalizer: (
      <>
        <path d="M5 4v16M12 4v16M19 4v16" />
        <circle cx="5" cy="9" r="2" className="fill-[#262332] stroke-current" />
        <circle cx="12" cy="15" r="2" className="fill-[#262332] stroke-current" />
        <circle cx="19" cy="8" r="2" className="fill-[#262332] stroke-current" />
      </>
    ),
    star: (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    ),
    shuffle: (
      <>
        <path d="M4 7h2.5c4 0 7 10 11 10H20" />
        <path d="m17 14 3 3-3 3M4 17h2.5c1.5 0 2.8-1.4 4-3.2M14 7.8c1.2-.6 2.3-.8 3.5-.8H20" />
        <path d="m17 4 3 3-3 3" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function CircularGallery({
  isPlaying,
  items,
}: {
  isPlaying: boolean;
  items: GalleryItem[];
}) {
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let previousTime = performance.now();

    const rotate = (time: number) => {
      const delta = Math.min(time - previousTime, 40);
      previousTime = time;

      if (isPlaying) {
        rotationRef.current += delta * 0.0025;
        setRotation(rotationRef.current);
      }
      frameRef.current = requestAnimationFrame(rotate);
    };

    frameRef.current = requestAnimationFrame(rotate);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    const scrubRotation = (event: WheelEvent) => {
      if (!isPlaying) return;
      rotationRef.current += event.deltaY * 0.035;
      setRotation(rotationRef.current);
    };

    window.addEventListener("wheel", scrubRotation, { passive: true });
    return () => window.removeEventListener("wheel", scrubRotation);
  }, [isPlaying]);

  const anglePerItem = 360 / Math.max(items.length, 1);

  return (
    <div
      className={`gallery-layer ${isPlaying ? "is-visible" : ""}`}
      aria-hidden={!isPlaying}
    >
      <div className="gallery-heading">
        <p>Wild frequencies</p>
        <span>Scroll to move through the memories</span>
      </div>
      <div className="gallery-perspective">
        <div
          className="gallery-ring"
          style={{ transform: `rotateY(${rotation}deg)` }}
        >
          {items.map((item, index) => {
            const itemAngle = index * anglePerItem;
            const relativeAngle =
              ((itemAngle + rotation + 540) % 360) - 180;
            const depth = Math.abs(relativeAngle);
            const opacity = Math.max(0.3, 1 - depth / 180);
            const blur = Math.max(0, (depth - 45) / 80);

            return (
              <article
                key={item.id}
                className="gallery-card"
                style={
                  {
                    "--card-angle": `${itemAngle}deg`,
                    opacity,
                    filter: `blur(${blur.toFixed(2)}px)`,
                  } as React.CSSProperties
                }
              >
                <img
                  src={item.url}
                  alt={item.title}
                  width={340}
                  height={440}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const fallback = defaultGalleryItems[index % defaultGalleryItems.length]?.url;
                    if (fallback && e.currentTarget.src !== fallback) {
                      e.currentTarget.src = fallback;
                    }
                  }}
                />
                <div className="gallery-card-copy">
                  <h3>{item.title}</h3>
                  <p>{item.subtitle}</p>
                  <small>Photo by: {item.by}</small>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatMediaTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds <= 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function formatRemainingMediaTime(duration: number, currentTime: number): string {
  if (!duration || isNaN(duration) || !isFinite(duration) || duration <= 0) return "-00:00";
  const rem = Math.max(0, duration - currentTime);
  const mins = Math.floor(rem / 60);
  const secs = Math.floor(rem % 60);
  return `-${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function AudioPlayer({
  playing,
  isBuffering,
  currentTime,
  duration,
  trackTitle,
  artistName,
  onPlayingChange,
  audioError,
}: {
  playing: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  trackTitle: string;
  artistName: string;
  onPlayingChange: (playing: boolean) => void;
  audioError: string;
}) {
  const [liked, setLiked] = useState(false);
  const radius = 34;
  const circumference = 2 * Math.PI * radius; // ~213.63
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const strokeOffset = circumference - (progressRatio * circumference);

  return (
    <section
      className="player-card w-full max-w-97.5 rounded-[26px] border border-white/10 p-3.5"
      aria-label="Audio player"
    >
      <div className="visualizer relative flex h-31.5 items-center justify-center overflow-hidden rounded-[18px] px-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_105%,rgba(184,41,255,.18),transparent_50%)]" />
        <div className="relative flex h-20 w-full items-center justify-center gap-0.75">
          {waveBars.map((height, index) => (
            <span
              key={index}
              className={`wave-bar ${playing && !isBuffering ? "is-playing" : ""} ${playing && isBuffering ? "is-buffering" : ""}`}
              style={
                {
                  height: `${height}%`,
                  animationDelay: `${(index % 9) * -0.11}s`,
                  animationDuration: `${0.72 + (index % 6) * 0.08}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <div className="px-3 pb-1 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[14px] font-semibold tracking-[0.01em] text-white">
              {trackTitle}
            </h2>
            <p className="mt-1 text-[11px] tracking-wide text-white/42">
              {artistName}
            </p>
          </div>
          <div className="flex gap-1">
            <button
              className={`icon-button ${liked ? "text-fuchsia-400" : ""}`}
              onClick={() => setLiked(!liked)}
              aria-label={liked ? "Remove from favorites" : "Add to favorites"}
            >
              <Icon name="heart" className="h-4.5 w-4.5" filled={liked} />
            </button>
            <button className="icon-button" aria-label="More options">
              <Icon name="more" className="h-4.75 w-4.75" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="w-12 text-[10px] font-medium tracking-wider text-white/40">
            {formatMediaTime(currentTime)}
          </span>
          <div className="flex items-center gap-7">
            <button className="control-button" aria-label="Previous track">
              <Icon name="previous" className="h-5 w-5" />
            </button>

            <button
              className="play-button relative grid h-18.5 w-18.5 place-items-center rounded-full"
              onClick={() => onPlayingChange(!playing)}
              aria-label={
                isBuffering && playing
                  ? "Buffering audio stream..."
                  : playing
                    ? "Pause track"
                    : "Play track"
              }
            >
              <svg
                className={`progress-ring absolute inset-0 h-full w-full -rotate-90 ${playing && !isBuffering && duration <= 0 ? "is-playing" : ""}`}
                viewBox="0 0 74 74"
              >
                <circle
                  cx="37"
                  cy="37"
                  r="34"
                  fill="none"
                  stroke="rgba(255,255,255,.13)"
                  strokeWidth="1.2"
                />
                <circle
                  className="progress-ring-line"
                  cx="37"
                  cy="37"
                  r="34"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  style={
                    duration > 0
                      ? { strokeDashoffset: strokeOffset }
                      : undefined
                  }
                />
              </svg>
              <span className="grid h-13.5 w-13.5 place-items-center rounded-full bg-white text-[#261331] shadow-[0_0_28px_rgba(255,255,255,.18)]">
                {isBuffering && playing ? (
                  <span className="audio-buffering-spin" aria-hidden="true" />
                ) : (
                  <Icon
                    name={playing ? "pause" : "play"}
                    className="h-5.5 w-5.5"
                  />
                )}
              </span>
            </button>

            <button className="control-button" aria-label="Next track">
              <Icon name="next" className="h-5 w-5" />
            </button>
          </div>
          <span className="w-12 text-right text-[10px] font-medium tracking-wider text-white/40">
            {formatRemainingMediaTime(duration, currentTime)}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-center gap-9 border-t border-white/[0.07] pt-3">
          <button className="utility-button" aria-label="Equalizer settings">
            <Icon name="equalizer" className="h-4.25 w-4.25" />
          </button>
          <button className="utility-button" aria-label="Favorite track">
            <Icon name="star" className="h-4.25 w-4.25" />
          </button>
          <button className="utility-button" aria-label="Shuffle">
            <Icon name="shuffle" className="h-4.25 w-4.25" />
          </button>
        </div>
        {audioError && (
          <p className="audio-playback-error" role="status" aria-live="polite">
            {audioError}
          </p>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioBuffering, setIsAudioBuffering] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [galleryItems, setGalleryItems] =
    useState<GalleryItem[]>(getGalleryItems);
  const [releases, setReleases] = useState<DiscographyRelease[]>([]);
  const [audioUrl, setAudioUrl] = useState(getAudioUrl);
  const [videoUrl, setVideoUrl] = useState(getVideoUrl);
  const [heroHeadline, setHeroHeadline] = useState("Feel the heart beats");
  const [heroSubtitle, setHeroSubtitle] = useState("Let the rhythm move through you.");
  const [videoOpen, setVideoOpen] = useState(false);
  const [isVideoBuffering, setIsVideoBuffering] = useState(true);
  const [videoError, setVideoError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const featuredRelease = releases[0];
  const featuredAudioUrl = featuredRelease?.audioUrl || audioUrl || DEFAULT_AUDIO_URL;

  useEffect(() => {
    let active = true;
    let initialFetchComplete = false;
    let receivedMusicUpdate = false;
    let receivedVideoUpdate = false;
    let receivedSettingsUpdate = false;
    const pendingGalleryChanges: Array<
      | { type: "UPSERT"; item: GalleryItem }
      | { type: "DELETE"; id: string }
    > = [];
    const pendingReleaseChanges: Array<
      | { type: "UPSERT"; release: DiscographyRelease }
      | { type: "DELETE"; id: string }
    > = [];

    const channel = supabase
      .channel("public-media-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "site_settings",
          filter: "id=eq.1",
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          receivedMusicUpdate = true;
          receivedVideoUpdate = true;
          receivedSettingsUpdate = true;
          const settings = payload.new as {
            background_music_url?: string | null;
            floating_video_url?: string | null;
            hero_headline?: string | null;
            hero_subtitle?: string | null;
          };
          setAudioUrl(normalizeAudioUrl(settings.background_music_url ?? ""));
          setAudioError("");
          setVideoUrl(settings.floating_video_url ?? "");
          setHeroHeadline(settings.hero_headline?.trim() || "Feel the heart beats");
          setHeroSubtitle(settings.hero_subtitle?.trim() || "Let the rhythm move through you.");
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gallery_photos" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = String(payload.old.id);
            if (!initialFetchComplete) pendingGalleryChanges.push({ type: "DELETE", id });
            setGalleryItems((current) => current.filter((photo) => photo.id !== id));
            return;
          }
          const item = galleryPhotoToItem(payload.new as GalleryPhotoRow);
          if (!initialFetchComplete) pendingGalleryChanges.push({ type: "UPSERT", item });
          setGalleryItems((current) => {
            const exists = current.some((photo) => photo.id === item.id);
            if (exists) {
              return current.map((photo) => (photo.id === item.id ? item : photo));
            }
            return [item, ...current];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "discography_releases" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = String(payload.old.id);
            if (!initialFetchComplete) pendingReleaseChanges.push({ type: "DELETE", id });
            setReleases((current) => current.filter((release) => release.id !== id));
            return;
          }
          const row = payload.new as {
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
          const release: DiscographyRelease = {
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
          if (!initialFetchComplete) {
            pendingReleaseChanges.push({ type: "UPSERT", release });
          }
          setReleases((current) =>
            [release, ...current.filter((item) => item.id !== release.id)].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            ),
          );
        },
      )
      .subscribe();

    void fetchSiteContent()
      .then((content) => {
        if (!active) return;
        let initialGallery = content.gallery.length
          ? content.gallery
          : getGalleryItems();
        for (const change of pendingGalleryChanges) {
          if (change.type === "UPSERT") {
            initialGallery = [
              change.item,
              ...initialGallery.filter((photo) => photo.id !== change.item.id),
            ];
          } else {
            initialGallery = initialGallery.filter((photo) => photo.id !== change.id);
          }
        }
        setGalleryItems(initialGallery);
        let initialReleases = content.releases;
        for (const change of pendingReleaseChanges) {
          if (change.type === "UPSERT") {
            initialReleases = [
              change.release,
              ...initialReleases.filter((item) => item.id !== change.release.id),
            ];
          } else {
            initialReleases = initialReleases.filter((item) => item.id !== change.id);
          }
        }
        setReleases(initialReleases.sort((left, right) => left.sortOrder - right.sortOrder));
        if (!receivedMusicUpdate) {
          setAudioUrl(normalizeAudioUrl(content.settings.audioUrl));
        }
        if (!receivedVideoUpdate) {
          setVideoUrl(content.settings.videoUrl || getVideoUrl());
        }
        if (!receivedSettingsUpdate) {
          setHeroHeadline(content.settings.heroHeadline);
          setHeroSubtitle(content.settings.heroSubtitle);
        }
      })
      .catch(() => {
        // Keep the local/default experience available while cloud content is unavailable.
      })
      .finally(() => {
        initialFetchComplete = true;
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const audio = audioRef.current;
    if (!featuredAudioUrl) {
      audio?.pause();
      setAudioError("");
      return;
    }
    if (!audio) return;

    if (isPlaying) {
      void audio
        .play()
        .then(() => {
          if (active) setAudioError("");
        })
        .catch(() => {
          if (active) {
            setAudioError("Audio unavailable. Check the published audio URL.");
          }
        });
    } else {
      audio.pause();
    }
    return () => {
      active = false;
    };
  }, [featuredAudioUrl, isPlaying]);

  return (
    <main
      className={`page-shell relative min-h-screen overflow-x-hidden text-white ${isPlaying ? "is-playing" : ""}`}
    >
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />
      <div className="venue-lighting" aria-hidden="true">
        <span className="spotlight spotlight-left" />
        <span className="spotlight spotlight-center" />
        <span className="spotlight spotlight-right" />
        <span className="stage-glow stage-glow-left" />
        <span className="stage-glow stage-glow-right" />
        <span className="fog fog-one" />
        <span className="fog fog-two" />
        <span className="fog fog-three" />
      </div>
      <div className="noise" />
      <CircularGallery isPlaying={isPlaying} items={galleryItems} />
      {featuredAudioUrl && (
        <audio
          key={featuredAudioUrl}
          ref={audioRef}
          src={featuredAudioUrl}
          preload="none"
          onEnded={() => {
            setIsPlaying(false);
            setIsAudioBuffering(false);
          }}
          onWaiting={() => setIsAudioBuffering(true)}
          onStalled={() => setIsAudioBuffering(true)}
          onSeeking={() => setIsAudioBuffering(true)}
          onSeeked={() => setIsAudioBuffering(false)}
          onCanPlay={() => setIsAudioBuffering(false)}
          onCanPlayThrough={() => setIsAudioBuffering(false)}
          onPlaying={() => setIsAudioBuffering(false)}
          onPause={() => setIsAudioBuffering(false)}
          onTimeUpdate={() => {
            if (audioRef.current) {
              setAudioCurrentTime(audioRef.current.currentTime);
            }
          }}
          onLoadedMetadata={() => {
            if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
              setAudioDuration(audioRef.current.duration);
            }
          }}
          onError={() => {
            setIsAudioBuffering(false);
            setAudioError(
              "Audio stream unavailable. Check the published audio URL.",
            );
          }}
        />
      )}

      <header className="header-shell relative z-20 mx-auto w-full max-w-360 px-6 sm:px-10 lg:px-16">
        <a href="#" className="logo text-3xl font-bold tracking-[-0.06em]">
          DJ<span>o</span>z
        </a>

        <nav
          className="main-nav"
          aria-label="Main navigation"
        >
          {navigation.map((item, index) => (
            <a
              key={item}
              href={
                item === "Pages" ? "/admin/login" : `#${item.toLowerCase()}`
              }
              className={`nav-link ${index === 0 ? "active" : ""}`}
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Link to="/admin/login" className="admin-entry-link">
            Admin
          </Link>
          {["facebook", "twitter", "instagram", "globe"].map((social) => (
            <a
              key={social}
              href="#"
              className="social-link"
              aria-label={social}
            >
              <Icon name={social} className="h-3.75 w-3.75" />
            </a>
          ))}
        </div>
      </header>

      <div className="hero-content relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 pb-10 pt-5 text-center sm:pt-9">
        <p className="eyebrow mb-1.5">New sounds - New emotion</p>
        <h1 className="hero-title text-[58px] leading-[1.05] sm:text-[78px] md:text-[92px]">
          {heroHeadline}
        </h1>
        <p className="mt-3 max-w-md text-[12px] leading-6 tracking-[0.035em] text-white/52 sm:text-[13px]">
          {heroSubtitle}
        </p>
        <div className="mt-7 w-full sm:mt-8">
          <AudioPlayer
            playing={isPlaying}
            isBuffering={isAudioBuffering}
            currentTime={audioCurrentTime}
            duration={audioDuration}
            trackTitle={featuredRelease?.trackTitle || "DJoz"}
            artistName={featuredRelease?.artist || "Featured track"}
            audioError={audioError}
            onPlayingChange={(playing) => {
              setAudioError("");
              setIsPlaying(playing);
            }}
          />
        </div>
      </div>

      <section className="discography-section relative z-10 mx-auto w-full max-w-6xl px-6 pb-28 pt-8 sm:px-10" id="discography">
        <div className="discography-heading">
          <p>Discography</p>
          <span>Selected releases</span>
        </div>
        {releases.length ? (
          <div className="public-release-grid">
            {releases.map((release) => (
              <article className="public-release-card" key={release.id}>
                {release.coverArtUrl ? (
                  <img
                    src={release.coverArtUrl}
                    alt={`${release.releaseTitle} cover artwork`}
                    width={480}
                    height={480}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="public-release-art-placeholder" aria-hidden="true">
                    <Icon name="music" className="h-8 w-8" />
                  </div>
                )}
                <div className="public-release-copy">
                  <p>{release.releaseTitle}</p>
                  <h2>{release.trackTitle}</h2>
                  <span>{release.artist}{release.releasedAt ? ` · ${release.releasedAt.slice(0, 4)}` : ""}</span>
                  {release.releaseUrl && (
                    <a href={release.releaseUrl} target="_blank" rel="noreferrer">
                      Listen / buy ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="discography-empty">New releases will appear here.</p>
        )}
      </section>

      <button
        className="floating-video-button"
        onClick={() => {
          setIsVideoBuffering(true);
          setVideoError("");
          setVideoOpen(true);
        }}
        aria-label="Open featured video"
      >
        <span>
          <Icon name="play" className="h-4 w-4" />
        </span>
        Watch the story
      </button>

      {videoOpen && (
        <div
          className="video-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Featured video"
          onClick={() => {
            if (videoRef.current) videoRef.current.pause();
            setVideoOpen(false);
            setIsVideoBuffering(false);
            setVideoError("");
          }}
        >
          <button
            className="video-modal-close"
            onClick={() => {
              if (videoRef.current) videoRef.current.pause();
              setVideoOpen(false);
              setIsVideoBuffering(false);
              setVideoError("");
            }}
            aria-label="Close video"
          >
            ×
          </button>
          <div
            className="video-modal-content"
            onClick={(event) => event.stopPropagation()}
          >
            {videoUrl ? (
              <div className="relative w-full h-full">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="none"
                  onLoadStart={() => setIsVideoBuffering(true)}
                  onWaiting={() => setIsVideoBuffering(true)}
                  onSeeking={() => setIsVideoBuffering(true)}
                  onSeeked={() => setIsVideoBuffering(false)}
                  onCanPlay={() => setIsVideoBuffering(false)}
                  onLoadedData={() => setIsVideoBuffering(false)}
                  onPlaying={() => setIsVideoBuffering(false)}
                  onError={() => {
                    setIsVideoBuffering(false);
                    setVideoError(
                      "Video stream temporarily unavailable. Check your network or the published video URL.",
                    );
                  }}
                />
                {isVideoBuffering && !videoError && (
                  <div
                    className="video-buffering-overlay"
                    role="status"
                    aria-label="Buffering video stream"
                  >
                    <span className="media-buffering-spinner" aria-hidden="true" />
                    <p>Buffering high-res stream...</p>
                  </div>
                )}
                {videoError && (
                  <div className="video-error-overlay" role="alert">
                    <p>{videoError}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setVideoError("");
                        setIsVideoBuffering(true);
                        if (videoRef.current) {
                          videoRef.current.load();
                          void videoRef.current.play().catch(() => {});
                        }
                      }}
                    >
                      Retry playback
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="video-empty-state">
                <span>Featured video</span>
                <h2>Your story is ready for its first scene.</h2>
                <p>Upload an MP4 or WebM from the admin dashboard to publish it here.</p>
                <Link to="/admin/login">Open admin login</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
