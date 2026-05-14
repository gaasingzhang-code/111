# ReqBot — AI 需求分析 Agent

ReqBot 是一个自主进行干系人访谈、需求分析、PRD 生成、边界用例识别和需求追溯的 AI Agent。多 Agent 编排 + 人在回路闸口，解决 PM 写 PRD 时"遗漏、扯皮、拍脑袋"三个痛点。

## 快速开始（Web 版）

```bash
cd web
pip install -r requirements.txt
cp .env.example .env          # 编辑 .env 填入 DEEPSEEK_API_KEY
python server.py
```

浏览器打开 `http://localhost:8000`，输入你的项目描述即可开始。

## 项目结构

```
├── web/                        # Web 应用（FastAPI + vanilla JS）
│   ├── server.py               #   后端：5 阶段编排 + SSE 流式
│   ├── templates/index.html    #   前端：三栏聊天界面
│   ├── static/app.js           #   前端逻辑
│   ├── static/style.css        #   样式
│   ├── requirements.txt        #   依赖：fastapi, uvicorn, httpx
│   └── .env.example            #   配置模板
├── agents/                     # 专职 Agent 定义（系统提示词）
│   ├── interviewer.md          #   Phase 1: 结构化访谈
│   ├── analyst.md              #   Phase 2: 需求分析 + 边界枚举
│   ├── prd-writer.md           #   Phase 3: PRD 生成
│   └── reviewer.md             #   Phase 4: 质量审查
├── knowledge/                  # 知识库
│   ├── prd-template.md         #   12 章节 PRD 模板
│   └── edge-case-taxonomy.md   #   5 类边界用例分类法
├── docs/                       # 文档
│   ├── PRD-ReqBot.md           #   ReqBot 自身 PRD
│   └── architecture.md         #   架构设计 + 关键决策
├── demo/
│   └── demo-script.md          #   面试演示脚本
├── output/                     # Demo 产物示例
├── skills/reqbot/SKILL.md      # CLI Skill 入口（备选）
├── CLAUDE.md
└── README.md
```

## 工作流

```
Phase 1: Discover  ──→  Phase 2: Analyze  ──→  Phase 3: Generate  ──→  Phase 4: Review
  (结构化访谈)           (需求分析+边界)          (PRD 生成)             (质量审查)
       ↑                      ↑                      ↑                     ↑
   HITL 闸口              HITL 闸口              HITL 闸口              HITL 闸口
```

## 与 "ChatGPT 写 PRD" 的区别

| 维度 | ChatGPT | ReqBot |
|------|---------|--------|
| 流程 | 单次 Prompt → 单次输出 | 5 阶段流水线 + 人在回路确认 |
| 访谈 | 用户手动追问 | Agent 主动访谈，置信度 < 80 追问 |
| 追溯 | 无 | 访谈原文 → 需求 → PRD 章节 → 验收标准 |
| 边界用例 | 靠用户主动问 | 5 类系统化枚举 |
| 模糊处理 | 静默填入合理值 | 列出 2-3 种解读让用户选 |
| 自审查 | 无 | 内置审查阶段检测模糊表述和缺失项 |
| 产物 | Markdown 文本 | PRD .md + 追溯矩阵 .json（可下载） |

## 技术栈

- **前端**：单 HTML + vanilla JS，零外部依赖，无 CDN
- **后端**：Python FastAPI + SSE 流式推送
- **AI**：DeepSeek API，httpx 直连，不绑定任何 SDK
- **架构**：多 Agent 编排 + Supervisor 模式

## 面试演示

参考 `demo/demo-script.md` — 10 分钟演示脚本，包含实时 Demo + 架构讲解 + 设计决策。

面试官也可直接阅读：
- `docs/PRD-ReqBot.md` — 考察产品思维
- `docs/architecture.md` — 考察架构能力
- `output/` — 考察实际产出质量
