import { useState } from "react";
import { Lock, User } from "lucide-react";
import { login, register } from "../lib/auth";
import { Alert } from "../components/ui";

export function LoginPage({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!username.trim() || !password) {
      setError("请输入账号与密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const name =
        mode === "login"
          ? await login(username.trim(), password)
          : await register(username.trim(), password);
      onSuccess(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <p className="display-en text-xs text-amber-400">TIPSY IMPRINT</p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-100">商家数据台</h1>
        <p className="mt-2 text-sm text-stone-500">
          {mode === "login" ? "登录后查看您的酒单与经营数据" : "创建商家账号，数据将按账号独立保存"}
        </p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-stone-500">账号</span>
            <div className="relative">
              <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
              <input
                className="input w-full pl-9"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="商家账号"
                autoComplete="username"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-stone-500">密码</span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
              <input
                className="input w-full pl-9"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder={mode === "login" ? "登录密码" : "至少 6 位"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
          </label>

          {error && <Alert>{error}</Alert>}

          <button className="btn-primary w-full justify-center" onClick={() => void submit()} disabled={busy}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
          </button>

          <button
            className="w-full text-center text-xs text-stone-500 transition-colors hover:text-amber-300"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "没有账号？注册商家账号" : "已有账号？返回登录"}
          </button>

          {mode === "login" && (
            <p className="text-center text-xs text-fg-faint">
              演示账号：owner / 123456
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
