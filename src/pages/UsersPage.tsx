import { useEffect, useState } from "react";
import type { Drink, User } from "../types";
import { fetchDrinks, fetchUsers } from "../lib/api";
import { PageHeader } from "../components/ui";

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);

  useEffect(() => {
    void (async () => {
      const [u, d] = await Promise.all([fetchUsers(), fetchDrinks()]);
      setUsers(u);
      setDrinks(d);
    })();
  }, []);

  const drinkName = (id?: string) => drinks.find((d) => d.id === id)?.name ?? "—";
  const totalSessions = users.reduce((a, u) => a + u.sessionCount, 0);

  return (
    <div>
      <PageHeader
        en="GUEST DIRECTORY"
        title="用户管理"
        desc="查看顾客的饮酒偏好与活跃度。数据来源为智能酒杯会话记录，用户可匿名（仅杯垫 ID 标识）。"
      />

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-100">顾客列表</h2>
          <span className="text-xs text-stone-600">
            {users.length} 位顾客 · 累计 {totalSessions} 次会话
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead>
              <tr>
                <th>用户 ID</th>
                <th>昵称</th>
                <th>会话次数</th>
                <th>偏好酒款</th>
                <th>最近活跃</th>
                <th>活跃度</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const level = u.sessionCount >= 8 ? "高频" : u.sessionCount >= 4 ? "常客" : "新客";
                const color =
                  level === "高频"
                    ? "bg-amber-500/15 text-amber-300"
                    : level === "常客"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-white/10 text-stone-400";
                return (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="tabular-nums text-stone-500">{u.id}</td>
                    <td className="text-stone-100">{u.nickname}</td>
                    <td className="tabular-nums">{u.sessionCount} 次</td>
                    <td>{drinkName(u.favoriteDrinkId)}</td>
                    <td className="tabular-nums text-stone-500">{u.lastActiveAt}</td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{level}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
