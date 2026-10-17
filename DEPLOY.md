# 部署说明

> 站点根目录：**本文件所在目录**（解压出来的 `My Confession/`）。文中出现的绝对路径只是示例，按你实际解压位置替换。
> 后端：`server.js`（Node 24 内置 SQLite，零依赖）
> 数据库：`data/app.db`　备份：`data/backup/`

---

## 0. 目录里都是什么

| 文件 | 作用 |
|---|---|
| `启动服务.bat` | 双击启动（纯 ASCII，不会有编码问题） |
| `server.js` | 后端：静态文件 + 人物册/留言板 API + SQLite |
| `backup.js` | 数据库备份（VACUUM INTO，WAL 下也安全） |
| `admin.html` | 审核台（需管理口令） |
| `config.json` | **管理口令 adminToken**，首次运行自动生成 |
| `data/app.db` | 数据库本体 |
| `data/backup/` | 自动备份，最多留 30 份 |
| `js/people.js` | 前端：人物册增删 + 留言板 |
| `css/style.css` | 全部样式（含手机端适配） |

**重点**：正文 69 条、岁月史书、鸣谢栏都是**静态 HTML**，访客永远改不到；只有人物册和留言板走 API。

---

## 1. 只在自己电脑上看（已可用）

双击 `启动服务.bat`，浏览器开：

```
http://127.0.0.1:8080/
```

关掉那个黑窗口 = 停止服务。

---

## 2. 让同一个 WiFi 下的同学访问

服务已经监听 `0.0.0.0`，同学的手机/电脑开：

```
http://192.168.1.106:8080/
```

> `192.168.1.106` 是你现在的内网 IP。换网络后会变，用 `ipconfig` 查。

如果**打不开**，九成是 Windows 防火墙。管理员 PowerShell 里跑一次：

```powershell
New-NetFirewallRule -DisplayName "My Confession 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

删除规则：

```powershell
Remove-NetFirewallRule -DisplayName "My Confession 8080"
```

---

## 3. 让外网也能访问（三选一）

### 方案 A：Cloudflare Tunnel（推荐，免费，不用公网 IP、不开端口、自带 HTTPS）

适合：没有公网 IP、在宿舍/家里用普通宽带。

```powershell
# 1) 装 cloudflared（winget 或直接下 exe）
winget install --id Cloudflare.cloudflared

# 2) 登录
cloudflared tunnel login

# 3) 建隧道
cloudflared tunnel create my-confession

# 4) 指向本机 8080
cloudflared tunnel route dns my-confession confession.你的域名.com

# 5) 跑起来（先测试）
cloudflared tunnel run --url http://127.0.0.1:8080 my-confession
```

**需要自己的域名**（托管到 Cloudflare 免费）。跑通后，把第 5 步装成服务：

```powershell
cloudflared service install
```

临时给别人看（不需要域名，几小时内有效）：

```powershell
cloudflared tunnel --url http://127.0.0.1:8080
```
它会打印一个 `https://xxx.trycloudflare.com` 的地址。

### 方案 B：云服务器（VPS）

适合：想 7×24 稳定、不想让家里电脑常开。

1. 买一台（1 核 1G 足够，几十元/月）
2. 装 Node 22.5+：`curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs`
3. 把整个 `My Confession` 目录传上去（`scp` 或 git）
4. 加 systemd：

```ini
# /etc/systemd/system/confession.service
[Unit]
Description=My Confession
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/confession
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now confession
systemctl status confession
```

5. 用 Caddy 自动上 HTTPS（比裸端口安全，因为留言/提交走明文不太好）：

```
# /etc/caddy/Caddyfile
confession.你的域名.com {
    reverse_proxy 127.0.0.1:8080
}
```

> ⚠️ 国内服务器要**备案**；不备案的话买境外机房（但访问速度会慢）。

### 方案 C：frp / 花生壳 等内网穿透

自己有一台公网服务器的话，frp 最灵活；不想折腾就用花生壳（付费）。原理同 A，只是要自己管服务端。

---

## 4. 开机自启（Windows，不想每次双击）

任务计划程序 → 创建任务：

- **触发器**：登录时
- **操作**：启动程序 `D:\code\01_站点\My Confession\启动服务.bat`
- **起始于**：`D:\code\01_站点\My Confession`
- 勾选「不管用户是否登录都要运行」需要密码；简单点就用「只在用户登录时运行」

命令行一次性添加：

