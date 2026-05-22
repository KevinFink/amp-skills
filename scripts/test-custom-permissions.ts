import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decide, type Rule } from '../plugins/custom-permissions/custom-permissions'
import { evaluateShellCommand } from '../plugins/custom-permissions/tighteners'

const repoRoot = resolve(import.meta.dir, '..')

const settings = JSON.parse(readFileSync(resolve(repoRoot, 'settings.json'), 'utf8')) as Record<string, unknown>
const userRules = (settings['amp.permissions'] as Rule[] | undefined) ?? []
const builtinRules = JSON.parse(readFileSync(resolve(repoRoot, 'plugins/custom-permissions/builtin-rules.json'), 'utf8')) as Rule[]

// Mirror the plugin's combined logic: rule cascade + heuristic tighteners.
function decideWithTighteners(tool: string, cmd: string | undefined, message?: string) {
	const normalizedMessage = message?.toLowerCase()
	const decision = decide(
		userRules,
		builtinRules,
		tool,
		cmd,
		message === undefined ? undefined : {
			message,
			gitCommitRequested: /\b(commit|committing|land|landing|ship|shipping)\b/.test(normalizedMessage ?? ''),
			gitLandingRequested: /\b(land|landing|ship|shipping|confirmed|confirm|approved|approve|yes|go ahead)\b/.test(normalizedMessage ?? ''),
		},
	)
	if (decision.action === 'allow' && decision.source === 'custom') {
		return decision
	}
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
	message?: string
	expected: { action: Rule['action'] | 'ask'; source: 'custom' | 'user' | 'builtin' | 'default' }
	note?: string
}

