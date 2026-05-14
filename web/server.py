"""
ReqBot Web Server — AI需求分析Agent Web版
FastAPI + SSE + DeepSeek API (via httpx, zero extra SDK)
"""

import json
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import httpx

# ── Config ──────────────────────────────────────────────
load_dotenv()
ROOT = Path(__file__).parent.parent

API_KEY = os.getenv("DEEPSEEK_API_KEY")
API_BASE = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
API_URL = f"{API_BASE}/v1/chat/completions"

app = FastAPI(title="ReqBot")
app.mount("/static", StaticFiles(directory=str(ROOT / "web" / "static")), name="static")

# ── Session store ───────────────────────────────────────
sessions: dict[str, dict] = {}


def load_agent(name: str) -> str:
    path = ROOT / "agents" / f"{name}.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def load_knowledge(name: str) -> str:
    path = ROOT / "knowledge" / f"{name}"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def build_system_prompt(phase: int, session: dict) -> str:
    """Build phase-specific system prompt from agent defs + knowledge + context"""

    if phase == 1:
        agent_prompt = load_agent("interviewer")
        round_num = session.get("round", 1)
        round_names = {1: "背景收集 (Context Gathering)", 2: "深入追问 (Deep Dive)", 3: "缺口检测 (Gap Detection)", 4: "模糊澄清 (Ambiguity Resolution)"}
        round_name = round_names.get(round_num, f"Round {round_num}")

        # Build round-specific guidance
        round_guidance = {
            1: "Focus: problem, users, goals, constraints, existing solutions. Ask broad, open questions. One question at a time.",
            2: "Focus: drill into vague answers. Quantify qualitative terms. Ask 'how do you measure that?' when you hear adjectives like fast, intuitive, scalable.",
            3: "Focus: actively look for missing information — personas not mentioned, flows not described, integrations not considered, edge cases overlooked.",
            4: "Focus: when you detect ambiguous language, present 2-3 concrete interpretations with trade-offs. Let the user choose. Present final summary after this round.",
        }
        guidance = round_guidance.get(round_num, "Continue the interview.")

        return f"""{agent_prompt}

## Current Context
Project: {session.get('project_name', '待定义')}
You are in **Round {round_num}/4: {round_name}**.
{guidance}

Ask one question at a time. Keep each response concise (under 400 characters).
When you have sufficient information across all 4 rounds (confidence >= 80 on key needs), present a structured summary of extracted needs, personas, and ambiguities.
End your summary with the exact marker: [READY_FOR_CONFIRM]
"""
    elif phase == 2:
        agent_prompt = load_agent("analyst")
        discover_data = json.dumps(session.get("phase_outputs", {}).get("discover", {}), ensure_ascii=False, indent=2)
        edge_taxonomy = load_knowledge("edge-case-taxonomy.md")
        return f"""{agent_prompt}

## Edge Case Taxonomy
{edge_taxonomy}

## Discover Output (Phase 1)
{discover_data}

Analyze the above needs. Output MoSCoW classification, edge cases, and consistency checks.
Keep output concise and structured. End with: [READY_FOR_CONFIRM]
"""
    elif phase == 3:
        agent_prompt = load_agent("prd-writer")
        analyze_data = json.dumps(session.get("phase_outputs", {}).get("analyze", {}), ensure_ascii=False, indent=2)
        prd_template = load_knowledge("prd-template.md")
        return f"""{agent_prompt}

## PRD Template
{prd_template}

## Analysis Output (Phase 2)
{analyze_data}

Generate a complete PRD following the template. Fill all 12 sections.
Mark missing information with 「待确认」. End with: [READY_FOR_CONFIRM]
"""
    elif phase == 4:
        agent_prompt = load_agent("reviewer")
        prd = session.get("phase_outputs", {}).get("generate", "")
        discover_data = json.dumps(session.get("phase_outputs", {}).get("discover", {}), ensure_ascii=False, indent=2)
        analyze_data = json.dumps(session.get("phase_outputs", {}).get("analyze", {}), ensure_ascii=False, indent=2)
        return f"""{agent_prompt}

## Discover Output (Phase 1)
{discover_data}

## Analysis Output (Phase 2)
{analyze_data}

## PRD to Review
{prd}

Audit this PRD. Output a structured review report with issues by severity (blocker/warning/suggestion).
Keep output concise. End with: [READY_FOR_CONFIRM]
"""
    return ""


