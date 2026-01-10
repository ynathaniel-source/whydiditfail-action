import { extractFixSuggestions } from '../src/fix-suggestions-extractor.js';

describe('extractFixSuggestions', () => {
  it('should extract fix_suggestions from multi-job result', () => {
    const result = {
      summary: {
        totalJobsAnalyzed: 2,
        jobsSkippedCascading: 0,
        independentRootCauses: 2
      },
      jobs: [
        {
          jobName: 'test-go-build',
          success: true,
          fix_suggestions: [
            {
              path: 'main.go',
              line_start: 10,
              line_end: 10,
              replacement: 'fixed code',
              confidence: 0.9
            }
          ]
        },
        {
          jobName: 'test-typescript',
          success: true,
          fix_suggestions: [
            {
              path: 'app.ts',
              line_start: 5,
              line_end: 5,
              replacement: 'fixed ts code',
              confidence: 0.85
            }
          ]
        }
      ],
      rootCauses: []
    };

    const suggestions = extractFixSuggestions(result);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].jobName).toBe('test-go-build');
    expect(suggestions[0].path).toBe('main.go');
    expect(suggestions[1].jobName).toBe('test-typescript');
    expect(suggestions[1].path).toBe('app.ts');
  });

  it('should handle single-job result with top-level fix_suggestions', () => {
    const result = {
      fix_suggestions: [
        {
          path: 'test.js',
          line_start: 1,
          line_end: 1,
          replacement: 'fixed',
          confidence: 0.8
        }
      ]
    };

    const suggestions = extractFixSuggestions(result);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].path).toBe('test.js');
  });

  it('should return empty array when no fix_suggestions exist', () => {
    const result = {
      jobs: [
        {
          jobName: 'test',
          success: true
        }
      ]
    };

    const suggestions = extractFixSuggestions(result);

    expect(suggestions).toHaveLength(0);
  });

  it('should dedupe identical fix suggestions from multiple jobs', () => {
    const result = {
      jobs: [
        {
          jobName: 'job1',
          fix_suggestions: [
            {
              path: 'main.go',
              line_start: 10,
              line_end: 10,
              replacement: 'same fix',
              confidence: 0.9
            }
          ]
        },
        {
          jobName: 'job2',
          fix_suggestions: [
            {
              path: 'main.go',
              line_start: 10,
              line_end: 10,
              replacement: 'same fix',
              confidence: 0.9
            }
          ]
        }
      ]
    };

    const suggestions = extractFixSuggestions(result);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].jobName).toBe('job1');
  });

  it('should handle empty jobs array', () => {
    const result = {
      jobs: []
    };

    const suggestions = extractFixSuggestions(result);

    expect(suggestions).toHaveLength(0);
  });

  it('should prefer job-level suggestions over top-level', () => {
    const result = {
      fix_suggestions: [
        {
          path: 'old.js',
          line_start: 1,
          line_end: 1,
          replacement: 'old',
          confidence: 0.5
        }
      ],
      jobs: [
        {
          jobName: 'new-job',
          fix_suggestions: [
            {
              path: 'new.js',
              line_start: 1,
              line_end: 1,
              replacement: 'new',
              confidence: 0.9
            }
          ]
        }
      ]
    };

    const suggestions = extractFixSuggestions(result);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].path).toBe('new.js');
    expect(suggestions[0].jobName).toBe('new-job');
  });
});
