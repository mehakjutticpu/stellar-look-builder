import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

type AdminSession = { admin?: boolean };
type ViewerSession = { claims?: Record<string, true> };

function sessionPassword() {
  const password = process.env["ADMIN_SESSION_SECRET"];
  if (!password) throw new Error("Session secret not configured");
  return password;
}

function adminSessionConfig() {
  return {
    password: sessionPassword(),
    name: "rdx-admin",
    maxAge: 60 * 60 * 8,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      path: "/",
    },
  };
}

function viewerSessionConfig() {
  return {
    password: sessionPassword(),
    name: "rdx-viewer-claim",
    maxAge: 60 * 15,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      path: "/",
    },
  };
}

function getUserAgent(): string | null {
  try {
    return getRequest().headers.get("user-agent");
  } catch {
    return null;
  }
}

function getClientIp(): string | null {
  try {
    const req = getRequest();
    const h = req.headers;
    return (
      h.get("cf-connecting-ip") ||
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null
    );
  } catch {
    return null;
  }
}

// ---------- CREATE ----------
export const createSecureMessage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        textMessage: z.string().max(20000).optional().nullable(),
        fileName: z.string().max(512).optional().nullable(),
        mimeType: z.string().max(200).optional().nullable(),
        fileSize: z.number().int().nonnegative().optional().nullable(),
        storagePath: z.string().max(1024).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = getClientIp();
    const { data: row, error } = await supabaseAdmin
      .from("secure_messages")
      .insert({
        text_message: data.textMessage || null,
        file_name: data.fileName || null,
        mime_type: data.mimeType || null,
        file_size: data.fileSize ?? null,
        storage_path: data.storagePath || null,
        creator_ip: ip,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

// ---------- META (before camera permission) ----------
export const getMessageMeta = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = await useSession<ViewerSession>(viewerSessionConfig());
    const claims = session.data.claims ?? {};
    const hasViewerClaim = claims[data.id] === true;

    const { data: row, error: readErr } = await supabaseAdmin
      .from("secure_messages")
      .select("id, viewed_at, mime_type, file_name")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) return { exists: false as const };

    if (row.viewed_at) {
      return {
        exists: true as const,
        alreadyViewed: !hasViewerClaim,
        mimeType: row.mime_type,
        fileName: row.file_name,
      };
    }

    const now = new Date().toISOString();
    const ip = getClientIp();
    const ua = getUserAgent();
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("secure_messages")
      .update({ viewed_at: now, viewer_ip: ip, viewer_user_agent: ua })
      .eq("id", data.id)
      .is("viewed_at", null)
      .select("id, mime_type, file_name")
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claim) return { exists: true as const, alreadyViewed: true, mimeType: row.mime_type, fileName: row.file_name };

    await session.update({ claims: { ...claims, [data.id]: true } });
    await supabaseAdmin.from("access_events").insert({
      message_id: claim.id,
      event_type: "link_opened",
      ip,
      user_agent: ua,
    });

    return {
      exists: true as const,
      alreadyViewed: false,
      mimeType: claim.mime_type,
      fileName: claim.file_name,
    };
  });

// ---------- OPEN (one-time) ----------
export const openSecureMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = await useSession<ViewerSession>(viewerSessionConfig());
    const claims = session.data.claims ?? {};
    if (claims[data.id] !== true) {
      return { ok: false as const, reason: "already_viewed_or_missing" };
    }

    const ip = getClientIp();
    const ua = getUserAgent();

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("secure_messages")
      .select("id, text_message, storage_path, file_name, mime_type, file_size")
      .eq("id", data.id)
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message);
    if (!claim) {
      return { ok: false as const, reason: "already_viewed_or_missing" };
    }

    const nextClaims = { ...claims };
    delete nextClaims[data.id];
    await session.update({ claims: nextClaims });

    let fileUrl: string | null = null;
    if (claim.storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from("secure-files")
        .createSignedUrl(claim.storage_path, 60 * 10);
      fileUrl = signed?.signedUrl ?? null;
    }

    // Log the view
    await supabaseAdmin.from("access_events").insert({
      message_id: claim.id,
      event_type: "view",
      ip,
      user_agent: ua,
    });

    return {
      ok: true as const,
      textMessage: claim.text_message,
      fileName: claim.file_name,
      mimeType: claim.mime_type,
      fileSize: claim.file_size,
      fileUrl,
    };
  });

