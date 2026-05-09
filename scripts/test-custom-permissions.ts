import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decide, type Rule } from '../plugins/custom-permissions/custom-permissions'
import { evaluateShellCommand } from '../plugins/custom-permissions/tighteners'

const repoRoot = resolve(import.meta.dir, '..')

const settings = JSON.parse(readFileSync(resolve(repoRoot, 'settings.json'), 'utf8')) as Record<string, unknown>
const userRules = (settings['amp.permissions'] as Rule[] | undefined) ?? []
const builtinRules = JSON.parse(readFileSync(resolve(repoRoot, 'plugins/custom-permissions/builtin-rules.json'), 'utf8')) as Rule[]

// Mirror the plugin's combined logic: rule cascade + heuristic tighteners.
function decideWithTighteners(tool: string, cmd: string | undefined) {
	const decision = decide(userRules, builtinRules, tool, cmd)
	if (decision.action === 'allow' && cmd !== undefined) {
		const tightened = evaluateShellCommand(cmd)
		if (tightened.kind === 'ask') {
			return { action: 'ask' as const, rule: null, source: 'default' as const }
		}
	}
	return decision
}

interface TestCase {
	tool: string
	cmd?: string
	expected: { action: Rule['action'] | 'ask'; source: 'user' | 'builtin' | 'default' }
	note?: string
}

