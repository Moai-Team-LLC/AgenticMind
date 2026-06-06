# AgenticMind + LangChain / LangGraph

Use [`langchain-mcp-adapters`](https://github.com/langchain-ai/langchain-mcp-adapters) —
it loads AgenticMind's MCP tools as LangChain tools.

```bash
pip install langchain-mcp-adapters langgraph "langchain[anthropic]"
```

```python
import asyncio
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

MCP_API_KEY = "..."  # your static key or a minted scoped token

async def main():
    client = MultiServerMCPClient(
        {
            "agenticmind": {
                "transport": "streamable_http",
                "url": "http://localhost:3000/mcp",
                "headers": {"Authorization": f"Bearer {MCP_API_KEY}"},
            }
        }
    )
    tools = await client.get_tools()  # kl_search, kl_ask_global, kl_ingest, mem_recall, ...

    agent = create_react_agent("anthropic:claude-sonnet-4-5", tools)
    result = await agent.ainvoke(
        {"messages": [{"role": "user",
                       "content": "Ingest 'AgenticMind enforces citations.' then ask what it enforces."}]}
    )
    print(result["messages"][-1].content)

asyncio.run(main())
```

The agent now grounds answers in your corpus via `kl_ask_global` (citation-enforced) and can
`kl_ingest` new knowledge. For a read-only agent, mint a `knowledge:read,memory:read` token
instead of the all-scope static key (see [`docs/security-model.md`](../../docs/security-model.md)).

Docs: [LangChain MCP](https://docs.langchain.com/oss/python/langchain/mcp).
