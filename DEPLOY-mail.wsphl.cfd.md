# GPT账号管理助手 VPS 部署方案

目标域名：`mail.wsphl.cfd`

## 1. 部署结构

推荐路径：

```bash
/opt/ctgptm-mail-assistant
/etc/ctgptm-mail-assistant.env
/etc/systemd/system/ctgptm-mail-assistant.service
/etc/nginx/sites-available/mail.wsphl.cfd
```

这些路径和 systemd 名称沿用历史部署约定，方便无缝覆盖现有 VPS；公开项目名以 `GPT账号管理助手` / `gpt-account-manager` 为准。

服务逻辑：

- Nginx 对外监听 `mail.wsphl.cfd`。
- Python 服务只监听 `127.0.0.1:8765`。
- 客户页 `/` 本地保存邮箱数据，不在服务器落库。
- 临时邮箱走 Cloudflare Temp Email Worker 后台，默认地址为：`https://maip.wsphl.cfd`，前台会自动填好，也可以手动修改。
- 微软邮箱是单独的 Microsoft OAuth / Graph / IMAP 链路，不走临时邮箱 Worker。
- 顶部导航固定为：商城 `https://shop.ohlaoo.com/`，中转站 `https://ohlaoo.com/`，公益站 `/public-pool`，转换器 `/converter.html`，CPA 仓管 `/warehouse.html`。
- 管理员页 `/admin.html` 不直接外露，必须带 `?token=<MAIL_PICKUP_ADMIN_TOKEN>`。

## 2. 准备服务器

Debian/Ubuntu：

```bash
sudo apt update
sudo apt install -y python3 nodejs nginx certbot python3-certbot-nginx unzip
```

确认域名 DNS：

```bash
dig +short mail.wsphl.cfd
```

这里应该返回你的 VPS 公网 IP。

## 3. 上传发布包

把压缩包上传到 VPS，例如：

```bash
scp gpt-account-manager-mail.wsphl.cfd.zip root@YOUR_VPS_IP:/tmp/
```

在 VPS 解压：

```bash
sudo mkdir -p /opt/ctgptm-mail-assistant
sudo unzip -o /tmp/gpt-account-manager-mail.wsphl.cfd.zip -d /opt/ctgptm-mail-assistant
sudo chown -R www-data:www-data /opt/ctgptm-mail-assistant
sudo mkdir -p /opt/ctgptm-mail-assistant/.cache
sudo chown -R www-data:www-data /opt/ctgptm-mail-assistant/.cache
```

## 4. 配置环境变量

复制模板：

```bash
sudo cp /opt/ctgptm-mail-assistant/deploy/mail-pickup.env.example /etc/ctgptm-mail-assistant.env
sudo nano /etc/ctgptm-mail-assistant.env
```

必须修改：

```bash
MAIL_PICKUP_ADMIN_TOKEN=换成一串长随机令牌
GPT_ACCOUNT_MANAGER_APP_TITLE=GPT账号管理助手
GPT_ACCOUNT_MANAGER_TEMP_WORKER_URL=https://maip.wsphl.cfd
GPT_ACCOUNT_MANAGER_STORE_URL=https://shop.ohlaoo.com/
GPT_ACCOUNT_MANAGER_RELAY_URL=https://ohlaoo.com/
GPT_ACCOUNT_MANAGER_PUBLIC_POOL_URL=https://ohlaoo.com/
# 可选：配置后管理员页可把勾选账号推送到公益池 API；不配置时只生成 JSON。
# GPT_ACCOUNT_MANAGER_PUBLIC_POOL_API_URL=https://your-public-pool.example/api/import
# GPT_ACCOUNT_MANAGER_PUBLIC_POOL_TOKEN=optional-pool-token
MAIL_PICKUP_LOGIN_STRATEGY=protocol
MAIL_PICKUP_NODE_BIN=node
```

生成随机令牌：

```bash
openssl rand -hex 32
```

如果你的临时邮箱 Worker 设置了站点访问密码，再填：

```bash
GPT_ACCOUNT_MANAGER_TEMP_SITE_PASSWORD=你的站点口令
```

`/warehouse.html` 的 CPA 仓管默认允许公网远程 CPA 管理地址。只有连接内网、局域网、容器私网或其它私有地址时，才需要额外开启：

```bash
MAIL_PICKUP_CPA_ALLOW_REMOTE=1
```

锁定配置文件权限：

```bash
sudo chown root:www-data /etc/ctgptm-mail-assistant.env
sudo chmod 640 /etc/ctgptm-mail-assistant.env
```

## 5. 安装 systemd 服务

```bash
sudo cp /opt/ctgptm-mail-assistant/deploy/ctgptm-mail-assistant.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ctgptm-mail-assistant
sudo systemctl status ctgptm-mail-assistant --no-pager
```

本机检查：

```bash
curl -I http://127.0.0.1:8765/
```

应该返回 `200 OK`。

## 6. 配置 Nginx

先用 HTTP 配置让 Certbot 申请证书：