// ---------- LOG ACCESS EVENT + SELFIE / CLIP ----------
export const logAccessEvent = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        messageId: z.string().uuid(),
        eventType: z.string().min(1).max(64),
        selfieBase64: z.string().optional().nullable(),
        clipBase64: z.string().optional().nullable(),
        clipMime: z.string().max(100).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = getClientIp();
    const ua = getUserAgent();

    let selfiePath: string | null = null;
    if (data.selfieBase64) {
      try {
        const b64 = data.selfieBase64.replace(/^data:image\/\w+;base64,/, "");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const path = `${data.messageId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("selfies")
          .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
        if (!upErr) selfiePath = path;
      } catch (e) {
        console.error("selfie upload failed", e);
      }
    }

    let clipPath: string | null = null;
    if (data.clipBase64) {
      try {
        const b64 = data.clipBase64.replace(/^data:[^;]+;base64,/, "");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const mime = data.clipMime || "video/webm";
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        const path = `clips/${data.messageId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("secure-files")
          .upload(path, bytes, { contentType: mime, upsert: false });
        if (!upErr) clipPath = path;
        else console.error("clip upload failed", upErr);
      } catch (e) {
        console.error("clip upload failed", e);
      }
    }

    await supabaseAdmin.from("access_events").insert({
      message_id: data.messageId,
      event_type: data.eventType,
      selfie_path: selfiePath,
      clip_path: clipPath,
      ip,
      user_agent: ua,
    });
    return { ok: true };
  });

// ---------- ADMIN AUTH ----------
export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const expectedU = process.env["ADMIN_USER"];
    const expectedP = process.env["ADMIN_PASS"];
    if (!expectedU || !expectedP) throw new Error("Admin creds not configured");
    if (data.username !== expectedU || data.password !== expectedP) {
      return { ok: false as const };
    }
    const session = await useSession<AdminSession>(adminSessionConfig());
    await session.update({ admin: true });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<AdminSession>(adminSessionConfig());
  await session.clear();
  return { ok: true };
});

export const adminIsLoggedIn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<AdminSession>(adminSessionConfig());
  return { admin: !!session.data.admin };
});

async function requireAdmin() {
  const session = await useSession<AdminSession>(adminSessionConfig());
  if (!session.data.admin) throw new Error("Unauthorized");
}

export const adminListMessages = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("secure_messages")
    .select("id, created_at, viewed_at, file_name, mime_type, file_size, viewer_ip, creator_ip")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return { messages: data ?? [] };
});

export const adminListEvents = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("access_events")
    .select("id, message_id, event_type, selfie_path, clip_path, ip, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const withUrls = await Promise.all(
    (data ?? []).map(async (e) => {
      let selfieUrl: string | null = null;
      let clipUrl: string | null = null;
      if (e.selfie_path) {
        const { data: s } = await supabaseAdmin.storage
          .from("selfies")
          .createSignedUrl(e.selfie_path, 60 * 30);
        selfieUrl = s?.signedUrl ?? null;
      }
      if (e.clip_path) {
        const { data: s } = await supabaseAdmin.storage
          .from("secure-files")
          .createSignedUrl(e.clip_path, 60 * 30);
        clipUrl = s?.signedUrl ?? null;
      }
      return { ...e, selfieUrl, clipUrl };
    }),
  );
  return { events: withUrls };
});

// ---------- ADMIN: DELETE CAPTURE / MESSAGE ----------
export const adminDeleteEvent = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("access_events")
      .select("id, selfie_path, clip_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.selfie_path) {
      await supabaseAdmin.storage.from("selfies").remove([row.selfie_path]);
    }
    if (row?.clip_path) {
      await supabaseAdmin.storage.from("secure-files").remove([row.clip_path]);
    }
    const { error } = await supabaseAdmin.from("access_events").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminDeleteSelfie = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("access_events")
      .select("id, selfie_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.selfie_path) {
      await supabaseAdmin.storage.from("selfies").remove([row.selfie_path]);
    }
    const { error } = await supabaseAdmin
      .from("access_events")
      .update({ selfie_path: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminDeleteClip = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("access_events")
      .select("id, clip_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.clip_path) {
      await supabaseAdmin.storage.from("secure-files").remove([row.clip_path]);
    }
    const { error } = await supabaseAdmin
      .from("access_events")
      .update({ clip_path: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
