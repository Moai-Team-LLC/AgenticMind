# AgenticMind + LlamaIndex

Use [`llama-index-tools-mcp`](https://pypi.org/project/llama-index-tools-mcp/). A URL ending
in `/mcp` uses the streamable-HTTP transport. For a **static bearer** (AgenticMind's
`MCP_API_KEY` or a minted token), attach it via a custom `httpx` client — `BasicMCPClient`
takes an `http_client` (the README's `with_oauth` path is for OAuth 2.0 flows, which
AgenticMind doesn't use).

```bash
pip install llama-index-tools-mcp httpx
```

```python
import httpx
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec

MCP_API_KEY = "..."  # static key or a minted scoped token

http_client = httpx.AsyncClient(
    headers={"Authorization": f"Bearer {MCP_API_KEY}"}
)
client = BasicMCPClient(url="http://localhost:3000/mcp", http_client=http_client)

tool_spec = McpToolSpec(client=client)        # optionally: allowed_tools=[...]
tools = await tool_spec.to_tool_list_async()  # or .to_tool_list() in sync code
# pass `tools` to a FunctionAgent / ReActAgent
```

`McpToolSpec`'s `allowed_tools` lets you expose only a subset (e.g. just `kl_ask_global` +
`kl_search`) — pair that with a read-only token for defense in depth (see
[`docs/security-model.md`](../../docs/security-model.md)).

Docs: [LlamaIndex — Using MCP Tools](https://developers.llamaindex.ai/python/framework/module_guides/mcp/llamaindex_mcp/).
