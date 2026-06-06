# AgenticMind + CrewAI

Use `MCPServerAdapter` from [`crewai-tools`](https://docs.crewai.com/en/mcp/overview) — it
exposes AgenticMind's MCP tools to your crew.

```bash
pip install "crewai-tools[mcp]"
```

```python
from crewai import Agent
from crewai_tools import MCPServerAdapter

MCP_API_KEY = "..."  # static key or a minted scoped token

server_params = {
    "url": "http://localhost:3000/mcp",
    "transport": "streamable-http",
    "headers": {"Authorization": f"Bearer {MCP_API_KEY}"},
}

with MCPServerAdapter(server_params) as tools:
    researcher = Agent(
        role="Knowledge researcher",
        goal="Answer only from the corpus, with citations.",
        backstory="You rely on AgenticMind for grounded, auditable answers.",
        tools=tools,          # kl_search, kl_ask_global, kl_ingest, mem_recall, ...
        verbose=True,
    )
    # ... build a Task / Crew that uses `researcher` ...
```

`MCPServerAdapter` is a context manager — the connection closes when the `with` block exits.
Prefer a least-privilege minted token over the all-scope static key for anything but local
dev (see [`docs/security-model.md`](../../docs/security-model.md)).

Docs: [CrewAI — MCP servers as tools](https://docs.crewai.com/en/mcp/overview).
