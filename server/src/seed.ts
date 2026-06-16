import { ApiError, IntervalUnit } from '@maxio-com/advanced-billing-sdk';
import { getProductsController, getProductFamiliesController } from './maxioClient.js';
import { PRODUCT_FAMILY, PLANS } from './constants.js';
import { formatCents } from './util.js';

/**
 * Idempotent seed for UC1 (plan §1.6, §8 Phase 1 — products subset). Ensures the
 * MeterMate product family and the flat recurring `basic` ($99/mo) and `pro`
 * ($299/mo) products exist on the configured Maxio test site, each with an
 * explicit price point. Re-running is safe: existing items are detected and
 * skipped. Metered/event components for later use cases are seeded separately.
 *
 * Run with: npm run seed -w server
 */
async function ensureProductFamily(): Promise<string> {
  const families = getProductFamiliesController();
  const { result } = await families.listProductFamilies({});
  const existing = result.find((r) => r.productFamily?.handle === PRODUCT_FAMILY.handle);
  if (existing?.productFamily?.id != null) {
    console.log(`• Product family '${PRODUCT_FAMILY.handle}' exists (id ${existing.productFamily.id}).`);
    return String(existing.productFamily.id);
  }

  const created = await families.createProductFamily({
    productFamily: {
      name: PRODUCT_FAMILY.name,
      description: 'MeterMate consulting plans and usage.',
    },
  });
  const id = created.result.productFamily?.id;
  if (id == null) throw new Error('Failed to create product family: no id returned.');
  console.log(`✓ Created product family '${PRODUCT_FAMILY.handle}' (id ${id}).`);
  return String(id);
}

async function ensureProduct(familyId: string, plan: (typeof PLANS)[number]): Promise<void> {
  const products = getProductsController();
  try {
    const { result } = await products.readProductByHandle(plan.handle);
    if (result.product?.id != null) {
      console.log(`• Product '${plan.handle}' exists (id ${result.product.id}).`);
      return;
    }
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode !== 404) throw err;
    // 404 → does not exist yet; fall through to create.
  }

  const created = await products.createProduct(familyId, {
    product: {
      name: plan.name,
      handle: plan.handle,
      description: plan.description,
      priceInCents: BigInt(plan.priceInCents),
      interval: plan.interval,
      intervalUnit: IntervalUnit.Month,
    },
  });
  console.log(
    `✓ Created product '${plan.handle}' (id ${created.result.product?.id}) at ${formatCents(plan.priceInCents)}/mo.`,
  );
}

async function main(): Promise<void> {
  console.log('Seeding MeterMate products on Maxio test site…\n');
  const familyId = await ensureProductFamily();
  for (const plan of PLANS) {
    await ensureProduct(familyId, plan);
  }
  console.log('\nSeed complete. Plan handles ready: ' + PLANS.map((p) => p.handle).join(', '));
}

main().catch((err: unknown) => {
  if (err instanceof ApiError) {
    console.error(`Seed failed (HTTP ${err.statusCode}):`, err.body || err.result);
  } else {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
