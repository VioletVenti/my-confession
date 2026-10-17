# My Confession

彰武县高级中学 2022 级一班的班级纪念站，收录班规、往事、轶闻、人物册和《岁月史书》。

这是一个静态 HTML/CSS/JavaScript 网站，附带一个零第三方依赖的 Node.js 服务。静态内容可直接打开 `index.html` 浏览；人物册的实时数据和留言板需要启动服务。

## 快速开始

需要 Node.js 22.5 或更高版本。项目使用 Node 内置的 `node:sqlite`，无需运行 `npm install`。

```bash
# macOS / Linux
./start.sh
```

Windows 用户运行 `start.bat`。然后访问 <http://127.0.0.1:8080/>。服务默认监听 `0.0.0.0`，同一局域网的设备也可以访问运行服务电脑的内网 IP。

也可以用 Docker Compose 部署：

```bash
docker compose up -d --build
```

默认映射到主机的 8080 端口。NAS 部署、数据保留和备份说明见[部署指南](docs/DEPLOYMENT.md)。

## 站点内容

| 栏目 | 页面 |
|---|---|
| 首页与搜索 | `index.html` |
| 班规 | `rules-daily.html`、`rules-face.html`、`rules-study.html`、`rules-punish.html`、`rules-misc.html` |
| 往事 | `youth-fun.html`、`youth-combo.html`、`youth-end.html`、`youth-epilogue.html`、`youth-credits.html` |
| 轶闻 | `anec-legend.html`、`anec-clumsy.html`、`anec-wisdom.html`、`anec-custom.html`、`anec-lucky.html` |
| 人物册 | `people-normal.html`、`people-half.html`、`people-full.html`、`people-god.html`、`people-xx.html` |
| 岁月史书 | `suishu.html` |
| 其他 | `about.html`、`contact.html`、`help.html`、`copyright.html` |

## 维护文档

- [开发指南](docs/DEVELOPMENT.md)：项目结构、内容修改、前后端职责和本地检查
- [部署指南](docs/DEPLOYMENT.md)：本机、局域网、Docker/NAS、备份和公开访问
- [旧部署文档入口](DEPLOY.md)：保留的兼容链接

## 数据与安全

访客提交的人物册内容和留言存放在 `data/app.db`。首次启动时，服务会生成管理口令并写入 `config.json`；这两个路径已加入 `.gitignore`，不要提交或公开它们。部署到互联网前，请配置 HTTPS 和强管理口令。

项目没有构建步骤或第三方运行时依赖。HTML 页面和 `css/`、`js/` 资源的路径互相引用，新增页面时请沿用仓库根目录的现有路径布局。

<p align="center"><sub>2022 级一班 · 留个念想</sub></p>
