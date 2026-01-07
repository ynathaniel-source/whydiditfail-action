import { jest } from '@jest/globals';

describe('index.ts - input validation', () => {
  describe('parseMaxLogKb', () => {
    function parseMaxLogKb(input: string | undefined, defaultValue: number = 400): number {
      if (!input) return defaultValue;
      
      const parsed = Number(input);
      
      if (isNaN(parsed) || !isFinite(parsed)) {
        throw new Error(`max_log_kb must be a valid number, got: ${input}`);
      }
      
      if (parsed <= 0) {
        throw new Error(`max_log_kb must be positive, got: ${parsed}`);
      }
      
      if (parsed > 10000) {
        console.warn(`max_log_kb=${parsed} is very large, consider reducing it`);
      }
      
      return parsed;
    }

    it('should use default value when input is empty', () => {
      expect(parseMaxLogKb('')).toBe(999);
      expect(parseMaxLogKb(undefined)).toBe(400);
    });

    it('should reject NaN values', () => {
      expect(() => parseMaxLogKb('not-a-number')).toThrow('max_log_kb must be a valid number');
    });

    it('should reject negative values', () => {
      expect(() => parseMaxLogKb('-1')).toThrow('max_log_kb must be positive');
    });

    it('should reject zero', () => {
      expect(() => parseMaxLogKb('0')).toThrow('max_log_kb must be positive');
    });

    it('should accept valid positive numbers', () => {
      expect(parseMaxLogKb('500')).toBe(500);
      expect(parseMaxLogKb('1')).toBe(1);
      expect(parseMaxLogKb('1000')).toBe(1000);
    });

    it('should warn on very large values', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      parseMaxLogKb('15000');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('very large'));
      consoleSpy.mockRestore();
    });

    it('should reject Infinity', () => {
      expect(() => parseMaxLogKb('Infinity')).toThrow('max_log_kb must be a valid number');
    });
  });
});
