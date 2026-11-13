import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Table ownership (docs/TESTING.md "Table ownership"): a store-scoped table is queried with `.from()` only in the files
// that own it, so its store filter and its 404-not-403 rule live in one place and every other module calls that
// service. A new store-scoped table gets a row here; an empty list means no file may query it directly yet.
const TABLE_OWNERS = {
  orders: ['src/services/order.service.ts', 'src/utils/serializers.ts'],
  order_items: ['src/services/order.service.ts'],
  media_uploads: ['src/services/media.service.ts'],
  menu_items: ['src/services/menu.service.ts', 'src/services/order.service.ts'],
  store_memberships: ['src/services/team.service.ts'],
  store_invites: ['src/services/team.service.ts'],
  stock_movements: ['src/services/stock.service.ts'],
  modifier_groups: ['src/services/modifier.service.ts'],
  modifier_options: ['src/services/modifier.service.ts'],
  menu_item_modifier_groups: ['src/services/modifier.service.ts'],
  order_item_modifiers: ['src/services/order.service.ts'],
  domain_events: [],
};

const ownerFiles = [...new Set(Object.values(TABLE_OWNERS).flat())];
const forbidTables = (file) => [
  'error',
  ...Object.entries(TABLE_OWNERS)
    .filter(([, owners]) => !owners.includes(file))
    .map(([table, owners]) => ({
      // The second form is a no-substitution template literal, `.from(\`orders\`)`, which has no `.value`.
      selector: `CallExpression[callee.property.name='from'][arguments.0.value='${table}'], CallExpression[callee.property.name='from'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked='${table}']`,
      message: `\`${table}\` is store-scoped: query it only in ${owners.join(', ') || 'its future owning service'} and call that from here.`,
    })),
];

export default tseslint.config(
  { ignores: ['dist', 'src/types/database.ts'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: { globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      // Everything logs through the logger (see docs/LOGGING.md).
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  { files: ['src/**/*.ts'], rules: { 'no-restricted-syntax': forbidTables(null) } },
  ...ownerFiles.map((file) => ({
    files: [file],
    rules: { 'no-restricted-syntax': forbidTables(file) },
  })),
);
