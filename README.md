# APIs HUB - MCP Servers

Configure MCP servers for APIs Hub.

```json
{
  "mcpServers": {
    "api-hub": {
      "command": "npx",
      "args": ["@synergy-shock/mcp-server", "star-wars-api"],
      "env": {
        "API_HUB_TOKEN": "ah_xxxxxx"
      }
    }
  }
}
```

# Swagger to MCP Tools

```ts
import { extractToolsFromSwagger } from "@synergy-shock/mcp-server/swagger";

const tools = await extractToolsFromSwagger("star-wars-api", {
  openapi: "3.0.0",
  /// ...
});
```
