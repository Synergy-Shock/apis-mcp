#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { memo } from 'radash';
import { extractToolsFromSwagger, ParamType } from "./swagger.js";

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

type ApiHubTools = {
  name: string
  description: string
  path: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  inputSchema: any
}

const getTools = memo(async (apiId: string) => {
  // console.log(JSON.stringify({ message: "Getting tools for" + process.argv0 }));
  const response = await fetch(`${API_GATEWAY_URL}/docs/${apiId}/swagger`);
  const body = await response.json();
  return extractToolsFromSwagger(apiId, body);
}, { key: (name: any) => name, ttl: Infinity });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await getTools("star-wars-api");
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
  const tools = await getTools("star-wars-api");
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

  // Parse the tool path to find path parameters
  const url = new URL(tool.endpoint); // This is now a full URL with the API gateway prefix
  const requestBody: Record<string, unknown> = {};
  const requestArgs: Record<string, unknown> = request.params.arguments || {};

  try {

    // Process arguments based on their paramType
    if (tool.inputSchema && tool.inputSchema.properties) {
      for (const [paramName, paramSchema] of Object.entries(tool.inputSchema.properties)) {
        if (!(paramName in requestArgs)) {

          if (tool.inputSchema.required && tool.inputSchema.required.includes(paramName)) {
            throw new Error(`Missing required argument: ${paramName}`);
          }

          continue;
        }

        const param = paramSchema as Record<string, unknown>;
        const paramType = param.paramType as string || 'query';
        const value = requestArgs[paramName];

        if (paramType === ParamType.Path) {
          // Collect path parameters
          url.pathname = url.pathname.replace(`%7B${paramName}%7D`, String(value));

        } else if (paramType === ParamType.Query) {
          // Add query parameters
          url.searchParams.append(paramName, String(value));

        } else if (paramType === ParamType.Body) {          // Collect body parameters
          requestBody[paramName] = value;
        }
      }
    }

    const requestInit: RequestInit = {
      method: tool.method,
      headers: {
        "Authorization": `Bearer ${API_HUB_TOKEN}`,
        "Content-Type": "application/json",
      }
    }

    if (tool.method !== 'GET' && tool.method !== 'DELETE') {
      requestInit.body = JSON.stringify(requestBody);
    }

    const response = await fetch(url, requestInit)
    const responseBody = await response.text();
    if (!response.ok) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Error: ${response.status} ${response.statusText}\n${responseBody} for ${url.toString()} with args ${JSON.stringify(request.params.arguments)} and body ${JSON.stringify(tool.inputSchema.properties)}`
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