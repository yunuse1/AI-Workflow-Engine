import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, MiniMap, ReactFlow, addEdge, useEdgesState, useNodesState,
  Handle, Position, MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Download, Play, Plus, RotateCcw, Save, Upload, X, Activity, CheckCircle2, CircleAlert } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const STORAGE_KEY = 'ai-workflow-engine:v1';

const initialNodes = [
  { id: 'start', type: 'decision', position: { x: 120, y: 180 }, data: { label: 'Support request?', prompt: 'Is this a customer support request?' } },
  { id: 'support', type: 'decision', position: { x: 520, y: 80 }, data: { label: 'Urgent support?', prompt: 'Does the request describe an urgent production issue?' } },
  { id: 'sales', type: 'decision', position: { x: 520, y: 300 }, data: { label: 'Sales qualified?', prompt: 'Is the user showing clear purchase intent?' } },
];

const initialEdges = [
  { id: 'e-start-support', source: 'start', target: 'support', sourceHandle: 'yes', label: 'YES', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e-start-sales', source: 'start', target: 'sales', sourceHandle: 'no', label: 'NO', markerEnd: { type: MarkerType.ArrowClosed } },
];

function DecisionNode({ id, data, selected }) {
  return (
    <div className={`decision-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-top"><span className="node-dot" /> AI DECISION</div>
      <div className="node-title">{data.label || 'Untitled decision'}</div>
      <div className="node-prompt">{data.prompt || 'Add a decision prompt…'}</div>
      <div className="handle-row">
        <span>NO <Handle type="source" position={Position.Right} id="no" style={{ top: '72%' }} /></span>
        <span>YES <Handle type="source" position={Position.Right} id="yes" style={{ top: '42%' }} /></span>
      </div>
    </div>
  );
}

const nodeTypes = { decision: DecisionNode };

function App() {
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }, []);
  const [nodes, setNodes, onNodesChange] = useNodesState(saved?.nodes || initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(saved?.edges || initialEdges);
  const [inputText, setInputText] = useState(saved?.inputText || 'The customer cannot log in and says production is blocked.');
  const [selectedId, setSelectedId] = useState(saved?.selectedId || 'start');
  const [runId, setRunId] = useState(null);
  const [execution, setExecution] = useState({ status: 'IDLE', logs: [], visited: [] });
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`${STORAGE_KEY}:history`)) || []; } catch { return []; }
  });
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const pollRef = useRef(null);

  const selected = nodes.find(n => n.id === selectedId);
  const activeIds = new Set(execution.visited || []);

  const onConnect = useCallback((connection) => {
    if (!connection.sourceHandle) return;
    setEdges((eds) => addEdge({ ...connection, id: `${connection.source}-${connection.sourceHandle}-${connection.target}`, label: connection.sourceHandle.toUpperCase(), markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, [setEdges]);

  const updateSelected = (field, value) => {
    setNodes(ns => ns.map(n => n.id === selectedId ? { ...n, data: { ...n.data, [field]: value } } : n));
  };

  const addNode = () => {
    const id = `node-${Date.now()}`;
    setNodes(ns => [...ns, { id, type: 'decision', position: { x: 260 + (ns.length % 3) * 80, y: 120 + (ns.length % 4) * 90 }, data: { label: 'New decision', prompt: 'Evaluate whether…' } }]);
    setSelectedId(id);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setNodes(ns => ns.filter(n => n.id !== selectedId));
    setEdges(es => es.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const saveWorkflow = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, inputText, selectedId }));
    setError('Workflow saved locally.');
    setTimeout(() => setError(''), 1800);
  };

  const exportWorkflow = () => {
    const blob = new Blob([JSON.stringify({ version: 1, nodes, edges, inputText }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'ai-workflow.json'; a.click(); URL.revokeObjectURL(url);
  };

  const importWorkflow = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('nodes and edges are required');
      setNodes(parsed.nodes); setEdges(parsed.edges); if (parsed.inputText) setInputText(parsed.inputText);
      setImportOpen(false); setImportText(''); setError('Workflow imported.');
    } catch (e) { setError(`Import failed: ${e.message}`); }
  };

  const resetWorkflow = () => {
    setNodes(initialNodes); setEdges(initialEdges); setInputText('The customer cannot log in and says production is blocked.'); setSelectedId('start'); setExecution({ status: 'IDLE', logs: [], visited: [] });
    localStorage.removeItem(STORAGE_KEY);
  };

  const runWorkflow = async () => {
    setError(''); setExecution({ status: 'STARTING', logs: [], visited: [] });
    const id = crypto.randomUUID(); setRunId(id);
    try {
      const response = await fetch(`${API_BASE}/api/workflow/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: id, input_text: inputText, nodes, edges, start_node_id: nodes[0]?.id }) });
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/api/workflow/status/${id}`); if (!r.ok) return;
          const data = await r.json(); setExecution(data);
          if (data.status === 'COMPLETED' || data.status === 'FAILED') {
            clearInterval(pollRef.current); setHistory(h => [{ id, status: data.status, logs: data.logs || [], at: new Date().toISOString() }, ...h].slice(0, 10));
          }
        } catch {}
      }, 700);
    } catch (e) { setExecution({ status: 'FAILED', logs: [], visited: [] }); setError(`Run failed: ${e.message}`); }
  };

  useEffect(() => () => clearInterval(pollRef.current), []);
  useEffect(() => { return () => clearInterval(pollRef.current); }, []);

  const decoratedEdges = edges.map(e => ({ ...e, animated: activeIds.has(e.source) && activeIds.has(e.target), className: activeIds.has(e.source) && activeIds.has(e.target) ? 'active-edge' : '' }));
  const decoratedNodes = nodes.map(n => ({ ...n, className: activeIds.has(n.id) ? 'node-active' : '' }));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="brand">AI Workflow Engine</div><div className="subtitle">Visual YES / NO decision orchestration</div></div>
        <div className="toolbar">
          <button onClick={addNode}><Plus size={16}/> Node</button><button onClick={saveWorkflow}><Save size={16}/> Save</button><button onClick={exportWorkflow}><Download size={16}/> Export</button><button onClick={() => setImportOpen(true)}><Upload size={16}/> Import</button><button onClick={resetWorkflow}><RotateCcw size={16}/></button>
          <button className="run-button" onClick={runWorkflow} disabled={execution.status === 'RUNNING' || execution.status === 'STARTING'}><Play size={16}/> Run workflow</button>
        </div>
      </header>
      <main className="workspace">
        <section className="canvas-panel">
          <div className="canvas-header"><span>{nodes.length} nodes · {edges.length} connections</span><span className={`status-pill ${execution.status.toLowerCase()}`}><Activity size={13}/> {execution.status}</span></div>
          <ReactFlow nodes={decoratedNodes} edges={decoratedEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, n) => setSelectedId(n.id)} fitView minZoom={0.35} maxZoom={1.7}>
            <Background gap={24} size={1} /><Controls /><MiniMap zoomable pannable />
          </ReactFlow>
        </section>
        <aside className="sidebar">
          <div className="section-title">Workflow input</div>
          <textarea className="input-box" value={inputText} onChange={e => setInputText(e.target.value)} placeholder="Text passed to every AI decision node…" />
          <div className="section-title row-title"><span>Selected node</span>{selected && <button className="icon-button" onClick={removeSelected} title="Delete node"><X size={15}/></button>}</div>
          {selected ? <div className="editor-card"><label>Label<input value={selected.data.label} onChange={e => updateSelected('label', e.target.value)} /></label><label>Decision prompt<textarea value={selected.data.prompt} onChange={e => updateSelected('prompt', e.target.value)} /></label><div className="hint">The model is constrained to return exactly <b>YES</b> or <b>NO</b>.</div></div> : <div className="empty">Select a node to edit its decision.</div>}
          <div className="section-title row-title"><span>Execution logs</span>{execution.logs?.length > 0 && <span className="count">{execution.logs.length}</span>}</div>
          <div className="logs">
            {execution.logs?.length ? execution.logs.map((log, i) => <div className="log" key={`${log.node_id}-${i}`}><div className="log-icon">{log.decision === 'YES' ? <CheckCircle2 size={16}/> : <CircleAlert size={16}/>}</div><div><b>{i + 1}. {log.label}</b><div className="log-meta">Decision: <strong>{log.decision}</strong></div></div></div>) : <div className="empty">Run the workflow to see traversal and AI decisions here.</div>}
          </div>
          <div className="section-title">Run history</div>
          <div className="history">{history.length ? history.map(h => <div className="history-item" key={h.id}><span>{new Date(h.at).toLocaleTimeString()}</span><b>{h.status}</b><small>{h.logs.length} steps</small></div>) : <div className="empty">No completed runs yet.</div>}</div>
          {error && <div className="notice">{error}</div>}
        </aside>
      </main>
      {importOpen && <div className="modal-backdrop"><div className="modal"><div className="modal-title">Import workflow</div><textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste exported workflow JSON here…"/><div className="modal-actions"><button onClick={() => setImportOpen(false)}>Cancel</button><button className="run-button" onClick={importWorkflow}>Import</button></div></div></div>}
    </div>
  );
}

export default App;
