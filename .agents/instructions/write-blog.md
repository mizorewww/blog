# Coding Agent 撰写博客流程

本指令定义 agent 使用 `yarn write-blog` CLI 和 `humanizer-zh` skill 撰写新博客的完整流程。

## 适用场景

- 用户给出选题或标题，要求撰写一篇新博客文章。
- 需要生成符合仓库内容规范的 MDX/MD 文件、frontmatter 和静态资源路径。

## 流程

1. **确认选题与范围**
   - 与用户确认文章主题、目标读者、语言（zh/en）和主要结论。
   - 若用户未指定语言，默认使用 `zh`。

2. **生成 frontmatter**
   - 使用 `yarn write-blog create` 创建文章骨架。
   - 必填：`--title`、`--locale`。
   - 中文标题必须显式提供 `--slug`（脚本不会自动生成拼音 slug）。
   - slug 只允许小写字母、数字、连字符，且不以连字符开头或结尾。
   - 可选字段：`--summary`、`--categories`、`--tags`、`--translationKey`、`--authors`、`--image`、`--draft`、`--date`。
   - 默认作者为 `default`，默认日期为当天。

3. **撰写正文**
   - 在生成的文件中继续补充正文。
   - 遵循 `docs/content.md` 的 MDX 规范：
     - 使用标准 Markdown 和 GFM 表格/任务列表。
     - 代码块使用 ` ```language ` 语法。
     - 图标使用 `:icon-name:` shortcode。
     - 图表使用 ` ```echarts ` 或 `<ECharts />` 组件。
     - 图片放在 `public/static/images/`，文章中引用 `/static/images/...`。

4. **润色中文文本（仅中文文章）**
   - 调用 `.agents/skills/humanizer-zh/SKILL.md` 的规则对正文进行去 AI 痕迹润色。
   - 润色后保持核心信息、技术准确性和原文语气不变。
   - 英文文章如需润色，使用项目现有的英文风格指南（避免冗长连接词、被动语态和填充短语）。

5. **构建验证**
   - 运行 `yarn content:generate` 验证 frontmatter 和 MDX 能被 Contentlayer 正确解析。
   - 运行 `yarn build` 验证整站构建通过。
   - 修复所有构建错误后再继续。

6. **最终检查与提交**
   - 运行 `yarn check` 确保所有确定性门禁通过。
   - 提交前删除任何 `--draft` 标记（如果文章应发布）。
   - 按原子提交原则创建提交。

## 禁止事项

- 不要为中文标题自动生成拼音 slug；未提供 slug 时应向用户说明并要求显式提供。
- 不要把 `TODO`、`FIXME`、`HACK` 等占位符留在正文中。
- 不要直接修改 `out/` 目录。
- 不要把 humanizer-zh 当作可编程库调用；它是 prompt-based skill，需要 agent 主动读取并应用规则。
