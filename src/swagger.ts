import { openapiSchemaToJsonSchema } from "@openapi-contrib/openapi-schema-to-json-schema";

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || "https://apis-hub.synergyshock.com/api";

export enum ParamType {
  Query = "query",
  Path = "path",
  Body = "body",
}

// Type definitions for Swagger/OpenAPI objects
export interface SwaggerDocument {
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
  [key: string]: unknown;
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  [key: string]: unknown;
}

export interface Parameter {
  name?: string;
  in?: string;
  description?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RequestBody {
  description?: string;
  content?: Record<string, ContentObject>;
  required?: boolean;
  [key: string]: unknown;
}

export interface ContentObject {
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InputSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  endpoint: string;
  method: string;
  inputSchema: InputSchema;
}

// Type for JSON-like objects
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

/**
 * Extract tools array from Swagger/OpenAPI specification
 */
export function extractToolsFromSwagger(apiId: string, swaggerData: SwaggerDocument): Tool[] {
  const tools: Tool[] = [];
  const paths = swaggerData.paths || {};

  // Iterate through all paths
  for (const path in paths) {
    const pathItem = paths[path];

    // Iterate through HTTP methods for each path
    for (const method in pathItem) {
      if (["get", "post", "put", "delete", "patch"].includes(method)) {
        const operation = pathItem[method as keyof PathItem] as Operation | undefined;

        if (!operation) continue;

        // Create a tool name based on operationId or path+method
        const operationId =
          operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // Convert path parameters to a schema
        let inputSchema: InputSchema = {
          type: "object",
          properties: {},
          required: [],
        };

        if (operation.parameters || operation.requestBody) {
          inputSchema = generateInputSchema(operation, swaggerData);
        }

        // Create a tool entry
        tools.push({
          name: operationId,
          description:
            operation.description || operation.summary || `${method.toUpperCase()} ${path}`,
          endpoint: `${API_GATEWAY_URL}/use/${apiId}/${path}`,
          method: method.toUpperCase(),
          inputSchema: inputSchema,
        });
      }
    }
  }

  return tools
}

/**
 * Generate input schema for a Swagger operation, resolving all references
 */
function generateInputSchema(operation: Operation, swaggerData: SwaggerDocument): InputSchema {
  const schema: InputSchema = {
    type: "object",
    properties: {},
    required: [],
  };

  // Handle path/query parameters
  if (operation.parameters && Array.isArray(operation.parameters)) {
    for (const param of operation.parameters) {
      let paramSchema = param.schema || {};

      // Resolve any $ref in the parameter schema
      paramSchema = resolveReferences(paramSchema, swaggerData);

      if (param.required && param.name) {
        schema.required!.push(param.name);
      }

      if (param.name) {
        // Add paramType to the schema to indicate where this parameter belongs
        (paramSchema as Record<string, unknown>).paramType = param.in || ParamType.Query;

        schema.properties[param.name] = paramSchema;

        // Add description if available
        if (param.description) {
          (schema.properties[param.name] as Record<string, unknown>).description =
            param.description;
        }
      }
    }
  }

  // Handle request body
  if (operation.requestBody && operation.requestBody.content) {
    const contentTypes = Object.keys(operation.requestBody.content);
    if (contentTypes.length > 0) {
      const firstContentType = contentTypes[0];
      let bodySchema = operation.requestBody.content[firstContentType].schema;

      if (bodySchema) {
        // Resolve any $ref in the body schema
        bodySchema = resolveReferences(bodySchema, swaggerData);

        // Convert to JSON Schema
        const convertedBodySchema = openapiSchemaToJsonSchema(bodySchema);

        // Remove $schema property
        if (convertedBodySchema && typeof convertedBodySchema === "object") {
          delete (convertedBodySchema as Record<string, unknown>).$schema;

          // Instead of adding a 'body' property, merge the properties into the root schema
          if (convertedBodySchema.type === "object" && convertedBodySchema.properties) {
            // Add the body properties to the root level
            const bodyProperties = convertedBodySchema.properties as Record<string, unknown>;
            for (const [propName, propSchema] of Object.entries(bodyProperties)) {
              // Mark each property as part of the body
              if (typeof propSchema === "object" && propSchema !== null) {
                (propSchema as Record<string, unknown>).paramType = ParamType.Body;
              }
              schema.properties[propName] = propSchema;
            }

            // Add body's required properties to the root schema's required array
            if (convertedBodySchema.required && Array.isArray(convertedBodySchema.required)) {
              for (const requiredProp of convertedBodySchema.required) {
                if (typeof requiredProp === "string" && !schema.required!.includes(requiredProp)) {
                  schema.required!.push(requiredProp);
                }
              }
            }

            // Handle any constraints like anyOf, allOf, oneOf, etc.
            for (const constraintType of ["anyOf", "allOf", "oneOf", "not"]) {
              if (constraintType in convertedBodySchema) {
                schema[constraintType] = convertedBodySchema[constraintType];
              }
            }
          } else {
            // If it's not an object with properties, add it as is with paramType
            (convertedBodySchema as Record<string, unknown>).paramType = ParamType.Body;
            schema.properties._body = convertedBodySchema;
            if (operation.requestBody.required) {
              schema.required!.push("_body");
            }
          }
        }
      }
    }
  }

  // If there are no required fields, remove the required array
  if (schema.required && schema.required.length === 0) {
    delete schema.required;
  }

  return schema;
}

/**
 * Resolve $ref references in a schema
 */
function resolveReferences(
  schema: Record<string, unknown>,
  swaggerData: SwaggerDocument,
): Record<string, unknown> {
  // Deep clone the schema to avoid modifying the original
  const result = JSON.parse(JSON.stringify(schema));

  // Function to recursively resolve references
  function resolveRef(obj: JsonValue): JsonValue {
    if (!obj || typeof obj !== "object") return obj;

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => resolveRef(item));
    }

    // Handle $ref
    if ("$ref" in obj && typeof obj.$ref === "string") {
      const refPath = obj.$ref.split("/");
      // Skip the first element which is '#'
      refPath.shift();

      // Navigate to the referenced object
      let refObj: unknown = swaggerData;
      for (const segment of refPath) {
        if (
          refObj &&
          typeof refObj === "object" &&
          segment in (refObj as Record<string, unknown>)
        ) {
          refObj = (refObj as Record<string, unknown>)[segment];
        } else {
          // Reference not found
          return {
            type: "object",
            description: `Reference not found: ${obj.$ref}`,
          };
        }
      }

      // Resolve nested references
      return resolveRef(refObj as JsonValue);
    }

    // Handle regular objects by processing each property
    const result: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip $schema
      if (key === "$schema") continue;
      result[key] = resolveRef(value);
    }

    return result;
  }

  return resolveRef(result) as Record<string, unknown>;
}