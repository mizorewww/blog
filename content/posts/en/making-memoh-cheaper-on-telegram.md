{"title":"Putting Memoh Under the Knife: Specializing an Agent for Cheaper Telegram Group Chats","description":"Specializing the general-purpose agent framework Memoh into a Telegram group-chat bot—fewer LLM calls, smaller payloads, and 99.7% prompt-cache hit rates cut LLM costs by more than 80%.","date":"2026-08-03","tag":"Tech","tags":["Memoh","Telegram","LLM","Prompt Caching","Cost Optimization"]}
---

A while ago, I deployed [Memoh](https://github.com/memohai/memoh) as a few Telegram group-chat bots, mainly to burn through an Ollama subscription I couldn't possibly use up on my own (some idiot subscribed to a full year of Ollama at once).

![The Memoh bot "Xiaoxue" chatting in a Telegram group and replying with a catgirl sticker](../../images/memoh-telegram-chat.png)

After running it for a bit, I noticed that ten minutes of group chat could burn through half of my 5-hour limit, and a single day would eat half of my weekly quota. That got me thinking: in a pure chat scenario, how can I drive down both the number of LLM calls and the token consumption per call? I made a set of targeted changes for group chat, and my total cost dropped to less than a fifth of what it used to be.

To be clear, this post isn't here to nitpick upstream. Memoh is a thoughtfully designed general-purpose agent framework—multi-step tool loops, a rich toolset, and structured message metadata are all reasonable and even necessary for an agent that "gets work done for you." What I did was **specialize** it into a chatbot: an agent in a group chat spends most of its life just talking rather than executing tasks, and "talking" inside a general-purpose agent loop has a very unfavorable cost structure.

## Where Does the Money Actually Go?

First, here is the breakdown of a real request captured before my optimizations:

| Component | Size | Share |
| --- | ---: | ---: |
| Messages (conversation history) | ~157.7 KB | 68.0% |
| Tools (tool schemas) | ~49.5 KB | 21.3% |
| System (system prompt) | ~24.7 KB | 10.7% |

A single request is over 200 KB—roughly 50,000 tokens. The catch is what a general-purpose agent's tool loop does with that payload: **every extra tool call re-reads all 50,000 tokens from scratch**. And chat scenarios are packed with tool calls: sending a message is one, replying is one, sending a sticker is another, and after sending, a delivery status comes back for the model to read and confirm. Behind a single outgoing group-chat message, the full context is read 2 to 3 times over.

So my changes followed three directions: make fewer calls, read less per call, and hit the prompt cache on almost everything already read. Every change below includes the actual code from my fork ([mizorewww/Memoh](https://github.com/mizorewww/Memoh), compared against upstream baseline `d0c5c735^`).

## Change 1: Clock Out Right After Sending

Upstream's loop works like this: the model decides to send a message → calls `send` → the framework returns the delivery status (message ID, platform, target conversation, etc.) as a tool result → the model is invoked a second time, reads the entire context again, says "okay, sent," and finishes. For a group-chat bot, that final call is almost pure waste: the message has already been delivered to the chat, and there is nothing meaningful left for the model to do except echo a confirmation. With the Doubao model, an even worse failure mode showed up: seeing the success result, the model kept calling `send` over and over in an infinite loop.

My fix wraps the provider in a decorator (`internal/agent/runtime/native/terminal_send.go`). Once `send` successfully delivers to the current conversation, the next time the model would be called, the decorator immediately returns `FinishReasonStop` locally without making a network request at all:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/runtime/native/terminal_send.go#L76-L103" title="End the turn locally after successful delivery"
type terminalSendProvider struct {
	sdk.Provider
	state *terminalSendState
}

func (p *terminalSendProvider) DoGenerate(ctx context.Context, params sdk.GenerateParams) (*sdk.GenerateResult, error) {
	if p.state.isDelivered() {
		return &sdk.GenerateResult{
			FinishReason: sdk.FinishReasonStop,
			Response:     sdk.ResponseMetadata{ID: terminalSendResponseID},
		}, nil
	}
	return p.Provider.DoGenerate(ctx, params)
}

func (p *terminalSendProvider) DoStream(ctx context.Context, params sdk.GenerateParams) (*sdk.StreamResult, error) {
	if !p.state.isDelivered() {
		return p.Provider.DoStream(ctx, params)
	}
	parts := make(chan sdk.StreamPart, 2)
	parts <- &sdk.FinishStepPart{
		FinishReason: sdk.FinishReasonStop,
		Response:     sdk.ResponseMetadata{ID: terminalSendResponseID},
	}
	parts <- &sdk.FinishPart{FinishReason: sdk.FinishReasonStop}
	close(parts)
	return &sdk.StreamResult{Stream: parts}, nil
}
```

Of course, the protocol requires every `tool_call` to be paired with a `tool_result`, so we can't literally drop the result without leaving a dangling tool call in history. Instead, the result is compressed to the bare minimum: a successful send to the current conversation returns just `{"ok": true}`, only attaching target metadata when sending across conversations; failures return a structured retryable error (`error_code` + `retryable` + `guidance`) so the model has a chance to recover instead of crashing the loop with a Go error:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/tool/message.go#L311-L324" title="Minimal send result"
func (p *MessageProvider) execSend(ctx context.Context, session SessionContext, toolCallID string, args map[string]any) (any, error) {
	if session.SessionType == sessionmode.Discuss {
		sendResult, err := p.exec.SendDirectForTool(ctx, toMessagingSession(session), "", toolCallID, args)
		if err != nil {
			return messageSendErrorResult(err)
		}
		resp := map[string]any{"ok": true}
		if !session.IsSameConversation(sendResult.Platform, sendResult.Target) {
			resp["platform"] = sendResult.Platform
			resp["target"] = sendResult.Target
			resp["delivered"] = "target"
		}
		return resp, nil
	}
```

There is one more layer in history projection. When future turns read the conversation history, successful `send` calls are folded into a minimal call/result pair containing only the five audience-visible fields (`text`, `reply_to`, `sticker_id`, `attachments`, `message`), stripping delivery internals (`bot_id`, `platform`, `message_id`, etc.) from the prompt context. Note that this folding happens only in the projection layer—the persisted canonical history remains untouched for debugging:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/application/service_messages.go#L232-L246" title="Minimal send call in history projection"
func minimalDiscussSendCall(call sdk.ToolCallPart) sdk.ToolCallPart {
	input := normalizeToolInputMap(call.Input)
	minimal := make(map[string]any, 5)
	// Current-conversation routing is implicit. Keep only audience-visible
	// payload fields and the reply reference needed to understand the exchange.
	for _, key := range []string{"text", "reply_to", "sticker_id", "attachments", "message"} {
		if value, ok := input[key]; ok {
			minimal[key] = value
		}
	}
	return sdk.ToolCallPart{
		ToolCallID: strings.TrimSpace(call.ToolCallID),
		ToolName:   "send",
		Input:      minimal,
	}
```

The result: on pure messaging turns, LLM calls drop from 2 to 1—**an immediate 50% savings**. Multi-step workflows that search the web or call other tools still work normally; the bot simply treats `send` as the terminal action of the turn.

## Change 2: Send Text, Reply, and Sticker in a Single Call

In group chats, a single response is often both a reply to someone and accompanied by a sticker. Previously, that required multiple tool calls, re-reading the entire context each time. I merged them into a single `send` tool signature:

```text
send(text[optional], reply_to[optional], sticker_id[optional])
```

Concretely, this involved two changes. First, upstream already had a top-level `reply_to` parameter alongside a redundant nested `message.reply{message_id}` object; I removed the nested form, kept only the top-level parameter, and restricted it to message IDs visible in the current turn (returning a retryable error if invisible instead of replying to the wrong message).

Second, I had previously written an MCP server for sending stickers, only to realize that invoking an external MCP tool added an extra LLM round-trip every time. I folded the sticker catalog directly into the `sticker_id` parameter of `send`:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/runtime/native/telegram_sticker.go#L14-L31" title="Turn the sticker MCP into an internal backend of send"
	"github.com/memohai/memoh/internal/delivery"
)

const (
	telegramStickerSendGuidance     = " For Telegram, normally pair every coherent public message with at least one context-appropriate Sticker by setting `sticker_id` in the same send call; omit it only when the catalog has no suitable Sticker. Choose from the full visual descriptions, not from the original emoji alone, and avoid repetitive duplicates."
	telegramStickerCatalogSchemaKey = "x-memoh-sticker-catalog"
)

type telegramStickerSchemaEntry struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	Emoji       string `json:"emoji"`
	Status      string `json:"status"`
}

// mergeTelegramStickerSendTools converts the Sticker MCP into an internal
// backend for the first-party send tool. The model sees one send call whose
// sticker_id enum contains the complete, stable catalog; it never sees a
```

Within a single `send` call, the bot delivers the text first and then the sticker; if the sticker fails after the text is already sent, it returns partial success and terminates immediately so the model won't retry and send duplicate text.

I also had a vision model pre-generate a concise visual description (under 50 characters) for every sticker, stored alongside the sticker-set metadata in SQLite. Sorted deterministically by ID, these descriptions are embedded into the `send` tool schema's description. Once merged, sending a sticker incurs virtually zero extra LLM cost.

## Change 3: Move Everything That Changes to the Tail of the Prefix

This is the key to prompt-cache hit rates. Every provider's prompt caching mechanism (Anthropic, OpenAI, DeepSeek, Kimi—all of them) works by **prefix matching**: the prefix of a request must match byte-for-byte, and the first byte that changes invalidates the cache for everything after it.

To be fair, upstream's default behavior isn't bad across ordinary turns: conversation history is appended at the end, so automatic prefix caches like DeepSeek's catch most of it. The real leak was a frequently rewritten file buried in the middle of the system prompt: upstream placed `MEMORY.md` between `AGENTS.md` and `PROFILES.md`. Because `MEMORY.md` is rewritten constantly by the memory subsystem, every update invalidated the cache for everything following it. My fix was a one-function change:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/runtime/native/fs.go#L66-L71" title="Move MEMORY.md to the tail of the system prompt"
// systemFileLoadOrder keeps the frequently changing memory summary at the
// tail of the system prompt. Stable instruction/profile content therefore
// remains in the reusable prefix when MEMORY.md changes between turns.
func systemFileLoadOrder() []string {
	return []string{"AGENTS.md", "PROFILES.md", "MEMORY.md"}
}
```

Changing the load order from `AGENTS.md → MEMORY.md → PROFILES.md` to `AGENTS.md → PROFILES.md → MEMORY.md` keeps the most stable instructions at the front of the prefix and pushes the most volatile file to the very end of the system prompt. Following the same principle, I cleaned up several other sources of "prefix pollution":

- The memory-writing manual (~2.6 KB) is now injected only when a memory provider is actually configured; when set to `None`, the entire section is omitted:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/application/service.go#L710" title="Skip memory instructions when no memory provider is configured"
MemoryInstructions:    strings.TrimSpace(botSettings.MemoryProviderID) != "",
```

- Platform identity now injects only the active platform's fields, and strips `avatar_url` (which contained the bot token) from the injected prompt.

The difference is measurable: under the old "dynamically mutate system prompt" path, a forced-reply call measured just 5.1% cache read (a single measurement of that specific code path, not the everyday baseline). After the fix, two consecutive requests in a live group chat sent 52,259 and 52,633 input tokens, of which 52,096 and 52,480 were served from cache—a **99.7% cache hit rate**, leaving only ~160 uncached input tokens billed at full price per turn.

## Change 4: Invisible Request Slimming

Smaller requests mean cheaper reads on every turn. This part stacks several small reductions together, all exposed as configurable Telegram channel policies stored in bot metadata:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/channelpolicy/policy.go#L21-L24" title="Four Telegram channel policy keys"
TelegramToolCallsEnabledMetadataKey = "telegram_tool_calls_enabled"
TelegramEnabledToolsMetadataKey     = "telegram_enabled_tools"
TelegramSkillsEnabledMetadataKey    = "telegram_skills_enabled"
TelegramMessageMetadataModeKey      = "telegram_message_metadata_mode"
```

- `telegram_tool_calls_enabled` is the master switch for tools, `telegram_enabled_tools` is an explicit allowlist (an empty array disables all tools), and `telegram_skills_enabled` controls skills. A chat bot doesn't need shell execution or file editing; on my two production bots I enabled only `send`, **turning off 37 tools**. The crucial detail is *when* filtering happens: the allowlist runs before schema generation, so disabled tools don't contribute a single byte to the request:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/runtime/native/agent.go#L990-L997" title="Filter tools before schema generation"
}
filtered := make([]sdk.Tool, 0, len(providerTools))
for _, tool := range providerTools {
	if cfg.ChannelPolicy.AllowsTool(tool.Name) || cfg.ChannelPolicy.AllowsBackendTool(tool.Name) {
		filtered = append(filtered, tool)
	}
}
providerTools = filtered
```

Before optimization, the Tools section accounted for 21.3% of the request (~49.5 KB, roughly 12,000 tokens); now it is almost completely gone. Policy evaluation is fail-closed: if reading the policy fails, it exposes no tools rather than leaking tools that should be disabled.

- `telegram_message_metadata_mode` controls how message metadata headers are projected, defaulting to `compact` on Telegram. Upstream prepends a full metadata header to every message sent to the model: `<message id="..." sender="..." t="..." channel="telegram" conversation="..." type="..." target="...">`. The canonical format in SQLite stays unchanged, but the transient projection sent to the LLM strips the per-message repeated timestamp, platform, and conversation name while keeping speaker attribution for group chats:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/turn/user_header.go#L165-L183" title="Compact message header projection"
func ProjectUserMessageHeader(content, mode string) string {
	if strings.ToLower(strings.TrimSpace(mode)) != "compact" || !strings.HasPrefix(strings.TrimSpace(content), "<message") {
		return content
	}
	start := strings.Index(content, "<message")
	if start < 0 {
		return content
	}
	endRel := strings.Index(content[start:], ">")
	if endRel < 0 {
		return content
	}
	end := start + endRel
	compactOpening, ok := projectMessageOpeningTag(content[start : end+1])
	if !ok {
		return content
	}
	return content[:start] + compactOpening + content[end+1:]
}
```

That saves 85–120 characters per message, reduces occurrences of `channel="telegram"` in a request from 148 down to 2, and shrinks a full-history payload from 221.0 KB to 208.7 KB.

## Change 5: Giving Text-Only Models "Eyes"

Some of the primary models I run don't support vision (such as DeepSeek V4 Flash), yet people post images in group chats all day long. I added an auxiliary vision model mechanism: when the primary model declares no vision support and the current turn includes image attachments, a cheap small vision model describes the images first:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/application/auxiliary_vision.go#L183-L196" title="Trigger only when the primary model lacks vision"
func (s *Service) describeImagesWithAuxiliaryVision(
	ctx context.Context,
	req ChatRequest,
	primarySupportsVision bool,
	attachments []gatewayAttachment,
) string {
	if s == nil || primarySupportsVision {
		return ""
	}
	images := extractNativeImageParts(attachmentsToAny(attachments))
	return s.describeImagePartsWithAuxiliaryVision(ctx, req, primarySupportsVision, images)
}

func (s *Service) describeImagePartsWithAuxiliaryVision(
```

The generated description is appended as an `<auxiliary_vision_description>` block at the **tail of the last user message**, once again leaving the cached prefix untouched:

```go src="https://github.com/mizorewww/Memoh/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/internal/agent/application/auxiliary_vision.go#L454-L467" title="Append vision descriptions to the tail of the last user message"
func appendAuxiliaryVisionToLastUserMessage(messages []sdk.Message, visionContext string) []sdk.Message {
	visionContext = strings.TrimSpace(visionContext)
	if visionContext == "" {
		return messages
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != sdk.MessageRoleUser {
			continue
		}
		messages[i].Content = append(messages[i].Content, sdk.TextPart{Text: "\n\n" + visionContext})
		return messages
	}
	return append(messages, sdk.UserMessage(visionContext))
}
```

## Bonus Telegram-Specific Polish

A few additional improvements aimed at making the bot feel more natural in Telegram group chats also helped keep costs predictable:

- Continuously refreshing the `typing` indicator throughout any turn where the bot is selected to reply, so group members see "is typing…" instead of 30 seconds of dead silence followed by a wall of text;
- Switching context compaction to a rolling-summary mode whose prompt explicitly forbids repeating raw tool-argument JSON; the context budget takes the smaller of the model's context window and the bot's compaction threshold, and truncation boundaries never split a `user`/`tool` pair mid-exchange.

## How Much Did It Actually Save?

Modeling the savings is straightforward. The input cost of a single LLM call is:

$$
C_{\mathrm{call}} = T \times \left[(1-h) \times P_{\mathrm{in}} + h \times P_{\mathrm{cache}}\right] = T \times P_{\mathrm{in}} \times \left[(1-h) + h \times r\right]
$$

where `T` is the number of input tokens, `h` is the cache hit rate, and `r = P_cache / P_in` is the ratio of cached-input price to uncached-input price. Multiplying by the number of calls `N` per turn separates the before/after ratio into three independent factors:

$$
\frac{C_{\mathrm{before}}}{C_{\mathrm{after}}} = \frac{N_{\mathrm{old}}}{N_{\mathrm{new}}} \times \frac{T_{\mathrm{old}}}{T_{\mathrm{new}}} \times \frac{f(h_{\mathrm{old}})}{f(h_{\mathrm{new}})}
$$

where $$f(h) = (1-h) + h \times r$$. Each of the three factors is grounded in real measurements:

- **N_old / N_new = 2–3**: pure text turns drop from 2 calls to 1, and reply + sticker turns drop from 3 calls to 1. This is structural—no estimation involved;
- **T_old / T_new ≈ 70K / 52K ≈ 1.35**: stripping the unused tool schemas (49.5 KB), dynamic sticker catalog (18.3 KB), and repeated message headers removes ~20K tokens per request;
- **h_new = 99.7%** is measured in production; I set `h_old = 95%` to be generous to upstream's automatic prefix caching, which works well on ordinary turns and only loses its prefix when `MEMORY.md` is rewritten.

Using official provider pricing as of 2026-08-03—DeepSeek V4 Flash at $0.0028/$0.14 = **1/50**, Claude Sonnet 4.6 at 1/10, Kimi K2.6 at ~1/6, and Doubao seed-1.6 at 1/5—and plugging in conservative numbers (`N` ratio = 2, `h_old` = 95%):

| Model | r | f(95%) / f(99.7%) | Total Factor 2 × 1.35 × f-ratio | Savings |
| --- | ---: | ---: | ---: | ---: |
| DeepSeek V4 Flash | 1/50 | 3.0 | ≈ 8.1× | ≈ 88% |
| Claude Sonnet 4.6 | 1/10 | 1.4 | ≈ 3.8× | ≈ 74% |
| Kimi K2.6 | ≈1/6 | 1.2 | ≈ 3.3× | ≈ 70% |

The pattern is obvious: the steeper the cache discount, the more leverage you get from pushing the hit rate to 99.7%—DeepSeek's 50× cache discount pushes total savings close to 90%. Meanwhile, the call-count factor `N` doesn't depend on caching at all; it's free money. This matches what I see on my actual billing dashboard: costs dropped to well under 1/5 of what they were, and the conservative formula gives ~1/8 on DeepSeek even before counting the eliminated output tokens.

## Closing Thoughts

All I really did was ask one question at every step of the pipeline: **when you put a general-purpose agent framework into a high-frequency group chat, is this read or this LLM call actually necessary?** Don't make an extra call just to confirm a sent message, combine text + reply + sticker into a single call, push volatile files to the tail of the prompt prefix, don't send a single byte of unused tool schemas, and let a cheap small vision model look at images first.

Once again, credit goes to upstream for building a solid foundation: the tool loop, history projection, and channel abstractions are cleanly separated. The reason I could pull off this degree of specialization in a little over a week is precisely because those boundaries were well drawn—wrapping the provider for terminal `send` without touching the core loop, and filtering tools before schema generation, both plugged cleanly into seams the architecture already had. If your use case is "an agent that does multi-step work," upstream's defaults are probably right for you; if, like me, you just want a talkative resident in your Telegram group that won't burn through your wallet, I hope these notes help.
