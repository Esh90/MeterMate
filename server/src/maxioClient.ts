import {
  Client,
  Environment,
  SubscriptionsController,
  ProductsController,
  ProductFamiliesController,
  ComponentsController,
  SubscriptionComponentsController,
} from '@maxio-com/advanced-billing-sdk';
import { config } from './config.js';

/**
 * Singleton Maxio Advanced Billing client (plan §4.4). HTTP Basic auth: the API
 * key is the username and the literal "x" is the password. Scoped to a site
 * subdomain and US/EU environment. Construction is lazy so the server can boot
 * (and serve /api/health) even before Maxio credentials are configured; the
 * first billing call will surface a clear error if the key is missing.
 */
let client: Client | null = null;

export function getMaxioClient(): Client {
  if (client) return client;

  if (!config.MAXIO_API_KEY) {
    throw new Error(
      'MAXIO_API_KEY is not set. Configure Maxio credentials in .env before using billing routes.',
    );
  }

  client = new Client({
    basicAuthCredentials: {
      username: config.MAXIO_API_KEY,
      password: 'x',
    },
    environment: config.MAXIO_ENVIRONMENT === 'EU' ? Environment.EU : Environment.US,
    site: config.MAXIO_SITE_SUBDOMAIN,
    timeout: 120_000,
  });

  return client;
}

// Cached controllers (constructed from the singleton client).
let subscriptions: SubscriptionsController | null = null;
let products: ProductsController | null = null;
let productFamilies: ProductFamiliesController | null = null;
let components: ComponentsController | null = null;
let subscriptionComponents: SubscriptionComponentsController | null = null;

export function getSubscriptionsController(): SubscriptionsController {
  if (!subscriptions) subscriptions = new SubscriptionsController(getMaxioClient());
  return subscriptions;
}

export function getProductsController(): ProductsController {
  if (!products) products = new ProductsController(getMaxioClient());
  return products;
}

export function getProductFamiliesController(): ProductFamiliesController {
  if (!productFamilies) productFamilies = new ProductFamiliesController(getMaxioClient());
  return productFamilies;
}

export function getComponentsController(): ComponentsController {
  if (!components) components = new ComponentsController(getMaxioClient());
  return components;
}

export function getSubscriptionComponentsController(): SubscriptionComponentsController {
  if (!subscriptionComponents) {
    subscriptionComponents = new SubscriptionComponentsController(getMaxioClient());
  }
  return subscriptionComponents;
}

/** Admin URL for a subscription, used in Slack "View in Maxio" buttons. */
export function maxioSubscriptionUrl(subscriptionId: number): string {
  return `https://${config.MAXIO_SITE_SUBDOMAIN}.chargify.com/subscriptions/${subscriptionId}`;
}
