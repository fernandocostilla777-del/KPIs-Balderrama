const { buildYtdRanges } = require('../src/services/ytd-comparativo');
console.log('Jul 9:', JSON.stringify(buildYtdRanges('2026-07-09')));
console.log('Jul 31:', JSON.stringify(buildYtdRanges('2026-07-31')));
