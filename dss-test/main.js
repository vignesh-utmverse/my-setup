// Entry point for every DSS test: node main.js --env <env> --test <test> [options]
// Run with --help to list the tests, or --test <name> --help for that test's options.
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { ENVS, getConfig } = require('./config.js');

const TESTS_DIR = path.join(__dirname, 'tests');

// Accepted by every test. --dss-url, --dss-host, --oauth-url, --key-file and --uss-url override the
// env's settings from config.js.
const GLOBAL_OPTIONS = {
    env:         { type: 'string', short: 'e', desc: `Environment: ${Object.keys(ENVS).join(', ')}` },
    test:        { type: 'string', short: 't', desc: 'Test to run (listed below)' },
    'dss-url':   { type: 'string', desc: 'DSS base URL' },
    'dss-host':  { type: 'string', desc: 'Token audience for the DSS' },
    'oauth-url': { type: 'string', desc: 'OAuth server base URL' },
    'key-file':  { type: 'string', desc: 'Google service account key file' },
    'uss-url':   { type: 'string', desc: 'USS base URL written into DSS records' },
    help:        { type: 'boolean', short: 'h', desc: "Show help; with --test, show that test's options" },
};

// Tests run only against staging (the local pool in ../dss-dev) unless they set allEnvs: most of them
// write into the DSS or load it, so they must not reach a shared DSS by accident. A test that sets
// deprecated (a message) still runs, with a warning, but is no longer listed or completed.
const STAGING = 'staging';

function envsFor(test) {
    return test.allEnvs ? Object.keys(ENVS) : [STAGING];
}

function testNames() {
    return fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
}

function loadTest(name) {
    if (!testNames().includes(name)) throw new Error(`Unknown test "${name}" (available: ${testNames().join(', ')})`);
    return require(path.join(TESTS_DIR, `${name}.js`));
}

function describeOptions(options) {
    return Object.entries(options).map(([name, opt]) => {
        const flag = `${opt.short ? `-${opt.short}, ` : '    '}--${name}${opt.type === 'string' ? ' <value>' : ''}`;
        const def = opt.default !== undefined ? ` (default: ${opt.default})` : '';
        return `  ${flag.padEnd(32)} ${opt.desc}${def}`;
    }).join('\n');
}

function usage(testName, test) {
    const lines = ['Usage: node main.js --env <env> --test <test> [options]', '', 'Global options:', describeOptions(GLOBAL_OPTIONS)];
    if (test) {
        lines.push('', `${testName}: ${test.description}`, `Environments: ${test.allEnvs ? 'all' : `${STAGING} only`}`);
        if (test.deprecated) lines.push(`Deprecated: ${test.deprecated}`);
        lines.push(describeOptions(test.options));
    } else {
        const deprecated = [];
        lines.push('', 'Tests (run against every environment unless marked staging only):');
        for (const name of testNames()) {
            const t = loadTest(name);
            if (t.deprecated) deprecated.push(`  ${name.padEnd(20)} ${t.deprecated}`);
            else lines.push(`  ${name.padEnd(20)} ${t.description}${t.allEnvs ? '' : ` (${STAGING} only)`}`);
        }
        if (deprecated.length) lines.push('', 'Deprecated:', ...deprecated);
        lines.push('', 'Add --help after --test <name> for its options, e.g. node main.js --test injectRid --help');
    }
    return lines.join('\n');
}

// Candidates for the word being typed on a "node main.js ..." command line. completion.bash calls this
// with the line up to the cursor; an empty result falls back to file name completion.
function complete(line) {
    const words = line.split(/\s+/);
    const current = words.pop();  // '' right after a space
    const args = words.slice(words.findIndex(w => w.endsWith('main.js')) + 1);
    const valueOf = (long, short) => {
        const at = args.findIndex(a => a === long || a === short);
        return at === -1 ? undefined : args[at + 1];
    };
    const testName = valueOf('--test', '-t');
    const envName = valueOf('--env', '-e');
    const test = testNames().includes(testName) ? loadTest(testName) : undefined;
    const options = { ...GLOBAL_OPTIONS, ...(test?.options ?? {}) };
    const nameOf = flag => flag.startsWith('--') ? flag.slice(2) : Object.keys(options).find(n => options[n].short === flag.slice(1));

    const prev = nameOf(args[args.length - 1] ?? '');
    let candidates = [];
    if (options[prev]?.type === 'string') {
        // Envs the chosen test may run against, and tests the chosen env allows; deprecated tests are left out.
        if (prev === 'env') candidates = test ? envsFor(test) : Object.keys(ENVS);
        else if (prev === 'test') candidates = testNames().filter(name => {
            const t = loadTest(name);
            return !t.deprecated && (!envName || envsFor(t).includes(envName));
        });
        else candidates = options[prev].choices ?? [];
    } else if (current.startsWith('-')) {
        const used = new Set(args.filter(a => a.startsWith('-')).map(nameOf));
        candidates = Object.keys(options).filter(n => !used.has(n) || options[n].multiple).map(n => `--${n}`);
    }
    return candidates.filter(c => c.startsWith(current));
}

// parseArgs reads "--lng -122.4" as two flags, so glue negative numbers to their option: --lng=-122.4
function cliArgs() {
    const args = [];
    for (const arg of process.argv.slice(2)) {
        const prev = args[args.length - 1];
        if (/^-\d/.test(arg) && prev?.startsWith('--') && !prev.includes('=')) args[args.length - 1] = `${prev}=${arg}`;
        else args.push(arg);
    }
    return args;
}

async function main() {
    if (process.argv[2] === '--complete') {
        const candidates = complete(process.argv[3] ?? '');
        if (candidates.length) console.log(candidates.join('\n'));
        return;
    }

    const args = cliArgs();
    // A loose first pass finds --test, so the strict parse below can include that test's options.
    const { values: first } = parseArgs({ args, options: GLOBAL_OPTIONS, strict: false });
    const test = first.test ? loadTest(first.test) : null;

    if (first.help) {
        console.log(usage(first.test, test));
        return;
    }
    if (!first.env || !test) {
        console.error(`${usage(first.test, test)}\n\nError: --env and --test are required`);
        process.exitCode = 1;
        return;
    }

    const { values: opts } = parseArgs({ args, options: { ...GLOBAL_OPTIONS, ...test.options }, strict: true });
    const cfg = getConfig(opts.env, {
        DSS_BASE_URL: opts['dss-url'],
        DSS_HOST: opts['dss-host'],
        OAUTH_BASE_URL: opts['oauth-url'],
        KEY_FILE: opts['key-file'],
        USS_BASE_URL: opts['uss-url'],
    });
    if (!envsFor(test).includes(cfg.ENV)) {
        throw new Error(`${opts.test} only runs against ${envsFor(test).join(', ')}, not ${cfg.ENV}`);
    }
    if (test.deprecated) console.warn(`Warning: ${opts.test} is deprecated: ${test.deprecated}\n`);

    console.log(`env: ${cfg.ENV} | dss: ${cfg.DSS_BASE_URL} (aud ${cfg.DSS_HOST}) | test: ${opts.test}\n`);
    await test.run(cfg, opts);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exitCode = 1;
});
