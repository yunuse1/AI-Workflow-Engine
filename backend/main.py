import os
import json
import inngest
import inngest.fast_api

from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY", "dummy-key")
base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
llm_client = OpenAI(api_key=api_key, base_url=base_url)
inngest_client = inngest.Inngest(
    app_id="ai_workflow_system",
    is_production=False
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EXECUTION_HISTORY: Dict[str, Any] = {}

class EdgeModel(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = "yes"  

class NodeData(BaseModel):
    label: str
    prompt: str

class NodeModel(BaseModel):
    id: str
    data: NodeData
    type: Optional[str] = "decision"

class WorkflowPayload(BaseModel):
    run_id: str
    input_text: str
    nodes: List[NodeModel]
    edges: List[EdgeModel]
    start_node_id: str


def evaluate_llm_decision(prompt: str, user_input: str) -> str:
    system_prompt = (
        "You are a strict binary decision engine in a workflow. "
        "Evaluate the user's input against the given condition. "
        "You MUST answer with EXACTLY one word: either 'YES' or 'NO'. "
        "Do not provide explanations, punctuation, or additional words."
    )
    user_content = f"Condition / Question: {prompt}\nInput: {user_input}"

    response = llm_client.chat.completions.create(
        model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        temperature=0.0,
        max_tokens=5
    )
    raw_answer = response.choices[0].message.content.strip().upper()
    return "YES" if "YES" in raw_answer else "NO"


@inngest_client.create_function(
    fn_id="execute-ai-workflow",
    trigger=inngest.TriggerEvent(event="workflow/run.requested")
)


async def execute_workflow_fn(ctx: inngest.Context, step: inngest.Step) -> Dict[str, Any]:
    event_data = ctx.event.data
    run_id = event_data["run_id"]
    nodes = {n["id"]: n for n in event_data["nodes"]}
    edges = event_data["edges"]
    user_input = event_data["input_text"]
    current_node_id = event_data["start_node_id"]

    logs = []
    visited_nodes = []
    
    EXECUTION_HISTORY[run_id] = {
        "status": "RUNNING",
        "current_node": current_node_id,
        "logs": logs,
        "visited": visited_nodes
    }

    while current_node_id:
        current_node = nodes.get(current_node_id)
        if not current_node:
            break

        visited_nodes.append(current_node_id)
        prompt = current_node["data"]["prompt"]
        node_label = current_node["data"]["label"]

        async def run_step():
            decision = evaluate_llm_decision(prompt, user_input)
            return decision

        decision = await step.run(f"node-decision-{current_node_id}", run_step)

        log_entry = {
            "node_id": current_node_id,
            "label": node_label,
            "prompt": prompt,
            "decision": decision
        }
        logs.append(log_entry)

        matching_edge = next(
            (e for e in edges if e["source"] == current_node_id and e.get("sourceHandle", "yes").lower() == decision.lower()),
            None
        )

        current_node_id = matching_edge["target"] if matching_edge else None

    EXECUTION_HISTORY[run_id] = {
        "status": "COMPLETED",
        "logs": logs,
        "visited": visited_nodes,
        "final_node": visited_nodes[-1] if visited_nodes else None
    }

    return {"status": "SUCCESS", "run_id": run_id, "logs": logs}


inngest.fast_api.serve(app, inngest_client, [execute_workflow_fn])


@app.post("/api/workflow/run")
async def trigger_workflow(payload: WorkflowPayload):
    await inngest_client.send(
        inngest.Event(
            name="workflow/run.requested",
            data=payload.model_dump()
        )
    )
    return {"message": "Workflow started", "run_id": payload.run_id}


@app.get("/api/workflow/status/{run_id}")
async def get_workflow_status(run_id: str):
    if run_id not in EXECUTION_HISTORY:
        return {"status": "PENDING", "logs": [], "visited": []}
    return EXECUTION_HISTORY[run_id]