```powershell
$act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"D:\code\01_站点\My Confession\启动服务.bat`"" -WorkingDirectory "D:\code\01_站点\My Confession"
$trg = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "My Confession" -Action $act -Trigger $trg -Description "校园同好站（人物册+留言板）"
```

---

## 5. 备份

手动：`node backup.js`

自动（每天 23:00）：

```powershell
$act = New-ScheduledTaskAction -Execute "node" -Argument "backup.js" -WorkingDirectory "D:\code\01_站点\My Confession"
$trg = New-ScheduledTaskTrigger -Daily -At 23:00
Register-ScheduledTask -TaskName "My Confession 备份" -Action $act -Trigger $trg
```

备份是完整的 `.db` 文件，恢复就是把它改名成 `data/app.db` 覆盖回去（先停服务）。

---

## 6. 上线前安全检查清单

- [ ] **改掉默认管理口令**：编辑 `config.json` 的 `adminToken`，换成你自己的长随机串
- [ ] 确认 `data/`、`config.json`、`server.js` 无法通过网址下载（已内置拦截，实测 404）
- [ ] 用 HTTPS（方案 A 自带 / 方案 B 用 Caddy），否则留言内容明文传输
- [ ] 想开留言审核：把 `config.json` 里 `messagesModerated` 改成 `true`，重启服务
- [ ] 定期看一次审核台，清掉被软删除的垃圾数据
- [ ] 别把 `config.json` 和 `data/` 传到任何公开仓库

---

## 7. 常见问题

**Q：双击 bat 一闪就没了？**
用命令行跑 `cmd /c 启动服务.bat` 看报错。最常见是没装 Node 或版本太低（需要 22.5+）。

**Q：人物册显示"连不上服务"？**
说明是通过 `file://` 直接打开的 HTML，而不是通过服务访问。改用 `http://127.0.0.1:8080/`。

**Q：端口 8080 被占用？**
`set PORT=9000` 后再运行 bat。

**Q：想换成别的数据库？**
不用换。SQLite 单文件、零配置，几十人访问完全够用；真到瓶颈再谈。

**Q：能不能改回纯静态 / GitHub Pages？**
可以。审核台里点「导出静态快照」，会生成 `data/people.json`，把它并进页面即可。

---

## 8. 交接给合伙人（平移）

**核心结论：这套东西是"零依赖 + 单文件数据库"，平移不需要改一行代码。**

一键出包：

```powershell
cd "D:\code\01_站点\My Confession"
powershell -ExecutionPolicy Bypass -File .\打包部署.ps1
# 产物：D:\code\01_站点\My Confession-deploy-<日期>.zip
```

打包脚本会自动做四件事：
1. 先 `node backup.js` 导一份**干净数据库快照**（不带 WAL），保证数据一致
2. 只复制运行时需要的 46 个文件，剔掉素材/压缩包/留档/备份（省 30 MB）
3. **包内中文文件名换成 ASCII**（`部署说明.md`→`DEPLOY.md`、`启动服务.bat`→`start.bat`、音频→`nanchenglu-54-15.m4a`），避免 Linux 解压乱码
4. 生成 `README-DEPLOY.txt`

对面拿到 zip 后：

```bash
unzip My\ Confession-deploy-*.zip
cd "My Confession"
chmod +x start.sh && ./start.sh     # Windows 双击 start.bat
```

### 平移前必须确认的三件事

| 项 | 要求 | 不满足会怎样 |
|---|---|---|
| **Node 版本** | **22.5+**（推荐 24 LTS） | 没有 `node:sqlite`，启动直接失败 |
| 数据目录可写 | `data/` 要有写权限 | SQLite 建不了库，启动失败 |
| 端口占用 | 8080 或自定义 `PORT` | 启动失败 |

### ⚠️ 平移后两边数据会分叉

zip 里带的是**打包那一刻**的快照。如果之后你在本地又加了人物/留言，需要：

- 重新跑一次打包，或
- 直接拷 `data/app.db` 过去覆盖（**先停对方的服务**）

**不要两边同时改**，SQLite 单文件不支持双写。

### 交接清单

- [ ] 对方 Node 版本 ≥ 22.5
- [ ] 解压即能 `./start.sh` 跑起来
- [ ] 打开站点能看到 6 条人物、留言板正常
- [ ] 改掉 `config.json` 的 `adminToken`
- [ ] 配 HTTPS（Cloudflare Tunnel 或 Caddy）