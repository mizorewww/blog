{"title":"gdirect：终端直连 Google 云盘的原理与配置指南","description":"TL;DR 先看 gdirect 是如何绕过 DNS 与 SNI 阻断直连 Google 云盘的，再照着 10 分钟图文指南配好专属 OAuth 客户端，最后拆解底层 IP 探测与定制 libaria2 的实现细节。","date":"2026-10-25","tag":"技术","tags":["Rust","Google Drive","CLI","Network"]}
---

平时从 Google Drive 拖几十 GB 的数据集或备份，走代理往往既烧流量又受限于节点带宽；用浏览器下载还经常在中途断流后从头再来。为此我写了 [gdirect](https://github.com/mizorewww/gdirect)：一个在终端里浏览、下载、上传和挂载 Google 云盘的工具。

这篇文章按三个部分组织：**先用几分钟讲清楚它是怎么“伪装”并直连 Google 的（TL;DR）**，接着是**开箱即用的安装与 10 分钟图文配置指南**，最后再深入源码做**底层技术解析**。

## TL;DR：我们是怎么“伪装”直连的？

在受限网络下直连 Google Drive 之所以会失败，通常卡在两道关卡：**DNS 污染**（拿不到真实 IP）和 **TLS SNI 阻断**（TLS 握手阶段的 `ClientHello` 明文暴露了 `drive.google.com` 等域名，触发连接重置）。

但 Google 在全球有大量共用前端架构（Google Front End）的边缘节点 IP，其中不少 IP 本身并没有在路由层被封锁——只要你的 TCP 连接能落到这些真实的 Google IP 上，并且在 TLS/HTTP 层告诉它你要访问的是 Drive 服务，Google 的边缘网关就会把流量正常转发给云盘后端。

`gdirect` 就是利用这一点，通过四步完成“伪装”与直连的：

1. **绕过系统 DNS，实测筛出能用的真 Google IP**：不直接采信系统 DNS，而是从内置种子 IP（`183.56.143.147`）、历史缓存和候选池出发，直接连向目标 IP 的 443 端口。只有当对端出示了合法的 Google 官方 TLS 证书、且能正确响应 Drive v3 API 探针时，才会被记入本地 SQLite，并在 24 小时内自动复用延迟最低的那一个。
2. **TCP 层“指鹿为马”，HTTP 与证书层原封不动**：上层请求写的依然是标准的 `https://www.googleapis.com` 和 `https://*.googleusercontent.com`，因此发给 Google 的 HTTP `Host` 头完全正常，本机对 Google 证书的合法性校验也一分不减；但在底层的套接字解析阶段（Rust 的 `reqwest::resolve` 和打过补丁的 C++ `libaria2` `getaddrinfo`），哪怕下载途中发生多次 302 跨域名重定向，所有连接都会被强制扭转到那个扫出来的直连 IP 上。
3. **改写或剥离 TLS SNI，绕过明文域名阻断**：如果网络环境会检测 TLS 握手包里的明文域名，可以用 `--no-sni` 让 `libaria2` 在 `ClientHello` 中干脆不发 SNI 扩展，或者用 `--sni example.com` 塞一个别的域名进去。中间设备看不到敏感的 Google 域名，而连接到达 Google 边缘节点后依然能正常完成握手，且**全程保持严格的 TLS 证书校验**。
4. **控制面与数据面分离**：只有几 KB 的登录与刷新令牌（`accounts.google.com`、`oauth2.googleapis.com`）照常走系统网络或代理，保证随时能登得上；真正吃带宽的目录浏览、多连接并发下载、32 MiB 分块上传全部走直连 IP，不耗代理流量就能跑满本地宽带。

| 流量类型 | 涉及命令 / 域名 | 走向 |
| --- | --- | --- |
| 云盘 API、下载、上传 | `browse`、`ls`、`download`、`upload`（`www.googleapis.com`、`drive.usercontent.google.com`、`*.googleusercontent.com`） | 扫描到的 Google 直连 IP。主机名和证书校验不变，可用 `--sni` / `--no-sni` 改写或去掉 TLS SNI |
| 登录与刷新令牌 | `login` 及自动刷新（`accounts.google.com`、`oauth2.googleapis.com`） | 系统网络（走系统 DNS 与系统代理） |
| 磁盘挂载 | `mount`（底层调用 `rclone`） | 系统网络 |

> **大陆网络环境特别提示：**
> `gdirect` 登录与刷 Token（`accounts.google.com`、`oauth2.googleapis.com`）需要走代理；但到了 `scan` 扫描和下载/上传阶段，如果你开着翻墙软件（尤其是 **TUN 虚拟网卡模式** 或 **域名嗅探**），流量很可能会被翻墙软件强行截胡，导致**依旧走代理扣流量**或者扫描全部失败。
> 大陆用户请务必二选一（详见下文[大陆网络与代理配置指南](#大陆网络与代理配置指南)）：
> 1. **省心做法**：开着翻墙软件完成 `gdirect login` 登录；之后**退出翻墙软件（或关闭 TUN 模式）**，再执行 `gdirect scan` 和下载。
> 2. **规则分流做法**：在翻墙软件中配置规则，让 `drive.usercontent.google.com`、`*.googleusercontent.com` 等传输域名及扫出的直连 IP 走 **`DIRECT` 直连**（并关闭它们的 `fake-ip`），仅保留登录域名走代理。

---

## 安装指南

预编译二进制支持 **macOS 15+**（Apple Silicon / Intel）、**Linux x86_64**（glibc 2.35+，如 Ubuntu 22.04+、Debian 12+、Fedora、Arch）和 **Windows x86_64**。

### 方式一：一键安装脚本

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/mizorewww/gdirect/main/scripts/install.sh | bash
```

Windows PowerShell：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/mizorewww/gdirect/main/scripts/install.ps1')))
```

安装脚本会把 `gdirect` 和配套校验用的 `cacert.pem` 放到 `~/.local/bin`（Windows 为 `%LOCALAPPDATA%\gdirect\bin`）。

如果你还想用 `gdirect mount` 把云盘挂载成本地磁盘，在安装命令末尾加上 `--with-mount`（PowerShell 用 `-WithMount`），脚本会顺带装好依赖（`rclone 1.75.2+`，Linux 额外安装 `fuse3`，Windows 通过 `winget` 安装 `WinFsp`）：

```sh
curl -fsSL https://raw.githubusercontent.com/mizorewww/gdirect/main/scripts/install.sh | bash -s -- --with-mount
```

### 方式二：Homebrew（macOS / Linux）

```sh
brew tap mizorewww/gdirect https://github.com/mizorewww/gdirect
brew install mizorewww/gdirect/gdirect
brew install rclone   # 仅挂载功能需要；Linux 另需用系统包管理器安装 fuse3
```

后续升级执行 `brew update && brew upgrade gdirect` 即可。

---

## Google Cloud 一次性配置指南（约 10 分钟）

为了避免共用 OAuth 客户端导致全员配额耗尽（429 限流）或被封禁，`gdirect` 不内置公共客户端，而是让你在自己的 Google Cloud 项目里创建一个 **Desktop app（桌面应用）** 客户端。只需操作一次，Google 完全免费。

### 1. 新建项目并启用 Drive API

1. 打开 [Google Cloud 控制台](https://console.cloud.google.com/)，点击页面顶部的项目选择器，再点击右上角的 **New project（新建项目）**。名称随意（例如 `gdirect`），个人账号的 **Location（位置）** 保持 **No organization（无组织）** 即可。点击 **Create（创建）** 后，确认顶部已经切换到这个新项目。

   ![在 Google Cloud 控制台中新建项目](../images/gdirect/01-project.png)

2. 打开 [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) 页面，确认顶部是刚才新建的项目，点击 **Enable（启用）**。

   ![启用 Google Drive API](../images/gdirect/02-enable-api.png)

   完成后，页面会显示服务名称 `drive.googleapis.com`，状态变为 **Enabled（已启用）**。

   ![确认 Google Drive API 已启用](../images/gdirect/03-api-enabled.png)

### 2. 配置 OAuth 应用

1. 打开 [Google Auth Platform](https://console.cloud.google.com/auth/overview)，点击 **Get started（开始）**。
2. **App information（应用信息）**：填写应用名称（比如 `gdirect`，登录授权时会显示），用户支持邮箱选择你自己的邮箱，点击 **Next（下一步）**。

   ![填写 OAuth 应用名称与支持邮箱](../images/gdirect/04-branding.png)

3. **Audience（受众群体）**：选择 **External（外部）**，点击 **Next（下一步）**（个人账号无法选 Internal）。

   ![受众群体选择外部](../images/gdirect/05-audience.png)

4. **Contact information（联系信息）**：填写你的邮箱，点击 **Next（下一步）**。
5. **Finish（完成）**：勾选同意 Google API 服务用户数据政策，点击 **Continue（继续）**，再点击 **Create（创建）**。

   ![勾选同意数据政策并创建应用](../images/gdirect/06-policy.png)

### 3. 添加 Drive 权限范围（Scope）

1. 在左侧菜单打开 **Data Access（数据访问）**，点击 **Add or remove scopes（添加或移除范围）**。
2. 在弹出的面板中勾选 `.../auth/drive`（说明为“查看、修改、创建和删除您的所有 Google 云端硬盘文件”）。如果列表里找不到，直接把下面的地址粘贴到 **Manually add scopes（手动添加范围）** 中，点击 **Add to table（添加到表）**，再点击 **Update（更新）**：

   ```text
   https://www.googleapis.com/auth/drive
   ```

   ![添加并勾选 auth/drive 权限范围](../images/gdirect/07-add-scope.png)

3. **注意**：回到数据访问页面后，一定要点击底部的 **Save（保存）**。只点上一步的 Update 并不会真正保存。

   ![点击页面底部的 Save 保存权限范围](../images/gdirect/08-scope-saved.png)

### 4. 创建桌面客户端并下载 JSON

1. 在左侧菜单打开 **Clients（客户端）**，点击 **Create client（创建客户端）**。应用类型必须选择 **Desktop app（桌面应用）**（网页客户端、API Key 和服务账号 JSON 都不能用），名称随意（如 `gdirect Desktop`），点击 **Create（创建）**。

   ![创建 Desktop app 类型的 OAuth 客户端](../images/gdirect/09-desktop-client.png)

2. 在弹出的窗口中，**关闭之前**点击 **Download JSON（下载 JSON）**。窗口关闭后就无法再次下载这个文件；如果不小心关掉了，重新创建一个客户端即可。

   ![下载客户端 JSON 文件](../images/gdirect/10-client-created.png)

### 5. 允许你的账号登录（解决 7 天过期问题）

新建的应用默认处于 **Testing（测试）** 状态，只有测试用户列表中的账号可以登录：

1. 在左侧菜单打开 **Audience（目标对象）**，在 **Test users（测试用户）** 下点击 **Add users**，填入你要在 `gdirect` 中使用的 Google 账号邮箱，点击 **Save（保存）**。

   ![将自己的 Google 账号添加为测试用户](../images/gdirect/11-test-user.png)

测试状态下，登录凭证会在 **7 天**后失效，届时执行 `gdirect login --reauth` 重新授权即可。

如果不想每周重新登录，可以直接在 **Audience（目标对象）** 页面顶部点击 **Publish app（发布应用）**，把状态改为 **In production（正式版）**。自己使用的应用不需要经过 Google 审核，切到正式版后就不会再有 7 天过期的限制。

### 6. 在终端登录

在终端执行下面的命令，把路径换成你下载的 JSON 文件：

```sh
gdirect login --client-secret ~/Downloads/client_secret.json
```

1. 程序会自动打开浏览器（如果没有自动打开，请把终端打印的链接复制到**同一台电脑**的浏览器中打开，因为授权完成后要回调本机的临时端口）。
2. 选择你的 Google 账号，Google 会提示“此应用未经验证”——这是正常的，因为应用是你自己刚刚创建的：
   - **测试状态**：点击 **Continue（继续）**，不要点“返回到安全网页”。
   - **正式版（In production）**：点击左下角 **Advanced（高级）**，再点击 **Go to 你的应用名 (unsafe)（转至……（不安全））**。

   ![在未验证应用提示页点击继续](../images/gdirect/12-unverified.png)

3. 核对应用名称和 Google 云端硬盘权限，确认无误后点击 **Continue（继续）**。

   ![勾选并确认授权访问 Google 云端硬盘](../images/gdirect/13-consent.png)

4. 回到终端，看到 `Logged in` 即大功告成。此时可以删掉下载的 JSON 文件（客户端信息已保存在本地 SQLite 中，以后切换账号或重登只需执行 `gdirect login --reauth`）。

> **无界面服务器（Headless）提示**：如果在没有浏览器的远程服务器上使用，可以先在桌面电脑上完成登录，或者用 `gdirect login --credentials 路径` 导入已有的 `authorized_user` 凭据 JSON；写脚本时也可以直接通过环境变量 `GDIRECT_ACCESS_TOKEN` 传入访问令牌。

---

## 大陆网络与代理配置指南

在大陆使用 `gdirect` 时，最容易踩的一个坑是：**明明用了 `gdirect`，结果几十 GB 的下载流量还是走了翻墙软件，或者 `gdirect scan` 一个可用 IP 都扫不出来。**

### 为什么开着翻墙软件还会走代理？

虽然 `gdirect` 在代码里显式绕过了系统环境变量里的 HTTP/SOCKS 代理（设置了 `no_proxy`），并把连接直接发往 Google 的公网 IP，但大陆常用的代理客户端（Clash Verge / Mihomo、Surge、Sing-box 等）普遍开启了 **TUN 虚拟网卡模式**、**Fake-IP（增强模式）** 以及 **流量域名嗅探（Sniffing）**：

1. 当 `gdirect` 向直连 IP 发起 TLS 握手时，TUN 虚拟网卡在网络层把包拦下来，嗅探出 TLS `ClientHello` 里的 SNI 是 `www.googleapis.com` 或 `*.googleusercontent.com`；
2. 翻墙软件命中了内置的 `GEOSITE,google,PROXY` 规则，于是不管三七二十一，把这股本该直连的 TCP 流量**重新塞进了你的代理节点**；
3. 反过来，如果在扫描阶段 DNS 被返回了 `198.18.x.x` 的 Fake-IP，或者探测包被 TUN 截胡后超时，就会导致 `gdirect scan` 报全员 `unavailable`。

因此，在大陆环境下，你有两种使用方式可以选：

### 方案一：登录开代理，`scan` 和下载时退出翻墙软件（或关闭 TUN）

如果你不想折腾翻墙软件的分流规则，这是最简单、也最保险的做法：

1. **登录阶段（开着翻墙软件）**：保持翻墙软件开启，执行 `gdirect login --client-secret ...` 完成初次登录（因为浏览器访问 `accounts.google.com` 和终端请求 `oauth2.googleapis.com` 换取令牌必须走代理）。
2. **扫描与下载阶段（退出翻墙软件，或关掉 TUN 开关）**：
   - 如果你的翻墙软件只开了“系统代理（System Proxy）”而**没开 TUN 模式**，通常可以直接使用；但只要开了 TUN，请先**关闭 TUN 模式**（或者在已经拿到短期 Token 后直接退出翻墙软件）。
   - 执行一次 `gdirect scan`，让它在纯物理宽带下扫出真正能直连的 Google IP。
   - 执行 `gdirect download ...` 或 `gdirect browse` 开始满速直连下载。
   - 如果所在宽带运营商对 Google 域名有连接重置（表现为下载报 `libaria2 code 1: connection or TLS failure`），加上 `--no-sni` 剥离 TLS 明文域名即可：

```sh
gdirect scan
gdirect download FILE_ID --no-sni
gdirect browse --no-sni
```

> **提示**：每次登录或刷新拿到的短期 `access_token` 在本地 SQLite 中有约 1 小时的有效期。只要在有效期内，完全退出翻墙软件也能正常 `ls`、`browse` 和 `download`；当超过 1 小时提示无法连接 `oauth2.googleapis.com` 刷新令牌时，再临时开一下代理刷个 Token 即可。

### 方案二：在翻墙软件中配置直连规则（保持代理与 TUN 常开）

如果你希望翻墙软件和 TUN 模式 24 小时常开、不用来回切开关，只需在代理软件里把 `gdirect` 涉及的域名按职责分流：

- **必须走代理（`PROXY`）的域名**（仅登录和刷新令牌用，流量极小）：
  - `accounts.google.com`
  - `oauth2.googleapis.com`
- **必须设为直连（`DIRECT`）并关闭 `fake-ip` 的域名与 IP**（云盘 API、上传与下载流量）：
  - `drive.usercontent.google.com`
  - `*.googleusercontent.com`
  - `drive.google.com`
  - `www.googleapis.com`、`content.googleapis.com`、`drive.googleapis.com`
  - 以及 `gdirect scan --list` 扫出来的可用 Google IP（如默认的种子 IP `183.56.143.147`）

以 **Clash / Mihomo** 为例，推荐在配置文件中加入以下规则（注意放在 `GEOSITE,google` 或 `MATCH` 兜底规则**之前**）：

```yaml
dns:
  fake-ip-filter:
    - "www.googleapis.com"
    - "drive.googleapis.com"
    - "content.googleapis.com"
    - "drive.usercontent.google.com"
    - "drive.google.com"
    - "+.googleusercontent.com"

rules:
  # 1. 登录与刷新令牌走代理
  - DOMAIN,accounts.google.com,PROXY
  - DOMAIN,oauth2.googleapis.com,PROXY

  # 2. 云盘下载与 API 域名走直连（若担心影响浏览器访问其他 googleapis 服务，也可改用下面的 PROCESS-NAME 规则）
  - DOMAIN,drive.usercontent.google.com,DIRECT
  - DOMAIN-SUFFIX,googleusercontent.com,DIRECT
  - DOMAIN,www.googleapis.com,DIRECT
  - DOMAIN,drive.googleapis.com,DIRECT
  - DOMAIN,content.googleapis.com,DIRECT

  # 3. 或者更干脆：除 oauth2 刷令牌外，让 gdirect 进程发出的所有连接与直连 IP 律走 DIRECT
  - PROCESS-NAME,gdirect,DIRECT
  - IP-CIDR,183.56.143.147/32,DIRECT,no-resolve
```

配好并重载配置后，即使全程开着 TUN 模式，`gdirect` 刷新 Token 也会自动走代理，而 `scan`、浏览和几十 GB 的大文件下载则会直接走物理网卡直连，不会偷跑一字节机场流量。

---

## 日常使用与排障速查

### 常用命令

```sh
gdirect                                   # 等同于 gdirect browse，打开交互式 TUI
gdirect browse -o ~/Downloads             # 指定下载目录（默认 ./downloads）
gdirect ls root --json                    # 列出目录内容（支持 JSON 输出）
gdirect download 文件ID或分享链接          # 下载文件，断流重跑同一命令即可续传
gdirect download FILE_ID -o file.zip
gdirect download DOC_ID --export application/pdf -o doc.pdf
gdirect upload ./file.zip                 # 32 MiB 分块上传，支持断点续传
gdirect upload ./file.zip --parent FOLDER_ID --name backup.zip
gdirect mount                             # 挂载到 ~/GoogleDrive（macOS 走原生 NFS 免 FUSE）
gdirect unmount                           # 卸载并清理临时导出的凭据
```

在 `gdirect browse` 界面中，可以用键盘完成几乎所有日常操作：

| 按键 | 操作 |
| --- | --- |
| `j / k`、`↑ / ↓` | 上下选择文件或文件夹 |
| `Enter`、`l / →` | 进入文件夹 |
| `h / ←`、`Backspace` | 返回上级目录 |
| `d` | 加入下载队列（Google 文档、表格、幻灯片自动导出为 PDF） |
| `+ / -` | 调整后续下载的并发连接数（`1–16`），并保存为默认值（初始为 8） |
| `r` | 刷新当前目录 |
| `c` | 取消当前下载并保留已下载部分 |
| `q` | 退出 |

如果遇到特殊网络环境，`download` 和 `browse` 还支持手动干预传输层参数：

- `--ip IP`：强制使用指定的 Google IP，跳过自动扫描结果；
- `--sni HOST` / `--no-sni`：改写 TLS SNI 主机名，或完全不发送 SNI（证书仍按真实 Google 主机名校验）；
- `-j N`：仅对当前命令设置并发连接数（`1–16`）；
- `gdirect scan --ips FILE`：探测自定义候选 IP 列表（每行一个公网 IP，`#` 后为注释）。

### 常见报错速查表

| 现象 | 处理方法 |
| --- | --- |
| `access_denied` 或提示应用正在测试 | 把当前账号加为测试用户，或发布应用（见配置指南第 5 步） |
| `redirect_uri_mismatch` | 下载的 JSON 不是 **Desktop app** 客户端，按第 4 步重新创建 |
| `Drive API 403 … insufficient permission` | 在客户端所在的**同一个项目**中启用 Drive API（第 1 步），并保存 Drive 权限范围（第 3 步底部点 Save）；然后执行 `gdirect login --reauth` |
| `refresh credential expired or revoked` | 执行 `gdirect login --reauth`。如果每 7 天出现一次，把应用从测试状态发布为正式版（第 5 步） |

---

## 技术解析：底层是怎么实现的？

如果你对 `gdirect` 内部是如何用 Rust 配合定制 `libaria2` 实现上述机制感兴趣，下面结合仓库源码逐一拆解。

### 1. 候选 IP 扫描与双端点校验

第一次运行传输类命令时，如果本地 SQLite 里没有 24 小时内验证过的可用 IP，`src/scan.rs` 就会启动扫描。候选池由三部分汇总（上限 256 个）：

1. 内置引导种子 IP `183.56.143.147`（来自 Cealing-Host，每次都会重新探测，从不盲目采信）；
2. 系统 DNS 对 `www.googleapis.com`、`drive.usercontent.google.com`、`drive.google.com` 解析出的公网 IP；
3. SQLite 中过去 7 天内曾经成功连通的历史 IP（超过 7 天未成功的僵死记录会在扫描前自动清理，避免候选池无限膨胀）。

在进入探测池前，`public(ip)` 会先把私网、环回、链路本地地址以及 `198.18.0.0/15`（Clash / Mihomo `fake-ip` 默认网段）全部过滤掉。随后启动 8 个工作线程并发执行 `probe(ip)`：

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/scan.rs#L78-L113" title="对单个候选 IP 进行 TLS 与双端点探测"
fn probe(ip: IpAddr) -> Result<(i64, Option<String>)> {
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .resolve("www.googleapis.com", SocketAddr::new(ip, 443))
        .resolve("drive.usercontent.google.com", SocketAddr::new(ip, 443))
        .build()?;
    let start = Instant::now();
    let response = client
        .get("https://www.googleapis.com/drive/v3/about?fields=user")
        .send()
        .map_err(|e| e.without_url())?;
    ensure!(
        response.status() == reqwest::StatusCode::UNAUTHORIZED,
        "unexpected Drive API status {}",
        response.status()
    );
    let data: serde_json::Value = response.json()?;
    ensure!(data["error"]["code"] == 401, "invalid Drive API response");
    let response=client.get("https://drive.usercontent.google.com/download?id=0B9P1L--7Wd2vU3VUVlFnbTgtS2c&export=download&confirm=t").send().map_err(|e|e.without_url())?;
    let status = response.status();
    let warning = if matches!(
        status,
        reqwest::StatusCode::FORBIDDEN | reqwest::StatusCode::NOT_FOUND
    ) {
        Some(format!("HTTP {status}"))
    } else {
        ensure!(status.is_success(), "Drive download probe HTTP {status}");
        let mut bytes = Vec::new();
        response.take(32).read_to_end(&mut bytes)?;
        (bytes != b"spam\n").then(|| "unexpected content".into())
    };
    Ok((start.elapsed().as_millis() as i64, warning))
}
```

这段探测逻辑有三个关键设计：

- **`.no_proxy()` + `.resolve()`**：强制绕过环境变量代理，在客户端内部把 `www.googleapis.com` 和 `drive.usercontent.google.com` 直接绑定到待测 `ip:443`，同时走完整的 TLS 证书校验（验证证书链及 SAN 域名匹配，杜绝连上运营商拦截页或中间人）。
- **无凭证 API 校验**：不携带任何用户 Token 请求 `GET /drive/v3/about?fields=user`。真正的 Google Drive API 节点一定会返回 HTTP `401 Unauthorized` 且 JSON `error.code == 401`。这样既验证了应用层路由，又不会在探测未知 IP 时泄露用户的 Bearer Token。
- **下载链路探针**：接着向 `drive.usercontent.google.com` 请求一个公开的小测试文件。如果测试文件本身因 Google 限流返回 403/404，只要前一步 Drive API 校验通过，该 IP 依然会被标记为可用并打印警告，避免因为公开测试文件失效而把正常 IP 全部误杀。

### 2. 定制 libaria2：为什么必须给 C++ 源码打补丁

对于 `ls` 和 `upload`，Rust 层的 `reqwest` 配合 `.resolve()` 就够用了；但下载大文件需要多连接分段并发和断点续传，`gdirect` 选择把 `aria2 1.37.0` 裁剪成纯 HTTP/HTTPS + OpenSSL 3 的静态库 `libaria2` 嵌进二进制。

问题在于：**Google Drive 的下载请求经常会发生跨域名 302 重定向**（例如从 `www.googleapis.com` 或 `drive.google.com` 重定向到 `drive.usercontent.google.com` 乃至动态生成的 `*.googleusercontent.com`）。在原版 `aria2` 里，如果你只是修改初始 URL，一旦跟随 302 跳转到新域名，`aria2` 又会去查系统 DNS；而如果你把 URL 里的域名硬改成 IP，TLS 证书校验又会立刻因为主机名不匹配而失败。

为此，`gdirect` 在构建 `libaria2` 时打了一个不到 90 行的补丁（`vendor/aria2-1.37.0.patch` 配合 `vendor/gdirect_route.h`），在 C++ 底层做了四处改动：

#### （1）Google Drive 传输域名白名单

先在 `vendor/gdirect_route.h` 中收拢所有受控的 Google Drive 域名：

```cpp src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/vendor/gdirect_route.h#L1-L12" title="Google Drive 域名白名单"
// gdirect's narrow routing hook for the pinned aria2 1.37.0 build.
#pragma once
#include <string>
extern const char* gdirect_ip;
extern const char* gdirect_sni;
inline bool gdirect_host(const std::string& h) {
  const std::string suffix = ".googleusercontent.com";
  return h == "drive.google.com" || h == "drive.usercontent.google.com" ||
         h == "www.googleapis.com" || h == "content.googleapis.com" ||
         h == "drive.googleapis.com" ||
         (h.size() > suffix.size() && h.compare(h.size()-suffix.size(), suffix.size(), suffix) == 0);
}
```

#### （2）在 `SocketCore.cc` 拦截 `getaddrinfo` 与 TLS SNI

上层 HTTP 请求保持原始 URL 不变（因此 HTTP `Host` 头与 OpenSSL 证书校验使用的目标域名完全不受影响）。只有当 `SocketCore` 真正调用 `getaddrinfo` 建立连接时，才把命中 `gdirect_host(host)` 的主机名替换成扫描出的 `gdirect_ip`，并加上 `AI_NUMERICHOST` 彻底跳过 DNS 解析。同一处还接管了 `tlsSession_->setSNIHostname()`：

```diff src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/vendor/aria2-1.37.0.patch#L22-L42" title="在 SocketCore.cc 中接管 TLS SNI 与 getaddrinfo"
@@ -936,7 +941,9 @@
     // "localhost" will produce TLS alert with GNUTLS.
     if (tlsctx->getSide() == TLS_CLIENT && !util::isNumericHost(hostname) &&
         hostname.find(".") != std::string::npos) {
-      rv = tlsSession_->setSNIHostname(hostname);
+      const char* sni = gdirect_host(hostname) ? gdirect_sni : nullptr;
+      rv = (sni && !*sni) ? TLS_ERR_OK :
+          tlsSession_->setSNIHostname(sni ? std::string(sni) : hostname);
       if (rv != TLS_ERR_OK) {
         throw DL_ABORT_EX(fmt(EX_SSL_INIT_FAILURE,
                               tlsSession_->getLastErrorString().c_str()));
@@ -1450,6 +1457,10 @@
   hints.ai_flags = getDefaultAIFlags();
   hints.ai_flags |= flags;
   hints.ai_protocol = protocol;
+  if (host && gdirect_ip && *gdirect_ip && gdirect_host(host)) {
+    host = gdirect_ip;
+    hints.ai_flags |= AI_NUMERICHOST;
+  }
   return getaddrinfo(host, service, &hints, resPtr);
 }
```

- 当 `gdirect_sni` 为 `nullptr`（默认）时，正常发送原域名作为 SNI；
- 当传入 `--sni HOST` 时，发送伪装的 SNI 主机名；
- 当传入 `--no-sni` 时（`gdirect_sni` 为空字符串 `""`），直接返回 `TLS_ERR_OK` 跳过设置，让 OpenSSL 发出不带 SNI 扩展的 `ClientHello`。

#### （3）跨域重定向自动剥离 `Authorization` 头与重定向白名单

下载私有文件时，初始请求发往 `https://www.googleapis.com/drive/v3/files/{id}?alt=media` 并携带 `Authorization: Bearer <token>`。一旦 302 跳转到 `*.googleusercontent.com` 的临时签名 URL，如果继续携带 `Authorization` 头，Google 内容节点会因为同时收到两套认证信息而报错，也有跨域名泄露令牌的风险。因此补丁在 `HttpRequest.cc` 中规定只有当 `getHost() == "www.googleapis.com"` 时才输出 `Authorization:` 头；并在 `Request.cc` 中强制限制所有重定向目标都必须是 `https` 且满足 `gdirect_host()`。

#### （4）去掉 OpenSSL 3 Legacy Provider 依赖

原版 `aria2` 在 OpenSSL 3 下启动时会无条件调用 `OSSL_PROVIDER_load(nullptr, "legacy")`（为了 BitTorrent 加密里的 RC4）。在没有安装 `legacy` 模块的系统上会导致启动直接崩溃。补丁用 `#ifdef ENABLE_BITTORRENT` 把它围了起来，使纯 HTTP 静态构建不再依赖任何外部 OpenSSL 模块。

### 3. 下载防呆、大文件病毒扫描确认页与 MD5 校验

在 Rust 侧的 `src/download.rs` 中，围绕 `libaria2` 还有三层保障：

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/download.rs#L191-L248" title="断点控制文件判定、HTML 确认页自动跳转与 MD5 校验"
    // Never treat an unrelated existing file as a resumable download.
    let control = PathBuf::from(format!("{}.aria2", args.output.display()));
    if args.output.exists() && !control.exists() {
        ensure!(
            matches_md5(&args.output, args.md5.as_deref())?,
            "output already exists; choose another -o path"
        );
        if progress.is_none() {
            println!("Already downloaded {}", args.output.display());
        }
        return Ok(());
    }
    if progress.is_none() {
        eprintln!(
            "libaria2 1.37.0 · IP={} · SNI={} · certificate verification ON",
            args.ip
                .map(|ip| ip.to_string())
                .unwrap_or_else(|| "system DNS".into()),
            match args.sni.as_deref() {
                None => "original",
                Some("") => "none",
                Some(sni) => sni,
            }
        );
    }
    let mut progress = progress;
    for attempt in 0..3 {
        download(&args, &url, token.as_deref(), progress.as_deref_mut())?;
        let mut prefix = Vec::new();
        fs::File::open(&args.output)?
            .take(1024 * 1024)
            .read_to_end(&mut prefix)?;
        // Public downloads can return the virus-scan confirmation form with HTTP 200.
        // Only Drive's own HTML pages are inspected; other files stay untouched.
        if token.is_none() && html_page(&prefix) {
            let text = String::from_utf8_lossy(&prefix);
            if text.contains("download-form") {
                let next = drive::confirmation(&text, &url)?;
                ensure!(attempt < 2, "Drive confirmation loop");
                fs::remove_file(&args.output)?;
                url = next;
                continue;
            }
            if text.contains("accounts.google.com/ServiceLogin")
                || text.contains("Google Drive - Quota exceeded")
                || text.contains("Google Drive - Access denied")
            {
                bail!(
                    "Drive returned a login/quota error page; saved for inspection at {}",
                    args.output.display()
                );
            }
        }
        ensure!(
            args.md5.is_none() || matches_md5(&args.output, args.md5.as_deref())?,
            "MD5 does not match Drive's checksum; the file is kept at {} for inspection",
            args.output.display()
        );
```

- **已存在文件的安全检查**：如果目标文件已存在且没有对应的 `.aria2` 断点文件，先算一次本地 MD5 与云端 `md5Checksum` 比对——匹配则直接提示 `Already downloaded`，不匹配则拒绝覆盖。
- **公开大文件的病毒扫描确认页拆解**：未登录状态下通过分享链接下载大文件时，Google Drive 会返回 HTTP 200 的 HTML 确认页（包含 `<form id="download-form">`）。`gdirect` 只在文件头部确实是 `<!doctype html` 或 `<html` 时解析该表单，拼出带 `confirm` / `uuid` 的真实下载地址自动重下，绝不会误伤内容里恰好带有 `download-form` 字样的普通压缩包或源码文件。
- **落盘后 MD5 校验**：下载完成后再次流式计算整个文件的 MD5 并与 Drive 元数据核对，确保多连接切片拼接毫无差错。

### 4. 32 MiB 分块可恢复上传

上传模块（`src/upload.rs`）基于 Google Drive v3 的 Resumable Upload 协议。考虑到跨国直连链路的 RTT 较高，分块过小会导致大量时间浪费在等待每个块的确认上，因此将单次分块大小设为 `32 MiB`。

每次开始上传时，程序以 `(本地绝对路径, 目标父目录 ID, 云端文件名)` 为键查询本地 SQLite：

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/upload.rs#L85-L105" title="向云端探测已有上传会话的已接收偏移量"
        let mut session = saved.filter(|s| s.size == size && s.modified == modified);
        if let Some(s) = &session {
            let response = self
                .client
                .put(session_url(&s.url)?)
                .bearer_auth(&token)
                .header("Content-Range", format!("bytes */{size}"))
                .header("Content-Length", 0)
                .send()
                .map_err(|e| e.without_url())?;
            match response.status() {
                StatusCode::OK | StatusCode::CREATED => {
                    let result = response.json()?;
                    db.unset(&key)?;
                    return Ok(result);
                }
                StatusCode::PERMANENT_REDIRECT => start = offset(&response, size)?,
                StatusCode::NOT_FOUND | StatusCode::GONE => session = None,
                _ => return Err(failure(response)),
            }
        }
```

只要本地文件的大小和纳秒级修改时间没有变化，中断后重跑同一条命令就会先发送 `Content-Range: bytes */{size}` 探测云端进度，从 `308 Permanent Redirect` 返回的 `Range` 头里拿到断点偏移量继续上传。

### 5. 本机 Loopback + PKCE 授权流

在 `src/auth.rs` 中，`gdirect login` 实现了无需外部 SDK 的 **OAuth 2.0 Loopback + PKCE（RFC 7636 `S256`）** 流程：

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/auth.rs#L194-L213" title="本机随机端口监听与 PKCE 授权 URL 构造"
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let redirect = format!(
        "http://127.0.0.1:{}/callback",
        listener.local_addr()?.port()
    );
    let state = random_string()?;
    let verifier = random_string()?;
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("access_type", "offline"),
        ("prompt", "consent select_account"),
        ("state", state.as_str()),
        ("code_challenge", challenge(&verifier).as_str()),
        ("code_challenge_method", "S256"),
    ]);
```

它在 `127.0.0.1:0` 上开启一个临时的非阻塞 TCP 监听，校验浏览器回调的 `state` 参数防 CSRF，再用授权码和 `code_verifier` 向 `https://oauth2.googleapis.com/token` 换取 `refresh_token`。落盘的 SQLite 数据库和临时导出的 `rclone` 凭据文件在创建时即强制设为 `0600` 权限，`unmount` 或挂载失败时也会自动清理导出的临时凭据文件。
