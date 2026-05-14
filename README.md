# ReqBot — AI 需求分析 Agent

ReqBot 是一个自主进行干系人访谈、需求分析、PRD 生成、边界用例识别和需求追溯的 AI Agent 系统。它是针对 AI Agent 产品经理岗位的面试作品，展示 Agent 架构设计、多 Agent 编排和 Claude Code Skill 开发能力。

## 与"ChatGPT 写 PRD"的区别

| 维度 | ChatGPT 写 PRD | ReqBot |
|------|---------------|--------|
| 流程 | 单次 Prompt → 单次输出 | 5 阶段流水线 + 人在回路闸口 |
| 访谈 | 用户手动追问 | Agent 主动访谈，置信度评分，模糊点追问 |
| 追溯 | 无 | 需求 → 访谈来源 → PRD 章节 → 验收标准，完整追溯链 |
| 边界用例 | 可能列举几条 | 系统化分类体系（5 大类）枚举 |
| 模糊处理 | 静默假设 | 列出 2-3 种解读，让用户选择 |
| 自审查 | 无 | 内置审查阶段，检测模糊表述、缺失验收标准 |

## 快速开始

### 前置条件
- Claude Code CLI 已安装

### 加载 Skill
```bash
claude --plugin-dir D:/ccaiagent
```

### 使用
```
/reqbot 做一个宠物领养小程序
```

ReqBot 将引导你完成 5 个阶段的需求分析，最终输出完整的 PRD 文档。

## 项目结构

```
D:/ccaiagent/
├── skills/reqbot/
│   └── SKILL.md              # 编排器：/reqbot 命令定义 + 工作流状态机
├── agents/
│   ├── interviewer.md        # Phase 1: 结构化访谈 Agent
│   ├── analyst.md            # Phase 2: 需求分析与边界用例 Agent
│   ├── prd-writer.md         # Phase 3: PRD 生成 Agent
│   └── reviewer.md           # Phase 4: 质量审查 Agent
├── knowledge/
│   ├── prd-template.md       # 标准 12 章节 PRD 模板
│   └── edge-case-taxonomy.md # 边界用例分类体系
├── docs/
│   ├── PRD-ReqBot.md         # ReqBot 自身的 PRD（用模板写自己）
│   └── architecture.md       # 架构设计 + Mermaid 图
├── demo/
│   └── demo-script.md        # 10 分钟面试演示脚本
├── CLAUDE.md                 # Claude Code 项目指令
└── README.md                 # 本文件
```

## 核心设计理念

- **多 Agent 编排**：访谈、分析、撰写、审查由专职 Agent 执行，而非单一 Prompt
- **人在回路(HITL)**：每个阶段切换需用户确认，Agent 不擅自推进
- **来源可追溯**：每条需求标注来源（访谈摘录），可前向/后向追溯
- **不幻觉**：信息不足时标记「待确认」并说明需要谁确认，不编造内容
