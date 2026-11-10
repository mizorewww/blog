{"title":"在 Google Colab G4 上一键跑 Qwen3.8-Flash-Next (262K 上下文)","description":"用 colab CLI 在单张 Colab G4 (RTX PRO 6000 Blackwell 96GB) 上一键部署 dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4，开启 MTP 投机解码（130~176 tok/s）与 262K 上下文，并通过 Cloudflare Tunnel 接入本地 pi 使用。复制粘贴三步跑通。","date":"2026-11-10","tag":"技术","tags":["llm","sglang","Google Drive","CLI"]}
---

Google Colab 的 **G4 GPU** 实例（NVIDIA RTX PRO 6000 Blackwell 96GB 显存 + 176GB 内存）刚好可以单卡跑满 [`dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4`](https://huggingface.co/dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4) 的 **262K 上下文**，开启 MTP 投机解码后单流生成速度可达 **130 ~ 176 tok/s**。

我把环境安装、预编译算子恢复、权重拉取/Google Drive 挂载、SGLang 启动和 Cloudflare Tunnel 反代全写进了一个脚本里，开源在 [mizorewww/colab-qwen38-g4](https://github.com/mizorewww/colab-qwen38-g4)。照着下面复制粘贴三步就能跑起来。

## 第一步：安装并登录 `colab` CLI

确保你的 Google 账号开有 Colab Pro / Pro+（有 G4 配额），在本地终端运行：

```bash
uv tool install google-colab-cli

gcloud auth application-default login \
  --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/colaboratory

# 验证登录成功：
colab sessions
```

## 第二步：克隆仓库并启动

```bash
git clone https://github.com/mizorewww/colab-qwen38-g4.git
cd colab-qwen38-g4

# 交互式启动（一路回车即可）：
python3 run_qwen38_g4.py
```

运行后会依次让你选择（直接按回车就是默认推荐项）：
1. **会话名**：默认 `qwen38-g4`（不存在会自动创建 G4 实例）。
2. **权重下载方式**：
   - 第一次用选默认的 `[1] Fast Direct NVMe`，直接从 HuggingFace 高速拉到 Colab 本地硬盘（约 6.5 分钟，不占 Google Drive 空间）；
   - 如果想把权重存进自己的 Google Drive 留着以后用，选 `[2] Mount Google Drive`，按终端弹出的链接点一下授权即可。
3. **加速模式**：默认 `[1]` 开启 MTP 投机解码（`130~176 tok/s`，分配 47.2 万 tokens KV 池）。
4. **API Key**：默认自动生成一个随机密钥保护反代隧道。
5. **写入 `pi` 配置**：跑完后输入 `y` 会自动帮你写进 `~/.pi/agent/models.json`。

如果你不想交互问答，也可以直接用一条命令全自动跑：

```bash
colab run --gpu G4 --keep -s qwen38-g4 --timeout 1800 run_qwen38_g4.py
```

等终端输出下面这段就说明已经就绪了：

```text
========================================================================
DEPLOYMENT SUCCESSFUL
TUNNEL_BASE_URL=https://xxxx.trycloudflare.com/v1
API_KEY=sk-qwen38-...
MODEL_ID=dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4
========================================================================
```

## 第三步：在 `pi` 或 OpenAI 客户端里使用

如果刚才在向导里选了自动更新 `~/.pi/agent/models.json`，现在直接就能用：

```bash
pi --model "colab-g4/dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4" -p "看一下本机配置"
```

如果手动配 `~/.pi/agent/models.json`，复制粘贴下面这段（把 `baseUrl` 和 `apiKey` 换成终端输出的值）：

```json
{
  "providers": {
    "colab-g4": {
      "name": "Colab G4 SGLang",
      "baseUrl": "https://xxxx.trycloudflare.com/v1",
      "api": "openai-completions",
      "apiKey": "sk-qwen38-...",
      "models": [
        {
          "id": "dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4",
          "name": "Qwen 3.8 Flash Next Cybersecurity NVFP4 (Colab G4)",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 262144,
          "maxTokens": 65536,
          "compat": {
            "supportsStore": false,
            "supportsDeveloperRole": false
          },
          "thinkingLevelMap": {
            "off": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "xhigh",
            "xhigh": "xhigh",
            "max": "xhigh"
          },
          "samplingParams": {
            "temperature": 1.0,
            "top_p": 0.95
          },
          "samplingParamsByThinkingLevel": {
            "off": {
              "temperature": 0.7,
              "top_p": 0.8
            }
          }
        }
      ]
    }
  }
}
```

也可以直接用 `curl` 调：

```bash
curl -s "https://xxxx.trycloudflare.com/v1/chat/completions" \
  -H "Authorization: Bearer sk-qwen38-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4",
    "messages": [{"role": "user", "content": "你好"}],
    "chat_template_kwargs": {"reasoning_effort": "low"}
  }'
```

## 第四步：用完关机（停止计费）

不用的时候记得关掉实例，避免继续扣计算单元：

```bash
colab stop -s qwen38-g4
colab sessions
```
