/**
 * The Paddle catalog for Keyline (M5 #70).
 *
 * One paid product: Team, $19/mo flat, 14-day trial. Solo is free and never
 * touches Paddle. Product and price carry custom_data.plan = "team" so
 * webhooks (#73) can map Paddle objects back to a workspace plan without
 * hardcoding ids. ensureTeamCatalog() is idempotent: it finds by
 * custom_data.plan first and only creates what's missing.
 */

import type { PaddleApi } from "./paddle.js";

export const TEAM_PLAN = {
  productName: "Keyline Team",
  description: "Up to 10 members, unlimited environments, full audit history.",
  taxCategory: "saas",
  /** Paddle amounts are strings in the currency's lowest unit. */
  unitPrice: { amount: "1900", currency_code: "USD" },
  trialDays: 14,
} as const;

interface PaddleProduct {
  id: string;
  name: string;
  status: "active" | "archived";
  custom_data: Record<string, unknown> | null;
}

interface PaddlePrice {
  id: string;
  product_id: string;
  status: "active" | "archived";
  custom_data: Record<string, unknown> | null;
}

const isTeam = (o: { custom_data: Record<string, unknown> | null; status: string }) =>
  o.status === "active" && o.custom_data?.plan === "team";

export interface CatalogResult {
  productId: string;
  priceId: string;
  created: { product: boolean; price: boolean };
}

export async function ensureTeamCatalog(api: PaddleApi): Promise<CatalogResult> {
  const products = await api.get<PaddleProduct[]>("/products?status=active&per_page=200");
  let product = products.find(isTeam) ?? null;
  const createdProduct = !product;
  if (!product) {
    product = await api.post<PaddleProduct>("/products", {
      name: TEAM_PLAN.productName,
      description: TEAM_PLAN.description,
      tax_category: TEAM_PLAN.taxCategory,
      custom_data: { plan: "team" },
    });
  }

  const prices = await api.get<PaddlePrice[]>(
    `/prices?product_id=${product.id}&status=active&per_page=200`,
  );
  let price = prices.find(isTeam) ?? null;
  const createdPrice = !price;
  if (!price) {
    price = await api.post<PaddlePrice>("/prices", {
      product_id: product.id,
      description: "Team, monthly flat",
      unit_price: TEAM_PLAN.unitPrice,
      billing_cycle: { interval: "month", frequency: 1 },
      trial_period: { interval: "day", frequency: TEAM_PLAN.trialDays },
      quantity: { minimum: 1, maximum: 1 },
      custom_data: { plan: "team" },
    });
  }

  return {
    productId: product.id,
    priceId: price.id,
    created: { product: createdProduct, price: createdPrice },
  };
}