async def stream_llm(system_prompt: str, messages: list[dict]):
    """Stream LLM response via SSE using DeepSeek API, with 1 retry on failure"""
    full_text = ""
    last_error = ""

    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = "assistant" if msg["role"] == "assistant" else msg["role"]
        api_messages.append({"role": role, "content": msg["content"]})

    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=120.0) as http:
                async with http.stream(
                    "POST",
                    API_URL,
                    headers={
                        "Authorization": f"Bearer {API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": MODEL,
                        "messages": api_messages,
                        "max_tokens": 8192,
                        "stream": True,
                    },
                ) as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    full_text += content
                                    yield f"data: {json.dumps({'type': 'token', 'text': content})}\n\n"
                            except json.JSONDecodeError:
                                pass
            yield f"data: {json.dumps({'type': 'token_done', 'full_text': full_text})}\n\n"
            return  # success, exit
        except Exception as e:
            last_error = str(e)
            if attempt == 0:
                yield f"data: {json.dumps({'type': 'retry', 'text': 'API 调用失败，正在重试...'})}\n\n"
                continue
    # both attempts failed
    yield f"data: {json.dumps({'type': 'error', 'text': f'请求失败（已重试）: {last_error}'})}\n\n"


def parse_confirm(text: str) -> bool:
    return "[READY_FOR_CONFIRM]" in text


def safe_slug(text: str) -> str:
    """Generate ASCII-only slug from text, stripping non-ASCII chars"""
    import re
    ascii_text = re.sub(r'[^\x00-\x7F]', '', text)  # remove non-ASCII
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', ascii_text).strip('-').lower()
    return slug or "project"


# ── Routes ──────────────────────────────────────────────

@app.get("/")
async def index():
    return HTMLResponse((ROOT / "web" / "templates" / "index.html").read_text(encoding="utf-8"))


@app.post("/api/start")
async def start_session(request: Request):
    """Start new session. User provides project idea."""
    body = await request.json()
    project_name = body.get("project", "").strip()
    if not project_name:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'text': '请输入项目描述'})}\n\n"]),
            media_type="text/event-stream"
        )

    session_id = str(uuid.uuid4())[:8]
    slug = safe_slug(project_name)

    sessions[session_id] = {
        "project_name": project_name,
        "project_slug": slug,
        "current_phase": 1,
        "round": 1,
        "phase_outputs": {},
        "messages": [],
        "ready_for_confirm": False,
    }

    async def run():
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"
        yield f"data: {json.dumps({'type': 'phase_start', 'phase': 1, 'name': 'Discover — 结构化访谈'})}\n\n"

        session = sessions[session_id]
        system_prompt = build_system_prompt(1, session)
        session["messages"] = [{"role": "user", "content": f"我要做的项目是：{project_name}。请开始访谈。"}]

        async for chunk in stream_llm(system_prompt, session["messages"]):
            yield chunk

    return StreamingResponse(run(), media_type="text/event-stream")


@app.post("/api/chat/{session_id}")
async def chat(session_id: str, request: Request):
    """Send user message, get Agent response."""
    if session_id not in sessions:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'text': '会话不存在'})}\n\n"]),
            media_type="text/event-stream"
        )

    body = await request.json()
    user_msg = body.get("message", "").strip()
    if not user_msg:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'text': '消息为空'})}\n\n"]),
            media_type="text/event-stream"
        )

    session = sessions[session_id]
    phase = session["current_phase"]

    # Check for confirm command
    if user_msg.lower() in ["确认", "confirm", "ok", "继续"] and session["ready_for_confirm"]:
        return await advance_phase(session_id)

    # Add user message
    session["messages"].append({"role": "user", "content": user_msg})

    async def run():
        system_prompt = build_system_prompt(phase, session)

        full_response = ""
        async for chunk in stream_llm(system_prompt, session["messages"]):
            chunk_data = chunk.replace("data: ", "").strip()
            if chunk_data:
                try:
                    data = json.loads(chunk_data)
                    if data.get("type") == "token":
                        full_response += data.get("text", "")
                except json.JSONDecodeError:
                    pass
            yield chunk

        session["messages"].append({"role": "assistant", "content": full_response})

        # Phase 1: advance round after each agent response
        if phase == 1:
            if session.get("round", 1) < 4:
                session["round"] = session.get("round", 1) + 1
                yield f"data: {json.dumps({'type': 'round', 'round': session['round'], 'total': 4})}\n\n"
            # Fallback: force confirm-ready after round 4 even if marker missing
            if session.get("round", 1) >= 4 and not parse_confirm(full_response):
                full_response += "\n\n[READY_FOR_CONFIRM]"

        if parse_confirm(full_response):
            session["ready_for_confirm"] = True
            yield f"data: {json.dumps({'type': 'ready_for_confirm', 'phase': phase})}\n\n"

        if phase == 1 and session["ready_for_confirm"]:
            session["phase_outputs"]["discover"] = {
                "phase": "discover",
                "project_name": session["project_name"],
                "raw_output": full_response,
            }

    return StreamingResponse(run(), media_type="text/event-stream")


