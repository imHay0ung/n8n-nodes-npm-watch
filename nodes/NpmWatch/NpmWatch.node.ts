import type {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

interface VersionChange {
  pkg: string;
  from: string;
  to: string;
  tag: string;
  publishedAt?: string;
  changeType: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';
  npmUrl?: string;
  repositoryUrl?: string;
  changelogUrl?: string;
  releaseNotes?: string;
  releaseTitle?: string;
}

// ========== 헬퍼 함수들 ==========

async function checkPackageVersion(
  context: IExecuteFunctions,
  pkg: string,
  tag: string,
  registry: string,
  timeout: number,
  includePre: boolean,
  skipInitial: boolean,
  debugMode: boolean,
  fetchReleaseInfo: boolean,
  lastSeenStore: IDataObject
): Promise<VersionChange | null> {
  const encoded = encodeURIComponent(pkg);
  const url = `${registry}/${encoded}`;

  // npm registry에서 패키지 정보 가져오기
  const data = await context.helpers.httpRequest({
    method: 'GET',
    url,
    json: true,
    timeout,
    headers: {
      'Accept': 'application/json',
    },
  }) as any;

  const distTags = data?.['dist-tags'] ?? {};
  const currentVersion = distTags[tag];

  if (!currentVersion) {
    context.logger?.debug(`NpmWatch: ${pkg}에 "${tag}" 태그가 없습니다`);
    return null;
  }

  // 프리릴리스 버전 필터링
  if (!includePre && /-/.test(currentVersion)) {
    context.logger?.debug(`NpmWatch: ${pkg}@${currentVersion}는 프리릴리스 버전입니다`);
    return null;
  }

  const lastSeen = lastSeenStore[pkg] as string | undefined;

  // 🧪 디버그 모드: 강제로 "이전 버전"을 설정
  if (debugMode && !lastSeen) {
    const fakePrevious = generateFakePreviousVersion(currentVersion);
    context.logger?.warn(`🧪 DEBUG: ${pkg}의 이전 버전을 ${fakePrevious}로 시뮬레이션`);
    
    const change = await buildVersionChange(
      context,
      pkg,
      fakePrevious,
      currentVersion,
      tag,
      data,
      fetchReleaseInfo,
      timeout
    );
    
    return change;
  }

  // 초기 실행: 현재 버전만 저장하고 알림 안 보냄
  if (!lastSeen) {
    lastSeenStore[pkg] = currentVersion;
    
    if (skipInitial) {
      context.logger?.info(`NpmWatch: ${pkg}@${currentVersion} 초기화 완료 (알림 건너뜀)`);
      return null;
    } else {
      context.logger?.info(`NpmWatch: ${pkg}@${currentVersion} 초기화 완료`);
    }
  }

  // 버전 변경 없음
  if (lastSeen === currentVersion) {
    return null;
  }

  // 버전 변경 감지
  context.logger?.info(
    `NpmWatch: ${pkg} 업데이트 감지 - ${lastSeen || '(초기)'} → ${currentVersion}`
  );

  // 상태 업데이트
  lastSeenStore[pkg] = currentVersion;

  const change = await buildVersionChange(
    context,
    pkg,
    lastSeen || '(초기)',
    currentVersion,
    tag,
    data,
    fetchReleaseInfo,
    timeout
  );

  return change;
}

async function buildVersionChange(
  context: IExecuteFunctions,
  pkg: string,
  fromVersion: string,
  toVersion: string,
  tag: string,
  npmData: any,
  fetchReleaseInfo: boolean,
  timeout: number
): Promise<VersionChange> {
  const publishedAt = npmData?.time?.[toVersion];
  const changeType = detectChangeType(fromVersion, toVersion);
  const npmUrl = `https://www.npmjs.com/package/${pkg}/v/${toVersion}`;

  let repositoryUrl: string | undefined;
  let changelogUrl: string | undefined;
  let releaseNotes: string | undefined;
  let releaseTitle: string | undefined;

  if (fetchReleaseInfo) {
    try {
      // repository URL 추출
      const repository = npmData?.repository;
      if (repository) {
        if (typeof repository === 'string') {
          repositoryUrl = normalizeRepositoryUrl(repository);
        } else if (repository.url) {
          repositoryUrl = normalizeRepositoryUrl(repository.url);
        }
      }

      // GitHub 저장소인 경우 releases 정보 가져오기
      if (repositoryUrl && repositoryUrl.includes('github.com')) {
        const githubInfo = await fetchGitHubRelease(
          context,
          repositoryUrl,
          toVersion,
          timeout
        );
        
        if (githubInfo) {
          changelogUrl = githubInfo.url;
          releaseNotes = githubInfo.body;
          releaseTitle = githubInfo.name;
        } else {
          // releases API에 없으면 기본 releases 링크
          const versionTag = toVersion.startsWith('v') ? toVersion : `v${toVersion}`;
          changelogUrl = `${repositoryUrl}/releases/tag/${versionTag}`;
        }
      }
    } catch (err: any) {
      context.logger?.debug(`릴리스 정보 가져오기 실패: ${err?.message}`);
    }
  }

  return {
    pkg,
    from: fromVersion,
    to: toVersion,
    tag,
    changeType,
    publishedAt,
    npmUrl,
    repositoryUrl,
    changelogUrl,
    releaseNotes,
    releaseTitle,
  };
}

async function fetchGitHubRelease(
  context: IExecuteFunctions,
  repoUrl: string,
  version: string,
  timeout: number
): Promise<{ url: string; body: string; name: string } | null> {
  try {
    // GitHub URL에서 owner/repo 추출
    const match = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
    if (!match) return null;

    const [, owner, repo] = match;
    
    // 여러 태그 형식 시도 (v1.0.0, 1.0.0 등)
    const tagVariants = [
      `v${version}`,
      version,
      `${repo}@${version}`,
      `${repo}-${version}`,
    ];

    for (const tag of tagVariants) {
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
        
        const release = await context.helpers.httpRequest({
          method: 'GET',
          url: apiUrl,
          json: true,
          timeout: timeout,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'n8n-npm-watch',
          },
        }) as any;

        if (release && release.html_url) {
          return {
            url: release.html_url,
            body: release.body || '',
            name: release.name || release.tag_name,
          };
        }
      } catch {
        // 다음 태그 형식 시도
        continue;
      }
    }

    return null;
  } catch (err: any) {
    context.logger?.debug(`GitHub release 조회 실패: ${err?.message}`);
    return null;
  }
}

