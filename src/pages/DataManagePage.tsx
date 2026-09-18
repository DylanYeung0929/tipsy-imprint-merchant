import { useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";
import { fetchDrinks, fetchEvents, fetchSessions, fetchUsers } from "../lib/api";
import { EVENT_TYPE_LABEL } from "../lib/mock";
import { useLoad } from "../lib/useLoad";
import { Alert, EmptyState, Input, PageHeader, Table } from "../components/ui";

export function DataManagePage() {
  const { data, loading, error, reload } = useLoad(async () => {
    const [sessions, events, drinks, users] = await Promise.all([
      fetchSessions(),
      fetchEvents(),
      fetchDrinks(),
      fetchUsers(),
    ]);
    return { sessions, events, drinks, users };
  });

  const sessions = data?.sessions ?? [];
  const events = data?.events ?? [];
  const drinks = data?.drinks ?? [];
  const users = data?.users ?? [];
  const [drinkFilter, setDrinkFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const clearFilters = () => {
    setDrinkFilter("all");
    setUserFilter("all");
    setQuery("");
  };

  const drinkName = (id: string) => drinks.find((d) => d.id === id)?.name ?? id;
  const userName = (id: string) => users.find((u) => u.id === id)?.nickname ?? id;

  const filtered = useMemo(
    () =>
      sessions.filter((s) => {
        if (drinkFilter !== "all" && s.drinkId !== drinkFilter) return false;
        if (userFilter !== "all" && s.userId !== userFilter) return false;
        if (query) {
          const text = `${s.id} ${drinkName(s.drinkId)} ${userName(s.userId)}`.toLowerCase();
          if (!text.includes(query.toLowerCase())) return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, drinkFilter, userFilter, query, drinks, users],
  );

  const sessionEvents = (id: string) => events.filter((e) => e.sessionId === id);

  return (
    <div>
      <PageHeader
        en="SESSION ARCHIVE"
        title="数据管理"
        desc="查询历史饮酒会话与原始传感器事件，支持按酒款、用户、关键字筛选。"
      />

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            icon={Search}
            className="w-full sm:w-64"
            placeholder="搜索会话 / 酒款 / 用户"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="input" value={drinkFilter} onChange={(e) => setDrinkFilter(e.target.value)}>
            <option value="all">全部酒款</option>
            {drinks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select className="input" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="all">全部用户</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.nickname}</option>
            ))}
          </select>
          <span className="ml-auto text-xs text-fg-faint">
            共 {filtered.length} 条会话
          </span>
        </div>
      </div>

      {error && (
        <Alert className="mt-6">
          {error}
          <button className="ml-3 underline hover:text-red-200" onClick={() => void reload()}>
            重试
          </button>
        </Alert>
      )}

      <div className="card mt-6 p-6">
        <Table
          columns={[
            { key: "id", label: "会话 ID" },
            { key: "user", label: "用户" },
            { key: "drink", label: "酒款" },
            { key: "startedAt", label: "开始时间" },
            { key: "pickup", label: "拿起次数" },
            { key: "volume", label: "总饮量" },
            { key: "shake", label: "摇晃峰值" },
            { key: "chugged", label: "一饮而尽" },
            { key: "actions", label: "操作", className: "sr-only" },
          ]}
          minWidth={720}
          stickyFirstCol
          caption="会话列表"
          loading={loading}
          isEmpty={filtered.length === 0}
          emptyRow={
            <tr>
              <td colSpan={9} className="border-0">
                <EmptyState
                  icon={SearchX}
                  title="没有符合条件的会话"
                  description="调整筛选条件，或清除筛选查看全部会话。"
                  action={
                    <button className="btn-ghost" onClick={clearFilters}>
                      清除筛选
                    </button>
                  }
                />
              </td>
            </tr>
          }
        >
          {filtered.map((s) => (
            <tr key={s.id}>
              <td className="tabular-nums text-stone-500">{s.id}</td>
              <td className="text-stone-100">{userName(s.userId)}</td>
              <td>{drinkName(s.drinkId)}</td>
              <td className="tabular-nums text-stone-500">{s.startedAt}</td>
              <td className="tabular-nums">{s.pickupCount} 次</td>
              <td className="tabular-nums">{s.sipVolumeTotal} ml</td>
              <td className="tabular-nums">{Math.round(s.shakeMax * 100)}%</td>
              <td>{s.chugged ? <span className="text-emerald-400">是</span> : <span className="text-fg-faint">否</span>}</td>
              <td>
                <button
                  className="text-xs text-amber-400 hover:text-amber-300 max-lg:py-3"
                  onClick={() => setDetailId(detailId === s.id ? null : s.id)}
                >
                  {detailId === s.id ? "收起事件" : "查看事件"}
                </button>
              </td>
            </tr>
          ))}
        </Table>

        {detailId && sessionEvents(detailId).length > 0 && (
          <div className="mt-6 rounded-lg border border-white/10 bg-black/30 p-5">
            <h3 className="text-sm text-stone-500">
              会话 {detailId} · 原始事件（{sessionEvents(detailId).length} 条）
            </h3>
            <ol className="mt-3 space-y-1.5">
              {sessionEvents(detailId).map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 tabular-nums text-xs text-fg-faint">{e.timestamp}</span>
                  <span className="w-20 shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-center text-xs text-amber-300">
                    {EVENT_TYPE_LABEL[e.type]}
                  </span>
                  <span className="text-stone-400">
                    {e.value !== undefined &&
                      (e.type === "shake" ? `幅度 ${e.value}` : `饮用量 ${e.value} ml`)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
