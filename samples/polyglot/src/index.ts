import { parseConfig } from './parser';
import { formatReport } from './util';

export interface Options {
  verbose: boolean;
  retries: number;
}

const DEFAULTS: Options = { verbose: false, retries: 3 };

export async function run(argv: string[]): Promise<number> {
  const options = { ...DEFAULTS, ...parseConfig(argv) };
  const report = await formatReport(options);
  if (options.verbose) process.stdout.write(report);
  return report.length > 0 ? 0 : 1;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
