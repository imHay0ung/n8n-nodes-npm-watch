import type {
    IExecuteFunctions, IDataObject, INodeExecutionData, INodeType, INodeTypeDescription,
  } from 'n8n-workflow';
  
  export class NpmWatch implements INodeType {
    description: INodeTypeDescription = {
      displayName: 'Npm Watch',
      name: 'npmWatch',
      icon: 'fa:box-open',
      group: ['transform'],
      version: 1,
      description: 'Check npm dist-tags and emit when version changes',
      defaults: { name: 'Npm Watch' },
      inputs: ['main'], outputs: ['main'],
      properties: [
        { displayName: 'Packages', name: 'packages', type: 'string',
          default: 'react, axios', description: 'Comma-separated list (supports @scope/name)' },
        { displayName: 'Tag', name: 'tag', type: 'options', default: 'latest',
          options: [
            { name: 'Latest', value: 'latest' },
            { name: 'Next', value: 'next' },
            { name: 'Beta', value: 'beta' },
            { name: 'Custom…', value: 'custom' },
          ]},
        { displayName: 'Custom Tag', name: 'customTag', type: 'string', default: '',
          displayOptions: { show: { tag: ['custom'] } }},
        { displayName: 'Registry Base URL', name: 'registry', type: 'string',
          default: 'https://registry.npmjs.org' },
        { displayName: 'Include Pre-Releases', name: 'includePre', type: 'boolean', default: true },
      ],
    };
  
    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
      const registry = this.getNodeParameter('registry', 0) as string;
      const tagSel   = this.getNodeParameter('tag', 0) as string;
      const custom   = this.getNodeParameter('customTag', 0) as string;
      const tag      = tagSel === 'custom' ? (custom || 'latest') : tagSel;
  
      const rawPkgs  = (this.getNodeParameter('packages', 0) as string) || '';
      const packages = rawPkgs.split(',').map(s => s.trim()).filter(Boolean);
  
      const store = this.getWorkflowStaticData('node') as IDataObject; // { lastSeen: { [pkg]: "x.y.z" } }
      if (!store.lastSeen) store.lastSeen = {};
  
      const changes: Array<{pkg: string; from?: string; to: string; publishedAt?: string}> = [];
  
      for (const pkg of packages) {
        const encoded = encodeURIComponent(pkg); // @scope/name → @scope%2Fname
        const url = `${registry}/${encoded}`;
        try {
          const data = await this.helpers.httpRequest({ method: 'GET', url, json: true, timeout: 10000 }) as any;
          const distTags = data?.['dist-tags'] ?? {};
          const nextVer: string | undefined = distTags[tag];
          if (!nextVer) continue;
  
          const includePre = this.getNodeParameter('includePre', 0) as boolean;
          if (!includePre && /-/.test(nextVer)) continue;
  
          const lastSeen = (store.lastSeen as IDataObject)[pkg] as string | undefined;
          if (lastSeen !== nextVer) {
            const publishedAt = data?.time?.[nextVer];
            changes.push({ pkg, from: lastSeen, to: nextVer, publishedAt });
            (store.lastSeen as IDataObject)[pkg] = nextVer;
          }
        } catch (err: any) {
          this.logger?.warn(`NpmWatch: failed to fetch ${pkg}: ${err?.message ?? err}`);
          continue;
        }
      }
  
      if (!changes.length) return [[]];
  
      const items: INodeExecutionData[] = changes.map(c => ({
        json: { package: c.pkg, from: c.from, to: c.to, tag, publishedAt: c.publishedAt },
      }));
      return [items];
    }
  }
  