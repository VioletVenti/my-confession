# 部署指南

本指南说明如何在个人电脑、局域网和 Docker/NAS 上运行 My Confession。公开访问时还需要 HTTPS 反向代理。

## 在个人电脑运行

安装 Node.js 22.5 或更高版本（建议 Node.js 24），然后在项目目录启动：

```bash
# macOS / Linux
./start.sh
```

Windows 用户运行 `start.bat`。浏览器打开 <http://127.0.0.1:8080/>。服务首次启动时会生成管理口令并在终端显示；请保存好口令。停止服务可在终端按 `Ctrl+C`，Windows 则关闭启动窗口。

默认监听 `0.0.0.0:8080`。macOS/Linux 可通过 `PORT=9000 ./start.sh` 更换端口。

## 局域网访问

让其他设备访问运行服务的电脑内网 IP，例如 `http://192.168.1.20:8080/`。请在路由器或操作系统防火墙中，仅对需要的网络开放该端口。内网部署默认使用 HTTP。

<a id="docker-nas"></a>
## Docker / NAS

NAS 需要安装 Docker 和 Compose。将项目目录放在 NAS 上，在该目录运行：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f my-confession
```

等容器健康状态变为 `healthy` 后，在局域网打开 `http://NAS的IP:8080/`。首次启动时日志会显示管理口令；保存好后，不要把日志或口令公开分享。

常用操作：

```bash
docker compose up -d --build  # 构建或更新并启动
docker compose logs -f        # 查看日志
docker compose stop           # 停止，保留容器和数据
docker compose start          # 重新启动
docker compose down           # 删除容器，保留数据卷
```

Compose 将 SQLite 数据、备份和管理配置保存在命名卷 `confession_data`。普通重启、镜像更新以及 `docker compose down` 都会保留数据。**不要运行 `docker compose down -v`**，它会删除数据卷。

## 公开访问

不要把未加 HTTPS 的服务直接暴露到互联网。建议通过 NAS 或服务器上的反向代理提供 HTTPS，并把流量转发到本服务的主机端口 8080。Cloudflare Tunnel、Caddy 等方案需要各自的域名、DNS 和代理配置；这些不由本项目的 Compose 文件管理。

公开部署前请确认管理口令足够强，并妥善保存。`config.json` 含管理凭据，SQLite 数据库含访客提交内容；应限制对 NAS 管理界面、备份和 Docker 卷的访问。

## 数据备份与恢复

### Node.js 直接运行

服务运行期间也可执行：

```bash
node backup.js
```

脚本通过 SQLite `VACUUM INTO` 生成一致性快照，写入 `data/backup/`，最多保留 30 份。备份应复制到另一块磁盘或独立存储位置；仅留在原设备上无法应对磁盘故障。

### Docker / NAS

在项目目录执行以下命令，会在数据卷中生成备份：

```bash
docker compose exec my-confession node backup.js
```

该备份仍位于 `confession_data` 卷内。请使用 NAS 的 Docker 卷备份功能或平台提供的导出方式，将卷数据备份到独立存储。恢复前停止服务，并按 NAS 的卷恢复流程还原数据。删除卷或重建存储前，先确认独立备份可用。

## 相关说明

- 开发和本地检查见[开发指南](DEVELOPMENT.md)。
- `docker compose config --quiet` 可检查 Compose 配置格式；镜像构建和容器启动需要 Docker daemon 正常运行。
