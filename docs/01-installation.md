# 01 — Installation

[English](#english) | [中文](#中文)

## English

This guide installs PolyPulse on a Linux or macOS machine. Windows works with WSL2 recommended.

---

## Step 1: Check prerequisites

### Node.js (required)

PolyPulse needs **Node.js 20 or newer**.

```bash
node -v    # should print v20.x or v22.x
npm -v     # should print 10.x or similar
```

If Node is missing:

- **Ubuntu/Debian:** `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- **macOS:** install from [nodejs.org](https://nodejs.org/) or use `brew install node`

### Git (optional)

Only needed if you clone from a repository:

```bash
git --version
```

### Disk space

Allow at least **2 GB** free. The `data/` folder grows over time as JSONL files accumulate.

---

## Step 2: Get the project

If you already have the folder, skip to Step 3.

```bash
cd ~
git clone <your-repo-url> polymarket-multi-tool-ts
cd polymarket-multi-tool-ts
```

Or unzip/copy the project folder to a path you remember, e.g. `/root/polymarket-multi-tool-ts`.

---

## Step 3: Create your config file

PolyPulse reads settings from a `.env` file in the project root.

```bash
cp .env.example .env
```

Open `.env` in any text editor. For your **first install**, leave live trading disabled:

```env
LIVE_TRADING_ENABLED=false
```

You will add wallet keys later in [05 — Live trading](05-live-trading.md).

---

## Step 4: Install dependencies

From the project root:

```bash
npm install
```

This downloads all packages for the monorepo (`@pmt/shared`, collector, dashboard, strategies).

**Expected time:** 1–3 minutes depending on network.

If you see audit warnings about vulnerabilities, they are usually in dev dependencies and do not block running the app.

---

## Step 5: Build TypeScript

```bash
npm run build
```

This compiles all four packages into their `dist/` folders.

**Success looks like:** no red error lines; command exits with code 0.

If build fails, see [08 — Troubleshooting](08-troubleshooting.md).

---

## Step 6: Verify folder structure

You should have:

```
polymarket-multi-tool-ts/
├── .env              ← you created this
├── node_modules/     ← from npm install
├── packages/
│   ├── shared/dist/
│   ├── collector/dist/
│   ├── dashboard/dist/
│   └── strategies/dist/
└── package.json
```

---

## Next step

Continue to **[02 — First run](02-first-run.md)** to start the bot and open the dashboard.

---

## 中文

本指南在 Linux 或 macOS 机器上安装 PolyPulse。Windows 建议使用 WSL2。

---

### 第 1 步：检查前提条件

#### Node.js（必需）

PolyPulse 需要 **Node.js 20 或更新版本**。

```bash
node -v    # 应打印 v20.x 或 v22.x
npm -v     # 应打印 10.x 或类似版本
```

如果缺少 Node：

- **Ubuntu/Debian：** `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- **macOS：** 从 [nodejs.org](https://nodejs.org/) 安装或使用 `brew install node`

#### Git（可选）

仅在从存储库克隆时需要：

```bash
git --version
```

#### 磁盘空间

至少预留 **2 GB** 可用空间。`data/` 文件夹会随着 JSONL 文件累积而增长。

---

### 第 2 步：获取项目

如果已有文件夹，跳至第 3 步。

```bash
cd ~
git clone <your-repo-url> polymarket-multi-tool-ts
cd polymarket-multi-tool-ts
```

或解压/复制项目文件夹到你记得的路径，例如 `/root/polymarket-multi-tool-ts`。

---

### 第 3 步：创建配置文件

PolyPulse 从项目根目录中的 `.env` 文件读取设置。

```bash
cp .env.example .env
```

在任何文本编辑器中打开 `.env`。对于**首次安装**，禁用实时交易：

```env
LIVE_TRADING_ENABLED=false
```

你稍后将在 [05 — 实时交易](05-live-trading.md) 中添加钱包密钥。

---

### 第 4 步：安装依赖

从项目根目录：

```bash
npm install
npm run build
```

---

### 下一步

继续到 **[02 — 首次运行](02-first-run.md)** 启动机器人并打开仪表板。
