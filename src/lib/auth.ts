import type { Drink, SensorEvent, Session, User } from "../types";
import { getSnapshot } from "./mock";

export interface Snapshot {
  drinks?: Drink[];
  users?: User[];
  sessions?: Session[];
  events?: SensorEvent[];
}

const TOKEN_KEY = "tipsy_merchant_token";
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `接口错误 ${res.status}`);
  }
  return data;
}

export async function login(username: string, password: string): Promise<string> {
  const data = await request<{ token: string; username: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.username;
}

export async function register(username: string, password: string): Promise<string> {
  const data = await request<{ token: string; username: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.username;
}

export async function fetchMe(): Promise<string> {
  const data = await request<{ username: string }>("/auth/me");
  return data.username;
}

export async function logout() {
  setToken(null);
}

export async function fetchSnapshot(): Promise<Snapshot | null> {
  return request<Snapshot | null>("/data");
}

export async function saveSnapshot(): Promise<void> {
  await request("/data", {
    method: "PUT",
    body: JSON.stringify(getSnapshot()),
  });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** 数据变更后防抖保存快照到服务端（登录后由 api 层调用） */
export function scheduleSnapshotSave() {
  if (!getToken()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveSnapshot().catch(() => {});
  }, 600);
}
