#!/usr/bin/env node
// The API's response types are hand copies: `XDto` in server/src/types/api.ts and `X` in client/src/types/api.ts
// (CLAUDE.md §10). A field on one side only, or required on one side and optional on the other, is the drift that
// ships a client reading a field the server never sends. This compares every pair by shape (nested objects, arrays,
// unions and literal types included), so a renamed enum member or a nullable that became required fails too.
//
// It uses the TypeScript compiler from client/node_modules, so it runs where the client's dependencies are installed
// (the CI `client` job). Server types with no client copy are listed in NO_CLIENT_COPY, on purpose.
//
//   node scripts/ci/check-dto-parity.mjs [--root <repo>]
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Server types the client never reads as a type of its own. A type that gains a client copy must leave this list. */
export const NO_CLIENT_COPY = new Set([]);

/**
 * Properties the server always sends and the client reads as optional, on purpose: a menu in `fp_cache`, a profile in
 * `fp_auth` or an order served by an older API predates the field, and the client must still render it. Matched
 * against `<ServerType><path>?`. Only this direction: a field the client requires and the server may omit is a bug.
 * ponytail: matched by name, so a same-named field on another type is excused too; qualify the pattern then.
 */
export const CLIENT_OPTIONAL = [
  /\.(imageSrcSet|modifierGroupIds|diet)\?$/,
  /^ManagedMenuItemDto\.templateItemId\?$/,
  /^MenuResponse\.(rules|modifierGroups)\?$/,
  /^(OrderItemDto|OrderDto\.items\[\])\.(imageUrl|baseUnitPrice|modifiers)\?$/,
  /modifiers\[\]\.optionId\?$/,
  // Also the membership Join.tsx adds from POST /me/invites/accept, whose answer carries no store settings.
  /^UserDto\.memberships\[\]\.staffCanEditStock\?$/,
];

/** The client name for a server type: `XDto` is `X`; a type without the suffix keeps its name. */
export const clientName = (name) => name.replace(/Dto$/, '');

export function loadTypescript(root) {
  return createRequire(join(root, 'client/package.json'))('typescript');
}

/** Every pair's differences, as readable lines. `serverFile` and `clientFile` are absolute paths. */
export function compareDtos(
  ts,
  serverFile,
  clientFile,
  allow = NO_CLIENT_COPY,
  clientOptional = CLIENT_OPTIONAL,
) {
  const program = ts.createProgram([serverFile, clientFile], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  const checker = program.getTypeChecker();
  const exportsOf = (file) => {
    const source = program.getSourceFile(file);
    const symbol = checker.getSymbolAtLocation(source);
    return new Map(checker.getExportsOfModule(symbol).map((s) => [s.name, s]));
  };
  const server = exportsOf(serverFile);
  const client = exportsOf(clientFile);

  // A flat map of "path" to what sits there: required or optional, and the type with unions sorted. Aliases are
  // expanded, so `Role` on one side and a literal union on the other compare by content. `optional` drops the
  // `undefined` strict mode adds to a `?` property: the `?` is recorded on its own.
  const flatten = (type, path, out, seen, optional = false) => {
    if (type.isUnion()) {
      const members = type.types.filter((t) => !(optional && t.flags & ts.TypeFlags.Undefined));
      if (members.length === 1) return flatten(members[0], path, out, seen, optional);
      const objects = members.filter(
        (t) => t.flags & ts.TypeFlags.Object && !checker.isArrayType(t),
      );
      const rest = members
        .filter((t) => !objects.includes(t))
        .map((t) => (checker.isArrayType(t) ? '[]' : checker.typeToString(t)))
        .sort();
      out[path] = [...new Set(rest)].join(' | ');
      objects.forEach((t, i) => flatten(t, `${path}|${i}`, out, seen));
      members
        .filter((t) => checker.isArrayType(t))
        .forEach((t) => flatten(checker.getTypeArguments(t)[0], `${path}[]`, out, seen));
      return;
    }
    if (checker.isArrayType(type)) {
      // The container is recorded too, so an array on one side and a scalar on the other differ.
      out[path] = '[]';
      return flatten(checker.getTypeArguments(type)[0], `${path}[]`, out, seen);
    }
    const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    const props = type.getProperties();
    if (!index && (props.length === 0 || (type.flags & ts.TypeFlags.Object) === 0)) {
      out[path] = checker.typeToString(type);
      return;
    }
    // Checked before the index signature too, so a dictionary of itself terminates.
    if (seen.has(type)) return void (out[path] = '<recursive>');
    const inner = new Set(seen).add(type);
    if (index) {
      out[path] = 'map';
      flatten(index.type, `${path}[*]`, out, inner);
    }
    for (const prop of props) {
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const own = `${path}.${prop.name}`;
      const sub = {};
      flatten(checker.getTypeOfSymbol(prop), own, sub, inner, isOptional);
      Object.assign(out, sub);
      out[`${own}?`] = isOptional ? 'optional' : 'required';
    }
  };

  const shape = (symbol) => {
    const out = {};
    flatten(checker.getDeclaredTypeOfSymbol(symbol), '', out, new Set());
    return out;
  };

  const problems = [];
  for (const [name, symbol] of server) {
    if ((symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) === 0) continue;
    if (!/Dto$|Response$/.test(name) && !client.has(name) && !allow.has(name)) continue;
    const twin = clientName(name);
    const mate = client.get(twin);
    if (!mate) {
      if (!allow.has(name))
        problems.push(`${name}: no client type "${twin}" (copy it, or list it in NO_CLIENT_COPY)`);
      continue;
    }
    if (allow.has(name)) {
      problems.push(`${name}: has a client copy "${twin}" but is listed in NO_CLIENT_COPY`);
      continue;
    }
    const a = shape(symbol);
    const b = shape(mate);
    // Presence and `?` are the `X?` entries; the other entries are types, compared where both sides have the path.
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] === b[key]) continue;
      const where = `${name}${key} (client ${twin})`;
      if (!key.endsWith('?')) {
        if (a[key] !== undefined && b[key] !== undefined)
          problems.push(`${where}: server ${a[key]}, client ${b[key]}`);
      } else if (a[key] === undefined) problems.push(`${where}: only on the client`);
      else if (b[key] === undefined) problems.push(`${where}: only on the server`);
      else if (a[key] === 'required' && clientOptional.some((re) => re.test(`${name}${key}`)))
        continue;
      else problems.push(`${where}: server ${a[key]}, client ${b[key]}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root');
  const root = resolve(
    at > 0 ? process.argv[at + 1] : fileURLToPath(new URL('../..', import.meta.url)),
  );
  const problems = compareDtos(
    loadTypescript(root),
    join(root, 'server/src/types/api.ts'),
    join(root, 'client/src/types/api.ts'),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length) {
    console.error(
      `\n${problems.length} difference(s) between the server and client response types.`,
    );
    process.exit(1);
  }
  console.log('Server and client response types match.');
}
