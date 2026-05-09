import { evaluateShellCommand } from '../plugins/custom-permissions/tighteners'

type ExpectedDecision = 'allow' | 'ask'

const cases: Array<{ command: string; expected: ExpectedDecision }> = [
	{ command: 'git status --short', expected: 'allow' },
	{ command: 'amp plugins list', expected: 'allow' },
	{ command: 'terraform validate', expected: 'allow' },
	{ command: 'npx html-validate index.html src/page.html', expected: 'allow' },
	{ command: "sed -n '1,80p' README.md", expected: 'allow' },
	{ command: 'gh issue list --repo photoopapp/photoop-product --state open', expected: 'allow' },
	{ command: 'gh issue view 123 --repo photoopapp/photoop-product', expected: 'allow' },
	{ command: "sed -i 's/a/b/' README.md", expected: 'ask' },
	{ command: "sed -n 's/a/b/w out.txt' README.md", expected: 'ask' },
	{ command: "python -c 'print(1)'", expected: 'ask' },
	{ command: 'find . -name node_modules -delete', expected: 'ask' },
	{ command: 'gh issue close 123 --repo photoopapp/photoop-product', expected: 'ask' },
	// local_psql.sh: read-only by default, asks when --write is present so the
	// plugin can override the broad allow rule in settings.json.
	{ command: '~/photoop-backend/scripts/local_psql.sh', expected: 'allow' },
	{ command: '~/photoop-backend/scripts/local_psql.sh -c "SELECT version()"', expected: 'allow' },
	{ command: '/home/ec2-user/photoop-backend/scripts/local_psql.sh -c "SELECT 1"', expected: 'allow' },
	{ command: '~/photoop-backend/scripts/local_psql.sh --write -c "UPDATE users SET ..."', expected: 'ask' },
	{ command: '/home/ec2-user/photoop-backend/scripts/local_psql.sh --write', expected: 'ask' },
	// git worktree: allowed broadly, but plugin asks before remove
	{ command: 'git worktree list', expected: 'allow' },
	{ command: 'git worktree add ../wt main', expected: 'allow' },
	{ command: 'git worktree prune', expected: 'allow' },
	{ command: 'git -C ~/repo worktree list', expected: 'allow' },
	{ command: 'git worktree remove ../wt', expected: 'ask' },
	{ command: 'git -C ~/repo worktree remove --force ../wt', expected: 'ask' },
]

let failures = 0

for (const testCase of cases) {
	const decision = evaluateShellCommand(testCase.command)
	if (decision.kind !== testCase.expected) {
		failures += 1
		console.error(`FAIL ${testCase.command}`)
		console.error(`  expected: ${testCase.expected}`)
		console.error(`  actual:   ${decision.kind} (${decision.reason})`)
		continue
	}

	console.log(`PASS ${testCase.command}`)
}

if (failures > 0) {
	process.exit(1)
}
