#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { memo } from 'radash';
import { extractToolsFromSwagger } from "./swagger.js";
import { fetchTool } from "./mcp.js";

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || "https://apis-hub.synergyshock.com/api";
const API_HUB_TOKEN = process.env.API_HUB_TOKEN!

const server = new Server(
  {
    name: "api-hub",
    version: '0.0.0-development',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const getTools = memo(async (apiId: string) => {
  // console.log(JSON.stringify({ message: "Getting tools for" + process.argv0 }));
  const response = await fetch(`${API_GATEWAY_URL}/docs/${apiId}/swagger`);
  const body = await response.json();
  return extractToolsFromSwagger(apiId, body);
}, { key: (name: any) => name, ttl: Infinity });

server.setRequestHandler(ListToolsRequestSchema, async (req) => {
  const tools = await getTools(process.argv[1]);
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object",
        properties: {}
      }
    }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tools = await getTools(process.argv[1]);
  const map = new Map(tools.map((tool) => [tool.name, tool]));

  if (!request.params.arguments) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Error: Arguments are required`
      }],
    };
  }

  const tool = map.get(request.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Error: Unknown tool: ${request.params.name}`
      }],
    };
  }

  try {
    const response = await fetchTool(tool, request.params.arguments, { apiKey: API_HUB_TOKEN })
    const responseBody = await response.text()
    if (!response.ok) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Error: ${response.status} ${response.statusText}\n${responseBody}`
        }],
      };
    }

    return {
      content: [{ type: "text", text: responseBody }],
    };

  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid input: ${JSON.stringify(error.errors)}`);
    }

    return {
      isError: true,
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});