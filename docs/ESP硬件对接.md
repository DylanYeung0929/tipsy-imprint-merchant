# 微醺印记 · 智能酒杯（ESP32）数据上传对接文档

> 面向固件开发同学。后端已按本文档实现并上线，可直接联调。
> 协议基础：《ESP 与后端的对接》5 页规格，本文是它的落地版（含实际域名、鉴权、错误码与边界处理）。
> 更新日期：2026-09-17

## 0. 一页速览

硬件侧只需要 4 类信息：

| 类别 | 内容 |
|---|---|
| 服务地址 | 生产 `https://tipsy-merchant.pages.dev`；本地联调 `http://<后端电脑局域网IP>:8787`（调试期允许 HTTP） |
| 鉴权 | 请求头 `X-Device-Key: <设备密钥>`（密钥值由后端另行私下提供，请烧录进固件，勿提交到公开仓库） |
| 设备编号 | `deviceId`：读 Wi-Fi MAC 末 6 位十六进制 → `cup-base-8B3E7D` |
| 报文格式 | 3 个接口 + 统一响应信封（见 §3–§6） |

必须遵守的 5 条：

1. `seq` 从 1 开始逐包递增；
2. 只有收到 `ackSeq == 本包 seq` 才能删除该包；
3. 上传失败一律**用原数据、原 seq 重传**（后端按 `sessionId + seq` 幂等去重，不会重复入库）；
4. 收到 `STOP` 后停止产生新数据，先把缓存里不足 1 秒的尾包传完，再发 `complete`；
5. 设备端**不需要**做任何行为识别，只上传原始采样，识别与统计全部由后端完成。

## 1. 基础信息

| 项 | 值 |
|---|---|
| 调试环境 | `http://<后端所在电脑的局域网IP>:8787`（HTTP） |
| 生产环境 | `https://tipsy-merchant.pages.dev`（HTTPS） |
| 鉴权头 | `X-Device-Key: <密钥>`，所有 `/api/v1/devices/*` 请求必带 |
| 其他请求头 | `Content-Type: application/json` |
| 协议版本 | 请求与响应均带 `protocolVersion: 1`，非 1 返回 `UNSUPPORTED_VERSION` |
| deviceId 规则 | `cup-base-<Wi-Fi MAC 末6位hex大写>`，如 MAC `A4:CF:12:8B:3E:7D` → `cup-base-8B3E7D`；允许字符 `[A-Za-z0-9._-]`，长度 ≤64 |
| 采样 | 约 25 Hz 连续采样（每 40 ms 一组），FSR 402 + IMU（加速度 + 角速度） |
| 分包 | 每 1 秒一包 ≈ 25 组样本；**每包允许 1–120 组**，请求体 ≤ 32 KB |
| 轮询 | 空闲时每 2 秒查询一次命令 |
| 用户信息 | ESP 不保存 userId，后端通过与小程序创建的会话关联 |

## 2. 完整时序（状态机）

```
        ┌─────────────────────────── 空闲 ───────────────────────────┐
        │  每 2s: GET .../command                                     │
        │     ↓ WAIT                    ↓ STOP（老板点了停止）          │
        │  继续轮询                 停止采样，缓存尾包补传                │
        │                             ↓ 尾包 ack(STOP)                │
        │                          POST .../complete { lastSeq }      │
        │     ↓ START ← 小程序下单     ↓ COMPLETED                     │
        └─────────────┬─────────────────────────────────────────────┘
                      ↓
   校准（短暂静置）→ 25Hz 采样 → 每秒打包 seq=1,2,3…
        ↓
   POST .../telemetry-batches（每包）
        ↓ 响应 CONTINUE + ackSeq          ← 收到与 seq 相同才删该包
        ↓ 响应 STOP   + ackSeq（首次）    → 停止采样，传尾包
        ↓ 响应 INVALID_*（校验失败）      → 修正后用**原 seq** 重发
```

关键点：

- `START` 只在会话第一次被投递（固件首次查询到该会话时返回），此后查询返回 `CONTINUE`；
- 会话进行中，轮询 `command` 也可能收到 `STOP`（老板点停止后，下一次轮询/下一次上传响应都会带 STOP）；
- 会话结束后设备回到空闲，清空 `sessionId` 与本地缓存。

## 3. 接口 ①：查询当前命令

```
GET /api/v1/devices/{deviceId}/command
Header: X-Device-Key: <密钥>
```

**无会话（WAIT）**

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466400000,
  "command": "WAIT", "sessionId": null, "ackSeq": null, "error": null }
```

**有新会话（START，仅投递一次）**

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466400000,
  "command": "START", "sessionId": "ses-0001", "ackSeq": null, "error": null }
```

**会话进行中（CONTINUE）** — `ackSeq` 为后端已收到的最大 seq：

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466401000,
  "command": "CONTINUE", "sessionId": "ses-0001", "ackSeq": 7, "error": null }
