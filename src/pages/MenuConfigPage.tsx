import { useRef, useState } from "react";
import { Camera, Loader2, Pencil, Plus, Trash2, Wine } from "lucide-react";
import type { Drink, MenuImportItem } from "../types";
import { createDrink, deleteDrink, fetchDrinks, importMenu, updateDrink } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import {
  Alert,
  Badge,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Table,
  saleStatusMeta,
} from "../components/ui";

/** 压缩图片到最长边 maxDim 的 JPEG data URL，避免超过接口 4MB 限制 */
function compressImage(file: File, maxDim = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error("浏览器不支持图片处理"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };
    img.src = url;
  });
}

interface FormState {
  name: string;
  category: string;
  abv: string;
  price: string;
  flavor: string;
  designIntent: string;
  active: boolean;
}

const emptyForm: FormState = {
  name: "",
  category: "",
  abv: "",
  price: "",
  flavor: "",
  designIntent: "",
  active: true,
};

export function MenuConfigPage() {
  const { data, loading, error: loadError, reload } = useLoad(fetchDrinks);
  const drinks = data ?? [];
  const [editing, setEditing] = useState<Drink | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Drink | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const openCreate = () => {
    setForm(emptyForm);
    setCreating(true);
  };

  const openEdit = (d: Drink) => {
    setForm({
      name: d.name,
      category: d.category,
      abv: String(d.abv),
      price: String(d.price),
      flavor: d.flavor,
      designIntent: d.designIntent,
      active: d.active,
    });
    setEditing(d);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
    setError("");
  };

  const submit = async () => {
    if (!form.name.trim() || !form.designIntent.trim()) {
      setError("酒名与设计初衷为必填项（设计初衷供 AI 匹配分析使用）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = {
        name: form.name.trim(),
        category: form.category.trim() || "其他",
        abv: Number(form.abv) || 0,
        price: Number(form.price) || 0,
        flavor: form.flavor.trim() || "未知",
        designIntent: form.designIntent.trim(),
        active: form.active,
      };
      if (editing) {
        await updateDrink(editing.id, data);
      } else {
        await createDrink(data);
      }
      await reload();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteDrink(pendingDelete.id);
      await reload();
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "删除失败，请重试");
    } finally {
      setDeleteBusy(false);
    }
  };

  // ---- 拍照导入 ----
  const [importOpen, setImportOpen] = useState(false);
  const [importImage, setImportImage] = useState("");
  const [importItems, setImportItems] = useState<MenuImportItem[]>([]);
  const [importChecked, setImportChecked] = useState<number[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const closeImport = () => {
    if (importBusy || importSaving) return;
    setImportOpen(false);
    setImportImage("");
    setImportItems([]);
    setImportChecked([]);
    setImportError("");
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError("");
    if (!file.type.startsWith("image/")) {
      setImportError("请选择图片文件（jpg / png 等）");
      return;
    }
    try {
      setImportImage(await compressImage(file));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "图片读取失败");
    }
  };

  const runImport = async () => {
    if (!importImage || importBusy) return;
    setImportBusy(true);
    setImportError("");
    try {
      const items = await importMenu(importImage);
      if (!items.length) {
        setImportError("AI 未识别到酒款，请换一张更清晰的酒单照片");
        return;
      }
      setImportItems(items);
      setImportChecked(items.map((_, i) => i));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "识别失败，请重试");
    } finally {
      setImportBusy(false);
    }
  };

  const toggleCheck = (i: number) =>
    setImportChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));

  const saveImported = async () => {
    if (!importChecked.length || importSaving) return;
    setImportSaving(true);
    setImportError("");
    try {
      for (const i of importChecked) {
        const it = importItems[i];
        await createDrink({
          name: it.name,
          category: it.category,
          abv: it.abv,
          price: it.price,
          flavor: it.flavor,
          designIntent: it.designIntent || "待补充设计初衷",
          cardStyle: it.cardStyle,
          active: true,
        });
      }
      await reload();
      closeImport();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImportSaving(false);
    }
  };

  const setItem = (i: number, k: keyof MenuImportItem, v: string | number) =>
    setImportItems((items) => items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const set = (k: keyof FormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const modalOpen = creating || editing !== null;

  return (
    <div>
      <PageHeader
        en="MENU CONFIG"
        title="酒单配置"
        desc="维护酒款信息与「设计初衷」。AI 分析将把用户真实行为与设计初衷比对，输出匹配度与经营建议。"
      />

      {loadError && (
        <Alert className="mb-4">
          {loadError}
          <button className="ml-3 underline hover:text-red-200" onClick={() => void reload()}>
            重试
          </button>
        </Alert>
      )}

      <div className="card p-6">
        <CardHeader
          title="酒款列表"
          meta={`${drinks.length} 款`}
          stackOnMobile
          actions={
            <>
              <button className="btn-ghost" onClick={() => setImportOpen(true)}>
                <Camera className="size-4" aria-hidden="true" />
                拍照导入
              </button>
              <button className="btn-primary" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" />
                新增酒款
              </button>
            </>
          }
        />

        <Table
          columns={[
            { key: "name", label: "酒款" },
            { key: "category", label: "品类" },
            { key: "abv", label: "酒精度" },
            { key: "price", label: "价格" },
            { key: "flavor", label: "风味" },
            { key: "intent", label: "设计初衷" },
            { key: "status", label: "状态" },
            { key: "actions", label: "" },
          ]}
          minWidth={880}
          stickyFirstCol
          caption="酒款列表"
          loading={loading && drinks.length === 0}
          isEmpty={!loading && drinks.length === 0}
          emptyRow={
            <tr>
              <td colSpan={8} className="border-0">
                <EmptyState
                  icon={Wine}
                  title="暂无酒款"
                  description="手动新增酒款，或拍照让 AI 识别酒单后一键导入。"
                  action={
                    <button className="btn-primary" onClick={openCreate}>
                      <Plus className="size-4" aria-hidden="true" />
                      新增酒款
                    </button>
                  }
                />
              </td>
            </tr>
          }
        >
          {drinks.map((d) => (
            <tr key={d.id}>
              <td className="text-stone-100">{d.name}</td>
              <td>{d.category}</td>
              <td className="tabular-nums">{d.abv}%</td>
              <td className="tabular-nums">¥{d.price}</td>
              <td className="max-w-44 text-stone-400">{d.flavor}</td>
              <td className="max-w-64 text-stone-400">{d.designIntent}</td>
              <td>
                {d.active ? (
                  <Badge tone={saleStatusMeta.on.tone}>{saleStatusMeta.on.label}</Badge>
                ) : (
                  <Badge tone={saleStatusMeta.off.tone}>{saleStatusMeta.off.label}</Badge>
                )}
              </td>
              <td>
                <div className="flex items-center justify-end gap-1">
                  <button
                    className="rounded p-1.5 text-stone-500 hover:bg-white/5 hover:text-amber-300 max-lg:p-3"
                    onClick={() => openEdit(d)}
                    aria-label={`编辑 ${d.name}`}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    className="rounded p-1.5 text-stone-500 hover:bg-red-500/10 hover:text-red-400 max-lg:p-3"
                    onClick={() => {
                      setDeleteError("");
                      setPendingDelete(d);
                    }}
                    aria-label={`删除 ${d.name}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>

      {modalOpen && (
        <Modal title={creating ? "新增酒款" : `编辑 · ${editing?.name}`} onClose={close}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">酒名 *</span>
                <input className="input w-full" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="如：Old Fashioned" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">品类</span>
                <input className="input w-full" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="如：威士忌 / 鸡尾酒" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">酒精度（%）</span>
                <input className="input w-full" type="number" min={0} value={form.abv} onChange={(e) => set("abv", e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">价格（元）</span>
                <input className="input w-full" type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">风味描述</span>
              <input
                className="input w-full"
                value={form.flavor}
                onChange={(e) => set("flavor", e.target.value)}
                placeholder="如：威士忌醇厚，橙皮与苦精的草本甜香"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">
                设计初衷 *（AI 匹配分析依据）
              </span>
              <textarea
                className="input w-full resize-none"
                rows={3}
                value={form.designIntent}
                onChange={(e) => set("designIntent", e.target.value)}
                placeholder="如：预期用户多次拿起、每次少饮、长时间停留"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-stone-400">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
                className="size-4 accent-amber-500"
              />
              在售
            </label>

            {error && <Alert>{error}</Alert>}

            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={close}>取消</button>
              <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {importOpen && (
        <Modal title="拍照导入酒单" size="3xl" preventClose onClose={closeImport}>
            {importItems.length === 0 ? (
              <div className="space-y-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pickFile(e.target.files?.[0])}
                />
                {importImage ? (
                  <>
                    <img
                      src={importImage}
                      alt="酒单预览"
                      className="max-h-72 w-full rounded-lg border border-white/10 bg-black/40 object-contain"
                    />
                    <div className="flex gap-3">
                      <button
                        className="btn-ghost flex-1"
                        onClick={() => fileRef.current?.click()}
                      >
                        重选照片
                      </button>
                      <button
                        className="btn-primary flex-1"
                        onClick={() => void runImport()}
                        disabled={importBusy}
                      >
                        {importBusy ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            AI 识别中（约 20 秒）…
                          </>
                        ) : (
                          "AI 识别"
                        )}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-white/15 px-6 py-12 text-fg-muted transition-colors hover:border-amber-500/40 hover:text-stone-300"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Camera className="size-8" aria-hidden="true" />
                    <span className="text-sm">点击拍照或选择酒单照片</span>
                    <span className="text-xs text-fg-faint">
                      AI 将自动识别酒名、品类、度数、价格与风味，并生成卡片配色
                    </span>
                  </button>
                )}
                {importError && <Alert>{importError}</Alert>}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-stone-400">
                    识别到 <span className="text-amber-300">{importItems.length}</span> 款，已选{" "}
                    {importChecked.length} 款 —— 可先修改再导入
                  </p>
                  <button
                    className="text-xs text-stone-500 hover:text-stone-300"
                    onClick={() =>
                      setImportChecked(
                        importChecked.length === importItems.length
                          ? []
                          : importItems.map((_, i) => i),
                      )
                    }
                  >
                    {importChecked.length === importItems.length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="space-y-3">
                  {importItems.map((it, i) => {
                    const style = it.cardStyle;
                    return (
                      <div
                        key={i}
                        className={`rounded-xl border p-3 ${
                          importChecked.includes(i)
                            ? "border-amber-500/30 bg-white/[0.03]"
                            : "border-white/10 opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={importChecked.includes(i)}
                            onChange={() => toggleCheck(i)}
                            className="size-4 shrink-0 accent-amber-500"
                            aria-label={`选择 ${it.name}`}
                          />
                          {style && (
                            <span
                              className="size-8 shrink-0 rounded-lg border border-white/10"
                              style={{
                                background: `linear-gradient(135deg, ${style.bgFrom}, ${style.bgTo})`,
                                boxShadow: `inset 0 0 0 1px ${style.accent}22`,
                              }}
                              title={`花纹 ${style.pattern} · 点缀 ${style.accent}`}
                            />
                          )}
                          <input
                            className="input w-36"
                            value={it.name}
                            onChange={(e) => setItem(i, "name", e.target.value)}
                            aria-label="酒名"
                          />
                          <input
                            className="input w-24"
                            value={it.category}
                            onChange={(e) => setItem(i, "category", e.target.value)}
                            aria-label="品类"
                          />
                          <input
                            className="input w-16"
                            type="number"
                            min={0}
                            value={it.abv}
                            onChange={(e) => setItem(i, "abv", Number(e.target.value))}
                            aria-label="酒精度"
                          />
                          <input
                            className="input w-16"
                            type="number"
                            min={0}
                            value={it.price}
                            onChange={(e) => setItem(i, "price", Number(e.target.value))}
                            aria-label="价格"
                          />
                        </div>
                        <input
                          className="input mt-2 w-full"
                          value={it.flavor}
                          onChange={(e) => setItem(i, "flavor", e.target.value)}
                          aria-label="风味"
                        />
                      </div>
                    );
                  })}
                </div>
                {importError && <Alert>{importError}</Alert>}
                <div className="flex justify-end gap-3 pt-2">
                  <button className="btn-ghost" onClick={closeImport}>取消</button>
                  <button
                    className="btn-primary"
                    onClick={() => void saveImported()}
                    disabled={importSaving || importChecked.length === 0}
                  >
                    {importSaving ? "导入中…" : `导入所选 ${importChecked.length} 款`}
                  </button>
                </div>
              </div>
            )}
        </Modal>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除酒款"
        danger
        busy={deleteBusy}
        confirmText="删除"
        description={
          pendingDelete && (
            <>
              确定删除「{pendingDelete.name}」？已有会话数据不受影响，但统计将无法关联。
              {deleteError && <Alert className="mt-3">{deleteError}</Alert>}
            </>
          )
        }
        onConfirm={() => void remove()}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError("");
        }}
      />
    </div>
  );
}