function detectChangeType(
  oldVersion: string | undefined,
  newVersion: string
): 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown' {
  if (!oldVersion || oldVersion === '(초기)') return 'unknown';

  // 프리릴리스 체크
  if (/-/.test(newVersion)) return 'prerelease';

  try {
    const oldParts = oldVersion.replace(/[^0-9.]/g, '').split('.').map(Number);
    const newParts = newVersion.replace(/[^0-9.]/g, '').split('.').map(Number);

    if (newParts[0] > oldParts[0]) return 'major';
    if (newParts[1] > oldParts[1]) return 'minor';
    if (newParts[2] > oldParts[2]) return 'patch';
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function generateFakePreviousVersion(currentVersion: string): string {
  try {
    const parts = currentVersion.split('.');
    if (parts.length >= 3) {
      const patch = parseInt(parts[2]) || 0;
      parts[2] = Math.max(0, patch - 1).toString();
      return parts.join('.');
    }
  } catch {
    // 실패하면 그냥 다른 버전 반환
  }
  return '0.0.0';
}

function normalizeRepositoryUrl(repoString: string): string {
  // git+https://github.com/user/repo.git -> https://github.com/user/repo
  // git://github.com/user/repo.git -> https://github.com/user/repo
  // github:user/repo -> https://github.com/user/repo
  
  let url = repoString
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/^github:/, 'https://github.com/');
  
  return url;
}

// ========== 메인 노드 클래스 ==========

