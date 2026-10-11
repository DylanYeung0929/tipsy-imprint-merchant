# 微醺印记 · 智能酒杯数据平台

酒吧场景的智能酒杯全栈系统：杯垫式传感器采集饮酒行为 → 电脑桥接上传云端 → 商家数据后台呈现行为事件、印记卡片与 AI 经营分析。

- 商家数据后台（本仓库）：https://tipsy-merchant.pages.dev
- 产品官网（[tipsy-imprint-web](https://github.com/DylanYeung0929/tipsy-imprint-web)）：https://tipsy-imprint.pages.dev

## 系统架构

```
┌──────────────┐   BLE 25Hz   ┌───────────────┐    HTTPS     ┌─────────────────────────┐
│ ESP32-C6 杯垫 │ ───────────→ │ ble_bridge.py │ ───────────→ │ Cloudflare Pages         │
│ FSR + MPU6050│  20B NOTIFY  │  电脑桥接      │  协议 v1      │ Functions + KV + D1      │
└──────────────┘              └───────────────┘              └────────────┬────────────┘
                                                                          │ 同域 /api
                                                              ┌───────────┴────────────┐
                                                              │ React 商家数据后台 (src/) │
                                                              └────────────────────────┘
```

## 目录结构

```
├── hardware/        # ESP32-C6 固件（Arduino + NimBLE）与电脑端 BLE → 云端桥接器
├── functions/       # Cloudflare Pages Functions 后端（同域 API）
├── src/             # Vite + React + TypeScript 商家数据后台（暗色黑金主题）
├── server/          # 已退役的本地分析服务（仅本地 dev 备用）
├── docs/            # 硬件对接协议文档（ESP 协议 v1）
├── schema.sql       # D1 建表（遥测 sessions / packets）
├── wrangler.jsonc   # Pages 项目绑定（KV / D1 / Workers AI）
└── deploy-public.mjs# 商家端 + 产品站一键构建部署
```

## 硬件

**固件 `hardware/CupSensorFinal.ino`**（Arduino IDE 烧录 ESP32-C6）

- MPU6050（I2C：D4=SDA / D5=SCL，400 kHz）+ FSR 压力传感（D1，12 位 ADC）
- 25 Hz 采样，20 字节打包包（`sampleNo/uptimeMs/fsrAdc/ax..gz`）经 BLE NOTIFY 广播
- BLE 设备名 `CupSensor-C6`；UUID 前缀 `6d3741xx-6b8f-4f0e-8b3a-3a25d74c2100`
- 依赖库：NimBLE-Arduino、Adafruit MPU6050
- 固件只做 BLE，不直连云端（约 10 m 内由电脑桥接上传）

**桥接器 `hardware/ble_bridge.py`**（Python + bleak）

```bash
pip install bleak
export TIPSY_DEVICE_KEY=<设备密钥>    # 密钥不入库，由管理员线下分发
python3 ble_bridge.py                # 真实硬件：扫描并连接 CupSensor-C6
python3 ble_bridge.py --simulate     # 无硬件联调：本机合成 25Hz 采样
python3 ble_bridge.py --simulate --demo   # 合成数据 + 自动建会话跑完整套动作
python3 ble_bridge.py --sniff        # 只看 BLE 链路，不连云
```

把 BLE 采样翻译为云端 ESP 协议 v1：轮询 command（WAIT/START/CONTINUE/STOP）、1 秒 25 样本一批、seq 单调递增 + ACK 重传（云端按 seq 幂等去重）、`/complete` 收尾后云端结算事件。交互键：`n` 新建会话 / `s` 请求停止 / `v` 查看事件 / `q` 退出（自动收尾）。

## 后端（Cloudflare Pages Functions，`functions/api/[[path]].js`）

- **鉴权**：PBKDF2-SHA256（5 万次）+ HMAC pepper，登录 token 存 KV（7 天 TTL）
- **存储**：KV（商家快照 / 配图短链），D1（遥测 sessions + packets，`INSERT OR IGNORE` 按 seq 幂等）
- **ESP 协议 v1**：设备侧 `X-Device-Key` 鉴权；`GET /api/v1/devices/{id}/command`、`POST .../telemetry-batches`、`POST .../sessions/{id}/complete`（校验 1..lastSeq 齐全）
- **行为事件识别**：compute-on-read，从原始采样识别 拿起 / 放下 / 小酌 / 摇晃 / 一饮而尽 与饮用量（ml）
- **AI 功能**：经营分析、酒单拍照导入 OCR、AI 配图（Workers AI flux）、AI 助手对话、印记文案
- **密钥管理**：`PASSWORD_PEPPER`、`DEVICE_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` 全部走 Cloudflare secrets / 本地 `.dev.vars`，不入库

## 前端（商家数据后台，`src/`）

Vite + React + TypeScript，暗色黑金主题，自托管 Playfair Display 衬线字体。

- **页面**：总览分析 / 实时体验（遥测曲线 + 行为事件）/ 数据接收（事件流 + AI 解读）/ 数据管理 / 用户管理 / 酒单配置（AI 拍照导入 + AI 配图）/ 印记卡片（SVG 花纹 + 一键导出 PNG）
- **AI 助手**：全局悬浮球，可拖拽，对话贴靠定位，携带酒单/会话/用户数据摘要做上下文

## 本地开发

```bash
npm install
npm run dev        # 前端 dev server（5174，/api 代理到 127.0.0.1:8787）
npx wrangler pages dev dist --port 8787   # 本地 Pages Functions（密钥来自 .dev.vars）
```

## 部署

```bash
node deploy-public.mjs   # 一次构建并部署商家端与产品站两站
```
