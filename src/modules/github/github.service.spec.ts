import { GithubService } from './github.service.js';

const makeRepo = (overrides = {}) => ({
  id: 1,
  name: 'my-repo',
  full_name: 'user/my-repo',
  private: false,
  description: 'A test repo',
  default_branch: 'main',
  html_url: 'https://github.com/user/my-repo',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('GithubService', () => {
  let service: GithubService;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    service = new GithubService();
    fetchMock = jest.spyOn(global, 'fetch' as keyof typeof global).mockImplementation(
      jest.fn() as jest.Mock,
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  describe('listRepos', () => {
    it('returns mapped repos on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo()],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com/user/repos'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
        }),
      );

      expect(result).toEqual([
        {
          id: 1,
          name: 'my-repo',
          fullName: 'user/my-repo',
          private: false,
          description: 'A test repo',
          defaultBranch: 'main',
          htmlUrl: 'https://github.com/user/my-repo',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
    });

    it('returns empty array when response is not ok', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Unauthorized' }),
      } as unknown as Response);

      const result = await service.listRepos('bad-token');
      expect(result).toEqual([]);
    });

    it('maps null description correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo({ description: null })],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');
      expect(result[0].description).toBeNull();
    });

    it('maps private repos correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo({ private: true })],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');
      expect(result[0].private).toBe(true);
    });

    it('returns empty array for empty response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');
      expect(result).toEqual([]);
    });
  });
});
