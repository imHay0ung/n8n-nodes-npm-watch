// nodes/NpmWatch/test-npm-watch.spec.ts
import { checkPackageVersion, detectChangeType } from './NpmWatch.node';
import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';

/**
 * n8n execution context 모킹
 */
const getMockExecutionContext = (): IExecuteFunctions => ({
  helpers: {
    httpRequest: jest.fn(),
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
} as unknown as IExecuteFunctions);

describe('NpmWatch Node', () => {
  let mockContext: IExecuteFunctions;

  beforeEach(() => {
    mockContext = getMockExecutionContext();
    jest.clearAllMocks();
  });

  describe('checkPackageVersion', () => {
    it('should detect a minor version change', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockApiResponse = {
        'dist-tags': {
          'latest': '18.3.1',
          'next': '18.4.0-alpha-1'
        },
        'time': {
          '18.3.1': '2025-10-20T16:00:00.000Z'
        }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo 추가
        lastSeenStore
      );

      // 검증
      expect(result).toBeTruthy();
      expect(result!.pkg).toBe('react');
      expect(result!.from).toBe('18.2.0');
      expect(result!.to).toBe('18.3.1');
      expect(result!.changeType).toBe('minor');
      expect(result!.publishedAt).toBe('2025-10-20T16:00:00.000Z');
      
      // store가 업데이트 되었는지 확인
      expect(lastSeenStore['react']).toBe('18.3.1');

      // API 호출 검증
      expect(mockContext.helpers.httpRequest).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://registry.npmjs.org/react',
        json: true,
        timeout: 10000,
        headers: { 'Accept': 'application/json' },
      });
    });

    it('should detect a major version change', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockApiResponse = {
        'dist-tags': { 'latest': '19.0.0' },
        'time': { '19.0.0': '2025-10-21T10:00:00.000Z' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.changeType).toBe('major');
      expect(result!.from).toBe('18.2.0');
      expect(result!.to).toBe('19.0.0');
    });

    it('should detect a patch version change', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.2.1' },
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.changeType).toBe('patch');
    });

    it('should return null if there is no version change', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.2.0' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeNull();
      expect(lastSeenStore['react']).toBe('18.2.0');
    });

    it('should initialize and skip notification when skipInitial is true', async () => {
      const lastSeenStore: IDataObject = {};

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.2.0' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        true, // skipInitial
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeNull();
      expect(lastSeenStore['react']).toBe('18.2.0');
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'NpmWatch: react@18.2.0 초기화 완료 (알림 건너뜀)'
      );
    });

    it('should notify on first run when skipInitial is false', async () => {
      const lastSeenStore: IDataObject = {};

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.2.0' },
        'time': { '18.2.0': '2025-10-01T00:00:00.000Z' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false, // skipInitial
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.pkg).toBe('react');
      expect(result!.from).toBe('(초기)');
      expect(result!.to).toBe('18.2.0');
    });

    it('should skip pre-release versions when includePre is false', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.3.0-beta.1' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        false, // includePre
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'NpmWatch: react@18.3.0-beta.1는 프리릴리스 버전입니다'
      );
    });

    it('should include pre-release versions when includePre is true', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.3.0-beta.1' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true, // includePre
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.changeType).toBe('prerelease');
    });

    it('should return null when the requested tag does not exist', async () => {
      const lastSeenStore: IDataObject = {};

      const mockApiResponse = {
        'dist-tags': { 'latest': '18.2.0' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'beta', // 존재하지 않는 태그
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'NpmWatch: react에 "beta" 태그가 없습니다'
      );
    });

    it('should handle scoped packages correctly', async () => {
      const lastSeenStore: IDataObject = {
        '@types/node': '20.0.0'
      };

      const mockApiResponse = {
        'dist-tags': { 'latest': '20.1.0' }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockApiResponse);

      const result = await checkPackageVersion(
        mockContext,
        '@types/node',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.pkg).toBe('@types/node');
      expect(result!.from).toBe('20.0.0');
      expect(result!.to).toBe('20.1.0');
      
      // URL 인코딩 확인
      const callArgs = (mockContext.helpers.httpRequest as jest.Mock).mock.calls[0][0];
      expect(callArgs.url).toBe('https://registry.npmjs.org/%40types%2Fnode');
    });

    it('should fetch GitHub release info when fetchReleaseInfo is true', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockNpmResponse = {
        'dist-tags': { 'latest': '18.3.1' },
        'time': { '18.3.1': '2025-10-20T16:00:00.000Z' },
        'repository': {
          'type': 'git',
          'url': 'https://github.com/facebook/react.git'
        }
      };

      const mockGitHubResponse = {
        html_url: 'https://github.com/facebook/react/releases/tag/v18.3.1',
        name: 'React 18.3.1',
        tag_name: 'v18.3.1',
        body: '## Bug Fixes\n\n* Fixed memory leak\n* Performance improvements'
      };

      // npm API 호출, GitHub API 호출 순서로 모킹
      (mockContext.helpers.httpRequest as jest.Mock)
        .mockResolvedValueOnce(mockNpmResponse)
        .mockResolvedValueOnce(mockGitHubResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        true, // fetchReleaseInfo = true
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.repositoryUrl).toBe('https://github.com/facebook/react');
      expect(result!.changelogUrl).toBe('https://github.com/facebook/react/releases/tag/v18.3.1');
      expect(result!.releaseTitle).toBe('React 18.3.1');
      expect(result!.releaseNotes).toContain('Bug Fixes');
      expect(result!.releaseNotes).toContain('Fixed memory leak');

      // GitHub API가 호출되었는지 확인
      expect(mockContext.helpers.httpRequest).toHaveBeenCalledTimes(2);
    });

    it('should work without GitHub release info when fetchReleaseInfo is false', async () => {
      const lastSeenStore: IDataObject = {
        'react': '18.2.0'
      };

      const mockNpmResponse = {
        'dist-tags': { 'latest': '18.3.1' },
        'time': { '18.3.1': '2025-10-20T16:00:00.000Z' },
        'repository': {
          'type': 'git',
          'url': 'https://github.com/facebook/react.git'
        }
      };

      (mockContext.helpers.httpRequest as jest.Mock).mockResolvedValue(mockNpmResponse);

      const result = await checkPackageVersion(
        mockContext,
        'react',
        'latest',
        'https://registry.npmjs.org',
        10000,
        true,
        false,
        false,
        false, // fetchReleaseInfo = false
        lastSeenStore
      );

      expect(result).toBeTruthy();
      expect(result!.repositoryUrl).toBeUndefined();
      expect(result!.releaseNotes).toBeUndefined();

      // GitHub API가 호출되지 않았는지 확인 (npm API만 1번)
      expect(mockContext.helpers.httpRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('detectChangeType', () => {
    it('should detect major changes', () => {
      expect(detectChangeType('1.0.0', '2.0.0')).toBe('major');
    });

    it('should detect minor changes', () => {
      expect(detectChangeType('1.0.0', '1.1.0')).toBe('minor');
    });

    it('should detect patch changes', () => {
      expect(detectChangeType('1.0.0', '1.0.1')).toBe('patch');
    });

    it('should detect prerelease versions', () => {
      expect(detectChangeType('1.0.0', '1.1.0-beta.1')).toBe('prerelease');
    });

    it('should return unknown for invalid versions', () => {
      expect(detectChangeType(undefined, '1.0.0')).toBe('unknown');
    });

    it('should return unknown for initial version', () => {
      expect(detectChangeType('(초기)', '1.0.0')).toBe('unknown');
    });
  });
});