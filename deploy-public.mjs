#!/usr/bin/env node
/**
 * 公网部署脚本（云端架构）
 *  - 商家端前端 → Cloudflare Pages 经典版（固定网址，pages.dev 大陆可访问）
 *  - 后端 API → 同项目 Pages Functions（/api + KV），无需本机服务/隧道
 *  - 产品介绍站 → Cloudflare Pages 经典版（固定网址）
 * 前置：已注册 Cloudflare 账号并执行过 npx wrangler login；Pages 项目已创建
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MERCHANT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_DIR = "/Users/dylanyeung/微醺印记-web";
const MERCHANT_URL = "https://tipsy-merchant.pages.dev";
const PRODUCT_URL = "https://tipsy-imprint.pages.dev";

function log(msg) {
  console.log(`\n[deploy] ${msg}`);
}

function run(cmd, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`)),
    );
  });
}

async function main() {
  // 清理旧 pages 流程留下的部署缓存（会阻塞 wrangler deploy）
  for (const dir of [MERCHANT_DIR, PRODUCT_DIR]) {
    const stale = path.join(dir, ".wrangler", "deploy", "config.json");
    if (fs.existsSync(stale)) {
      fs.rmSync(stale);
      log(`已清理旧部署缓存 ${stale}`);
    }
  }

  log(`构建商家端（同域 /api，产品站互链=${PRODUCT_URL}）…`);
  await run("npm", ["run", "build"], MERCHANT_DIR, {
    VITE_PRODUCT_URL: PRODUCT_URL,
  });
  log("部署商家端 → 经典 Pages（前端 + Pages Functions/KV）…");
  await run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name", "tipsy-merchant"], MERCHANT_DIR);

  log(`构建产品站（商家端互链=${MERCHANT_URL}）…`);
  await run("npm", ["run", "build"], PRODUCT_DIR, {
    VITE_MERCHANT_URL: MERCHANT_URL,
  });
  log("部署产品站 → 经典 Pages …");
  await run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name", "tipsy-imprint"], PRODUCT_DIR);

  console.log("\n========== 部署完成 ==========");
  console.log(`产品介绍站:  ${PRODUCT_URL}`);
  console.log(`商家数据台:  ${MERCHANT_URL}（前端 + 云端 API，无需本机开机）`);
}

main().catch((error) => {
  console.error(`\n[deploy] 失败: ${error.message}`);
  process.exit(1);
});
