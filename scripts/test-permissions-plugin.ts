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
	{ command: "AWS_PROFILE=photoop python -c 'print(1)'", expected: 'ask' },
	{ command: 'AWS_PROFILE=photoop ls', expected: 'allow' },
	{ command: 'find . -name node_modules -delete', expected: 'ask' },
	{ command: 'gh issue close 123 --repo photoopapp/photoop-product', expected: 'ask' },
	{ command: 'gh issue create --title "bug" --body "details" --repo photoopapp/photoop-product', expected: 'allow' },
	{ command: 'gh issue comment 249 --body "looks good" --repo photoopapp/photoop-product', expected: 'allow' },
	{ command: 'gh issue edit 249 --add-assignee @me --add-label status/in-progress --repo photoopapp/photoop-product', expected: 'allow' },
	{ command: 'gh issue edit 249 --remove-label status/in-progress --repo photoopapp/photoop-product', expected: 'allow' },
	{ command: 'gh issue edit 249 --title "new title" --repo photoopapp/photoop-product', expected: 'ask' },
	{ command: 'gh issue edit 249 --body "new body" --repo photoopapp/photoop-product', expected: 'ask' },
	{ command: 'gh issue edit 249 --add-label foo --body "rewrite" --repo a/b', expected: 'ask' },
	// AWS subcommand-position checks
	{ command: 'aws ec2 describe-instances', expected: 'allow' },
	{ command: 'aws s3 ls', expected: 'allow' },
	{ command: 'aws s3api list-buckets', expected: 'allow' },
	{ command: 'aws dynamodb scan --table-name X', expected: 'allow' },
	{ command: 'aws s3 cp local list-bucket/key', expected: 'ask' },
	{ command: 'aws ec2 terminate-instances --instance-ids i-1', expected: 'ask' },
	{ command: 'aws --profile p --region us-east-1 ec2 describe-instances', expected: 'allow' },
	{ command: 'aws ec2', expected: 'ask' },
	// Command/process substitution and backticks
	{ command: 'aws ec2 describe-instances $(rm -rf /)', expected: 'ask' },
	{ command: 'aws ec2 describe-instances `rm -rf /`', expected: 'ask' },
	{ command: 'diff <(echo a) <(echo b)', expected: 'ask' },
	// Single-quoted substitution markers should NOT trigger (they're literal)
	{ command: "echo '$(date)'", expected: 'allow' },
	// Subshell grouping
	{ command: '(rm -rf /)', expected: 'ask' },
	{ command: '{ rm -rf /; }', expected: 'ask' },
	// local_psql.sh: read-only by default, asks when --write is present so the
	// plugin can override the broad allow rule in settings.json.
	{ command: '~/photoop-backend/scripts/local_psql.sh', expected: 'allow' },
	{ command: '~/photoop-backend/scripts/local_psql.sh -c "SELECT version()"', expected: 'allow' },
	{ command: '/home/ec2-user/photoop-backend/scripts/local_psql.sh -c "SELECT 1"', expected: 'allow' },
	{ command: './scripts/local_psql.sh -c "SELECT 1"', expected: 'allow' },
	{ command: '~/sandwichboard-backend/scripts/local_psql.sh -c "SELECT 1"', expected: 'allow' },
	{ command: '/home/ec2-user/sandwichboard-workflow/scripts/local_psql.sh -c "SELECT 1"', expected: 'allow' },
	{ command: '~/photoop-backend/scripts/local_psql.sh --write -c "UPDATE users SET ..."', expected: 'ask' },
	{ command: '/home/ec2-user/photoop-backend/scripts/local_psql.sh --write', expected: 'ask' },
	{ command: './scripts/local_psql.sh --write -c "UPDATE users SET ..."', expected: 'ask' },
	{ command: '~/sandwichboard-backend/scripts/local_psql.sh --write', expected: 'ask' },
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
