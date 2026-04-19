// Input-validation helpers.
//
// Two patterns are supported:
//  1. JSON Schema via Fastify's built-in ajv:  app.post('/x', { schema: {...} }, handler)
//     Pass the `schema` option directly — Fastify validates + returns 400 on its own.
//  2. Imperative `requireFields` / `check` preHandlers for cases not easily expressed
//     as a JSON Schema (e.g., cross-field rules, RBAC-dependent rules).
//
// Both work fully offline; no external dependencies.

export function requireFields(fields, source = 'body') {
  return async (request, reply) => {
    const payload = request[source] || {};
    const missing = fields.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === '');
    if (missing.length) {
      return reply.code(400).send({
        error: 'Missing required fields',
        source,
        fields: missing
      });
    }
  };
}

/**
 * Generic validator: pass a function that returns an array of issue strings.
 *   check((req) => req.body.x > 0 ? null : ['x must be > 0'])
 */
export function check(fn) {
  return async (request, reply) => {
    const issues = await fn(request);
    if (issues && issues.length) {
      return reply.code(400).send({ error: 'Validation failed', issues });
    }
  };
}