```bash
sudo cp /opt/ctgptm-mail-assistant/deploy/nginx-mail.wsphl.cfd.conf /etc/nginx/sites-available/mail.wsphl.cfd
sudo ln -sf /etc/nginx/sites-available/mail.wsphl.cfd /etc/nginx/sites-enabled/mail.wsphl.cfd
sudo nginx -t
sudo systemctl reload nginx
```

申请 HTTPS：

```bash
sudo certbot --nginx -d mail.wsphl.cfd
```

证书签发成功后，建议直接切换到明确的 HTTPS 反代配置，避免 443 被 VPS 上旧站点接走：

```bash
sudo cp /opt/ctgptm-mail-assistant/deploy/nginx-mail.wsphl.cfd.ssl.conf /etc/nginx/sites-available/mail.wsphl.cfd
sudo nginx -t
sudo systemctl reload nginx
```

检查自动续期：

```bash
sudo certbot renew --dry-run
```

## 7. 访问地址

客户页：

```text
https://mail.wsphl.cfd/
```

转换器：

```text
https://mail.wsphl.cfd/converter.html
```

CPA 仓管：

```text
https://mail.wsphl.cfd/warehouse.html
```

默认 CPA 地址填 `http://localhost:8317`，管理密钥填 CPA/CLIProxyAPI 的 management key。点击“扫描 401”会探测 CPA 凭证是否 401；点某一行“修复”后可以单账号一键登录，自动从账号管理页本地凭证收验证码并上传新的 CPA auth。旧的“清理 401”仍保留，用于直接删除失效 auth file。

默认一键登录走轻量协议流程，不启动浏览器。协议流程会调用本包里的 `openai_sentinel_token.cjs`，所以 VPS 需要有 `node` 命令。先检查：

```bash
node --version
```

如果要在仓管页勾选 HTTP/SOCKS 代理刷新，先安装包内依赖：

```bash
cd /opt/ctgptm-mail-assistant
sudo apt-get update
sudo apt-get install -y python3-socks
sudo npm install --omit=dev --cache /tmp/ctgptm-npm-cache --no-audit --no-fund
```

如果协议登录日志里一直出现 Sentinel / authorize / OTP 相关失败，通常是当前 VPS 出口 IP、代理出口或 OpenAI 登录会话被限制。先更换稳定代理或干净出口后重试；页面日志会显示协议登录的具体阶段和失败原因。

管理员页：

```text
https://mail.wsphl.cfd/admin.html?token=你的_MAIL_PICKUP_ADMIN_TOKEN
```

管理员页里“本工具管理令牌”也填同一个 `MAIL_PICKUP_ADMIN_TOKEN`。

## 8. 使用格式

客户导入临时邮箱，也就是走 Cloudflare 临时邮箱 Worker 后台：

```text
邮箱----JWT----分类(可选)
```

客户导入微软邮箱，这是单独的 Microsoft OAuth 链路，不使用 Worker 后台地址：

```text
email----password----client_id----refresh_token----分类(可选)
```

管理员页只负责临时邮箱 Worker 后台的批量提取。管理员提取结果会输出：

```text
邮箱----JWT
```

## 9. 常用运维命令

查看服务日志：

```bash
sudo journalctl -u ctgptm-mail-assistant -f
```

重启服务：

```bash
sudo systemctl restart ctgptm-mail-assistant
```

更新代码：

```bash
sudo unzip -o /tmp/gpt-account-manager-mail.wsphl.cfd.zip -d /opt/ctgptm-mail-assistant
sudo chown -R www-data:www-data /opt/ctgptm-mail-assistant
sudo mkdir -p /opt/ctgptm-mail-assistant/.cache
sudo chown -R www-data:www-data /opt/ctgptm-mail-assistant/.cache
sudo systemctl restart ctgptm-mail-assistant
```

检查 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 10. 验证清单

```bash
curl -I https://mail.wsphl.cfd/
curl -I https://mail.wsphl.cfd/admin.html
curl -s https://mail.wsphl.cfd/ | head
```

预期：

- `/` 返回 `200`。
- 首页 HTML 应该出现 `GPT账号管理助手`，不应该出现 `OHlaoo - AI API Gateway`。
- `/admin.html` 不带 token 返回 `404`。
- `/admin.html?token=正确令牌` 返回 `200`。
- 客户页刷新临时邮箱时默认使用 `https://maip.wsphl.cfd`，客户页面可以手动修改 Temp API 地址。
- 客户页刷新微软邮箱时，只使用导入的 `email/password/client_id/refresh_token` 去走 Microsoft OAuth / Graph / IMAP。
- 顶部“商城”跳到 `https://shop.ohlaoo.com/`，“中转站”跳到 `https://ohlaoo.com/`。
- 独立 CPA 仓管页 `/warehouse.html` 可用 `http://localhost:8317` + CPA 管理密钥扫描 401；管理密钥只保存在浏览器 localStorage，不写入本工具服务端文件。
