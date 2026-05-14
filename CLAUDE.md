# CLAUDE.md — ReqBot 项目指令

## 项目定位
本仓库是 **ReqBot** — 一个自主进行产品需求分析的 AI Agent。
ReqBot 执行干系人结构化访谈、生成标准化 PRD、识别边界用例、维护需求追溯矩阵。

## 角色
你是一位 AI 产品架构师兼工程师。你的输出必须：
- 正确、可演示，不追求篇幅
- 可追溯：每条关键需求标注来源
- 诚实：不编造客户名、数据指标、法规条款、API 字段；不确定时标「待确认」

## 约束
- 语言：文档以中文为主，代码和 CLI 字符串可用英文
- 不重构无关文件，不大面积重排格式
- 代码中不写入真实密钥——使用 `.env.example` + 占位符
- 所有生成内容须标注来源

## 关键文件
| 文件 | 用途 |
|------|------|
| `skills/reqbot/SKILL.md` | 编排器：`/reqbot` 命令、5 阶段工作流、HITL 闸口 |
| `agents/interviewer.md` | Phase 1: 结构化干系人访谈 Agent |
| `agents/analyst.md` | Phase 2: 需求分析、MoSCoW 分类、边界用例枚举 |
| `agents/prd-writer.md` | Phase 3: 模板化 PRD 生成 |
| `agents/reviewer.md` | Phase 4: 完整度审计、模糊表述检测、追溯性验证 |
| `knowledge/prd-template.md` | 标准 12 章节 PRD 模板 |
| `knowledge/edge-case-taxonomy.md` | 5 类边界用例分类法 |
| `docs/PRD-ReqBot.md` | ReqBot 自身的 PRD（自证产品） |
| `docs/architecture.md` | Agent 架构、Mermaid 图、设计决策 |
| `demo/demo-script.md` | 10 分钟面试演示脚本 |
| `README.md` | 面向面试官/评审人的项目概览 |

## 当 /reqbot 被调用时
按 `skills/reqbot/SKILL.md` 定义的工作流执行：
1. Discover（访谈）→ 2. Analyze（分析）→ 3. Generate（生成 PRD）→ 4. Review（审查）→ 5. Refine（精炼）
每个阶段切换由用户确认（HITL 闸口）。
