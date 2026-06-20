# 02 — First run

[English](#english) | [中文](#中文)

## English

After installation, this guide starts PolyPulse and confirms everything works.

---

## Step 1: Start collector + dashboard

From the project root:

```bash
npm run dev
```

This command:

1. Rebuilds `@pmt/shared` (quick)
2. Starts **collector** (cyan logs) — feeds + data writer
3. Starts **dashboard** (magenta logs) — web server on port 3003

**Leave this terminal open.** Press `Ctrl+C` to stop both services.

---

## Step 2: Read the terminal output

### Collector (good signs)

```
PolyPulse collector starting
binance: connected
chainlink: connected
clob_ws: spawning
ipc server listening on /tmp/polypulse.sock
```

### Dashboard (good signs)

```
PolyPulse dashboard listening on http://0.0.0.0:3003
```

### Problems

| Message | Meaning |
|---------|---------|
| `EADDRINUSE` port 3003 | Another process uses port 3003 — stop it or change `DASHBOARD_BIND` in `.env` |
| `command not found: tsx` | Run `npm install` again |
| TypeScript errors on start | Run `npm run build` |

---

## Step 3: Open the dashboard

On the same machine:

**http://localhost:3003**

From another computer on your network (if firewall allows):

**http://YOUR_SERVER_IP:3003**

---

## Step 4: Check the connection badge

Top-right of the header:

| Status | Meaning |
|--------|---------|
| **connecting…** (red) | Dashboard started but collector not sending data yet — wait 10–30 s |
| **live** (green) | Collector connected via IPC — charts will update |
| Stays red > 1 min | Collector not running or wrong `IPC_PATH` — see troubleshooting |

---

## Step 5: Pick a market

1. Click a **coin** button (BTC, ETH, …)
2. Click a **timeframe** (5min, 15min, 1hour)
3. Charts should show:
   - Binance price + Chainlink PTB (left column)
   - YES / NO best ask (middle)
   - Strategy panel (right)

Data appears faster on **5min BTC** because those markets are most active.

---

## Step 6: Confirm data is being saved

After a few minutes:

```bash
ls data/prices/binance/
ls data/order_books/5min/BTC/
```

You should see `.jsonl` files growing. If `data/` stays empty, the collector is not writing — check collector logs.

---

## Step 7: Stop and restart

**Stop:** `Ctrl+C` in the terminal running `npm run dev`.

**Start again:**

```bash
npm run dev
```

**Run separately** (two terminals):

```bash
# Terminal 1
npm run collector

# Terminal 2
npm run dashboard
```

Use separate terminals when debugging which service failed.

---

## Step 8: Quick API check (optional)

With dashboard running:

```bash
curl -s http://localhost:3003/api/trading/status | head -c 200
curl -s http://localhost:3003/api/markets | head -c 200
```

Trading status shows paper vs live mode. Markets returns live snapshot JSON.

---

## Next step

Learn the UI in **[03 — Dashboard guide](03-dashboard.md)**.

---

## ??

???,????? PolyPulse ????????

---

### ? 1 ?:?? collector + dashboard

??????:

\\\ash
npm run dev
\\\

???:

1. ?? \@pmt/shared\(??)
2. ?? **collector**(????)� ??? + ?????
3. ?? **dashboard**(?????)� ?? **3003** ???????

**????????** ? \Ctrl+C\ ???????

---

### ? 2 ?:??????

#### Collector(????)

\\\
PolyPulse collector starting
binance: connected
chainlink: connected
clob_ws: spawning
ipc server listening on /tmp/polypulse.sock
\\\

#### Dashboard(????)

\\\
PolyPulse dashboard listening on http://0.0.0.0:3003
\\\

#### ??

| ?? | ?? |
|---------|---------|
| \EADDRINUSE\ ?? 3003 | ????????? 3003 � ?????? \.env\ ?? \DASHBOARD_BIND\ |
| \command not found: tsx\ | ???? \
pm install\ |
| TypeScript ?? | ?? \
pm run build\ |

---

### ? 3 ?:?????

???????:

**http://localhost:3003**

???????????(???????):

**http://YOUR_SERVER_IP:3003**

---

### ? 4 ?:??????

?????:

| ?? | ?? |
|--------|---------|
| **connecting�**(??) | ??????? collector ?????? � ?? 10-30 ? |
| **live**(??) | Collector ?? IPC ?? � ????? |
| ???? > 1 ?? | Collector ???? \IPC_PATH\ ?? � ?????? |

---

### ? 5 ?:????

1. ?? **coin** ??(BTC?ETH?�)
2. ?? **timeframe**(5min?15min?1hour)
3. ?????:
   - ???? + Chainlink PTB(??)
   - YES / NO ????(??)
   - ????(?)

**5min BTC** ???????,??????????

---

### ? 6 ?:???????

?????? \./data/\ ????????????????:

\\\ash
ls data/market_data/5min/BTC/
\\\

?????? \5m.jsonl\ ????????(??????????)?

---

## 中文

安装后，本指南启动 PolyPulse 并确认一切正常。

---

### 第 1 步：启动 collector + dashboard

从项目根目录：

\\\ash
npm run dev
\\\

此命令：

1. 重建 \@pmt/shared\（快速）
2. 启动 **collector**（青色日志）— 数据源 + 数据写入器
3. 启动 **dashboard**（品红色日志）— 端口 **3003** 上的网页服务器

**保持此终端打开。** 按 \Ctrl+C\ 停止两个服务。

---

### 第 2 步：读取终端输出

#### Collector（好的迹象）

\\\
PolyPulse collector starting
binance: connected
chainlink: connected
clob_ws: spawning
ipc server listening on /tmp/polypulse.sock
\\\

#### Dashboard（好的迹象）

\\\
PolyPulse dashboard listening on http://0.0.0.0:3003
\\\

#### 问题

| 消息 | 含义 |
|---------|---------|
| \EADDRINUSE\ 端口 3003 | 另一个进程使用端口 3003 — 停止它或更改 \.env\ 中的 \DASHBOARD_BIND\ |
| \command not found: tsx\ | 再次运行 \
pm install\ |
| TypeScript 错误 | 运行 \
pm run build\ |

---

### 第 3 步：打开仪表板

在同一台机器上：

**http://localhost:3003**

从网络上的另一台计算机（如果防火墙允许）：

**http://YOUR_SERVER_IP:3003**

---

### 第 4 步：检查连接徽章

标题右上角：

| 状态 | 含义 |
|--------|---------|
| **connecting…**（红色） | 仪表板已启动但 collector 还未发送数据 — 等待 10-30 秒 |
| **live**（绿色） | Collector 通过 IPC 连接 — 图表将更新 |
| 保持红色 > 1 分钟 | Collector 未运行或 \IPC_PATH\ 错误 — 查看故障排除 |

---

### 第 5 步：选择市场

1. 点击 **coin** 按钮（BTC、ETH、…）
2. 点击 **timeframe**（5min、15min、1hour）
3. 图表应显示：
   - 币安价格 + Chainlink PTB（左列）
   - YES / NO 最佳卖价（中间）
   - 策略面板（右）

**5min BTC** 上数据显示更快，因为这些市场最活跃。

---

### 第 6 步：确认数据被保存

每个周期都在 \./data/\ 中创建一个文件。使用以下命令确认：

\\\ash
ls data/market_data/5min/BTC/
\\\

你应该看到像 \5m.jsonl\ 这样的文件被写入（大小每个周期都在增长）。