const cases: TestCase[] = [
	// User rules from settings.json win over built-in
	{ tool: 'Bash', cmd: 'git add foo', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'cd ~/photoop-backend', expected: { action: 'allow', source: 'user' } },
	{
		tool: 'Bash',
		cmd: 'cat ~/photoop-product/scripts/worktree-start.sh | head -40 && echo --- && cd ~/photoop-backend && git status -sb && echo --- && cd ~/photoop-infrastructure && git status -sb && echo --- && cd ~/SandwichBoard && git status -sb',
		expected: { action: 'allow', source: 'user' },
	},
	{ tool: 'Bash', cmd: 'gh issue list --repo PhotoOpApp/SandwichBoard --state all', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'gh run view 25608940296 --repo PhotoOpApp/photoop-infrastructure --log-failed 2>&1 | head -200', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: 'gh run view 25608940296 --repo PhotoOpApp/photoop-infrastructure --log-failed 2>&1 | head -200', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: 'gh issue list --repo PhotoOpApp/SandwichBoard --state all', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'gh issue edit 249 --add-assignee @me --add-label status/in-progress --repo photoopapp/photoop-product 2>&1', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'gh issue edit 249 --remove-label status/in-progress --repo photoopapp/photoop-product', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'terraform plan -out=plan.tfplan', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: '~/photoop-backend/scripts/local_psql.sh --write -c "UPDATE x"', expected: { action: 'ask', source: 'default' }, note: 'user rule allows; tightener asks because of --write' },
	{ tool: 'Bash', cmd: 'git worktree remove ../wt', expected: { action: 'ask', source: 'default' }, note: 'user rule allows git worktree *; tightener asks on `git worktree remove`' },
	{ tool: 'Bash', cmd: "sed -n '470,580p' ~/photoop-infrastructure/terraform/environments/prod/main.tf", expected: { action: 'allow', source: 'user' } },
	// AWS read-only verbs (single command and segmented multi-command)
	{ tool: 'Bash', cmd: 'aws --profile photoop sqs list-queues --queue-name-prefix sbw-prod', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'aws ec2 describe-instances --region us-east-1', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'aws dynamodb scan --table-name MyTable', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'AWS_PROFILE=photoop aws s3api list-buckets --query "Buckets[?starts_with(Name,\'sbw-\')].Name" --output text 2>&1', expected: { action: 'allow', source: 'user' } },
	// Env-var prefix must NOT smuggle arbitrary commands through user rules
	{ tool: 'Bash', cmd: 'AWS_PROFILE=photoop rm -rf /', expected: { action: 'ask', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'AWS_PROFILE=photoop rm /tmp/foo', expected: { action: 'ask', source: 'builtin' } },
	// More env-prefix attack vectors
	{ tool: 'Bash', cmd: 'AWS_PROFILE=photoop git push --force origin main', expected: { action: 'ask', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'AWS_PROFILE=photoop /tmp/evil.sh', expected: { action: 'ask', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'FOO=bar AWS_PROFILE=photoop aws ec2 describe-instances', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'AWS_PROFILE="evil; rm -rf /" aws ec2 describe-instances', expected: { action: 'allow', source: 'user' }, note: 'quoted env value cannot inject — shell would treat literal "evil; rm -rf /" as the AWS_PROFILE value' },
	// Pipe smuggle: a destructive command piped after a permitted one must not be allowed
	{ tool: 'Bash', cmd: 'aws ec2 describe-instances | rm -rf /', expected: { action: 'ask', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'echo hi | rm -rf /tmp/x --recursive --force', expected: { action: 'ask', source: 'builtin' } },
	// Command substitution / backtick smuggle
	{ tool: 'Bash', cmd: 'aws ec2 describe-instances $(rm -rf /)', expected: { action: 'ask', source: 'default' } },
	{ tool: 'Bash', cmd: 'aws ec2 describe-instances `rm -rf /`', expected: { action: 'ask', source: 'default' } },
	// Subcommand-position smuggle: `list-` appearing in arg should not match `aws * list-*`
	{ tool: 'Bash', cmd: 'aws s3 cp local list-bucket/key', expected: { action: 'ask', source: 'default' } },
	// cd allow + dangerous next segment must not enable the second segment
	{ tool: 'Bash', cmd: 'cd ~/photoop-backend && rm -rf /', expected: { action: 'ask', source: 'builtin' } },
	// Subshell wrapping a destructive command
	{ tool: 'Bash', cmd: '(rm -rf /)', expected: { action: 'ask', source: 'builtin' } },
	// Lookalike binary that starts with aws
	{ tool: 'Bash', cmd: 'awsfake list-things', expected: { action: 'ask', source: 'builtin' } },

	{
		tool: 'Bash',
		cmd: 'AWS_PROFILE=photoop aws iam list-role-policies --role-name photoop-prod-ec2-role 2>&1; echo "---"; AWS_PROFILE=photoop aws iam get-role-policy --role-name photoop-prod-ec2-role --policy-name sbw-prod-workflow-payload-buckets --query \'PolicyDocument\' 2>&1',
		expected: { action: 'allow', source: 'user' },
	},
	{
		tool: 'Bash',
		cmd: 'aws --profile photoop sqs list-queues --queue-name-prefix sbw-prod 2>&1\necho "---"\naws --profile photoop s3api list-buckets --query "Buckets[?starts_with(Name, \'sbw-prod\')].Name" --output text 2>&1',
		expected: { action: 'allow', source: 'user' },
	},
	// Segmented allow shouldn't smuggle through a destructive command
	{ tool: 'Bash', cmd: 'aws sqs list-queues\naws s3 rm s3://bucket/key', expected: { action: 'ask', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'echo hi && rm -rf /tmp/foo --recursive --force', expected: { action: 'ask', source: 'builtin' } },
	// Built-in defaults
	{ tool: 'Bash', cmd: 'ls', expected: { action: 'allow', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'echo hello', expected: { action: 'allow', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'git push origin main', expected: { action: 'ask', source: 'builtin' }, note: '*git*push*' },
	{ tool: 'Bash', cmd: 'terraform apply', expected: { action: 'ask', source: 'builtin' }, note: 'catch-all ask Bash' },
	// Tool-name globs
	{ tool: 'mcp__filesystem', expected: { action: 'allow', source: 'builtin' } },
	{ tool: 'tb__notify_slack', expected: { action: 'allow', source: 'builtin' } },
	{ tool: 'finder', expected: { action: 'allow', source: 'builtin' } },
	// Unknown tool with no matching rule → default ask
	{ tool: 'totally_made_up_tool', expected: { action: 'ask', source: 'default' } },
]

let failures = 0
for (const c of cases) {
	const decision = decideWithTighteners(c.tool, c.cmd)
	const ok = decision.action === c.expected.action && decision.source === c.expected.source
	if (!ok) {
		failures += 1
		console.error(`FAIL ${c.tool}${c.cmd ? ` :: ${c.cmd}` : ''}`)
		console.error(`  expected: ${c.expected.action} (${c.expected.source})`)
		console.error(`  actual:   ${decision.action} (${decision.source})${decision.rule ? ` rule=${JSON.stringify(decision.rule)}` : ''}`)
		continue
	}
	console.log(`PASS ${c.tool}${c.cmd ? ` :: ${c.cmd}` : ''}`)
}

if (failures > 0) {
	process.exit(1)
}
