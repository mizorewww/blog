{"title":"gdirect：终端直连 Google 云盘的原理与配置指南","description":"TL;DR 先看 gdirect 如何借道 google-cn 国内节点直连 Google 云盘、避开翻墙软件嗅探截胡，再照着 10 分钟图文指南配好专属 OAuth 客户端，最后拆解底层实现。","date":"2026-10-25","tag":"技术","tags":["Rust","Google Drive","CLI","Network"]}
---

平时从 Google Drive 拖几十 GB 的数据集或备份，走代理往往既烧流量又受限于节点带宽；用浏览器下载还经常在中途断流后从头再来。为此我写了 [gdirect](https://github.com/mizorewww/gdirect)：一个在终端里浏览、下载、上传和挂载 Google 云盘的工具。

这篇文章按三个部分组织：**先用几分钟讲清楚它是怎么“伪装”并直连 Google 的（TL;DR）**，接着是**开箱即用的安装与 10 分钟图文配置指南**，最后再深入源码做**底层技术解析**。

## TL;DR：我们是怎么“伪装”直连的？

在大陆网络下，Google Drive 的域名（`drive.google.com`、`www.googleapis.com`、`drive.usercontent.google.com`）处于被封锁状态；但与此同时，Google 为了给国内提供 Chrome 更新、Android 连通性校验、字体等基础服务，在大陆境内（电信、联通、移动骨干网内）保留了一批可直连的边缘服务器——也就是分流规则集（如 [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata)）里归入 **`google-cn`** 的那批域名（如 `dl.google.com`、`g.cn`、`fonts.googleapis.com`）背后的国内 IP（例如广州电信的 `183.56.143.147`）。

关键在于：**这些位于墙内的 `google-cn` 节点，跑的同样是 Google 统一的前端反向代理（GFE，Google Front End），背后通过 Google 内部专线直通全球云盘后端，并且持有 `*.googleapis.com` 与 `*.googleusercontent.com` 的合法官方 TLS 证书。**

`gdirect` 就是利用这一点，用**“借 `google-cn` 的国内肉身（IP），发 Google Drive 的原始请求（域名与证书）”**完成伪装与直连的：

1. **底层 TCP 指向国内 `google-cn` 节点 IP**：绕过被污染的系统 DNS，从内置种子 IP（`183.56.143.147`）和候选池出发，直接连向目标的 443 端口。经过实测探针（核验 Google 官方 TLS 证书 + 验证 Drive v3 API 响应）确认可用后存入本地 SQLite。在底层的套接字建立阶段（Rust 的 `reqwest::resolve` 和定制 C++ `libaria2` 的 `getaddrinfo` 钩子），哪怕下载中途发生多次 302 跨域名重定向，所有连接的目标 IP 都会被强制锁死在这个国内 `google-cn` 节点上——因为目标 IP 本身就在国内骨干网，物理链路根本不过墙。
2. **上层 TLS / HTTP 保持真实云盘域名与证书校验**：连上国内 `google-cn` 的 IP 后，应用层请求写的依然是标准的 `https://www.googleapis.com`（API 与分块上传）和 `https://drive.usercontent.google.com` / `https://*.googleusercontent.com`（文件下载）。国内 GFE 节点收到后，按主机名通过 Google 内网把云盘数据拉回来；本机也照常按真实域名严格校验 TLS 证书（若遇到针对明文域名的拦截，还可用 `--sni` / `--no-sni` 改写或剥离 TLS 握手中的 SNI）。
3. **控制面与数据面分离**：只有几 KB 的登录与刷新令牌（`accounts.google.com`、`oauth2.googleapis.com`）照常走系统网络（翻墙代理），保证随时能登得上；真正吃带宽的目录浏览、多连接并发下载、32 MiB 分块上传全部走上述国内直连 IP，不耗一字节代理流量就能跑满本地宽带。

| 流量类型 | 涉及命令 / 域名 | 走向 |
| --- | --- | --- |
| 云盘 API、下载、上传 | `browse`、`ls`、`download`、`upload`（`www.googleapis.com`、`drive.usercontent.google.com`、`*.googleusercontent.com`） | 扫描到的国内 `google-cn` 可用 IP。主机名和证书校验不变，可用 `--sni` / `--no-sni` 改写或去掉 TLS SNI |
| 登录与刷新令牌 | `login` 及自动刷新（`accounts.google.com`、`oauth2.googleapis.com`） | 系统网络（走系统 DNS 与翻墙代理） |
| 磁盘挂载 | `mount`（底层调用 `rclone`） | 系统网络 |

> **大陆网络环境特别提示：**
> 就算你的翻墙软件已经把 [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) 的 `google-cn` 设为了直连，开着翻墙软件（尤其是 TUN 模式）跑 `gdirect` 时**依然有可能走代理**！因为 `gdirect` 虽然连的是 `google-cn` 的 IP，但 TLS 握手发的是云盘域名（`drive.usercontent.google.com`、`www.googleapis.com`），而这些域名在规则集里属于需要翻墙的 `google` 而非 `google-cn`，会被翻墙软件嗅探（Sniff）出域名后半路截胡送进代理。
> 因此大陆用户请务必二选一（详见下文[大陆网络与代理配置指南](#大陆网络与代理配置指南)）：
> 1. **在翻墙软件中配置规则**：显式让上述云盘域名（或 `gdirect` 进程）走 `DIRECT` 直连并关闭 `fake-ip`；
> 2. **退出翻墙软件或关闭 TUN**：开着代理完成 `gdirect login` 登录好之后，在 `scan` 和下载时退出翻墙软件（或关闭 TUN 模式）。

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

在大陆使用 `gdirect` 时，最容易遇到的困惑是：**我的翻墙软件（sing-box / Mihomo / Clash）明明已经用了 [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) 规则集，并且把 `google-cn` 设为了 `DIRECT` 直连，为什么跑 `gdirect` 下载时流量还是有可能走代理？**

### 仔细算一笔账：翻墙软件是怎么把直连流量截胡的？

虽然 `gdirect` 在应用层禁用了 HTTP/SOCKS 代理环境变量（`no_proxy`），但当你开着翻墙软件（尤其是 **TUN 虚拟网卡模式**）时，所有流量都会先经过翻墙软件的路由引擎。我们顺着翻墙软件的匹配逻辑看一遍：

1. **我们借的是 `google-cn` 的 IP，但发的是 Google Drive 的域名**：
   `gdirect` 在底层把连接目标 IP 换成了国内 `google-cn` 节点（比如 `183.56.143.147`），但为了让 Google 边缘节点正确路由并通过本机 TLS 证书校验，它在 TLS 握手（`ClientHello` 的 SNI）和 HTTP `Host` 头里发出的依然是 `www.googleapis.com`、`drive.usercontent.google.com` 和 `*.googleusercontent.com`。
2. **云盘的这些域名，并不在 `google-cn` 规则集里！**
   翻开 [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) 的 `google-cn` 规则集可以看到，里面收录的是 `dl.google.com`、`g.cn`、`gstatic.cn`、`fonts.googleapis.com`、`clientservices.googleapis.com` 等国内本来就能直连的域名；而 **`www.googleapis.com`、`drive.usercontent.google.com`、`drive.google.com`、`*.googleusercontent.com` 并不在 `google-cn` 里，它们全部躺在需要翻墙的 `google` 规则集里**。
3. **TUN 流量嗅探（`sniff`）触发按域名截胡**：
   当 `gdirect` 向国内 IP `183.56.143.147:443` 发起连接时，TUN 网卡拦下数据包，通过 `sniff`（TLS 域名嗅探）读出里面的 SNI 是 `drive.usercontent.google.com` 或 `www.googleapis.com`。随后翻墙软件拿着这个嗅探出来的域名从上往下走规则：
   - 经过 `rule_set: google-cn`（直连）$\rightarrow$ **未命中**（因为域名是云盘域名，不在 `google-cn` 中）；
   - 走到 `rule_set: google`（代理）$\rightarrow$ **直接命中！**
   - 在主流规则模板里，域名规则优先于 IP 规则（或者当 `scan` 尝试用系统 DNS 解析上述云盘域名时，直接在 DNS 层命中 `google` 规则被远端代理解析或返回 `198.18.x.x` 的 Fake-IP）。结果就是：**这股明明发往国内电信 IP 的连接，因为身上带着 `google` 规则集里的域名，被翻墙软件当成翻墙流量重新塞进了代理节点！**

理清了这个逻辑，大陆用户只需要在下面两种做法中**二选一**即可彻底解决：

### 做法一：登录好之后，`scan` 和下载时退出翻墙软件（或关闭 TUN）

如果你不想改动翻墙软件现有的分流规则，这是最简单、也最干净的做法：

1. **登录阶段（开着翻墙软件）**：保持翻墙软件正常开启，执行 `gdirect login --client-secret ...` 完成授权（因为浏览器打开 `accounts.google.com` 以及终端向 `oauth2.googleapis.com` 换取/刷新令牌必须走代理）。
2. **扫描与下载阶段（退出翻墙软件，或关闭 TUN 模式）**：
   - 登录完成后（本地已拿到有效期约 1 小时的短期 `access_token`），**直接退出翻墙软件，或者关掉翻墙软件的 TUN 模式**（如果只开系统代理 System Proxy、不开 TUN，`gdirect` 自身会忽略系统代理环境变量直接连出去，但关掉 TUN 最稳妥）。
   - 执行 `gdirect scan` 扫出当前纯物理宽带下最快的国内 `google-cn` 节点 IP。
   - 执行 `gdirect download ...` 或 `gdirect browse` 开始满速直连下载（若遇到宽带运营商对明文 SNI 重置连接，加上 `--no-sni` 即可）：

```sh
gdirect scan
gdirect download FILE_ID
# 若遇到连接或 TLS 重置（libaria2 code 1），去掉 SNI 即可：
gdirect download FILE_ID --no-sni
```

### 做法二：在翻墙软件中配置规则，把云盘域名（或 `gdirect` 进程）也并入直连

如果你希望翻墙软件和 TUN 模式 24 小时常开，思路其实很简单：**既然翻墙软件是因为嗅探到了云盘域名才把流量分给 `google`（代理）的，那我们就在 `google` 规则之前，手动把这几个云盘域名（或 `gdirect` 进程本身）也像 `google-cn` 一样指派给 `DIRECT` 直连**：

- **保留走代理（`PROXY`）的域名**（仅用于登录和令牌自动刷新）：
  - `accounts.google.com`
  - `oauth2.googleapis.com`
- **需要放行直连（`DIRECT`）并关闭 `fake-ip` 的传输域名**：
  - `drive.usercontent.google.com`
  - `*.googleusercontent.com`
  - `drive.google.com`
  - `www.googleapis.com`、`drive.googleapis.com`、`content.googleapis.com`

> **注意**：普通浏览器访问 `www.googleapis.com` 时并不会像 `gdirect` 这样把底层 IP 替换成 `google-cn` 节点，所以如果你把 `www.googleapis.com` 全局设为 `DIRECT`，可能会影响浏览器里依赖该域名的其他网页。因此在桌面端最推荐配合 **`PROCESS-NAME`（进程名分流）**，或者只对 `gdirect` 进程放行直连。

以 **Mihomo（Clash）** 为例，在配置文件的 `GEOSITE,google` 规则之前加入：

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

  # 2. 推荐：让 gdirect 进程的其余所有流量（扫描、API、下载、上传）强制直连，不被 sniff 域名规则截胡
  - PROCESS-NAME,gdirect,DIRECT

  # 3. 或者按具体域名直连（放在 GEOSITE,google / RULE-SET,google 之前）：
  - DOMAIN,drive.usercontent.google.com,DIRECT
  - DOMAIN-SUFFIX,googleusercontent.com,DIRECT
  - DOMAIN,www.googleapis.com,DIRECT
  - DOMAIN,drive.googleapis.com,DIRECT
  - DOMAIN,content.googleapis.com,DIRECT
```

如果你用的是 **sing-box**，同样可以在 `route.rules` 的 `sniff` 或 `rule_set: ["google"]` 之前加上一条按进程或域名的直连规则（保留 `oauth2.googleapis.com` 走代理），就能在 TUN 常开的情况下随时免流跑满云盘下载。

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

> **如何自己寻找更多候选直连 IP？**
> 如果内置种子 IP `183.56.143.147` 在你所在地区的运营商网络下延迟较高，你可以从 [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) 的 `google-cn` 列表里挑几个域名（如 `dl.google.com`、`g.cn`、`fonts.googleapis.com`、`gstatic.cn`），用国内 DNS（如 `dig @223.5.5.5 dl.google.com +short`）解析出一批你当地运营商的 Google 边缘 IP，每行一个存成 `ips.txt`，再执行 `gdirect scan --ips ips.txt`。探测仪会自动帮你筛出其中持有合法证书且能跑通 Drive API 的最快节点。

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
