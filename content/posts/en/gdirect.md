{"title":"gdirect: Direct Google Drive Access from the Terminal — How It Works and Setup Guide","description":"TL;DR on how gdirect routes Google Drive traffic through domestic google-cn edge nodes without getting hijacked by proxy sniffers, followed by a 10-minute illustrated OAuth setup guide and a deep dive into the Rust + patched libaria2 internals.","date":"2026-10-25","tag":"Tech","tags":["Rust","Google Drive","CLI","Network"]}
---

Pulling tens of gigabytes of datasets or backups from Google Drive over a proxy usually burns through expensive data quotas and bottlenecks on proxy node bandwidth; downloading in a browser often drops partway through and forces you to start over. To solve this, I wrote [gdirect](https://github.com/mizorewww/gdirect): a terminal tool for browsing, downloading, uploading, and mounting Google Drive.

This post is organized into three parts: **a quick TL;DR on how it "disguises" connections to reach Google directly**, **a ready-to-use installation and 10-minute illustrated setup guide**, and finally **a technical deep dive into the underlying source code**.

## TL;DR: How Do We Connect Directly Without a Proxy?

On networks in mainland China, Google Drive's domains (`drive.google.com`, `www.googleapis.com`, `drive.usercontent.google.com`) are blocked. At the same time, to keep basic services like Chrome updates, Android connectivity checks, and Google Fonts working in mainland China, Google maintains a pool of directly reachable edge servers inside domestic carrier backbones (China Telecom, Unicom, and Mobile)—the domestic IPs (such as Guangzhou Telecom's `183.56.143.147`) behind the domains categorized under **`google-cn`** in routing rulesets like [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) (`dl.google.com`, `g.cn`, `fonts.googleapis.com`, etc.).

Here is the key insight: **those domestic `google-cn` edge nodes run the exact same unified reverse proxy—Google Front End (GFE)—connected over Google's private backbone to the global Drive backends, and they present valid official TLS certificates for `*.googleapis.com` and `*.googleusercontent.com`.**

`gdirect` takes advantage of this by **"borrowing a domestic `google-cn` IP at the transport layer while sending authentic Google Drive requests (domains and certificate checks) at the application layer"**:

