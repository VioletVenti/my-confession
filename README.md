# My Confession

> 彰武县高级中学 2022 级一班的班级纪念站。
> 班规、往事、轶闻、人物册、《岁月史书》—— 把三年里那些人和那些事留在一个地方。

纯静态 HTML + 一个零依赖的 Node 小后端（Node 内置 SQLite，不需要 `npm install`）。

---

## 先看效果（什么都不用装）

**直接双击 `index.html`**，浏览器就能打开。

班规、往事、轶闻、《岁月史书》、人物册的静态内容全部能看，搜索也能用。
只有 **人物册的实时数据** 和 **留言板** 需要后端——这两块会提示"连不上服务"，是正常现象。

---

## 完整跑起来

需要 **Node.js 22.5 或更高**（用到内置的 `node:sqlite`，低了会直接启动失败）。

**Windows**：双击 `start.bat`，然后打开 <http://127.0.0.1:8080/>
关掉那个黑窗口 = 停止服务。

**macOS / Linux**：

```bash
chmod +x start.sh
./start.sh
```

**同一个 WiFi 下的同学也能看**，让他们开 `http://你的内网IP:8080/`。
打不开九成是防火墙，管理员 PowerShell 跑一次：

```powershell
New-NetFirewallRule -DisplayName "My Confession 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

---

## 站点地图

| 栏目 | 页面 | 内容 |
|---|---|---|
| **首页** | `index.html` | 班级介绍 + 全站搜索 |
| **班规** | `rules-daily.html` 日常 · `rules-face.html` 面子 · `rules-study.html` 学习 · `rules-punish.html` 处分 · `rules-misc.html` 闲杂 | 当年那些规矩，一条不落 |
| **往事** | `youth-fun.html` 趣闻 · `youth-combo.html` 排列组合 · `youth-end.html` 善终 · `youth-epilogue.html` 尾记 · `youth-credits.html` 相关人员 | 三年里发生的事 |
| **轶闻** | `anec-legend.html` 俗世奇人 · `anec-clumsy.html` 弄巧成拙 · `anec-wisdom.html` 集体智慧 · `anec-custom.html` 约定俗成 · `anec-lucky.html` 妙手偶得 | 那些人身上的段子 |
| **人物册** | `people-normal.html` 正常人 · `people-half.html` 半唐 · `people-full.html` 全唐 · `people-god.html` 神人 · `people-xx.html` \*\* | 分档名录，**访客可以自己往里加** |
| **岁月史书** | `suishu.html` | 185 条语录合集 |
| **兔兔** | `x-tutu.html` | 只能从搜索结果点进去 |
| **其他** | `about.html` · `contact.html` · `help.html` · `copyright.html` | 关于、联系方式、帮助、版权 |

改版前的老页面留在 `1.5.html`（自动跳转到新版）、`1.5-单页锚点版.html` 和 `历史记录/`。

---

## 目录结构

```
（仓库根目录）
├── README.md               本文件
├── index.html              首页
├── rules-*.html            班规 5 页
├── youth-*.html            往事 5 页
├── anec-*.html             轶闻 5 页
├── people-*.html           人物册 5 档
├── suishu.html             岁月史书
├── about/contact/help/copyright.html
│
├── css/style.css           全部样式（含手机端适配）
├── js/app.js               搜索与标签筛选
├── js/search-data.js       全站搜索索引（内联，见下方说明）
├── js/people.js            人物册增删 + 留言板
│
├── server.js               后端：静态服务 + API + SQLite（单文件）
├── backup.js               数据库备份
├── admin.html              审核台（要管理口令）
├── data/app.db             SQLite 数据库
│
├── start.bat               Windows 一键启动
├── start.sh                macOS / Linux 启动脚本
├── DEPLOY.md               部署、上线、交接的完整说明
└── nanchenglu-*.m4a        班会上放的两段录音
```

---

## 技术栈

| 层 | 选型 | 为什么 |
|---|---|---|
| 页面 | 纯 HTML / CSS / 原生 JS | 没有构建步骤，改完刷新就生效，谁都能接手 |
| 后端 | `server.js` 单文件，Node 内置 `node:http` + `node:sqlite` | **零第三方依赖**，不用 `npm install`，拷过去就能跑 |
| 数据库 | SQLite 单文件 `data/app.db` | 几十人访问完全够用，备份就是拷一个文件 |
| 搜索 | `js/search-data.js` 内联索引 | 用 `file://` 直接打开时 `fetch` 会被 CORS 拒绝，所以索引必须内联 |

**谁能改什么**：正文（班规、往事、轶闻、岁月史书、鸣谢）全是静态 HTML，访客永远改不到；
只有**人物册**和**留言板**走 API 写入数据库，删掉的内容是软删除，可以在审核台恢复。

---

## 部署 / 交给别人

完整步骤见 **[DEPLOY.md](DEPLOY.md)**，包含：

- 局域网访问 + 防火墙规则
- 三种上线方案：Cloudflare Tunnel（推荐，免费、不用公网 IP）/ 云服务器 + Caddy / frp 内网穿透
- Windows 开机自启、每天自动备份的计划任务
- 一键出包的打包脚本（产物已处理中文文件名，Linux 解压不会乱码）
- 上线前的安全检查清单

一句话版本：**这套东西是"零依赖 + 单文件数据库"，平移不需要改一行代码。**

---

## ⚠️ 注意

- **`config.json` 里是管理口令，`data/` 里是真实数据，都不要提交到公开仓库。**
  仓库里看到 `.gitignore` 已经把这两个排除了。
- 默认口令必须改掉再上线。
- 留言内容建议开 HTTPS，否则是明文传输。

---

<p align="center"><sub>2022 级一班 · 留个念想</sub></p>