```

**老板已请求停止（STOP）**：

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466500000,
  "command": "STOP", "sessionId": "ses-0001", "ackSeq": 100, "error": null }
```

## 4. 接口 ②：上传数据包

```
POST /api/v1/devices/{deviceId}/telemetry-batches
Header: X-Device-Key: <密钥>
```

**请求（第 1 包，完整 25 组）**

```json
{
  "protocolVersion": 1,
  "sessionId": "ses-0001",
  "seq": 1,
  "batchStartMs": 1789466400000,
  "sampleRateHz": 25,
  "samples": [
    { "tMs": 0,   "fsrAdc": 2311, "ax": 0.12, "ay": -0.31, "az": 9.76, "gx": 1.2,  "gy": -0.8, "gz": 0.4 },
    { "tMs": 40,  "fsrAdc": 2308, "ax": 0.11, "ay": -0.29, "az": 9.77, "gx": 1.0,  "gy": -0.9, "gz": 0.5 },
    { "tMs": 960, "fsrAdc": 2297, "ax": 0.10, "ay": -0.30, "az": 9.75, "gx": 0.9,  "gy": -0.7, "gz": 0.3 }
  ]
}
```

**字段说明**

| 字段 | 类型 | 说明 |
|---|---|---|
| `protocolVersion` | int | 固定 1 |
| `sessionId` | string | 来自 `START` 响应 |
| `seq` | int ≥1 | 本会话数据包序号，从 1 递增 |
| `batchStartMs` | int | **本包第一组样本的 Unix 毫秒时间**（可与 `serverTimeMs` 校时，见 §7） |
| `sampleRateHz` | number | 采样率，固定 25 |
| `samples[].tMs` | int | 样本相对 `batchStartMs` 的毫秒偏移：0、40、80……960 |
| `samples[].fsrAdc` | int | FSR 402 原始 ADC 值（**不要换算重量，原值上报即可**） |
| `samples[].ax/ay/az` | number | 加速度，单位 m/s²，水平静置时 `az ≈ 9.81` |
| `samples[].gx/gy/gz` | number | 角速度，单位 deg/s |

**响应 — 正常（CONTINUE）**

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466401050,
  "command": "CONTINUE", "sessionId": "ses-0001", "ackSeq": 1, "error": null }
```

**响应 — 老板已请求停止（STOP）**，`ackSeq` 仍为刚上传那一包的 seq：

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466500000,
  "command": "STOP", "sessionId": "ses-0001", "ackSeq": 100, "error": null }
```

**重传与幂等**

- 同一个 `(sessionId, seq)` 重复上传：后端忽略重复数据，但**仍返回正常 ack**（`ackSeq = 该 seq`），固件可安全重传；
- 校验失败（`INVALID_PAYLOAD`）时数据不保存，固件用**原 seq** 修正后重发即可，无需跳号；
- 上传无 ack 时（超时/断网）：继续采样写下一块缓存，网络恢复后**按 seq 从缺的那包依次补传**。

## 5. 接口 ③：完成会话

收到 `STOP` 后：停止产生新数据 → 把缓存中剩余样本打包（可为不足 1 秒的小包，如 12 组）→ 等尾包 ack → 发：

```
POST /api/v1/devices/{deviceId}/sessions/{sessionId}/complete

{ "protocolVersion": 1, "lastSeq": 101 }
```

`lastSeq` = 本会话上传的最后一个包序号。后端校验 1..lastSeq **全部收齐**后返回：

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466501000,
  "command": "COMPLETED", "sessionId": "ses-0001", "ackSeq": 101, "error": null }
```

收到 `COMPLETED`：清除 `sessionId` 与缓存，回到空闲轮询。

若返回 `INCOMPLETE`（中间有缺包）：

```json
{ "protocolVersion": 1, "ok": false, "serverTimeMs": 1789466501200,
  "command": "ERROR", "sessionId": "ses-0001", "ackSeq": null,
  "error": { "code": "INCOMPLETE", "message": "数据未收齐（已收 100 包 / 声明 101，最大 seq 100），请补传后再试" } }
```

→ 用原 seq 补传缺失包，再重发 `complete`。重复调用 `complete` 是幂等的（已 COMPLETED 会再次返回 COMPLETED）。

## 6. 统一响应信封与错误码

所有响应都是：

```json
{ "protocolVersion": 1, "ok": true, "serverTimeMs": 1789466400000,
  "command": "CONTINUE", "sessionId": "ses-0001", "ackSeq": 1, "error": null }
