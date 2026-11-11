import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The table-ownership rule in eslint.config.mjs: a store-scoped table queried outside its owner fails lint.
const eslint = new ESLint({ cwd: join(__dirname, '../..') });

async function ownershipErrors(filePath: string, table: string): Promise<string[]> {
  const [result] = await eslint.lintText(`supabaseAdmin.from('${table}').select();\n`, {
    filePath,
  });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);
}

describe('table ownership lint rule', () => {
  it('flags a store-scoped table queried outside its owner', async () => {
    expect(await ownershipErrors('src/services/menu.service.ts', 'orders')).toEqual([
      expect.stringContaining('`orders` is store-scoped'),
    ]);
    expect(await ownershipErrors('src/controllers/order.controller.ts', 'menu_items')).toHaveLength(
      1,
    );
    expect(await ownershipErrors('src/jobs/runner.ts', 'order_items')).toHaveLength(1);
  });

  it('flags a table named with a template literal', async () => {
    const [result] = await eslint.lintText('supabaseAdmin.from(`orders`).select();\n', {
      filePath: 'src/services/menu.service.ts',
    });
    expect(result?.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(1);
  });

  it('flags a table with no owner yet in every source file', async () => {
    expect(
      await ownershipErrors('src/services/order.service.ts', 'store_memberships'),
    ).toHaveLength(1);
    expect(await ownershipErrors('src/middleware/auth.ts', 'domain_events')).toHaveLength(1);
  });

  it('lets the owner query its table, and leaves other tables and tests alone', async () => {
    expect(await ownershipErrors('src/services/order.service.ts', 'orders')).toEqual([]);
    expect(await ownershipErrors('src/utils/serializers.ts', 'orders')).toEqual([]);
    expect(await ownershipErrors('src/services/order.service.ts', 'menu_items')).toEqual([]);
    expect(await ownershipErrors('src/services/menu.service.ts', 'stores')).toEqual([]);
    expect(await ownershipErrors('test/api/orders.test.ts', 'orders')).toEqual([]);
  });
});
