import { Users } from "lucide-react";
import { fetchDrinks, fetchUsers } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import {
  Alert,
  Badge,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  activityLevelOf,
  activityTone,
} from "../components/ui";

export function UsersPage() {
  const { data, loading, error, reload } = useLoad(async () => {
    const [users, drinks] = await Promise.all([fetchUsers(), fetchDrinks()]);
    return { users, drinks };
  });

  const users = data?.users ?? [];
  const drinks = data?.drinks ?? [];
  const drinkName = (id?: string) => drinks.find((d) => d.id === id)?.name ?? "—";
  const totalSessions = users.reduce((a, u) => a + u.sessionCount, 0);
  const isEmpty = !loading && users.length === 0;

  return (
    <div>
      <PageHeader
        en="GUEST DIRECTORY"
        title="用户管理"
        desc="查看顾客的饮酒偏好与活跃度。数据来源为智能酒杯会话记录，用户可匿名（仅杯垫 ID 标识）。"
      />

      <div className="card p-6">
        <CardHeader
          title="顾客列表"
          actions={
            <span className="text-xs text-fg-faint">
              {users.length} 位顾客 · 累计 {totalSessions} 次会话
            </span>
          }
        />

        {error && (
          <Alert className="mb-4">
            {error}
            <button className="ml-3 underline hover:text-red-200" onClick={() => void reload()}>
              重试
            </button>
          </Alert>
        )}

        <Table
          columns={[
            { key: "id", label: "用户 ID" },
            { key: "nickname", label: "昵称" },
            { key: "sessions", label: "会话次数" },
            { key: "favorite", label: "偏好酒款" },
            { key: "lastActive", label: "最近活跃" },
            { key: "activity", label: "活跃度" },
          ]}
          minWidth={640}
          caption="顾客列表"
          loading={loading}
          isEmpty={isEmpty}
          emptyRow={
            <tr>
              <td colSpan={6} className="border-0">
                <EmptyState
                  icon={Users}
                  title="暂无顾客数据"
                  description="顾客首次使用智能酒杯后，这里会自动生成画像与偏好。"
                />
              </td>
            </tr>
          }
        >
          {users.map((u) => {
            const level = activityLevelOf(u.sessionCount);
            return (
              <tr key={u.id}>
                <td className="tabular-nums text-stone-500">{u.id}</td>
                <td className="text-stone-100">{u.nickname}</td>
                <td className="tabular-nums">{u.sessionCount} 次</td>
                <td>{drinkName(u.favoriteDrinkId)}</td>
                <td className="tabular-nums text-stone-500">{u.lastActiveAt}</td>
                <td>
                  <Badge tone={activityTone[level]}>{level}</Badge>
                </td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