```

`command` 取值：`WAIT` / `START` / `CONTINUE` / `STOP` / `COMPLETED` / `ERROR`。

出错时 `ok: false`、`command: "ERROR"`、`error: { code, message }`：

| code | 触发场景 | 设备侧处理 |
|---|---|---|
| `UNAUTHORIZED` | `X-Device-Key` 缺失或错误 | 检查密钥烧录；不要重试轰炸 |
| `UNSUPPORTED_VERSION` | `protocolVersion` ≠ 1 | 固件写死 1 |
| `BAD_REQUEST` | 请求体不是合法 JSON / 过大 | 检查序列化 |
| `INVALID_PAYLOAD` | 字段缺失、类型错、样本数 0 或 >120 | 修正后用原 seq 重发 |
| `INVALID_SESSION` | 会话不存在 / 不属于该设备 / 已结束 | 丢弃本地 `sessionId`，回空闲轮询 |
| `INCOMPLETE` | `complete` 时缺包 | 补包后重发 `complete` |
| `DB_UNAVAILABLE` / `NOT_FOUND` | 后端瞬时问题 | 退避重试（1s→2s→4s…上限 30s） |

## 7. 固件侧实现建议

- **校时**：`batchStartMs` 必须是 Unix 毫秒。最简单的做法：首次收到 `serverTimeMs` 时记录 `offset = serverTimeMs - millis()`，之后 `batchStartMs = millis() + offset`。
- **缓存**：至少 2–3 块包缓冲（正在采样 / 待确认 / 重传）。
- **采样等间隔**：`tMs` 必须真实反映 40 ms 间隔（不要事件驱动补写），倾角与摇晃识别依赖时间精度。
- **IMU 安装**：请保持 `az` 轴与杯底法线一致（水平静置 `az ≈ +9.81`），最终安装朝向与符号约定请写在交付说明里（后端倾角算法为 `acos(az / |a|)`）。
- **IMU 量程建议**：±2 g / ±250~500 dps，摇晃识别看的是角速度峰值（≥90°/s）与过零次数。
- **FSR**：原值上报，交付时请附**空杯 / 满杯的 ADC 参考值**，后端据此标定「ADC → ml」换算（当前默认 10 单位 ≈ 1 ml）。
- **HTTPS**：生产环境走 TLS，ESP-IDF 用 `esp_crt_bundle` 即可；调试阶段先用 HTTP。
- **不要在设备端做行为识别**：拿起 / 放下 / 饮用 / 摇晃 / 一饮而尽全部由后端从原始采样推导。

## 8. 后端如何消费这些数据（为什么这样采样）

后端从 25 Hz 原始采样实时识别 5 类行为事件，并展示在老板数据台（数据接收页 / 数据分析页）：

| 事件 | 当前识别规则（初值，待实机标定） |
|---|---|
| 拿起酒杯 | FSR 连续低于静息基线 50% |
| 放回桌面 | 承重回升并稳定 |
| 饮用 | 倾角 ≥ 25° 且持续 ≥ 0.4 s |
| 摇晃 | 1 s 窗口内角速度峰值 ≥ 90°/s 且过零 ≥ 4 次 |
| 一饮而尽 | 单次持续倾角 ≥ 3 s |
| 饮用量 | 放下前后承重差 ÷ 10（单位→ml） |

实机数据回来后会一起调阈值；固件**不需要**输出这些事件或饮用量。

## 9. 自测与联调工具（后端已备）

| 工具 | 用途 |
|---|---|
| `esp-sim.mjs` | 协议模拟器：完整跑一遍 22 项断言（WAIT/START/上传/去重重传/STOP/尾包/INCOMPLETE/COMPLETED） |
| `esp-scenario.mjs` | 剧本喂数器：模拟一场真实饮酒（小酌→摇晃→一饮而尽），带 6 项识别自断言 |
| `esp-feed.mjs` | 持续正弦喂数，配合「实时体验」页看曲线 |

```bash
node esp-sim.mjs http://localhost:8787        # 本地
node esp-sim.mjs https://tipsy-merchant.pages.dev   # 生产
```

curl 快速自检（把 `DEVICE_KEY` 换成真实密钥）：

```bash
curl -H "X-Device-Key: $DEVICE_KEY" \
  https://tipsy-merchant.pages.dev/api/v1/devices/cup-base-8B3E7D/command
```

**联调清单**

- [ ] `command` 无密钥返回 `UNAUTHORIZED`，带正确密钥返回 `WAIT`
- [ ] 小程序下单后 2 s 内收到 `START` 与 `sessionId`
- [ ] 每秒上传一包，`ackSeq` 与 `seq` 一致后才删包
- [ ] 断网 10 s 后恢复：按 seq 补传，后端无重复数据
- [ ] 同 seq 重发两次：均返回相同 ackSeq
- [ ] 老板点「停止体验」：下一次上传/轮询收到 `STOP`
- [ ] 尾包上传后 `complete(lastSeq)` 返回 `COMPLETED`
- [ ] 会话结束后 `command` 回到 `WAIT`

## 10. 待双方确认

1. 最终 deviceId 清单（每台杯垫的 MAC）与密钥分发方式（建议线下提供）；
2. IMU / FSR 实际安装朝向、量程与符号约定；
3. 空杯 / 满杯 FSR ADC 参考值（用于 ml 标定）；
4. 传感器校准时长与规范（规格中「短暂校准」，建议静置 ≥1 s 并在首包前完成）。