export class NpmWatch implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Npm Watch',
    name: 'npmWatch',
    icon: 'fa:box-open',
    group: ['transform'],
    version: 1,
    description: 'npm 패키지의 버전 변경을 감지하고 릴리스 노트와 함께 알림',
    defaults: { name: 'Npm Watch' },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Packages',
        name: 'packages',
        type: 'string',
        default: 'react, axios',
        description: '콤마로 구분된 패키지 이름 (예: react, @types/node)',
        required: true,
      },
      {
        displayName: 'Tag',
        name: 'tag',
        type: 'options',
        default: 'latest',
        options: [
          { name: 'Latest', value: 'latest' },
          { name: 'Next', value: 'next' },
          { name: 'Beta', value: 'beta' },
          { name: 'Custom…', value: 'custom' },
        ],
      },
      {
        displayName: 'Custom Tag',
        name: 'customTag',
        type: 'string',
        default: '',
        displayOptions: { show: { tag: ['custom'] } },
        description: 'Custom dist-tag name',
      },
      {
        displayName: 'Registry Base URL',
        name: 'registry',
        type: 'string',
        default: 'https://registry.npmjs.org',
        description: 'npm registry URL',
      },
      {
        displayName: 'Include Pre-Releases',
        name: 'includePre',
        type: 'boolean',
        default: true,
        description: '프리릴리스 버전(예: 1.0.0-beta.1) 포함 여부',
      },
      {
        displayName: 'Skip Initial Run',
        name: 'skipInitial',
        type: 'boolean',
        default: true,
        description: '첫 실행 시 알림을 건너뛰고 현재 버전만 저장',
      },
      {
        displayName: 'Fetch Release Info',
        name: 'fetchReleaseInfo',
        type: 'boolean',
        default: true,
        description: 'GitHub 릴리스 노트 및 체인지로그를 함께 가져오기 (저장소가 GitHub인 경우)',
      },
      {
        displayName: 'Request Timeout (ms)',
        name: 'timeout',
        type: 'number',
        default: 15000,
        description: 'HTTP 요청 타임아웃 (밀리초)',
      },
      {
        displayName: 'Debug Mode',
        name: 'debugMode',
        type: 'boolean',
        default: false,
        description: '🧪 테스트용: 매 실행마다 상태를 초기화하여 항상 변경사항 감지',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const allChanges: VersionChange[] = [];
    
    // 노드별 영구 저장소
    const store = this.getWorkflowStaticData('node') as IDataObject;
    if (!store.lastSeen) {
      store.lastSeen = {};
      store.initializedAt = new Date().toISOString();
    }

    for (let i = 0; i < items.length; i++) {
      const registry = (this.getNodeParameter('registry', i) as string).replace(/\/$/, '');
      const tagSel = this.getNodeParameter('tag', i) as string;
      const custom = this.getNodeParameter('customTag', i) as string;
      const tag = tagSel === 'custom' ? (custom || 'latest') : tagSel;
      const includePre = this.getNodeParameter('includePre', i) as boolean;
      const skipInitial = this.getNodeParameter('skipInitial', i) as boolean;
      const fetchReleaseInfo = this.getNodeParameter('fetchReleaseInfo', i, true) as boolean;
      const timeout = this.getNodeParameter('timeout', i, 15000) as number;
      const debugMode = this.getNodeParameter('debugMode', i, false) as boolean;

      // 🧪 디버그 모드: 상태 초기화
      if (debugMode) {
        this.logger?.warn('⚠️ DEBUG MODE: 상태를 초기화합니다 (테스트용)');
        store.lastSeen = {};
      }

      const rawPkgs = (this.getNodeParameter('packages', i) as string) || '';
      const packages = rawPkgs
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      if (packages.length === 0) {
        this.logger?.warn('NpmWatch: 패키지가 지정되지 않았습니다');
        continue;
      }

      for (const pkg of packages) {
        try {
          const change = await checkPackageVersion(
            this,
            pkg,
            tag,
            registry,
            timeout,
            includePre,
            skipInitial,
            debugMode,
            fetchReleaseInfo,
            store.lastSeen as IDataObject
          );

          if (change) {
            allChanges.push(change);
          }
        } catch (err: any) {
          this.logger?.error(`NpmWatch: ${pkg} 조회 실패 - ${err?.message ?? err}`);
          continue;
        }
      }
    }

    // 변경사항이 없으면 빈 배열 반환
    if (allChanges.length === 0) {
      return [[]];
    }

    // 변경사항을 출력 아이템으로 변환
    const outputItems: INodeExecutionData[] = allChanges.map(change => ({
      json: {
        package: change.pkg,
        from: change.from,
        to: change.to,
        tag: change.tag,
        changeType: change.changeType,
        publishedAt: change.publishedAt,
        detectedAt: new Date().toISOString(),
        updateCommand: `npm install ${change.pkg}@${change.to}`,
        npmUrl: change.npmUrl,
        repositoryUrl: change.repositoryUrl,
        changelogUrl: change.changelogUrl,
        releaseTitle: change.releaseTitle,
        releaseNotes: change.releaseNotes,
      },
      pairedItem: { item: 0 },
    }));

    return [outputItems];
  }
}

// ========== Export (테스트용) ==========
export { checkPackageVersion, detectChangeType, generateFakePreviousVersion };