#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ble_bridge.py — 智能酒杯 ↔ 微醺印记云端 桥接器

CupSensorFinal.ino 只通过 BLE 广播 20 字节采样包（25Hz，NOTIFY），
本脚本在电脑上把 BLE 采样翻译成云端 ESP 协议 v1：

  GET  /api/v1/devices/{id}/command                 轮询 WAIT / START / CONTINUE / STOP
  POST /api/v1/devices/{id}/telemetry-batches       1 秒 25 个样本一批，seq 从 1 单调递增
  POST /api/v1/devices/{id}/sessions/{id}/complete  全部 ACK 后收尾，云端才会结算事件

用法：
  pip install bleak
  export TIPSY_DEVICE_KEY=<Cloudflare 上的 DEVICE_KEY>
  python3 ble_bridge.py                     # 真实硬件：扫描并连接 CupSensor-C6
  python3 ble_bridge.py --simulate          # 无硬件联调：本机合成 25Hz 采样
  python3 ble_bridge.py --simulate --demo   # 合成数据 + 自动建会话 + 跑完整套动作并收尾

交互键：n 新建会话 / s 请求停止 / v 查看事件 / q 退出（q 会先收尾进行中的会话）
（n 走匿名接口；s、v 需要商家登录 Cookie，用 --cookie "tipsy_session=..." 提供）
"""

import argparse
import asyncio
import json
import math
import os
import random
import ssl
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import deque

try:
    import certifi
except ImportError:
    certifi = None

# 必须与 CupSensorFinal.ino / 云端一致
DEVICE_NAME = "CupSensor-C6"
SERVICE_UUID = "6d374100-6b8f-4f0e-8b3a-3a25d74c2100"
DATA_UUID = "6d374101-6b8f-4f0e-8b3a-3a25d74c2100"

PACKET = struct.Struct("<HIHhhhhhh")  # sampleNo u16, uptimeMs u32, fsrAdc u16, ax..gz i16×6
SAMPLE_INTERVAL_MS = 40               # 25Hz
SAMPLES_PER_BATCH = 25                # 1 秒一批，正好 1 个 ACK
PROTOCOL_VERSION = 1
DEVICE_ONLINE_POLL_S = 2.0            # 轮询 command 的间隔
RETRANSMIT_AFTER_S = 3.0              # 超过该时长没被 ACK 就重传（云端 INSERT OR IGNORE 幂等）
FLUSH_TAIL_MS = 1000                  # 批内设备时间跨度达到 1 秒就发（不足 25 个样本时）
FLUSH_STALL_S = 2.0                   # 设备卡住不动时的墙钟兜底

# 与云端 EVENT_TUNING 对齐（functions/api/[[path]].js）
UNITS_PER_ML = 10.0                   # FSR 计数 → 毫升
ENCODE_ACC = 100.0                    # 固件里加速度放大 100 倍
ENCODE_GYRO = 10.0                    # 固件里角速度放大 10 倍

LOG_LOCK = threading.Lock()


def log(msg):
    with LOG_LOCK:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def wall_ms():
    return time.time() * 1000.0


def err_text(payload):
    """云端错误字段可能是 {code,message} 也可能是普通字符串（如 WAF/404），统一成一行。"""
    err = payload.get("error") if isinstance(payload, dict) else payload
    if isinstance(err, dict):
        return " ".join(str(v) for v in (err.get("code"), err.get("message")) if v) or "ERROR"
    return str(err or payload.get("code") or "ERROR")


# ---------------------------------------------------------------- 云端客户端

class Cloud:
    """ESP 协议 v1 的极简 HTTP 客户端（stdlib，够用不引依赖）。"""

    def __init__(self, base_url, device_key, cookie=None, timeout=10.0):
        self.base = base_url.rstrip("/")
        self.device_key = device_key
        self.cookie = cookie
        self.timeout = timeout
        self.ctx = ssl.create_default_context(cafile=certifi.where() if certifi else None)

    def request(self, method, path, body=None, device=False):
        """返回 (status, payload)；status=0 表示网络/传输层失败。"""
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        # Cloudflare 会拦 Python-urllib 默认 UA（error 1010），带一个明确的自报家门
        req.add_header("User-Agent", "CupSensorBridge/1.0 (ESP32-C6 BLE)")
        if device:
            req.add_header("X-Device-Key", self.device_key)
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as err:
            raw = err.read().decode(errors="replace")
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = {"error": raw[:200]}
            return err.code, payload
        except Exception as err:  # 断网、超时、证书问题
            return 0, {"error": f"{type(err).__name__}: {err}"}

    def command(self, device_id):
        return self.request("GET", f"/api/v1/devices/{device_id}/command", device=True)

    def send_batch(self, device_id, payload):
        return self.request("POST", f"/api/v1/devices/{device_id}/telemetry-batches", payload, device=True)

    def complete(self, device_id, session_id, last_seq):
        return self.request(
            "POST",
            f"/api/v1/devices/{device_id}/sessions/{session_id}/complete",
            {"protocolVersion": PROTOCOL_VERSION, "lastSeq": last_seq},
            device=True,
        )

    def create_session(self, user_id, device_id, drink=None):
        return self.request("POST", "/api/v1/sessions", {"userId": user_id, "deviceId": device_id, "drink": drink})

    def stop_session(self, session_id):
        return self.request("POST", f"/api/v1/sessions/{session_id}/stop")

    def events(self, session_id):
        return self.request("GET", f"/api/v1/sessions/{session_id}/events")


# ---------------------------------------------------------------- 样本队列

class Sample:
    __slots__ = ("epoch_ms", "recv_mono", "uptime_ms", "no", "fsr", "ax", "ay", "az", "gx", "gy", "gz")

    def __init__(self, epoch_ms, uptime_ms, no, fsr, ax, ay, az, gx, gy, gz):
        self.epoch_ms = epoch_ms         # 云端时钟（校时后），写进 batchStartMs
        self.recv_mono = time.monotonic()  # 本机单调钟，只用于积压判定，不受校时抖动影响
        self.uptime_ms = uptime_ms
        self.no = no
        self.fsr = fsr
        self.ax = ax
        self.ay = ay
        self.az = az
        self.gx = gx
        self.gy = gy
        self.gz = gz


# ---------------------------------------------------------------- 会话发送器

class SessionSender(threading.Thread):
    """轮询云端指令，把队列里的采样按 1 秒一批发出去，直到收尾。"""

    def __init__(self, cloud, device_id, stop_evt):
        super().__init__(daemon=True)
        self.cloud = cloud
        self.device_id = device_id
        self.stop_evt = stop_evt
        self.queue = deque()
        self.lock = threading.Lock()
        self.epoch_offset_ms = 0.0     # 本地墙钟 → 云端时钟
        self.session_id = None
        self.seq = 0
        self.pending = {}              # seq -> (payload, sent_at_mono, attempts)
        self.buffer = []               # 当前批次的样本
        self.last_sample_mono = 0.0    # 最后一个样本的到达时刻（判设备是否停推）
        self.stats = {"samples": 0, "sent": 0, "resend": 0, "dropped": 0, "lost": 0}
        self.last_no = None
        self.state = "空闲"
        self._last_poll = 0.0
        self._last_status = 0.0
        self._stop_seen = False
        self.sent_all = {}             # seq -> payload（收尾补传用，INSERT OR IGNORE 幂等）
        # 收尾只能在发送线程里做：seq/pending 不是线程安全的，跨线程 flush 会撞号产生空洞
        self._finish_target = None
        self._finish_done = threading.Event()

    # --- 采样入口（BLE 回调 / 模拟器线程调用）
    def push(self, sample):
        with self.lock:
            self.queue.append(sample)

    def _drain(self):
        with self.lock:
            items = list(self.queue)
            self.queue.clear()
        return items

    # --- 主循环
    def run(self):
        while not self.stop_evt.is_set():
            now = time.monotonic()
            if now - self._last_poll >= DEVICE_ONLINE_POLL_S:
                self._last_poll = now
                self._poll()
            samples = self._drain()
            if samples:
                self._ingest(samples)
            self._flush(force=False)
            self._retransmit()
            if self._finish_target:
                target, self._finish_target = self._finish_target, None
                self._finish(target)
                self._finish_done.set()
            if now - self._last_status >= 5.0:
                self._last_status = now
                self._print_status()
            time.sleep(0.05)

    def _poll(self):
        started = time.monotonic()
        status, payload = self.cloud.command(self.device_id)
        rtt_ms = (time.monotonic() - started) * 1000
        if status != 200 or not payload.get("ok"):
            log(f"轮询失败（HTTP {status}）：{err_text(payload)}")
            return
        # 用服务器时间锚定本地钟：样本时间戳才和云端事件时间线一致
        self.epoch_offset_ms = payload["serverTimeMs"] + rtt_ms / 2 - wall_ms()
        command = payload.get("command")
        sid = payload.get("sessionId")
        if command == "WAIT":
            if self.session_id:
                log("会话已被云端清除，回到空闲")
                self._reset_session()
            self.state = "空闲（等待扫码/建会话）"
        elif command == "START":
            self._adopt(sid, None)
            self.state = f"进行中 {sid}"
            log(f"收到 START → {sid}")
        elif command == "CONTINUE":
            self._adopt(sid, payload.get("ackSeq"))
            self.state = f"进行中 {sid}"
        elif command == "STOP":
            if self.session_id != sid:
                self._adopt(sid, payload.get("ackSeq"))
            self.state = "收尾中"
            self._finish_target = sid      # 交给 run() 在主循环里收尾
        elif command == "ERROR":
            log(f"设备鉴权/协议错误：{err_text(payload)}")

    def _adopt(self, session_id, ack_seq):
        """进入（或重连进）一个会话；桥接器中途重启时从 ackSeq+1 续传。"""
        if self.session_id == session_id:
            return
        self.session_id = session_id
        self.pending.clear()
        self.buffer.clear()
        self._stop_seen = False
        self.sent_all.clear()
        self.seq = max(1, int(ack_seq or 0) + 1) if ack_seq else 1

    def _reset_session(self):
        self.session_id = None
        self.seq = 0
        self.pending.clear()
        self.buffer.clear()
        self._stop_seen = False
        self.sent_all.clear()

    def _ingest(self, samples):
        for s in samples:
            if self.last_no is not None:
                expected = (self.last_no + 1) & 0xFFFF
                if s.no != expected:
                    gap = (s.no - expected) & 0xFFFF
                    self.stats["lost"] += gap
            self.last_no = s.no
            self.stats["samples"] += 1
            if self.session_id is None:
                self.stats["dropped"] += 1
                continue
            self.buffer.append(s)
            self.last_sample_mono = s.recv_mono

    def _close_batch(self, samples):
        first = samples[0]
        payload = {
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": self.session_id,
            "seq": self.seq,
            "batchStartMs": int(round(first.epoch_ms)),
            "sampleRateHz": 1000.0 / SAMPLE_INTERVAL_MS,
            "samples": [
                {
                    "tMs": s.uptime_ms - first.uptime_ms,   # 批内偏移用设备自己的时钟，免受 BLE 抖动影响
                    "fsrAdc": s.fsr,
                    "ax": s.ax, "ay": s.ay, "az": s.az,
                    "gx": s.gx, "gy": s.gy, "gz": s.gz,
                }
                for s in samples
            ],
        }
        self.pending[self.seq] = [payload, time.monotonic(), 0]
        self.sent_all[self.seq] = payload
        if len(self.sent_all) > 2000:      # 约 33 分钟会话，够用且不涨内存
            self.sent_all.pop(min(self.sent_all))
        self.seq += 1
        self._post(payload)

    def _flush(self, force):
        # 切满批时会剩下零头（采样是成串到达的，一批可能落到 26 个），零头继续攒
        while len(self.buffer) >= SAMPLES_PER_BATCH:
            self._close_batch(self.buffer[:SAMPLES_PER_BATCH])
            del self.buffer[:SAMPLES_PER_BATCH]
        if not self.buffer:
            return
        span_ms = self.buffer[-1].uptime_ms - self.buffer[0].uptime_ms
        idle_ms = (time.monotonic() - self.last_sample_mono) * 1000 if self.last_sample_mono else 0.0
        if force or span_ms >= FLUSH_TAIL_MS or idle_ms >= FLUSH_STALL_S * 1000:
            self._close_batch(self.buffer[:])
            self.buffer.clear()

    def _post(self, payload):
        seq = payload["seq"]
        status, resp = self.cloud.send_batch(self.device_id, payload)
        if status == 0:
            # 必须留痕：静默 return 的话，后面任何一批的 ACK 都会把它连带清出 pending，变成永久空洞
            log(f"批次 seq={seq} 传输失败，等重传")
            return
        self.stats["sent"] += 1
        if not resp.get("ok"):
            code = (resp.get("error") or {}).get("code") if isinstance(resp.get("error"), dict) else ""
            log(f"批次 seq={seq} 被拒：{err_text(resp)}")
            if code in ("INVALID_SESSION", "UNSUPPORTED_VERSION"):
                self._reset_session()
            return
        # 云端回的是本批自己的 seq，只清本批；按 ≤ 清会把中间失败的批次一起抹掉
        self._ack(seq, resp.get("command"))

    def _ack(self, ack_seq, command):
        if ack_seq:
            self.pending.pop(ack_seq, None)
        if command == "STOP" and not self._stop_seen:
            self._stop_seen = True
            log("批次 ACK 里带回 STOP，准备收尾")

    def _retransmit(self):
        now = time.monotonic()
        for seq in sorted(self.pending):
            if seq not in self.pending:  # 上一轮 _post 的 ACK 可能已把它清掉
                continue
            payload, sent_at, attempts = self.pending[seq]
            if now - sent_at < RETRANSMIT_AFTER_S:
                continue
            self.pending[seq][1] = now
            self.pending[seq][2] = attempts + 1
            if attempts == 0:
                log(f"seq={seq} 未确认，重传")
            self.stats["resend"] += 1
            self._post(payload)

    def _finish(self, session_id):
        log(f"收到 STOP → 收尾 {session_id}")
        self.state = "收尾中"
        with self.lock:   # 停采：把队列里剩下的样本也带上（设备可能还在推）
            tail = list(self.queue)
            self.queue.clear()
        if tail:
            self._ingest(tail)
        self._flush(force=True)

        last_seq = self.seq - 1
        deadline = time.monotonic() + 20
        while self.pending and time.monotonic() < deadline and not self.stop_evt.is_set():
            self._retransmit()
            time.sleep(0.5)
        if self.pending:
            log(f"收尾中止：还有 {len(self.pending)} 批没被确认（{sorted(self.pending)[:5]}…）")
            self._reset_session()
            self.state = "空闲"
            return
        if last_seq < 1:
            log("本场没有采到任何数据，无法完成会话")
            self._reset_session()
            self.state = "空闲"
            return

        resent = False
        for _ in range(4):
            status, resp = self.cloud.complete(self.device_id, session_id, last_seq)
            if status == 200 and resp.get("ok"):
                log(f"会话 COMPLETED：{session_id}（共 {last_seq} 批 / {self.stats['samples']} 样本）")
                break
            text = err_text(resp)
            log(f"complete 失败：{text}")
            if "COMPLETED" in text:
                break
            if "INCOMPLETE" in text and not resent and self.sent_all:
                # 云端按 seq 幂等入库，整场重发一遍即可补齐空洞
                resent = True
                log(f"检测到缺包，重发本场 {len(self.sent_all)} 批补齐…")
                for sq in sorted(self.sent_all):
                    self._post(self.sent_all[sq])
            else:
                time.sleep(1.0)
        else:
            log("complete 连续失败：会话仍是进行中，重启桥接器会从末位 seq 续传")
        self._reset_session()
        self.state = "空闲"

    def _print_status(self):
        s = self.stats
        log(
            f"状态={self.state} 样本={s['samples']} 已发批={s['sent']} 待确认={len(self.pending)} "
            f"重传={s['resend']} BLE丢包={s['lost']} 会话外丢弃={s['dropped']}"
        )

    # --- 操作台
    def create_session(self, user_id, drink):
        status, resp = self.cloud.create_session(user_id, self.device_id, drink)
        if resp.get("ok"):
            log(f"已建会话 {resp.get('sessionId')}，等设备 START（轮询 ≤{DEVICE_ONLINE_POLL_S:.0f}s）")
        else:
            log(f"建会话失败（{resp.get('code') or err_text(resp)}）：{resp.get('error') or ''}")

    def finish_now(self):
        """演示/自测用：不等商家点「停止体验」，直接收尾（云端允许 ACTIVE 直接 complete）。"""
        if not self.session_id:
            log("演示收尾跳过：还没有进行中的会话")
            return
        log("演示模式：跳过 STOP，直接收尾")
        self._finish_done.clear()
        self._finish_target = self.session_id
        self._finish_done.wait(90)

    def request_stop(self):
        if not self.session_id:
            log("当前没有进行中的会话")
            return
        if not self.cloud.cookie:
            log("停止需要商家 Cookie：在商家端登录后从浏览器复制，或直接用页面上的「停止体验」")
            return
        status, resp = self.cloud.stop_session(self.session_id)
        log(f"停止请求：{resp.get('status') or resp.get('error')}")

    def show_events(self, session_id=None):
        sid = session_id or self.session_id
        if not sid:
            log("没有会话可查看（可用 --watch <sessionId> 查历史）")
            return
        if not self.cloud.cookie:
            log("查看事件需要商家 Cookie（--cookie），或在页面「实时体验」里看")
            return
        status, resp = self.cloud.events(sid)
        if not resp.get("ok"):
            log(f"取事件失败：{resp.get('error')}")
            return
        events = resp.get("events") or []
        log(f"会话 {sid} 状态={resp.get('status')} 事件 {len(events)} 条")
        for e in events:
            log(f"  {time.strftime('%H:%M:%S', time.localtime(e['tsMs'] / 1000))}  {e['type']:<8} {e.get('value', '')}")


# ---------------------------------------------------------------- BLE 接收

async def ble_loop(sender, args, stop_evt):
    from bleak import BleakClient, BleakScanner

    def matcher(device, adv):
        name = device.name or (getattr(adv, "local_name", None) if adv else None)
        if name == args.device_name:
            return True
        # 固件的 advertising->setName() 只写 scan response，广播里常常没有名字，用服务 UUID 兜底
        return bool(adv and SERVICE_UUID in [str(u).lower() for u in adv.service_uuids])

    while not stop_evt.is_set():
        log(f"扫描 {args.device_name} …")
        try:
            device = await BleakScanner.find_device_by_filter(matcher, timeout=args.scan_timeout)
        except Exception as err:
            log(f"扫描失败：{err}")
            await asyncio.sleep(2)
            continue
        if device is None:
            log("没找到设备：确认杯子已上电、未被手机 App 占用")
            continue

        disconnected = asyncio.Event()

        def on_notify(_char, data):
            if len(data) != PACKET.size:
                log(f"包长异常 {len(data)}，期望 {PACKET.size}")
                return
            no, uptime, fsr, ax, ay, az, gx, gy, gz = PACKET.unpack(data)
            sender.push(Sample(
                wall_ms() + sender.epoch_offset_ms, uptime, no, fsr,
                ax / ENCODE_ACC, ay / ENCODE_ACC, az / ENCODE_ACC,
                gx / ENCODE_GYRO, gy / ENCODE_GYRO, gz / ENCODE_GYRO,
            ))

        try:
            async with BleakClient(device, disconnected_callback=lambda _c: disconnected.set()) as client:
                log(f"已连接 {device.address}，订阅 25Hz 数据")
                await client.start_notify(DATA_UUID, on_notify)
                await disconnected.wait()
                log("连接断开，重新扫描…")
        except Exception as err:
            log(f"连接失败：{err}")
            await asyncio.sleep(2)


# ---------------------------------------------------------------- 只监听不发送

class Sniffer:
    """--sniff：不碰云端，只打印解码后的采样，用来确认 BLE 链路与单位换算。"""

    epoch_offset_ms = 0.0

    def __init__(self, every=5):
        self.every = every
        self.n = 0
        self.t0 = time.monotonic()

    def push(self, s):
        self.n += 1
        if self.n % self.every:
            return
        rate = self.n / (time.monotonic() - self.t0)
        log(
            f"#{s.no:<6} {rate:4.1f}Hz  fsr={s.fsr:<5} "
            f"a=({s.ax:+.2f},{s.ay:+.2f},{s.az:+.2f}) g=({s.gx:+.1f},{s.gy:+.1f},{s.gz:+.1f})"
        )


# ---------------------------------------------------------------- 无硬件模拟

class Simulator(threading.Thread):
    """合成一段真实用法：静置 → 拿起 → 倾斜饮用 → 放回（重量减少）→ 摇晃 → 一饮而尽。

    数值按云端 EVENT_TUNING 设计：倾角 45°+ 触发 sip，持续 ≥3s 触发 chug，
    摇晃用 ±150dps、5Hz 方波凑够峰值与过零次数；总消耗控制在静息阈值以上。
    """

    def __init__(self, sender, stop_evt, rate_hz=25.0):
        super().__init__(daemon=True)
        self.sender = sender
        self.stop_evt = stop_evt
        self.interval = 1.0 / rate_hz
        self.weight = 3000.0   # FSR 原始计数（满杯）
        self.fsr = self.weight
        self.tilt = 0.0
        self.spin = 0.0
        self.no = 0
        self.tick = 0
        self.t0 = None

    # --- 原语：每个 tick 产出一个样本
    def _emit(self):
        # 绝对时间表：sleep 漂移不累积，设备时钟严格 40ms 一格
        delay = self.t0 + self.tick * self.interval - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        uptime_ms = int(round(self.tick * self.interval * 1000))
        self.tick += 1
        noise = lambda: random.gauss(0, 6)
        rad = math.radians(self.tilt)
        self.sender.push(Sample(
            wall_ms() + self.sender.epoch_offset_ms,
            uptime_ms,
            self.no & 0xFFFF,
            int(round(self.fsr + noise())),
            9.81 * math.sin(rad) / 1.0 + random.gauss(0, 0.05),
            random.gauss(0, 0.05),
            9.81 * math.cos(rad) + random.gauss(0, 0.05),
            random.gauss(0, 1.5), random.gauss(0, 1.5),
            self.spin + random.gauss(0, 3.0),
        ))
        self.no += 1

    def _hold(self, seconds, fsr_from, fsr_to, tilt_from, tilt_to, spin=0.0):
        steps = max(1, int(seconds * 25))
        for i in range(steps):
            k = (i + 1) / steps
            self.fsr = fsr_from + (fsr_to - fsr_from) * k
            self.tilt = tilt_from + (tilt_to - tilt_from) * k
            self.spin = spin
            self._emit()

    def run(self):
        random.seed(7)
        self.t0 = time.monotonic()
        plan = [
            ("静置（满杯）", dict(seconds=5, fsr_from=None, fsr_to=None, tilt_from=0, tilt_to=0)),
            ("拿起", dict(seconds=0.25, fsr_from=3000, fsr_to=120, tilt_from=0, tilt_to=0)),
            ("举杯", dict(seconds=0.3, fsr_from=120, fsr_to=120, tilt_from=0, tilt_to=50)),
            ("啜饮 25ml", dict(seconds=1.2, fsr_from=120, fsr_to=120, tilt_from=50, tilt_to=50)),
            ("回正", dict(seconds=0.3, fsr_from=120, fsr_to=120, tilt_from=50, tilt_to=0)),
            ("放回（少 25ml）", dict(seconds=0.25, fsr_from=120, fsr_to=2750, tilt_from=0, tilt_to=0)),
            ("静置", dict(seconds=3, fsr_from=None, fsr_to=None, tilt_from=0, tilt_to=0)),
            ("拿起", dict(seconds=0.25, fsr_from=2750, fsr_to=120, tilt_from=0, tilt_to=0)),
            ("举杯", dict(seconds=0.3, fsr_from=120, fsr_to=120, tilt_from=0, tilt_to=45)),
            ("啜饮 25ml", dict(seconds=1.2, fsr_from=120, fsr_to=120, tilt_from=45, tilt_to=45)),
            ("回正", dict(seconds=0.3, fsr_from=120, fsr_to=120, tilt_from=45, tilt_to=0)),
            ("放回（少 25ml）", dict(seconds=0.25, fsr_from=120, fsr_to=2500, tilt_from=0, tilt_to=0)),
            ("静置", dict(seconds=3, fsr_from=None, fsr_to=None, tilt_from=0, tilt_to=0)),
            ("拿起", dict(seconds=0.25, fsr_from=2500, fsr_to=120, tilt_from=0, tilt_to=0)),
            ("摇晃", dict(seconds=1.5, fsr_from=120, fsr_to=120, tilt_from=0, tilt_to=0, spin="shake")),
            ("放回（洒出 10ml）", dict(seconds=0.25, fsr_from=120, fsr_to=2400, tilt_from=0, tilt_to=0)),
            ("静置", dict(seconds=3, fsr_from=None, fsr_to=None, tilt_from=0, tilt_to=0)),
            ("拿起", dict(seconds=0.25, fsr_from=2400, fsr_to=120, tilt_from=0, tilt_to=0)),
            # 举杯要快、保持要久：云端按「倾角持续 ≥3 秒」判一饮而尽，慢慢抬起来是认不出的
            ("举杯倾斜", dict(seconds=0.4, fsr_from=120, fsr_to=120, tilt_from=0, tilt_to=70)),
            ("一饮而尽（保持）", dict(seconds=3.6, fsr_from=120, fsr_to=120, tilt_from=70, tilt_to=70)),
            ("放回（少 60ml）", dict(seconds=0.25, fsr_from=120, fsr_to=1800, tilt_from=0, tilt_to=0)),
            ("静置", dict(seconds=4, fsr_from=None, fsr_to=None, tilt_from=0, tilt_to=0)),
        ]
        for label, p in plan:
            if self.stop_evt.is_set():
                return
            log(f"[模拟] {label}")
            if p.get("spin") == "shake":
                self._shake(p["seconds"])
                continue
            fsr_from = self.fsr if p["fsr_from"] is None else p["fsr_from"]
            fsr_to = fsr_from if p["fsr_to"] is None else p["fsr_to"]
            self._hold(p["seconds"], fsr_from, fsr_to, p["tilt_from"], p["tilt_to"])
        log("[模拟] 动作跑完，保持静止（按 s 停止 / q 退出）")

    def _shake(self, seconds):
        steps = int(seconds * 25)
        direction = 1.0
        for i in range(steps):
            self.fsr, self.tilt = 120, 0
            self.spin = 150.0 * direction * random.choice([1.0, 1.0, 0.9])
            if i % 3 == 2:          # 每 3 个样本（120ms）翻一次向 → 1 秒 ≥4 次过零
                direction = -direction
            self._emit()


# ---------------------------------------------------------------- 主流程

def parse_args():
    p = argparse.ArgumentParser(description="智能酒杯 BLE → 微醺印记云端 桥接器")
    p.add_argument("--base-url", default=os.environ.get("TIPSY_BASE_URL", "https://tipsy-merchant.pages.dev"))
    p.add_argument("--device-id", default=os.environ.get("TIPSY_DEVICE_ID", "cup-base-001"))
    p.add_argument("--device-key", default=os.environ.get("TIPSY_DEVICE_KEY", ""))
    p.add_argument("--device-name", default=DEVICE_NAME)
    p.add_argument("--user-id", default=os.environ.get("TIPSY_USER_ID", "bridge-demo"))
    p.add_argument("--drink-name", default="", help="建会话时带的酒名（可选）")
    p.add_argument("--cookie", default=os.environ.get("TIPSY_COOKIE", ""), help="商家登录 Cookie，用于 s/v 键")
    p.add_argument("--simulate", action="store_true", help="不连 BLE，本机合成 25Hz 数据")
    p.add_argument("--sniff", action="store_true", help="只连 BLE 打印采样，不建会话、不连云")
    p.add_argument("--demo", action="store_true", help="模拟模式：自动建会话并在动作跑完后停止收尾")
    p.add_argument("--watch", default="", help="查看指定会话的事件后退出（需要 --cookie）")
    p.add_argument("--scan-timeout", type=float, default=8.0)
    return p.parse_args()


def main():
    args = parse_args()

    if args.sniff:   # 纯链路体检：只看 BLE，不需要密钥、不碰云端
        log(f"监听模式：连接 {args.device_name}，只打印采样（Ctrl-C 退出）")
        try:
            asyncio.run(ble_loop(Sniffer(), args, threading.Event()))
        except KeyboardInterrupt:
            pass
        return

    if not args.device_key:
        sys.exit("缺少 DEVICE_KEY：export TIPSY_DEVICE_KEY=<Cloudflare 后台的值> 或用 --device-key 传入")
    if args.device_key.startswith("dev-"):
        sys.exit("DEVICE_KEY 看起来是占位值，请填真实密钥")

    cloud = Cloud(args.base_url, args.device_key, cookie=args.cookie or None)
    status, payload = cloud.command(args.device_id)
    if status != 200 or not payload.get("ok"):
        sys.exit(f"云端连通性/鉴权失败（HTTP {status}）：{err_text(payload)}（检查 --base-url 与 DEVICE_KEY）")

    stop_evt = threading.Event()
    sender = SessionSender(cloud, args.device_id, stop_evt)
    sender.start()
    log(f"云端 {args.base_url} 设备 {args.device_id}（{payload.get('command')}）")

    if args.watch:
        sender.show_events(args.watch)
        return
    if args.demo:
        sender.create_session(args.user_id, {"name": args.drink_name or "桥接演示酒"})

    def console():
        for line in sys.stdin:
            cmd = line.strip().lower()
            if cmd == "n":
                drink = {"name": args.drink_name} if args.drink_name else None
                sender.create_session(args.user_id, drink)
            elif cmd == "s":
                sender.request_stop()
            elif cmd == "v":
                sender.show_events()
            elif cmd == "q":
                if sender.session_id:
                    log("退出前先收尾进行中的会话…")
                    sender.finish_now()   # 不收尾就退出会留下卡住的会话，占住杯子
                stop_evt.set()
                return
            elif cmd:
                log("按键：n 新建会话 / s 请求停止 / v 查看事件 / q 退出")

    threading.Thread(target=console, daemon=True).start()

    if args.simulate:
        sim = Simulator(sender, stop_evt)
        sim.start()
        if args.demo:
            def autopilot():
                sim.join()
                sender.finish_now()
                time.sleep(1.0)     # 让收尾日志打完
                stop_evt.set()

            threading.Thread(target=autopilot, daemon=True).start()
        while not stop_evt.is_set():
            time.sleep(0.3)
    else:
        try:
            asyncio.run(ble_loop(sender, args, stop_evt))
        except KeyboardInterrupt:
            pass
        stop_evt.set()

    log("退出。若会话仍在进行，云端会在你下次启动桥接器后从末位 seq 续传。")


if __name__ == "__main__":
    main()
