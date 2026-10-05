import { env } from '@farmgo/config';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** OpenAPI generated from the Zod route schemas, served with Scalar at /docs. */
export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'FarmGo Connect API',
          version: '0.1.0',
          description:
            'Demand-led marketplace connecting smallholder farmers with hotels and restaurants. ' +
            'Money is in KES cents. Authenticate with the Better Auth session cookie (web) or `Authorization: Bearer <token>` (mobile).',
        },
        servers: [{ url: env.API_URL }],
        components: {
          securitySchemes: {
            bearer: { type: 'http', scheme: 'bearer' },
            cookie: { type: 'apiKey', in: 'cookie', name: 'farmgo.session_token' },
          },
        },
        security: [{ bearer: [] }, { cookie: [] }],
        tags: [
          { name: 'me', description: 'Profile and onboarding' },
          { name: 'farms' },
          { name: 'catalog' },
          { name: 'supply' },
          { name: 'demand' },
          { name: 'matches' },
          { name: 'checkout', description: 'Cart, quote and one-payment checkout across farmers' },
          { name: 'orders' },
          { name: 'qa' },
          { name: 'logistics' },
          { name: 'crates' },
          { name: 'payments' },
          { name: 'pricing' },
          { name: 'inputs' },
          { name: 'notifications' },
          { name: 'uploads' },
          { name: 'admin' },
          { name: 'webhooks' },
          { name: 'health' },
        ],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(scalar, { routePrefix: '/docs' });
  },
  { name: 'docs' },
);
