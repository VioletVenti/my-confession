# 开发指南

本文面向要修改页面、内容或后端行为的维护者。项目没有前端构建流程，也没有第三方 Node.js 依赖。

## 环境与启动

- Node.js 22.5 或更高版本（需要内置 `node:sqlite`）；建议使用 Node.js 24。
- 无需 `npm install`，仓库没有 `package.json`。
- macOS/Linux：`./start.sh`；Windows：运行 `start.bat`。
- 默认地址：<http://127.0.0.1:8080/>。可用 `PORT=9000 ./start.sh` 更改 macOS/Linux 的端口；服务默认绑定 `0.0.0.0`。

启动前可用以下命令检查 Node 源码语法：

```bash
node --check server.js
node --check backup.js
```

## 目录与职责

```text
*.html             页面和内容，位于仓库根目录
css/style.css      全站样式与响应式布局
js/app.js          页面搜索和标签筛选
js/search-data.js  静态搜索索引
js/people.js       人物册和留言板的 API 客户端
server.js          静态文件服务、API、管理接口和 SQLite 初始化
admin.html         管理审核页面
backup.js          SQLite 一致性备份
data/app.db        运行时数据库（自动生成，不提交）
config.json        管理口令等运行配置（自动生成，不提交）
```

页面之间用相对路径互相链接，并从根路径引用 `css/` 和 `js/`。保持现有 URL 和目录位置可以避免破坏站内链接、书签和直接以 `file://` 打开的静态浏览方式。

## 修改页面和内容

班规、往事、轶闻和《岁月史书》的正文保存在对应 HTML 页面里，直接编辑页面即可。修改标题、描述或正文后，在浏览器刷新查看；无需编译。

搜索索引位于 `js/search-data.js`。如果加入了新的可搜索内容，要同步维护该索引；搜索需要兼容直接打开 HTML 的方式，因此不要把索引加载改成依赖 `fetch` 的外部文件。

人物册和留言板是动态功能：前端交互在 `js/people.js`，服务端校验、管理权限和数据持久化在 `server.js`。服务端使用 Node 内置 `node:http` 和 `node:sqlite`，数据库文件在 `data/app.db`。新增或调整数据字段时，同时检查 API 输入校验、管理页面展示以及现有数据库的兼容性。

## 数据与备份

服务启动时会创建 `data/` 和 SQLite 数据库；首次启动还会生成 `config.json` 中的管理口令，并输出到启动终端。不要提交数据库、口令或备份，也不要公开分享包含管理口令的启动日志。

运行 `node backup.js` 可在服务所在目录的 `data/backup/` 生成 SQLite 一致性快照，脚本最多保留 30 份。Docker 部署的数据目录挂载在命名卷中；容器内没有安装项目开发工具，源码修改后需重新构建镜像。

## 本地核对清单

修改完成后，根据改动范围核对：

```bash
node --check server.js
node --check backup.js
docker compose config --quiet
```

然后启动站点检查首页、改动页面和相关功能。若改了后端或 API，也要检查人物册、留言板和管理页面。Docker 配置检查只验证 Compose 文件格式；要验证镜像能否启动，还需要可用的 Docker daemon。
