import { evaluateShellCommand } from '../plugins/ambiguous-shell-permissions'

type ExpectedDecision = 'allow' | 'ask'

const cases: Array<{ command: string; expected: ExpectedDecision }> = [
	{ command: 'git status --short', expected: 'allow' },
	{ command: 'amp plugins list', expected: 'allow' },
	{ command: 'terraform validate', expected: 'allow' },
	{ command: "sed -n '1,80p' README.md", expected: 'allow' },
	{ command: 'gh issue list --repo photoopapp/photoop-product --state open', expected: 'allow' },
	{ command: 'gh issue view 123 --repo photoopapp/photoop-product', expected: 'allow' },
	{ command: "sed -i 's/a/b/' README.md", expected: 'ask' },
	{ command: "sed -n 's/a/b/w out.txt' README.md", expected: 'ask' },
	{ command: "python -c 'print(1)'", expected: 'ask' },
	{ command: 'find . -name node_modules -delete', expected: 'ask' },
	{ command: 'gh issue close 123 --repo photoopapp/photoop-product', expected: 'ask' },
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
