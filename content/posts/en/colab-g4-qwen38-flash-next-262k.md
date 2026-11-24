---
title: "One-Click Qwen3.8-Flash-Next (262K Context) on Google Colab G4"
description: "Deploy dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4 on a single Colab G4 (RTX PRO 6000 Blackwell 96GB) using the colab CLI with MTP speculative decoding (130–176 tok/s) and a 262K context window, exposed via Cloudflare Tunnel to your local pi client in three copy-paste steps."
date: 2026-11-10
tag: "Tech"
tags:
  - "LLM"
  - "SGLang"
  - "Google Drive"
  - "CLI"
---

Google Colab's **G4 GPU** instance (NVIDIA RTX PRO 6000 Blackwell with 96GB VRAM + 176GB system RAM) is just big enough to run [`dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4`](https://huggingface.co/dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4) at its full **262K context window** on a single card, reaching **130–176 tok/s** single-stream generation with MTP speculative decoding enabled.

I packed environment setup, precompiled kernel restoration, weight pulling / Google Drive mounting, SGLang startup, and Cloudflare Tunnel reverse proxying into a single script, open-sourced at [mizorewww/colab-qwen38-g4](https://github.com/mizorewww/colab-qwen38-g4). Follow the three copy-paste steps below to get it running.

## Step 1: Install and Log In to the `colab` CLI

Make sure your Google account has Colab Pro / Pro+ (with G4 quota), then run in your local terminal:

```bash
uv tool install google-colab-cli

gcloud auth application-default login \
  --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/colaboratory

# Verify login succeeded:
colab sessions
```

## Step 2: Clone the Repository and Launch

```bash
git clone https://github.com/mizorewww/colab-qwen38-g4.git
cd colab-qwen38-g4

# Interactive launch (just press Enter through the prompts):
python3 run_qwen38_g4.py
```

The script will prompt you in order (pressing Enter accepts the recommended defaults):
1. **Session name**: defaults to `qwen38-g4` (automatically provisions a new G4 instance if it doesn't exist yet).
2. **Weight download method**:
   - For your first run, pick the default `[1] Fast Direct NVMe` to pull weights directly from HuggingFace to Colab's local disk at high speed (~6.5 minutes, takes zero Google Drive space);
   - If you want to persist the weights in your own Google Drive for future sessions, pick `[2] Mount Google Drive` and click the authorization link printed in the terminal.
3. **Acceleration mode**: defaults to `[1]` with MTP speculative decoding enabled (`130–176 tok/s`, allocating a 472K-token KV cache pool).
4. **API Key**: generates a random key by default to protect the reverse-proxy tunnel.
5. **Write to `pi` config**: enter `y` after deployment to automatically update `~/.pi/agent/models.json`.

If you prefer a non-interactive run, you can launch everything with a single command:

```bash
colab run --gpu G4 --keep -s qwen38-g4 --timeout 1800 run_qwen38_g4.py
```

Once the terminal prints the block below, the server is ready:

```text
========================================================================
DEPLOYMENT SUCCESSFUL
TUNNEL_BASE_URL=https://xxxx.trycloudflare.com/v1
API_KEY=sk-qwen38-...
MODEL_ID=dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4
========================================================================
```

## Step 3: Use It in `pi` or Any OpenAI Client

If you chose to automatically update `~/.pi/agent/models.json` in the wizard, you can use it right away:

```bash
pi --model "colab-g4/dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4" -p "Check my local machine specs"
```

To configure `~/.pi/agent/models.json` manually, copy and paste the snippet below (replacing `baseUrl` and `apiKey` with the values printed in your terminal):

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

You can also call the endpoint directly with `curl`:

```bash
curl -s "https://xxxx.trycloudflare.com/v1/chat/completions" \
  -H "Authorization: Bearer sk-qwen38-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4",
    "messages": [{"role": "user", "content": "Hello"}],
    "chat_template_kwargs": {"reasoning_effort": "low"}
  }'
```

## Step 4: Shut Down When Done (Stop Billing)

Remember to stop the instance when you are done so it doesn't keep burning compute units:

```bash
colab stop -s qwen38-g4
colab sessions
```
