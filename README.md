# AI Workflow Engine

A visual AI workflow builder where every node is a deterministic YES/NO decision. The editor uses React Flow and execution is orchestrated by Inngest with an OpenAI-compatible LLM backend.

## Architecture

- `frontend/` — React + Vite + React Flow visual editor
- `backend/` — FastAPI + Inngest + OpenAI-compatible decision engine
- Workflow state — browser localStorage plus JSON import/export
- Execution — `workflow/run.requested` Inngest event, one Inngest step per decision node

## Features

- Add, connect and edit AI decision nodes
- YES / NO edge handles
- End-to-end Inngest execution with dynamic traversal
- Strict YES/NO model output normalization
- Live execution status and logs
- Animated active path
- Local save/load
- JSON export/import
- Execution history
- Responsive dark UI

## Run locally

### Backend

```bash
cd backend/..
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
```

Create `.env`:

```env
OPENAI_API_KEY=your_key
LLM_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

Start FastAPI:

```bash
uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

If the API is not on port 8000, create `frontend/.env` from `.env.example` and set `VITE_API_BASE`.

### Inngest

Run the Inngest dev server against the FastAPI/Inngest endpoint according to your local Inngest CLI setup. The backend registers the `execute-ai-workflow` function and exposes the Inngest serve endpoint from `backend/main.py`.

## Workflow contract

Each decision node contains a label and prompt. The backend sends the prompt and workflow input to the LLM and normalizes the result to exactly `YES` or `NO`. The matching edge's `sourceHandle` determines the next node.
