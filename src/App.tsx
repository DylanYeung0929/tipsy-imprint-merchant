import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ExternalLink,
  LogOut,
  RadioTower,
  Database,
  Stamp,
  Users,
  Wine,
} from "lucide-react";
import { DashboardPage } from "./pages/DashboardPage";
import { LiveSessionPage } from "./pages/LiveSessionPage";
import { DataReceivePage } from "./pages/DataReceivePage";
import { DataManagePage } from "./pages/DataManagePage";
import { UsersPage } from "./pages/UsersPage";
import { MenuConfigPage } from "./pages/MenuConfigPage";
import { ImprintCardsPage } from "./pages/ImprintCardsPage";
import { LoginPage } from "./pages/LoginPage";
import { AiAssistant } from "./components/AiAssistant";
import { fetchMe, fetchSnapshot, getToken, logout, setToken } from "./lib/auth";
import { fetchEspSessions } from "./lib/api";
import { resetStores } from "./lib/mock";

/** 设备在线 = 最近一个遥测数据包距今不超过该窗口 */
const DEVICE_ONLINE_WINDOW_MS = 60_000;

const nav = [
  { to: "/dashboard", label: "数据分析", en: "INSIGHTS", icon: BarChart3 },
  { to: "/receive", label: "数据接收", en: "INGEST", icon: RadioTower },
  { to: "/live", label: "实时体验", en: "LIVE", icon: Activity },
  { to: "/manage", label: "数据管理", en: "ARCHIVE", icon: Database },
  { to: "/users", label: "用户管理", en: "GUESTS", icon: Users },
  { to: "/menu", label: "酒单配置", en: "MENU", icon: Wine },
  { to: "/imprint", label: "印记卡片", en: "IMPRINT", icon: Stamp },
];

function Sidebar({
  username,
  onLogout,
}: {
  username: string;
  onLogout: () => void;
}) {
  const [deviceOnline, setDeviceOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const sessions = await fetchEspSessions(10);
        if (cancelled) return;
        const latest = sessions.reduce((m, s) => Math.max(m, s.last_packet_at_ms ?? 0), 0);
        setDeviceOnline(latest > 0 && Date.now() - latest < DEVICE_ONLINE_WINDOW_MS);
      } catch {
        // 拉取失败（未登录/网络）保留上次状态
      }
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r border-white/10 bg-[#100e0c]">
      <div className="border-b border-white/10 px-6 py-6">
        <p className="display-en text-xs text-amber-400">TIPSY IMPRINT</p>
        <h1 className="mt-1 text-lg font-semibold text-stone-100">商家数据台</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {nav.map(({ to, label, en, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-amber-500/10 text-amber-300"
                  : "text-stone-400 hover:bg-white/5 hover:text-stone-200"
              }`
            }
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{label}</span>
            <span className="display-en text-[10px] text-fg-faint group-[.active]:text-amber-500/70">
              {en}
            </span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 px-3 py-4">
        <a
          href={import.meta.env.VITE_PRODUCT_URL ?? "http://localhost:5173"}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-stone-400 transition-colors hover:bg-white/5 hover:text-stone-200"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="flex-1">产品介绍站</span>
          <span className="display-en text-[10px] text-fg-faint">SITE</span>
        </a>
      </div>
      <div className="border-t border-white/10 px-6 py-4">
        <p className="text-xs text-fg-faint">数据状态</p>
        <p
          className={`mt-1 flex items-center gap-2 text-sm ${deviceOnline ? "text-emerald-300" : "text-stone-500"}`}
          data-testid="device-status"
        >
          <span
            className={`size-1.5 rounded-full ${deviceOnline ? "animate-pulse bg-emerald-400" : "bg-stone-600"}`}
          />
          {deviceOnline ? "设备在线" : "设备离线"}
        </p>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-stone-300">{username}</p>
          <p className="text-xs text-fg-faint">商家账号</p>
        </div>
        <button
          className="rounded p-1.5 text-stone-500 transition-colors hover:bg-white/5 hover:text-red-400"
          onClick={onLogout}
          aria-label="退出登录"
          title="退出登录"
        >
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<"loading" | "out" | "in">("loading");
  const [username, setUsername] = useState("");

  useEffect(() => {
    void (async () => {
      if (!getToken()) {
        setAuthState("out");
        return;
      }
      try {
        const name = await fetchMe();
        resetStores(await fetchSnapshot());
        setUsername(name);
        setAuthState("in");
      } catch {
        setToken(null);
        setAuthState("out");
      }
    })();
  }, []);

  const handleLogin = async (name: string) => {
    resetStores(await fetchSnapshot());
    setUsername(name);
    setAuthState("in");
  };

  const handleLogout = () => {
    logout();
    setAuthState("out");
  };

  if (authState === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="display-en text-sm text-fg-faint">LOADING…</p>
      </div>
    );
  }

  if (authState === "out") {
    return <LoginPage onSuccess={(name) => void handleLogin(name)} />;
  }

  return (
    <div className="min-h-dvh">
      <Sidebar username={username} onLogout={handleLogout} />
      <main className="ml-56 min-h-dvh px-8 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/receive" element={<DataReceivePage />} />
          <Route path="/live" element={<LiveSessionPage />} />
          <Route path="/manage" element={<DataManagePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/menu" element={<MenuConfigPage />} />
          <Route path="/imprint" element={<ImprintCardsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <AiAssistant />
    </div>
  );
}
