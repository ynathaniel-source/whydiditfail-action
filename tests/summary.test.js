import { formatSummary } from '../src/summary.js';
describe('formatSummary', () => {
    it('should format high confidence explanation', () => {
        const explanation = {
            root_cause: 'npm failed to resolve DNS for registry.npmjs.org',
            where: 'During npm install step',
            why: 'DNS resolution failed with ENOTFOUND error',
            fixes: [
                'Retry the workflow',
                'Check GitHub Actions status page',
                'Configure custom npm registry'
            ],
            do_not_try: 'Do not modify package.json',
            confidence: 0.92
        };
        const summary = formatSummary(explanation);
        expect(summary).toContain('## 🔍 Failure Analysis');
        expect(summary).toContain('**Confidence:** 🟢 High (92%)');
        expect(summary).toContain('npm failed to resolve DNS');
        expect(summary).toContain('During npm install step');
        expect(summary).toContain('DNS resolution failed');
        expect(summary).toContain('Retry the workflow');
        expect(summary).toContain('Do not modify package.json');
    });
    it('should format medium confidence explanation', () => {
        const explanation = {
            root_cause: 'Test database connection failed',
            where: 'During test execution',
            why: 'PostgreSQL service not running',
            fixes: ['Add PostgreSQL service container'],
            do_not_try: 'Do not modify test code',
            confidence: 0.75
        };
        const summary = formatSummary(explanation);
        expect(summary).toContain('**Confidence:** 🟡 Medium (75%)');
    });
    it('should format low confidence explanation', () => {
        const explanation = {
            root_cause: 'Job failed with exit code 1',
            where: 'Unknown',
            why: 'Insufficient log detail',
            fixes: ['Enable debug logging'],
            do_not_try: 'Cannot provide specific guidance',
            confidence: 0.35
        };
        const summary = formatSummary(explanation);
        expect(summary).toContain('**Confidence:** 🔴 Low (35%)');
        expect(summary).toContain('⚠️ **Low Confidence Warning**');
    });
    it('should escape markdown special characters', () => {
        const explanation = {
            root_cause: 'Error with `backticks` and *asterisks*',
            where: 'Step [with] brackets',
            why: 'Because of _underscores_',
            fixes: ['Fix #1 with hash'],
            do_not_try: 'Do not use | pipes',
            confidence: 0.8
        };
        const summary = formatSummary(explanation);
        expect(summary).toContain('\\`backticks\\`');
        expect(summary).toContain('\\*asterisks\\*');
        expect(summary).toContain('\\[with\\]');
        expect(summary).toContain('\\_underscores\\_');
        expect(summary).toContain('\\#1');
        expect(summary).toContain('\\|');
    });
    it('should handle multiple fixes', () => {
        const explanation = {
            root_cause: 'Multiple issues detected',
            where: 'Various steps',
            why: 'Complex failure',
            fixes: [
                'First fix',
                'Second fix',
                'Third fix',
                'Fourth fix',
                'Fifth fix'
            ],
            do_not_try: 'Avoid these approaches',
            confidence: 0.65
        };
        const summary = formatSummary(explanation);
        expect(summary).toContain('1. First fix');
        expect(summary).toContain('2. Second fix');
        expect(summary).toContain('3. Third fix');
        expect(summary).toContain('4. Fourth fix');
        expect(summary).toContain('5. Fifth fix');
    });
    it('should include all required sections', () => {
        const explanation = {
            root_cause: 'Test root cause',
            where: 'Test location',
            why: 'Test reason',
            fixes: ['Test fix'],
            do_not_try: 'Test warning',
            confidence: 0.8
        };
        const summary = formatSummary(explanation);
        expect(summary).toContain('### 🎯 Root Cause');
        expect(summary).toContain('### 📍 Where');
        expect(summary).toContain('### 🤔 Why');
        expect(summary).toContain('### ✅ How to Fix');
        expect(summary).toContain('### ⛔ What NOT to Try');
    });
});
