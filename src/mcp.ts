import { ParamType, type Tool } from "./swagger.js";

export async function fetchTool(tool: Tool, params: Record<string, unknown>, options: { apiKey: string }) {

  // Parse the tool path to find path parameters
  const url = new URL(tool.endpoint); // This is now a full URL with the API gateway prefix
  const requestBody: Record<string, unknown> = {};
  const requestArgs: Record<string, unknown> = params || {};


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
      "Authorization": `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    }
  }

  if (tool.method !== 'GET' && tool.method !== 'DELETE') {
    requestInit.body = JSON.stringify(requestBody);
  }

  return fetch(url, requestInit)
}