const cases: TestCase[] = [
	// User rules from settings.json win over built-in
	{ tool: 'Bash', cmd: 'git add foo', expected: { action: 'ask', source: 'default' } },
	{ tool: 'Bash', cmd: 'git add foo', message: 'commit', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'git commit -m "update"', expected: { action: 'ask', source: 'default' } },
	{ tool: 'Bash', cmd: 'git commit -m "update"', message: 'Please commit these changes', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'git -C ~/repo add foo && git -C ~/repo commit -m "update"', message: 'ship it', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'git push origin develop', message: 'confirmed', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'git -C ~/repo merge --ff-only feature', message: 'land it', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'git -C ~/repo worktree remove ../wt', message: 'confirmed', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'git push origin develop', message: 'status?', expected: { action: 'ask', source: 'builtin' } },
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
	{ tool: 'Bash', cmd: 'amp plugins show-docs', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: 'amp plugins show-docs custom-permissions', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'gh issue edit 249 --add-assignee @me --add-label status/in-progress --repo photoopapp/photoop-product 2>&1', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'gh issue edit 249 --remove-label status/in-progress --repo photoopapp/photoop-product', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'gh issue comment 249 --body "looks good" --repo photoopapp/photoop-product', expected: { action: 'allow', source: 'user' } },
	// shell_command tool (used by sub-agents/MCP) must hit the same user rules as Bash
	{ tool: 'shell_command', cmd: "sed -n '1,140p' app/main.py && sed -n '320,380p' app/main.py", expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'cat foo | head', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: 'cd ~/photoop-backend && rg "tickets_module\\." app/routes/sandwichboard_admin_tickets.py | head -30', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'terraform plan -out=plan.tfplan', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: './scripts/local_psql.sh -c "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema=\'sandwichboard\'"', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: '~/sandwichboard-backend/scripts/local_psql.sh -c "SELECT 1"', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: '~/sandwichboard-workflow/scripts/local_psql.sh --write -c "UPDATE x"', expected: { action: 'ask', source: 'default' }, note: 'user rule allows; tightener asks because of --write' },
	{ tool: 'shell_command', cmd: './scripts/local_psql.sh --write -c "UPDATE x"', expected: { action: 'ask', source: 'default' }, note: 'relative local_psql still asks with --write' },
	{ tool: 'Bash', cmd: '~/photoop-backend/scripts/local_psql.sh --write -c "UPDATE x"', expected: { action: 'ask', source: 'default' }, note: 'user rule allows; tightener asks because of --write' },
	{ tool: 'Bash', cmd: 'git worktree remove ../wt', expected: { action: 'ask', source: 'default' }, note: 'user rule allows git worktree *; tightener asks on `git worktree remove`' },
	{ tool: 'Bash', cmd: "sed -n '470,580p' ~/photoop-infrastructure/terraform/environments/prod/main.tf", expected: { action: 'allow', source: 'custom' } },
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
	// `|| true` shell idiom: each segment must be independently allowed
	{ tool: 'Bash', cmd: 'ls admin/ && ls admin/ingestion 2>/dev/null || true', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'true', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'false', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'sleep 20', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: 'sleep 20; tmux capture-pane -p -S -200 -t "sbw-scoring-cleanup" | tail -80', expected: { action: 'allow', source: 'custom' } },
	// Read-only service/local health inspection
	{ tool: 'Bash', cmd: 'cmp -s templates/report-image.html templates/report-image-email.html && echo identical', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: "systemctl list-units --type=service --all --no-pager | rg -i 'sandwich|workflow|worker|openresty|nginx'", expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: "systemctl list-unit-files --type=service --no-pager | rg -i 'sandwich|workflow|worker|openresty|nginx'", expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'systemctl is-active openresty sandwichboard-backend', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'curl -fsS http://localhost:8090/healthz || true', expected: { action: 'allow', source: 'user' } },
	// Bare read-only utilities (commonly used as pipe sinks)
	{ tool: 'Bash', cmd: 'grep -rln "ingestion_queue\\|_ingestion_queue_url\\|sandwichboard.*ingest\\|receive_message" ~/photoop-backend/ --include="*.py" 2>/dev/null | head', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'cat foo | head', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: "ls -R admin | sed -e 's/.*//g' | head && rg --files admin js css", expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: "sed -e 's/a/b/w out.txt' README.md", expected: { action: 'ask', source: 'default' }, note: 'user rule allows sed -e; tightener asks because script writes a file' },
	// rg/sort with args (no builtin allow, only `rg -<flags>` is allowed by builtin regex)
	{ tool: 'Bash', cmd: 'cd ~/photoop-backend && rg "tickets_module\\." app/routes/sandwichboard_admin_tickets.py | head -30', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'cd ~/photoop-backend && rg -h "^from app\\." app/services/foo.py 2>&1 | sort -u', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'echo a | sort | uniq -c', expected: { action: 'allow', source: 'user' } },
	// git -C <dir> read-only verbs
	{
		tool: 'Bash',
		cmd: 'git -C /home/ec2-user/worktrees/SandwichBoard/issue-98 status --short --branch && git -C /home/ec2-user/worktrees/SandwichBoard/issue-98 log --oneline -3',
		expected: { action: 'allow', source: 'user' },
	},
	{ tool: 'Bash', cmd: 'git -C ~/repo show HEAD', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'git -C ~/repo diff --stat', expected: { action: 'allow', source: 'user' } },
	// bash -n / sh -n syntax check (non-destructive)
	{ tool: 'Bash', cmd: 'bash -n ~/photoop-product/scripts/worktree-land.sh', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'sh -n ./script.sh', expected: { action: 'allow', source: 'user' } },
	// npx eslint is a safe lint command
	{ tool: 'Bash', cmd: 'npx eslint', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'npx eslint src --max-warnings=0', expected: { action: 'allow', source: 'custom' } },
	// tmux capture-pane is read-only inspection of a tmux pane
	{ tool: 'Bash', cmd: 'tmux capture-pane -p -t amp:0.0', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'tmux capture-pane', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'tmux capture-pane -p -S -120 -t RIGHT:sbw-discovery 2>&1 || true', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'tmux list-windows', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'tmux list-windows -t RIGHT', expected: { action: 'allow', source: 'custom' } },
	// gh repo view is read-only repository metadata inspection
	{ tool: 'Bash', cmd: 'gh repo view', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'gh repo view photoopapp/photoop-product --json name,owner', expected: { action: 'allow', source: 'custom' } },
	// gh label list is read-only label metadata inspection
	{ tool: 'Bash', cmd: 'gh label list', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'gh label list --repo photoopapp/photoop-product --limit 100', expected: { action: 'allow', source: 'custom' } },
	// gh pr list is read-only pull request metadata inspection
	{ tool: 'Bash', cmd: 'gh pr list', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: 'gh pr list --state all --repo photoopapp/photoop-product', expected: { action: 'allow', source: 'custom' } },
	// nl piped to sed -n is read-only file inspection with line numbers
	{ tool: 'Bash', cmd: 'nl README.md', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: "nl -ba js/admin-competitors.js | sed -n '520,620p'", expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: "nl -ba js/admin-competitors.js | sed -n '520,620p'", expected: { action: 'allow', source: 'custom' } },
	// Fixed curl GET piped to rg is read-only inspection of the admin marketing page
	{ tool: 'Bash', cmd: "curl -k -s https://wt-admin.sandwichboard.ai/marketing-site/ | rg 'admin-marketing-site|admin-sidebar'", expected: { action: 'allow', source: 'custom' } },
	{ tool: 'shell_command', cmd: "curl -k -s https://wt-admin.sandwichboard.ai/marketing-site/ | rg 'admin-marketing-site|admin-sidebar'", expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'curl -k -s https://sandwichboard.ai/status?check=1', expected: { action: 'allow', source: 'custom' } },
	{ tool: 'Bash', cmd: 'curl -k -s https://example.com/status', expected: { action: 'ask', source: 'builtin' } },
	{ tool: 'Bash', cmd: 'curl -k -s https://sandwichboard.ai/status > output.html', expected: { action: 'ask', source: 'builtin' } },
	// SandwichBoard worktree helper is an approved local workflow script
	{ tool: 'Bash', cmd: '~/SandwichBoard/scripts/worktree-start.sh SandwichBoard 123', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: '/home/ec2-user/SandwichBoard/scripts/worktree-start.sh sandwichboard-backend 456', expected: { action: 'allow', source: 'user' } },
	// SandwichBoard dev-server status is read-only; start/stop operations should still prompt.
	{ tool: 'shell_command', cmd: '~/SandwichBoard/scripts/dev-server.sh --status', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: '/home/ec2-user/SandwichBoard/scripts/dev-server.sh -s', expected: { action: 'allow', source: 'user' } },
	{ tool: 'shell_command', cmd: '~/SandwichBoard/scripts/dev-server.sh --stop', expected: { action: 'ask', source: 'builtin' } },
	// bare `git remote` (no -C)
	{ tool: 'Bash', cmd: 'git remote -v', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'git remote', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'git remote get-url origin', expected: { action: 'allow', source: 'user' } },
	// pgrep as read-only utility
	{
		tool: 'Bash',
		cmd: 'aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/247688347937/sbw-prod-ingestion --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible 2>&1 | grep Approx\necho "---workers running:"\npgrep -af "app.workers.ingestion" 2>&1 | grep -v grep | head\necho "---recent backend log:"\ntail -5 ~/sb-backend.log',
		expected: { action: 'allow', source: 'user' },
	},
	// jq as pipe sink
	{ tool: 'Bash', cmd: `gh issue list --repo photoopapp/photoop-product --state open --json number,title,labels --limit 100 | jq -r '.[] | select((.title|test("OpenRouter|sync";"i"))) | "#\\(.number) \\(.title)"'`, expected: { action: 'allow', source: 'user' } },
	// for-loop with safe body
	{
		tool: 'Bash',
		cmd: 'cd ~/worktrees/photoop-infrastructure/issue-93 && for f in nginx/a.conf nginx/b.conf; do\n  echo "=== $f ==="\n  grep -n "location\\|proxy_pass" "$f" | head -20\ndone',
		expected: { action: 'allow', source: 'user' },
	},
	// python -m py_compile / compileall: bytecode/syntax check is safe
	{ tool: 'Bash', cmd: 'cd ~/worktrees/sandwichboard-workflow/issue-94 && python3 -m py_compile app/config.py app/discovery/llm_payload_store.py && echo OK', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'python -m py_compile foo.py', expected: { action: 'allow', source: 'user' } },
	{ tool: 'Bash', cmd: 'python3 -m compileall app/', expected: { action: 'allow', source: 'user' } },
	// for-loop with destructive body must still ask (single-line: `do rm -rf $x`)
	{ tool: 'Bash', cmd: 'for x in *; do rm -rf $x; done', expected: { action: 'ask', source: 'builtin' } },
	// for-loop iteration list with command substitution: single-line `do <cmd>` is asked by builtin `do *`,
	// so dangerous payload never gets to slip through.
	{ tool: 'Bash', cmd: 'for x in $(rm -rf /); do echo $x; done', expected: { action: 'ask', source: 'builtin' } },
	// notify-slack pipeline: printf segment + bare tool path segment
	{
		tool: 'Bash',
		cmd: "printf 'status: completed\\nsummary: Did the thing.\\n' | /home/ec2-user/amp-skills/skills/notify-slack/toolbox/notify-slack",
		expected: { action: 'allow', source: 'user' },
	},
	{
		tool: 'shell_command',
		cmd: "printf 'status: needs_attention\\nsummary: Need input.\\n' | /home/ec2-user/amp-skills/skills/notify-slack/toolbox/notify-slack",
		expected: { action: 'allow', source: 'user' },
	},
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
	const decision = decideWithTighteners(c.tool, c.cmd, c.message)
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
