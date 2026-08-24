import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSecureMessage } from "@/lib/rdx.functions";
import rdxLogo from "@/assets/rdx-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RDX Security Zone — Create One-Time Secure Message" },
      { name: "description", content: "Upload any file, voice, image, or video and generate a self-destructing one-time-view link protected by camera verification." },
      { property: "og:title", content: "RDX Security Zone" },
      { property: "og:description", content: "Send self-destructing files and messages with tight viewer security." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CreatePage,
});

function CreatePage() {
  const createFn = useServerFn(createSecureMessage);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleGenerate() {
    setError(null);
    setLink(null);
    if (!text.trim() && !file) {
      setError("Message ya file zaroor lagayen.");
      return;
    }
    setBusy(true);
    try {
      let storagePath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `${crypto.randomUUID()}.${ext}`;
        setProgress(`Uploading ${(file.size / (1024 * 1024)).toFixed(2)} MB...`);
        const { error: upErr } = await supabase.storage
          .from("secure-files")
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (upErr) throw upErr;
        storagePath = path;
      }
      setProgress("Generating secure link...");
      const res = await createFn({
        data: {
          textMessage: text.trim() || null,
          fileName: file?.name ?? null,
          mimeType: file?.type ?? null,
          fileSize: file?.size ?? null,
          storagePath,
        },
      });
      const url = `${window.location.origin}/v/${res.id}`;
      setLink(url);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div className="min-h-screen py-10 px-4 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 h-24 opacity-30"
        style={{
          background: "linear-gradient(180deg, transparent, var(--neon-sky), transparent)",
          animation: "rdx-scan-y 6s linear infinite",
        }}
      />

      <header className="max-w-4xl mx-auto text-center mb-10 relative">
        <div className="mb-6 flex justify-center md:absolute md:right-0 md:top-0 md:mb-0">
          <Link
            to="/admin"
            className="rounded-md border border-border bg-secondary px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-all hover:text-accent"
          >
            Admin Portal
          </Link>
        </div>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.4em] text-muted-foreground mb-3">
          <span className="w-2 h-2 rounded-full bg-neon-sky" style={{ animation: "rdx-pulse 1.5s infinite" }} />
          secure zone active
        </div>
        <img
          src={rdxLogo}
          alt="RDX Security Zone neon shield logo"
          width={1024}
          height={1024}
          className="mx-auto mb-3 h-24 w-24 md:h-28 md:w-28 drop-shadow-[0_0_25px_var(--glow-sky)]"
        />
        <h1 className="text-5xl md:text-6xl font-black neon-text-sky mb-2">RDX SECURITY ZONE</h1>
        <p className="text-muted-foreground text-sm md:text-base">
          One-time-view encrypted messages · Camera-verified viewers · Silent capture on tampering
        </p>
      </header>

      <main className="max-w-3xl mx-auto glass-panel rounded-xl p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg md:text-xl font-bold neon-text-green">// CREATE_SECURE_MESSAGE</h2>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">encrypted · one-time</span>
        </div>

        <label className="block mb-4">
          <span className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">Text message (optional)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Type a message the recipient will see once and never again..."
            className="w-full bg-input/60 rounded-md p-3 text-foreground font-mono text-sm outline-none focus:neon-border-sky border border-border transition-all resize-none"
          />
        </label>

        <label className="block mb-6">
          <span className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Attach file — image · voice · video · anything
          </span>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
          />
          {file && (
            <div className="text-xs text-accent mt-2">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB
            </div>
          )}
        </label>

        <button
          onClick={handleGenerate}
          disabled={busy}
          className="w-full py-3 rounded-md bg-primary text-primary-foreground font-bold uppercase tracking-widest text-sm hover:opacity-90 disabled:opacity-50 neon-border-sky transition-all"
        >
          {busy ? progress || "Processing..." : ">> Generate Secure Link"}
        </button>

        {error && (
          <div className="mt-4 p-3 rounded-md border border-destructive bg-destructive/10 text-sm text-destructive">
            {error}
          </div>
        )}

        {link && (
          <div className="mt-6 p-4 rounded-md glass-panel neon-border-green">
            <div className="text-xs uppercase tracking-widest neon-text-green mb-2">// link_generated</div>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-input rounded-md px-3 py-2 text-sm font-mono text-accent"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(link);
                }}
                className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-xs font-bold uppercase tracking-widest hover:opacity-90"
              >
                Copy
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Recipient ko camera "Allow Media" permission dena hogi. Aik baar dekha to link dubara nahi khulega.
              Screenshot / recording ki koshish par message foran lock hoga aur selfie admin panel me record hogi.
            </div>
          </div>
        )}

        <div className="mt-8 text-[10px] text-muted-foreground uppercase tracking-widest text-center">
          rdx zone · v1.0 · sardar rdx
        </div>
      </main>
    </div>
  );
}
