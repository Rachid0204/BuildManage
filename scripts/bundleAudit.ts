import type { Plugin } from 'vite';
export function bundleAudit(): Plugin {
  return { name: 'bundle-audit', generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter(x => x.type === 'chunk').map(c => ({
      file: c.fileName, entry: c.isEntry, dynamic: c.isDynamicEntry,
      imports: c.imports, dynamicImports: c.dynamicImports,
      modules: Object.keys(c.modules).map(id => id.replace(process.cwd(), '').replaceAll('\\\\', '/')),
    }));
    this.emitFile({ type: 'asset', fileName: 'bundle-audit.json', source: JSON.stringify(chunks, null, 2) });
  }};
}
