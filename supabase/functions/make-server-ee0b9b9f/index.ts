import { Hono, type Context } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const app = new Hono();
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

app.use("*", logger(console.log));
app.use(
  "/*",
  cors({
    origin: corsHeaders["Access-Control-Allow-Origin"],
    allowHeaders: ["authorization", "x-client-info", "apikey", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

async function isAdmin(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(token);
  return !error && data.user?.app_metadata?.role === "admin";
}

async function updateSettings(values: Record<string, string>) {
  const { data, error } = await supabase
    .from("site_settings")
    .update(values)
    .eq("id", 1)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No site_settings row exists with id 1.");
  return data;
}

function settingsResponse(settings: Record<string, string | null | undefined>) {
  const backgroundMusicUrl = settings.background_music_url ?? "";
  const floatingVideoUrl = settings.floating_video_url ?? "";
  return {
    background_music_url: backgroundMusicUrl,
    floating_video_url: floatingVideoUrl,
    settings: { audioUrl: backgroundMusicUrl, videoUrl: floatingVideoUrl },
  };
}

async function uploadFile(file: File, type: string) {
  const bucket = type === "photo" ? "photos" : type === "video" ? "videos" : "music";
  const fileName = file.name.replace(/[^\w.-]/g, "_");
  const path = `${crypto.randomUUID()}-${fileName}`;
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl;
}

async function createGalleryPhoto(
  imageUrl: string,
  title = "",
  photographerName = "",
) {
  const { data, error } = await supabase
    .from("gallery_photos")
    .insert({
      image_url: imageUrl,
      title,
      photographer_name: photographerName,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function publishMedia(
  type: string,
  url: string,
  title = "",
  photographerName = "",
) {
  if (type === "photo" || type === "photos") {
    return { item: await createGalleryPhoto(url, title, photographerName) };
  }
  if (type !== "music" && type !== "video") {
    throw new Error("Media type must be music, video, or photo.");
  }

  const settings = await updateSettings({
    [type === "music" ? "background_music_url" : "floating_video_url"]: url,
  });
  return settingsResponse(settings);
}

function normalizeMediaType(type: string) {
  if (type === "photos") return "photo";
  if (type === "videos") return "video";
  return type;
}

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/content", async (c) => {
  const { data, error } = await supabase
    .from("site_settings")
    .select("background_music_url, floating_video_url")
    .eq("id", 1)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(settingsResponse(data ?? {}));
});

app.post("/content", async (c) => {
  if (!(await isAdmin(c.req.header("Authorization")))) {
    return c.json({ error: "Admin access required." }, 401);
  }

  const body = await c.req.json<Record<string, unknown>>();
  const values: Record<string, string> = {};
  const backgroundMusicUrl = body.background_music_url ?? body.audioUrl;
  const floatingVideoUrl = body.floating_video_url ?? body.videoUrl;
  if (typeof backgroundMusicUrl === "string") {
    values.background_music_url = backgroundMusicUrl;
  }
  if (typeof floatingVideoUrl === "string") {
    values.floating_video_url = floatingVideoUrl;
  }
  if (Object.keys(values).length === 0) {
    return c.json({ error: "No valid settings were provided." }, 400);
  }

  try {
    return c.json(settingsResponse(await updateSettings(values)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update settings.";
    return c.json({ error: message }, 500);
  }
});

app.get("/gallery", async (c) => {
  const { data, error } = await supabase
    .from("gallery_photos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ items: data ?? [] });
});

app.post("/gallery", async (c) => {
  if (!(await isAdmin(c.req.header("Authorization")))) {
    return c.json({ error: "Admin access required." }, 401);
  }

  try {
    const contentType = c.req.header("Content-Type") ?? "";
    let imageUrl = "";
    let title = "";
    let photographerName = "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (file instanceof File) imageUrl = await uploadFile(file, "photo");
      title = String(formData.get("title") ?? "");
      photographerName = String(
        formData.get("photographer_name") ?? formData.get("photographer") ?? "",
      );
      imageUrl ||= String(formData.get("image_url") ?? "");
    } else {
      const body = await c.req.json<Record<string, unknown>>();
      imageUrl = typeof body.image_url === "string" ? body.image_url : "";
      title = typeof body.title === "string" ? body.title : "";
      photographerName =
        typeof body.photographer_name === "string" ? body.photographer_name : "";
    }
    if (!imageUrl) return c.json({ error: "An image file or image_url is required." }, 400);
    return c.json(
      { item: await createGalleryPhoto(imageUrl, title, photographerName) },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create gallery photo.";
    return c.json({ error: message }, 500);
  }
});

app.delete("/gallery/:id", async (c) => {
  if (!(await isAdmin(c.req.header("Authorization")))) {
    return c.json({ error: "Admin access required." }, 401);
  }
  const { error } = await supabase
    .from("gallery_photos")
    .delete()
    .eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

async function handleMedia(c: Context, routeType?: string) {
  if (!(await isAdmin(c.req.header("Authorization")))) {
    return c.json({ error: "Admin access required." }, 401);
  }

  try {
    const contentType = c.req.header("Content-Type") ?? "";
    let type = routeType ?? "";
    let url = "";
    let file: File | null = null;
    let title = "";
    let photographerName = "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      type ||= String(formData.get("type") ?? "");
      const formFile = formData.get("file");
      if (formFile instanceof File) file = formFile;
      url = String(formData.get("url") ?? "");
      title = String(formData.get("title") ?? "");
      photographerName = String(
        formData.get("photographer_name") ?? formData.get("photographer") ?? "",
      );
    } else {
      const body = await c.req.json<Record<string, unknown>>();
      type ||= typeof body.type === "string" ? body.type : "";
      url = typeof body.url === "string" ? body.url : "";
      title = typeof body.title === "string" ? body.title : "";
      photographerName =
        typeof body.photographer_name === "string" ? body.photographer_name : "";
    }

    type = normalizeMediaType(type);
    if (!file && !url) return c.json({ error: "A file or public URL is required." }, 400);
    if (file) url = await uploadFile(file, type);
    return c.json(await publishMedia(type, url, title, photographerName), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload media.";
    return c.json({ error: message }, 500);
  }
}

app.post("/media", (c) => handleMedia(c));
app.post("/media/:type", (c) => handleMedia(c, c.req.param("type")));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const response = await app.fetch(req);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("Unhandled Edge Function error:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: corsHeaders,
    });
  }
});