async def advance_phase(session_id: str):
    """Advance to next phase and auto-execute."""
    session = sessions[session_id]
    current = session["current_phase"]
    next_phase = current + 1

    if next_phase > 5:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'done', 'text': '所有阶段已完成'})}\n\n"]),
            media_type="text/event-stream"
        )

    session["current_phase"] = next_phase
    session["ready_for_confirm"] = False
    session["messages"] = []

    phase_names = {
        2: "Analyze — 需求分析与边界用例",
        3: "Generate — PRD 生成",
        4: "Review — 质量审查",
        5: "Refine — 最终交付",
    }

    async def run():
        yield f"data: {json.dumps({'type': 'phase_start', 'phase': next_phase, 'name': phase_names[next_phase]})}\n\n"

        system_prompt = build_system_prompt(next_phase, session)

        phase_msgs = {
            2: "请基于 Phase 1 的 Discover 输出，执行需求分析：MoSCoW 分类、边界用例枚举、一致性检查。",
            3: "请基于 Phase 2 的分析输出，按模板生成完整 PRD。",
            4: "请基于 Phase 1、2 和已生成的 PRD，执行质量审查。输出审计报告。",
            5: "请基于 Phase 4 的审查报告，精炼最终 PRD 并生成追溯矩阵。",
        }

        msg = phase_msgs.get(next_phase, "继续执行。")
        session["messages"] = [{"role": "user", "content": msg}]

        full_response = ""
        # Phase 3/4 may need auto-continue due to output length
        max_continues = 3 if next_phase in (3, 4) else 0
        for cont_attempt in range(max_continues + 1):
            chunk_count = 0
            async for chunk in stream_llm(system_prompt, session["messages"]):
                chunk_data = chunk.replace("data: ", "").strip()
                if chunk_data:
                    try:
                        data = json.loads(chunk_data)
                        if data.get("type") == "token":
                            full_response += data.get("text", "")
                            chunk_count += 1
                    except json.JSONDecodeError:
                        pass
                yield chunk

            session["messages"].append({"role": "assistant", "content": full_response[-5000:]})

            # Check if we should auto-continue
            if parse_confirm(full_response):
                break
            if cont_attempt < max_continues and chunk_count > 0:
                session["messages"].append({"role": "user", "content": "请继续生成未完成的内容"})
                full_response += "\n\n"
                yield f"data: {json.dumps({'type': 'token', 'text': '\n\n[继续生成...]\n\n'})}\n\n"

        session["messages"] = session["messages"][:1]  # Keep only original user msg + final response
        session["messages"].append({"role": "assistant", "content": full_response})

        phase_keys = {2: "analyze", 3: "generate", 4: "review", 5: "refine"}
        key = phase_keys.get(next_phase, f"phase_{next_phase}")
        session["phase_outputs"][key] = full_response

        slug = session["project_slug"]
        out_dir = ROOT / "output"
        out_dir.mkdir(exist_ok=True)

        if next_phase >= 3 and session["phase_outputs"].get("generate"):
            (out_dir / f"prd-{slug}-web.md").write_text(
                session["phase_outputs"]["generate"], encoding="utf-8"
            )

        if next_phase >= 4 and session["phase_outputs"].get("review"):
            (out_dir / f"review-{slug}-web.json").write_text(
                session["phase_outputs"]["review"], encoding="utf-8"
            )

        if parse_confirm(full_response):
            session["ready_for_confirm"] = True
            yield f"data: {json.dumps({'type': 'ready_for_confirm', 'phase': next_phase})}\n\n"

        if next_phase == 5:
            yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"

    return StreamingResponse(run(), media_type="text/event-stream")


@app.get("/api/export/{session_id}/{artifact}")
async def export_artifact(session_id: str, artifact: str):
    """Download generated artifacts"""
    if session_id not in sessions:
        return {"error": "会话不存在"}

    session = sessions[session_id]
    slug = session["project_slug"]

    if artifact == "prd":
        content = session.get("phase_outputs", {}).get("generate", "")
        if not content:
            prd_path = ROOT / "output" / f"prd-{slug}-web.md"
            if prd_path.exists():
                content = prd_path.read_text(encoding="utf-8")
        if not content:
            return {"error": "PRD 尚未生成"}
        return StreamingResponse(
            iter([content]),
            media_type="text/markdown",
            headers={"Content-Disposition": f"attachment; filename=prd-{slug}.md".encode('ascii', 'ignore').decode()}
        )

    elif artifact == "trace":
        content = session.get("phase_outputs", {}).get("review", "")
        if not content:
            return {"error": "追溯矩阵尚未生成"}
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=traceability-{slug}.json".encode('ascii', 'ignore').decode()}
        )

    return {"error": f"未知制品类型: {artifact}"}


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session state"""
    if session_id not in sessions:
        return {"error": "会话不存在"}
    s = sessions[session_id]
    return {
        "session_id": session_id,
        "project_name": s["project_name"],
        "project_slug": s["project_slug"],
        "current_phase": s["current_phase"],
        "ready_for_confirm": s["ready_for_confirm"],
        "has_prd": bool(s.get("phase_outputs", {}).get("generate")),
        "has_review": bool(s.get("phase_outputs", {}).get("review")),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
