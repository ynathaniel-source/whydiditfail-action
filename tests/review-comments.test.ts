import { jest } from '@jest/globals';

const mockCore = {
  info: jest.fn(),
  warning: jest.fn(),
};

const mockContext = {
  payload: {
    pull_request: { number: 123 },
    repository: { full_name: 'owner/repo' }
  },
  repo: { owner: 'owner', repo: 'repo' },
  runId: 456,
  job: 'test-job',
  sha: 'abc123',
};

const mockOctokit = {
  rest: {
    issues: {
      listComments: jest.fn() as any,
      createComment: jest.fn() as any,
      deleteComment: jest.fn() as any,
    },
    pulls: {
      createReview: jest.fn() as any,
      listReviewComments: jest.fn() as any,
      deleteReviewComment: jest.fn() as any,
    },
  },
};

const mockGithub = {
  context: mockContext,
  getOctokit: jest.fn(() => mockOctokit),
};

jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('@actions/github', () => mockGithub);

const { postFixSuggestions } = await import('../src/review-comments.js');

describe('review-comments.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPullNumber', () => {
    it('should get PR number from pull_request', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }]);

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          pull_number: 123
        })
      );
    });

    it('should handle missing pull_request gracefully', async () => {
      const originalPayload = mockContext.payload;
      mockContext.payload = { issue: { number: 789 } } as any;

      mockOctokit.rest.pulls.createReview.mockRejectedValue({
        status: 422,
        message: 'Path could not be resolved'
      });
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }]);

      mockContext.payload = originalPayload;
    });
  });

  describe('grouping and combining', () => {
    it('should combine fixes on close lines', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [
        {
          path: 'test.ts',
          line_start: 10,
          line_end: 10,
          replacement: 'fix1',
          confidence: 0.9
        },
        {
          path: 'test.ts',
          line_start: 12,
          line_end: 12,
          replacement: 'fix2',
          confidence: 0.9
        }
      ]);

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({
              path: 'test.ts',
              start_line: 10,
              line: 12
            })
          ])
        })
      );
    });

    it('should not combine fixes on distant lines', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [
        {
          path: 'test.ts',
          line_start: 10,
          line_end: 10,
          replacement: 'fix1',
          confidence: 0.9
        },
        {
          path: 'test.ts',
          line_start: 50,
          line_end: 50,
          replacement: 'fix2',
          confidence: 0.9
        }
      ]);

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({ line: 10 }),
            expect.objectContaining({ line: 50 })
          ])
        })
      );
    });

    it('should handle empty groups gracefully', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', []);

      expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
    });

    it('should group by file path', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [
        {
          path: 'file1.ts',
          line_start: 10,
          line_end: 10,
          replacement: 'fix1',
          confidence: 0.9
        },
        {
          path: 'file2.ts',
          line_start: 20,
          line_end: 20,
          replacement: 'fix2',
          confidence: 0.9
        }
      ]);

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({ path: 'file1.ts' }),
            expect.objectContaining({ path: 'file2.ts' })
          ])
        })
      );
    });
  });

  describe('cleanup', () => {
    it('should only delete WhyDidItFail comments', async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { type: 'Bot' },
            body: '### 🔧 Suggested Fixes\n\nRun #123\n\n<!-- whydiditfail -->'
          },
          {
            id: 2,
            user: { type: 'Bot' },
            body: 'Some other bot comment'
          },
          {
            id: 3,
            user: { type: 'User' },
            body: 'User comment'
          }
        ]
      });
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});
      mockOctokit.rest.issues.deleteComment.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }], {}, true);

      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1 })
      );
    });

    it('should only delete comments from different runs', async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { type: 'Bot' },
            body: '### 🔧 Suggested Fixes\n\nRun #123\n\n<!-- whydiditfail -->'
          },
          {
            id: 2,
            user: { type: 'Bot' },
            body: '### 🔧 Suggested Fixes\n\nRun #456\n\n<!-- whydiditfail -->'
          }
        ]
      });
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});
      mockOctokit.rest.issues.deleteComment.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }], {}, true);

      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1 })
      );
    });

    it('should not delete comments without WhyDidItFail marker', async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { type: 'Bot' },
            body: '### 🔧 Suggested Fixes\n\nRun #123'
          }
        ]
      });
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }], {}, true);

      expect(mockOctokit.rest.issues.deleteComment).not.toHaveBeenCalled();
    });
  });

  describe('comment formatting', () => {
    it('should include WhyDidItFail marker in all comments', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }]);

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({
              body: expect.stringContaining('<!-- whydiditfail -->')
            })
          ])
        })
      );
    });

    it('should include run ID and job name', async () => {
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }]);

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({
              body: expect.stringMatching(/Run #456/)
            })
          ])
        })
      );
    });
  });

  describe('fallback to PR comments', () => {
    it('should fallback when files not in PR diff', async () => {
      mockOctokit.rest.pulls.createReview.mockRejectedValue({
        status: 422,
        message: 'Path could not be resolved'
      });
      mockOctokit.rest.issues.createComment.mockResolvedValue({});

      await postFixSuggestions('token', [{
        path: 'test.ts',
        line_start: 1,
        line_end: 1,
        replacement: 'fixed',
        confidence: 0.9
      }]);

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('🔧 Suggested Fixes')
        })
      );
    });
  });
});
