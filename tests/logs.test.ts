import { jest } from '@jest/globals';

const mockCore = {
  info: jest.fn(),
  warning: jest.fn(),
};

const mockGithub = {
  context: {
    runId: 123,
    repo: { owner: 'test-owner', repo: 'test-repo' },
    job: 'test-job',
  },
  getOctokit: jest.fn(),
};

jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('@actions/github', () => mockGithub);

const { fetchJobLogsBestEffort } = await import('../src/logs.js');
const fs = await import('node:fs');

describe('logs.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WHYDIDITFAIL_LOG_PATH;
  });

  describe('UTF-8 truncation', () => {
    it('should handle ASCII text correctly', async () => {
      const testFile = '/tmp/test-ascii.log';
      const content = 'a'.repeat(1000);
      fs.writeFileSync(testFile, content);
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const result = await fetchJobLogsBestEffort(0.5);

      expect(result.length).toBeLessThanOrEqual(512);
      expect(result).not.toContain('\uFFFD');
      
      fs.unlinkSync(testFile);
    });

    it('should not split multi-byte UTF-8 characters', async () => {
      const testFile = '/tmp/test-utf8.log';
      const content = 'Hello 世界 ✅ café 🎉 '.repeat(50);
      fs.writeFileSync(testFile, content);
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const result = await fetchJobLogsBestEffort(0.5);

      expect(result).not.toContain('\uFFFD');
      expect(result.length).toBeLessThanOrEqual(512 + 10);
      
      fs.unlinkSync(testFile);
    });

    it('should handle emoji correctly', async () => {
      const testFile = '/tmp/test-emoji.log';
      const content = '🚀'.repeat(200);
      fs.writeFileSync(testFile, content);
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const result = await fetchJobLogsBestEffort(0.5);

      expect(result).not.toContain('\uFFFD');
      const emojiCount = (result.match(/🚀/g) || []).length;
      expect(emojiCount).toBeGreaterThan(0);
      
      fs.unlinkSync(testFile);
    });

    it('should not truncate if content is smaller than limit', async () => {
      const testFile = '/tmp/test-small.log';
      const content = 'Small content';
      fs.writeFileSync(testFile, content);
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const result = await fetchJobLogsBestEffort(1);

      expect(result).toBe(content);
      expect(mockCore.warning).not.toHaveBeenCalled();
      
      fs.unlinkSync(testFile);
    });
  });

  describe('log extraction performance', () => {
    it('should handle large logs with duplicates efficiently', async () => {
      const testFile = '/tmp/test-large.log';
      const lines = [];
      for (let i = 0; i < 10000; i++) {
        lines.push(`Line ${i % 100}`);
        if (i % 500 === 0) {
          lines.push('error: Something failed');
        }
      }
      fs.writeFileSync(testFile, lines.join('\n'));
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const start = Date.now();
      const result = await fetchJobLogsBestEffort(100);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(result).toContain('error:');
      
      fs.unlinkSync(testFile);
    });
  });

  describe('error pattern detection', () => {
    it('should extract logs with error patterns', async () => {
      const testFile = '/tmp/test-errors.log';
      const content = [
        'Starting build...',
        'Compiling files...',
        'error: Cannot find module',
        'at line 42',
        'Build failed',
        'Process completed with exit code 1'
      ].join('\n');
      fs.writeFileSync(testFile, content);
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const result = await fetchJobLogsBestEffort(10);

      expect(result).toContain('error: Cannot find module');
      expect(result).toContain('exit code 1');
      
      fs.unlinkSync(testFile);
    });

    it('should handle logs with no errors', async () => {
      const testFile = '/tmp/test-no-errors.log';
      const lines = Array(200).fill('Normal log line');
      fs.writeFileSync(testFile, lines.join('\n'));
      process.env.WHYDIDITFAIL_LOG_PATH = testFile;

      const result = await fetchJobLogsBestEffort(10);

      expect(result).toBeTruthy();
      expect(result.split('\n').length).toBeLessThanOrEqual(200);
      
      fs.unlinkSync(testFile);
    });
  });
});
