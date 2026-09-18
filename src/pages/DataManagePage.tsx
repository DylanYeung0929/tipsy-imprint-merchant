import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Drink, SensorEvent, Session, User } from "../types";
import { fetchDrinks, fetchEvents, fetchSessions, fetchUsers } from "../lib/api";
import { EVENT_TYPE_LABEL } from "../lib/mock";
import { PageHeader } from "../components/ui";

export function DataManagePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<SensorEvent[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [drinkFilter, setDrinkFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [s, e, d, u] = await Promise.all([
        fetchSessions(),
        fetchEvents(),
        fetchDrinks(),
        fetchUsers(),
      ]);
      setSessions(s);
      setEvents(e);
      setDrinks(d);
      setUsers(u);
    })();
  }, []);

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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-600" aria-hidden="true" />
            <input
              className="input w-64 pl-9"
              placeholder="搜索会话 / 酒款 / 用户"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
          <span className="ml-auto text-xs text-stone-600">
            共 {filtered.length} 条会话
          </span>
        </div>
      </div>

      <div className="card mt-6 p-6">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[720px]">
            <thead>
              <tr>
                <th>会话 ID</th>
                <th>用户</th>
                <th>酒款</th>
                <th>开始时间</th>
                <th>拿起次数</th>
                <th>总饮量</th>
                <th>摇晃峰值</th>
                <th>一饮而尽</th>
                <th className="sr-only">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.02]">
                  <td className="tabular-nums text-stone-500">{s.id}</td>
                  <td className="text-stone-100">{userName(s.userId)}</td>
                  <td>{drinkName(s.drinkId)}</td>
                  <td className="tabular-nums text-stone-500">{s.startedAt}</td>
                  <td className="tabular-nums">{s.pickupCount} 次</td>
                  <td className="tabular-nums">{s.sipVolumeTotal} ml</td>
                  <td className="tabular-nums">{Math.round(s.shakeMax * 100)}%</td>
                  <td>{s.chugged ? <span className="text-emerald-400">是</span> : <span className="text-stone-600">否</span>}</td>
                  <td>
                    <button
                      className="text-xs text-amber-400 hover:text-amber-300"
                      onClick={() => setDetailId(detailId === s.id ? null : s.id)}
                    >
                      {detailId === s.id ? "收起事件" : "查看事件"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-stone-600">
                    没有符合条件的会话
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detailId && sessionEvents(detailId).length > 0 && (
          <div className="mt-6 rounded-lg border border-white/10 bg-black/30 p-5">
            <h3 className="text-sm text-stone-500">
              会话 {detailId} · 原始事件（{sessionEvents(detailId).length} 条）
            </h3>
            <ol className="mt-3 space-y-1.5">
              {sessionEvents(detailId).map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 tabular-nums text-xs text-stone-600">{e.timestamp}</span>
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