1. **Point underlying TCP sockets at domestic `google-cn` node IPs**: Bypassing poisoned system DNS, `gdirect` starts from a built-in seed IP (`183.56.143.147`) and candidate pool, connecting directly to port 443. Candidates that pass live probes (verifying an official Google TLS certificate + a valid Drive v3 API response) are cached in local SQLite. During socket creation (via Rust's `reqwest::resolve` and a custom `getaddrinfo` hook in patched C++ `libaria2`), even across multiple cross-domain HTTP 302 redirects mid-download, every target IP is pinned to that domestic `google-cn` node—so the physical packet path stays inside domestic carrier backbones and never crosses the firewall.
2. **Keep real Google Drive hostnames and strict TLS verification at the upper layers**: Once connected to the domestic `google-cn` IP, application-layer requests still address standard `https://www.googleapis.com` (API and chunked uploads) and `https://drive.usercontent.google.com` / `https://*.googleusercontent.com` (file downloads). The domestic GFE node routes the request by hostname over Google's internal backbone to fetch your Drive data, while the client strictly verifies TLS certificates against the real Google hostnames as usual (and if an ISP middlebox resets connections on cleartext SNI, `--sni` / `--no-sni` can rewrite or strip the TLS SNI extension).
3. **Separate the control plane from the data plane**: Login and token refreshes (`accounts.google.com`, `oauth2.googleapis.com`), which take only a few kilobytes, go through the normal system network (your proxy) so authentication always works; bandwidth-heavy directory listing, multi-connection concurrent downloads, and 32 MiB resumable uploads all go straight through the domestic `google-cn` IP—saturating your local broadband without spending a single byte of proxy traffic.

| Traffic Type | Commands / Domains | Route |
| --- | --- | --- |
| Drive API, downloads, uploads | `browse`, `ls`, `download`, `upload` (`www.googleapis.com`, `drive.usercontent.google.com`, `*.googleusercontent.com`) | Scanned domestic `google-cn` IP. Hostnames and TLS certificate verification remain unchanged; `--sni` / `--no-sni` can rewrite or strip TLS SNI |
| Login & token refresh | `login` and automatic token refresh (`accounts.google.com`, `oauth2.googleapis.com`) | System network (uses system DNS and your proxy) |
| Disk mount | `mount` (invokes `rclone` under the hood) | System network |

> **Important Note for Users in Mainland China:**
> Even if your proxy client already sets `google-cn` from [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) to `DIRECT`, running `gdirect` with your proxy (especially TUN mode) enabled **can still end up routing your downloads through the proxy!** That's because although `gdirect` connects to a `google-cn` IP, its TLS handshake sends Google Drive hostnames (`drive.usercontent.google.com`, `www.googleapis.com`). In standard rulesets, those domains belong to `google` (proxied) rather than `google-cn` (direct), so a TUN sniffer will inspect the TLS SNI, match the `google` rule, and hijack the connection into your proxy tunnel.
> Make sure to pick one of these two setups (see [Mainland China Network and Proxy Configuration Guide](#mainland-china-network-and-proxy-configuration-guide) below for details):
> 1. **Add direct rules in your proxy client**: explicitly route the Drive domains above (or the `gdirect` process) to `DIRECT` and exclude them from `fake-ip`;
> 2. **Quit your proxy or disable TUN during transfers**: keep your proxy on for the one-time `gdirect login`, then quit the proxy (or turn off TUN mode) when running `scan` and `download`.

---

## Installation

Prebuilt binaries are provided for **macOS 15+** (Apple Silicon / Intel), **Linux x86_64** (glibc 2.35+, e.g. Ubuntu 22.04+, Debian 12+, Fedora, Arch), and **Windows x86_64**.

### Option 1: One-Line Install Script

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/mizorewww/gdirect/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/mizorewww/gdirect/main/scripts/install.ps1')))
```

The installer places `gdirect` and its bundled `cacert.pem` into `~/.local/bin` (`%LOCALAPPDATA%\gdirect\bin` on Windows).

If you also want to use `gdirect mount` to mount Google Drive as a local disk, pass `--with-mount` (`-WithMount` in PowerShell) to automatically install the mount dependencies (`rclone 1.75.2+`, plus `fuse3` on Linux or `WinFsp` via `winget` on Windows):

```sh
curl -fsSL https://raw.githubusercontent.com/mizorewww/gdirect/main/scripts/install.sh | bash -s -- --with-mount
```

### Option 2: Homebrew (macOS / Linux)

```sh
brew tap mizorewww/gdirect https://github.com/mizorewww/gdirect
brew install mizorewww/gdirect/gdirect
brew install rclone   # Only needed for `gdirect mount`; Linux also requires `fuse3` from your system package manager
```

To upgrade later, run `brew update && brew upgrade gdirect`.

---

## One-Time Google Cloud Setup Guide (~10 Minutes)

To avoid rate-limiting (`429 Too Many Requests`) or bans caused by everyone sharing a single public OAuth client, `gdirect` does not ship a shared client ID. Instead, you create your own **Desktop app** OAuth client in your personal Google Cloud project. You only need to do this once, and it is completely free.

### 1. Create a Project and Enable the Drive API

1. Open the [Google Cloud Console](https://console.cloud.google.com/), click the project picker at the top of the page, and click **New project** in the top-right corner. Name it anything you like (e.g. `gdirect`), leave **Location** as **No organization** for a personal account, click **Create**, and make sure the new project is selected at the top.

   ![Creating a new project in the Google Cloud Console](../../images/gdirect/01-project.png)

2. Open the [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) page, confirm your new project is selected at the top, and click **Enable**.

   ![Enabling the Google Drive API](../../images/gdirect/02-enable-api.png)

   Once enabled, the page shows the service name `drive.googleapis.com` with status **Enabled**.

   ![Confirming that the Google Drive API is enabled](../../images/gdirect/03-api-enabled.png)

### 2. Configure the OAuth App

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and click **Get started**.
2. **App information**: Enter an app name (e.g. `gdirect`, shown on the consent screen), select your email address as the user support email, and click **Next**.

   ![Entering the OAuth app name and support email](../../images/gdirect/04-branding.png)

3. **Audience**: Choose **External** and click **Next** (personal accounts cannot choose Internal).

   ![Selecting External audience](../../images/gdirect/05-audience.png)

4. **Contact information**: Enter your email address and click **Next**.
5. **Finish**: Check the box agreeing to the Google API Services User Data Policy, click **Continue**, and then click **Create**.

   ![Agreeing to the user data policy and creating the app](../../images/gdirect/06-policy.png)

### 3. Add the Drive Scope

1. Open **Data Access** in the left sidebar and click **Add or remove scopes**.
2. In the drawer that opens, select `.../auth/drive` ("See, edit, create, and delete all of your Google Drive files"). If you don't see it in the table, paste the URL below into **Manually add scopes**, click **Add to table**, and then click **Update**:

   ```text
   https://www.googleapis.com/auth/drive
   ```

   ![Adding and selecting the auth/drive scope](../../images/gdirect/07-add-scope.png)

3. **Important**: After returning to the Data Access page, make sure to click **Save** at the bottom of the page. Clicking Update in the drawer alone does not persist the change.

   ![Clicking Save at the bottom of the Data Access page](../../images/gdirect/08-scope-saved.png)

### 4. Create a Desktop Client and Download the JSON

1. Open **Clients** in the left sidebar and click **Create client**. Set **Application type** to **Desktop app** (Web application clients, API keys, and service-account JSONs will not work), give it any name (e.g. `gdirect Desktop`), and click **Create**.

   ![Creating a Desktop app OAuth client](../../images/gdirect/09-desktop-client.png)

2. In the dialog that pops up, click **Download JSON** **before closing the modal**. Once closed, Google won't let you download the secret JSON again (if you close it by mistake, just create a new client).

   ![Downloading the client secret JSON file](../../images/gdirect/10-client-created.png)

### 5. Allow Your Account to Sign In (and Avoid the 7-Day Expiry)

Newly created apps start in **Testing** mode, where only listed test users are allowed to sign in:

1. Open **Audience** in the left sidebar, click **Add users** under **Test users**, enter the Google account email you want to use with `gdirect`, and click **Save**.

   ![Adding your Google account as a test user](../../images/gdirect/11-test-user.png)

While the app stays in Testing mode, refresh tokens expire after **7 days**, requiring `gdirect login --reauth` once a week.

If you don't want to re-authenticate every week, simply click **Publish app** at the top of the **Audience** page to switch the status to **In production**. A personal app used only by you does not need to go through Google's verification review, and publishing it removes the 7-day token expiration limit.

### 6. Log In from the Terminal

Run the command below in your terminal, replacing the path with the JSON file you downloaded:

```sh
gdirect login --client-secret ~/Downloads/client_secret.json
```

1. Your browser will open automatically (if it doesn't, copy the URL printed in the terminal and open it in a browser **on the same machine**, since the OAuth flow redirects back to a temporary localhost port).
2. Choose your Google account. Google will warn that "Google hasn't verified this app"—this is completely normal because you just created it yourself:
   - **Testing mode**: Click **Continue** (not "Back to safety").
   - **In production**: Click **Advanced** in the bottom-left corner, then click **Go to <your app name> (unsafe)**.

   ![Clicking Continue on the unverified app screen](../../images/gdirect/12-unverified.png)

3. Verify the app name and Google Drive permission scope, then click **Continue**.

   ![Granting Google Drive access on the consent screen](../../images/gdirect/13-consent.png)

4. Back in the terminal, once you see `Logged in`, you're all set. You can delete the downloaded JSON file now—the client credentials are saved inside local SQLite, and re-authenticating or switching accounts later only requires `gdirect login --reauth`.

> **Headless Server Tip**: On a remote server without a browser, you can authenticate on your desktop first, or import an existing `authorized_user` credentials JSON via `gdirect login --credentials <PATH>`. For scripts, you can also pass an access token directly via the `GDIRECT_ACCESS_TOKEN` environment variable.

---

## Mainland China Network and Proxy Configuration Guide

The most common question from users in mainland China is: **My proxy client (sing-box / Mihomo / Clash) already uses [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) and routes `google-cn` to `DIRECT`—why does `gdirect` traffic still get routed through my proxy?**

### Tracing the Packet Path: How Does a Proxy Sniffer Hijack Direct Traffic?

Even though `gdirect` disables HTTP/SOCKS proxy environment variables (`no_proxy`) at the application layer, whenever your proxy client is running—especially in **TUN virtual network interface mode**—every packet on the machine passes through the proxy's routing engine first. Let's trace what happens step by step:

1. **We borrow a `google-cn` IP, but send Google Drive hostnames**:
   At the socket layer, `gdirect` replaces the destination IP with a domestic `google-cn` edge node (such as `183.56.143.147`). However, so that Google's edge router knows which backend service to reach and local TLS certificate verification succeeds, the TLS handshake (`ClientHello` SNI) and HTTP `Host` header still carry `www.googleapis.com`, `drive.usercontent.google.com`, and `*.googleusercontent.com`.
2. **Those Google Drive domains are NOT in the `google-cn` ruleset!**
   If you inspect `google-cn` in [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata), it lists domains that are natively unblocked in mainland China—such as `dl.google.com`, `g.cn`, `gstatic.cn`, `fonts.googleapis.com`, and `clientservices.googleapis.com`. Meanwhile, **`www.googleapis.com`, `drive.usercontent.google.com`, `drive.google.com`, and `*.googleusercontent.com` are not in `google-cn`—they all sit in the proxied `google` ruleset**.
3. **TUN traffic sniffing (`sniff`) hijacks the connection by domain**:
   When `gdirect` opens a connection to the domestic IP `183.56.143.147:443`, the TUN interface intercepts the packet and uses `sniff` (TLS SNI inspection) to see that the SNI hostname is `drive.usercontent.google.com` or `www.googleapis.com`. The proxy then evaluates its routing rules top-to-bottom using that sniffed domain:
   - `rule_set: google-cn` (`DIRECT`) $\rightarrow$ **Miss** (the Drive domain isn't in `google-cn`);
   - `rule_set: google` (`PROXY`) $\rightarrow$ **Match!**
   - Because domain rules precede IP rules in almost all proxy templates (or when `scan` resolves those domains through system DNS and gets handed a `198.18.x.x` Fake-IP), **a connection physically destined for a domestic China Telecom IP gets misclassified as blocked Google traffic and shoved right back into your proxy tunnel!**

Once you see why this happens, picking **either one** of the two approaches below solves it completely:

### Approach 1: Quit Your Proxy (or Turn Off TUN) During `scan` and Downloads

If you don't want to touch your proxy client's routing rules, this is the simplest and cleanest workflow:

1. **Login phase (proxy ON)**: With your proxy running as usual, run `gdirect login --client-secret ...` to finish authorization (opening `accounts.google.com` in the browser and exchanging/refreshing tokens against `oauth2.googleapis.com` require a proxy).
2. **Scan & transfer phase (quit proxy, or turn off TUN mode)**:
   - Once logged in (`gdirect` caches a short-lived `access_token` valid for ~1 hour), **quit your proxy client or turn off its TUN mode** (if you only use System Proxy without TUN, `gdirect` ignores system proxy environment variables automatically, though turning off TUN is the most foolproof).
   - Run `gdirect scan` to find the fastest domestic `google-cn` edge IP over your raw physical broadband.
   - Run `gdirect download ...` or `gdirect browse` to download at full line speed (if your ISP resets connections on cleartext SNI, pass `--no-sni`):

```sh
gdirect scan
gdirect download FILE_ID
# If you hit connection or TLS resets (libaria2 code 1), strip SNI:
gdirect download FILE_ID --no-sni
```

### Approach 2: Add Direct Rules in Your Proxy Client for Drive Domains (or the `gdirect` Process)

If you keep your proxy and TUN mode running 24/7, the fix is straightforward: **since the proxy hijacks traffic after sniffing the Drive hostnames, place a rule before `google` that routes the `gdirect` process (or those Drive domains) to `DIRECT`, just like `google-cn`**:

- **Domains that must stay on `PROXY`** (used only for login and token refresh):
  - `accounts.google.com`
  - `oauth2.googleapis.com`
- **Transfer domains to route to `DIRECT` and exclude from `fake-ip`**:
  - `drive.usercontent.google.com`
  - `*.googleusercontent.com`
  - `drive.google.com`
  - `www.googleapis.com`, `drive.googleapis.com`, `content.googleapis.com`

> **Note**: Unlike `gdirect`, a regular web browser visiting `www.googleapis.com` does not rewrite the underlying socket IP to a `google-cn` node. Routing `www.googleapis.com` to `DIRECT` globally would break websites in your browser that depend on it. On desktop platforms, matching by **`PROCESS-NAME`** (`gdirect`) is strongly recommended.

For **Mihomo (Clash)**, add the following before your `GEOSITE,google` rule:

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
  # 1. Keep OAuth login and token refresh on PROXY
  - DOMAIN,accounts.google.com,PROXY
  - DOMAIN,oauth2.googleapis.com,PROXY

  # 2. Recommended: force all other traffic from the gdirect process (scan, API, download, upload) to DIRECT so sniffed domain rules don't hijack it
  - PROCESS-NAME,gdirect,DIRECT

  # 3. Or route by domain (place before GEOSITE,google / RULE-SET,google):
  - DOMAIN,drive.usercontent.google.com,DIRECT
  - DOMAIN-SUFFIX,googleusercontent.com,DIRECT
  - DOMAIN,www.googleapis.com,DIRECT
  - DOMAIN,drive.googleapis.com,DIRECT
  - DOMAIN,content.googleapis.com,DIRECT
```

If you use **sing-box**, add an equivalent process-name or domain `direct` rule before `rule_set: ["google"]` in `route.rules` (while keeping `oauth2.googleapis.com` proxied) to enjoy zero-proxy-quota full-speed Drive transfers with TUN left on all day.

---

## Daily Usage & Troubleshooting Reference

### Common Commands

```sh
gdirect                                   # Same as `gdirect browse`, opens the interactive TUI
gdirect browse -o ~/Downloads             # Set download directory (defaults to ./downloads)
gdirect ls root --json                    # List directory contents (supports JSON output)
gdirect download <FILE_ID_OR_SHARE_URL>   # Download a file; re-run the same command to resume after interruption
gdirect download FILE_ID -o file.zip
gdirect download DOC_ID --export application/pdf -o doc.pdf
gdirect upload ./file.zip                 # 32 MiB chunked upload with automatic resume
gdirect upload ./file.zip --parent FOLDER_ID --name backup.zip
gdirect mount                             # Mount at ~/GoogleDrive (uses native NFS on macOS, no FUSE needed)
gdirect unmount                           # Unmount and clean up temporary exported credentials
```

Inside the `gdirect browse` TUI, you can drive everything from the keyboard:

| Key | Action |
| --- | --- |
| `j / k`, `↑ / ↓` | Move selection up or down |
| `Enter`, `l / →` | Open folder |
| `h / ←`, `Backspace` | Go to parent folder |
| `d` | Queue selected item for download (Google Docs, Sheets, and Slides are exported as PDF) |
| `+ / -` | Adjust concurrent connections (`1–16`) for subsequent downloads and save as default (starts at 8) |
| `r` | Refresh current folder |
| `c` | Cancel active download while keeping partial data on disk |
| `q` | Quit |

For tricky network environments, `download` and `browse` also expose transport-layer overrides:

- `--ip IP`: Force a specific Google IP, skipping automatic scan results;
- `--sni HOST` / `--no-sni`: Override the TLS SNI hostname, or omit the SNI extension altogether (certificates are still verified against the real Google hostname);
- `-j N`: Set concurrent connections (`1–16`) for this command only;
- `gdirect scan --ips FILE`: Probe a custom candidate IP list (one public IP per line, `#` for comments).

### Troubleshooting Quick Reference

| Symptom | Fix |
| --- | --- |
| `access_denied` or message that the app is being tested | Add your Google account as a Test user, or publish the app (Step 5 of the setup guide) |
| `redirect_uri_mismatch` | The downloaded JSON is not from a **Desktop app** client; recreate it following Step 4 |
| `Drive API 403 … insufficient permission` | Enable the Google Drive API in the **same project** as your OAuth client (Step 1), save the Drive scope (click Save at the bottom in Step 3), then run `gdirect login --reauth` |
| `refresh credential expired or revoked` | Run `gdirect login --reauth`. If this happens every 7 days, publish the app from Testing to In production (Step 5) |

---

## Technical Deep Dive: How Is It Implemented Under the Hood?

If you're curious about how `gdirect` combines Rust with a custom-patched `libaria2` build to pull this off, here is a walkthrough of the source code.

### 1. Candidate IP Scanning & Dual-Endpoint Verification

When a transfer command runs without a verified IP from the last 24 hours in local SQLite, `src/scan.rs` kicks off a scan. Up to 256 candidates are assembled from three sources:

1. The built-in bootstrap seed IP `183.56.143.147` (from Cealing-Host—always re-probed before use, never blindly trusted);
2. Public IPs returned by system DNS for `www.googleapis.com`, `drive.usercontent.google.com`, and `drive.google.com`;
3. Historical IPs in SQLite that succeeded within the past 7 days (stale entries older than 7 days are pruned before each scan so the pool never grows unbounded).

Before entering the probe pool, `public(ip)` filters out private, loopback, link-local, and `198.18.0.0/15` (the default Clash / Mihomo `fake-ip` range) addresses. Eight worker threads then run `probe(ip)` concurrently:

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/scan.rs#L78-L113" title="Probing a candidate IP with TLS verification and dual endpoints"
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

Three design choices stand out in this probe:

- **`.no_proxy()` + `.resolve()`**: Bypasses environment proxy variables and binds `www.googleapis.com` and `drive.usercontent.google.com` directly to `ip:443` inside the HTTP client while enforcing full TLS certificate verification (chain validation + SAN hostname matching), ruling out ISP captive portals or MITM boxes.
- **Credential-less API verification**: Calls `GET /drive/v3/about?fields=user` without any user token. A genuine Google Drive API front end always replies with HTTP `401 Unauthorized` and JSON `error.code == 401`. This confirms application-layer routing without ever exposing the user's Bearer token to untrusted candidate IPs.
- **Download path probe**: Requests a tiny public test file from `drive.usercontent.google.com`. If Google rate-limits the public test file with HTTP 403/404, the IP is still accepted with a warning so long as the Drive API check passed, avoiding false negatives when the public test file is throttled.

> **How to find more candidate direct IPs for your ISP:**
> If the built-in seed IP `183.56.143.147` has high latency on your regional carrier, pick a few domains from the `google-cn` list in [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) (such as `dl.google.com`, `g.cn`, `fonts.googleapis.com`, or `gstatic.cn`), resolve them against a domestic DNS server (e.g. `dig @223.5.5.5 dl.google.com +short`) to get Google edge IPs on your local ISP, save them one per line in `ips.txt`, and run `gdirect scan --ips ips.txt`. The scanner will automatically verify their TLS certificates and Drive API routing and pick the fastest node.

### 2. Custom `libaria2`: Why Patching the C++ Source Was Necessary

For `ls` and `upload`, Rust's `reqwest` with `.resolve()` is all we need. Downloading multi-gigabyte files, however, requires multi-connection segmented concurrency and crash-safe resume, so `gdirect` embeds `aria2 1.37.0` trimmed down to a static HTTP/HTTPS + OpenSSL 3 library (`libaria2`).

Here is the catch: **Google Drive download requests routinely go through cross-domain HTTP 302 redirects** (for instance, from `www.googleapis.com` or `drive.google.com` to `drive.usercontent.google.com` and dynamically generated `*.googleusercontent.com` hosts). In stock `aria2`, if you only override the initial URL, `aria2` falls right back to system DNS as soon as it follows a 302 redirect to a new hostname; and if you rewrite the hostname in the URL to a raw IP literal, TLS certificate verification fails immediately due to hostname mismatch.

To solve this cleanly, `gdirect` applies a ~90-line patch (`vendor/aria2-1.37.0.patch` plus `vendor/gdirect_route.h`) when compiling `libaria2`, making four targeted changes at the C++ layer:

#### (1) Allowlist of Google Drive Transfer Domains

First, `vendor/gdirect_route.h` defines the exact set of Google Drive hostnames under `gdirect`'s control:

```cpp src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/vendor/gdirect_route.h#L1-L12" title="Google Drive hostname allowlist"
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

#### (2) Intercepting `getaddrinfo` and TLS SNI in `SocketCore.cc`

Upper-layer HTTP requests keep their original URLs untouched (so both the HTTP `Host` header and OpenSSL's X.509 hostname verification check the real Google domain). Only when `SocketCore` calls `getaddrinfo` to open a TCP socket does it swap any hostname matching `gdirect_host(host)` for the scanned `gdirect_ip` with `AI_NUMERICHOST` set, bypassing DNS resolution completely. Right above that, it also hooks `tlsSession_->setSNIHostname()`:

```diff src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/vendor/aria2-1.37.0.patch#L22-L42" title="Hooking TLS SNI and getaddrinfo in SocketCore.cc"
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

- When `gdirect_sni` is `nullptr` (the default), the original hostname is sent as SNI;
- When `--sni HOST` is passed, the custom SNI hostname is sent instead;
- When `--no-sni` is passed (`gdirect_sni` points to an empty string `""`), it returns `TLS_ERR_OK` without calling `setSNIHostname`, causing OpenSSL to send a `ClientHello` with no SNI extension at all.

#### (3) Stripping `Authorization` Headers Across Redirects & Redirect Allowlisting

When downloading a private file, the initial request goes to `https://www.googleapis.com/drive/v3/files/{id}?alt=media` with `Authorization: Bearer <token>`. Once redirected via HTTP 302 to a pre-signed `*.googleusercontent.com` URL, forwarding the `Authorization` header causes Google's content servers to reject the request for carrying two sets of credentials—and risks leaking the token across domains. The patch therefore restricts `HttpRequest.cc` to emit the `Authorization:` header only when `getHost() == "www.googleapis.com"`, and enforces in `Request.cc` that every redirect target must use `https` and match `gdirect_host()`.

#### (4) Removing the OpenSSL 3 Legacy Provider Dependency

Under OpenSSL 3, stock `aria2` unconditionally calls `OSSL_PROVIDER_load(nullptr, "legacy")` at startup (for RC4 in BitTorrent encryption), which crashes on systems without the OpenSSL legacy provider module installed. Guarding that call with `#ifdef ENABLE_BITTORRENT` makes the HTTP-only static build completely self-contained.

### 3. Overwrite Guards, Large-File Virus-Scan Confirmation Pages, and MD5 Verification

On the Rust side (`src/download.rs`), three additional safeguards wrap `libaria2`:

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/download.rs#L191-L248" title="Control-file resume check, HTML confirmation-page parsing, and MD5 verification"
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

- **Safety check for existing files**: If the output file already exists without a companion `.aria2` control file, `gdirect` hashes the local file and compares it against Drive's `md5Checksum`—printing `Already downloaded` if they match and refusing to overwrite if they don't.
- **Unwrapping virus-scan confirmation pages on public large files**: When downloading a large public shared file without authentication, Google Drive returns an HTTP 200 HTML page containing `<form id="download-form">`. Only when the file header starts with `<!doctype html` or `<html` does `gdirect` parse that form to extract the `confirm` / `uuid` parameters and re-download the actual binary, ensuring archives or source files that happen to contain the string `download-form` are never touched.
- **Post-download MD5 verification**: Once `libaria2` finishes, `gdirect` streams the completed file through MD5 and verifies it against Drive's metadata to guarantee that multi-connection chunk reassembly is bit-for-bit exact.

### 4. 32 MiB Resumable Chunked Uploads

The upload module (`src/upload.rs`) implements the Google Drive v3 Resumable Upload protocol. Because cross-border direct links can have higher RTT, tiny chunks waste too much time waiting for per-chunk acknowledgments, so the chunk size is set to `32 MiB`.

When starting an upload, `gdirect` looks up any prior session in local SQLite keyed by `(canonical local path, target parent folder ID, remote filename)`:

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/upload.rs#L85-L105" title="Probing the remote upload session for the last committed byte offset"
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

As long as the local file's size and nanosecond modification timestamp haven't changed, re-running the upload command after an interruption sends `Content-Range: bytes */{size}` to query Google's committed byte offset from the `308 Permanent Redirect` `Range` header and resumes right where it left off.

### 5. Localhost Loopback + PKCE OAuth Flow

In `src/auth.rs`, `gdirect login` implements the **OAuth 2.0 Loopback + PKCE (RFC 7636 `S256`)** flow without pulling in heavy external OAuth SDKs:

```rust src="https://github.com/mizorewww/gdirect/blob/f4b67efb3f96ba061e89ac956b0b0335a481b007/src/auth.rs#L194-L213" title="Ephemeral localhost listener and PKCE authorization URL construction"
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

It binds an ephemeral non-blocking TCP listener on `127.0.0.1:0`, validates the `state` parameter on the browser callback to prevent CSRF, and exchanges the authorization code plus `code_verifier` against `https://oauth2.googleapis.com/token` for a `refresh_token`. Both the SQLite database and any temporary `rclone` configuration exported for `mount` are created with `0600` permissions, and temporary mount credentials are automatically wiped on `unmount` or mount failure.
