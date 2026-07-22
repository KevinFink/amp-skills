/**
 * Tighteners: heuristics that look at a shell command and decide whether the
 * permissions plugin should ask the user even if the rule cascade would
 * otherwise allow it (e.g., `python -c`, `sed -i`, `find -delete`,
 * `git worktree remove`, `local_psql.sh --write`).
 *
 * Imported by ./custom-permissions.ts so we have a single plugin (and a
 * single confirm modal) instead of two parallel plugins both prompting.
 */
export type TightenerDecision =
	| { kind: 'allow'; reason: string }
	| { kind: 'ask'; reason: string }

const PYTHON_COMMANDS = new Set(['python', 'python3', 'python2', 'py'])
const SHELL_COMMANDS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const NODE_COMMANDS = new Set(['node', 'nodejs'])
const TERRAFORM_COMMANDS = new Set(['terraform'])
const AMP_COMMANDS = new Set(['amp'])
const GIT_COMMANDS = new Set(['git'])
const SED_COMMANDS = new Set(['sed', 'gsed'])
const GH_COMMANDS = new Set(['gh'])
const AWS_COMMANDS = new Set(['aws'])
const DESTRUCTIVE_FILESYSTEM_COMMANDS = new Set(['rm', 'rmdir', 'unlink'])
const AWS_READ_ONLY_VERBS = ['list-', 'describe-', 'get-', 'show-', 'head-']
const AWS_READ_ONLY_ACTIONS = new Set(['scan', 'ls', 'help'])

const SAFE_VERSION_FLAGS = new Set(['--version', '-V', '-v', '--help', '-h'])
const GH_READ_ONLY_GROUPS = new Set(['issue', 'pr', 'repo', 'release', 'run', 'workflow', 'label', 'milestone', 'project', 'gist'])
const GH_READ_ONLY_ACTIONS = new Set(['list', 'view', 'status', 'diff', 'checks'])
const GH_TOP_LEVEL_READ_ONLY_ACTIONS = new Set(['status', 'version', 'help'])

export function evaluateShellCommand(command: string): TightenerDecision {
	const segments = splitShellSegments(command)
	for (const segment of segments) {
		const substitutionCheck = checkForCommandSubstitution(segment)
		if (substitutionCheck.kind === 'ask') {
			return substitutionCheck
		}

		const subshellCheck = checkForSubshell(segment)
		if (subshellCheck.kind === 'ask') {
			return subshellCheck
		}

		const tokens = tokenizeShell(segment)
		if (tokens.length === 0) {
			continue
		}

		const decision = evaluateSimpleCommand(tokens, segment)
		if (decision.kind === 'ask') {
			return decision
		}
	}

	return { kind: 'allow', reason: 'No ambiguous interpreter or destructive find usage detected.' }
}

function checkForCommandSubstitution(segment: string): TightenerDecision {
	let quote: 'single' | 'double' | null = null
	let escaped = false
	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index]
		const next = segment[index + 1]

		if (escaped) {
			escaped = false
			continue
		}
		if (char === '\\' && quote !== 'single') {
			escaped = true
			continue
		}
		if (char === "'" && quote !== 'double') {
			quote = quote === 'single' ? null : 'single'
			continue
		}
		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double'
			continue
		}
		if (quote === 'single') {
			continue
		}
		if (char === '$' && next === '(') {
			const end = findCommandSubstitutionEnd(segment, index)
			if (end === -1) {
				return { kind: 'ask', reason: 'Unterminated command substitution `$(...)`.' }
			}
			const innerCommand = segment.slice(index + 2, end)
			const innerDecision = evaluateShellCommand(innerCommand)
			if (innerDecision.kind === 'ask') {
				return { kind: 'ask', reason: `Command substitution \`$(...)\` contains guarded command: ${innerDecision.reason}` }
			}
			index = end
			continue
		}
		if (char === '`') {
			return { kind: 'ask', reason: 'Backtick command substitution can execute arbitrary code.' }
		}
		if (char === '<' && next === '(') {
			return { kind: 'ask', reason: 'Process substitution `<(...)` can execute arbitrary code.' }
		}
		if (char === '>' && next === '(') {
			return { kind: 'ask', reason: 'Process substitution `>(...)` can execute arbitrary code.' }
		}
	}
	return { kind: 'allow', reason: 'No command/process substitution found.' }
}

function checkForSubshell(segment: string): TightenerDecision {
	const trimmed = segment.trimStart()
	if (/^\(crontab -l(?:\s|$)/.test(trimmed)) {
		return { kind: 'allow', reason: 'Parenthesized crontab -l fallback is read-only cron inspection.' }
	}
	if (trimmed.startsWith('(') || trimmed.startsWith('{ ')) {
		return { kind: 'ask', reason: 'Subshell or grouping wraps a command and bypasses per-command checks.' }
	}
	return { kind: 'allow', reason: 'Segment is not a subshell or grouping.' }
}

function evaluateSimpleCommand(tokens: string[], segment: string): TightenerDecision {
	// Skip leading shell env-var assignments (e.g. `AWS_PROFILE=photoop`,
	// `FOO="a b"`) so the next interpreter check sees the real command name.
	let envStripped = 0
	while (envStripped < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[envStripped])) {
		envStripped += 1
	}
	if (envStripped > 0) {
		if (envStripped === tokens.length) {
			return { kind: 'allow', reason: 'Only env-var assignments, no command to evaluate.' }
		}
		return evaluateSimpleCommand(tokens.slice(envStripped), segment)
	}

	const command = basename(tokens[0])
	const args = tokens.slice(1)

	if (command === 'env' || command === 'command' || command === 'sudo' || command === 'uv' || command === 'bun' || command === 'npx') {
		const nested = stripWrapper(tokens)
		if (nested.length !== tokens.length) {
			return evaluateSimpleCommand(nested, segment)
		}
	}

	if (PYTHON_COMMANDS.has(command)) {
		return evaluatePython(args, segment)
	}

	if (SHELL_COMMANDS.has(command)) {
		return evaluateShellInterpreter(command, args, segment)
	}

	if (NODE_COMMANDS.has(command)) {
		return evaluateNode(args, segment)
	}

	if (TERRAFORM_COMMANDS.has(command)) {
		return evaluateTerraform(args)
	}

	if (AMP_COMMANDS.has(command)) {
		return evaluateAmp(args)
	}

	if (GIT_COMMANDS.has(command)) {
		return evaluateGit(args)
	}

	if (SED_COMMANDS.has(command)) {
		return evaluateSed(command, args, segment)
	}

	if (GH_COMMANDS.has(command)) {
		return evaluateGh(args)
	}

	if (AWS_COMMANDS.has(command)) {
		return evaluateAws(args)
	}

	if (DESTRUCTIVE_FILESYSTEM_COMMANDS.has(command)) {
		return { kind: 'ask', reason: `${command} can delete files or directories.` }
	}

	if (command === 'find' || command === 'gfind') {
		return evaluateFind(args, segment)
	}

	if (isLocalPsqlScript(tokens[0])) {
		return evaluateLocalPsql(args)
	}

	return { kind: 'allow', reason: 'Command is not one of the guarded ambiguous shell tools.' }
}

function isLocalPsqlScript(path: string): boolean {
	return path === './scripts/local_psql.sh'
		|| path === 'scripts/local_psql.sh'
		|| path === '~/photoop-backend/scripts/local_psql.sh'
		|| path === '/home/ec2-user/photoop-backend/scripts/local_psql.sh'
		|| path === '~/sandwichboard-backend/scripts/local_psql.sh'
		|| path === '/home/ec2-user/sandwichboard-backend/scripts/local_psql.sh'
		|| path === '~/sandwichboard-workflow/scripts/local_psql.sh'
		|| path === '/home/ec2-user/sandwichboard-workflow/scripts/local_psql.sh'
}

function evaluateLocalPsql(args: string[]): TightenerDecision {
	if (args.includes('--write')) {
		return { kind: 'ask', reason: 'local_psql.sh --write allows DDL/DML and can mutate the database.' }
	}
	return { kind: 'allow', reason: 'local_psql.sh without --write is read-only.' }
}

function evaluatePython(args: string[], segment: string): TightenerDecision {
	if (args.length === 0) {
		return { kind: 'ask', reason: 'Python without arguments may open an interpreter and run arbitrary code.' }
	}

	if (isOnlySafeInfoFlags(args)) {
		return { kind: 'allow', reason: 'Python informational flag.' }
	}

	if (isRepoPythonScriptHelp(args)) {
		return { kind: 'allow', reason: 'Python repo script help output is expected to be side-effect free.' }
	}

	if (isSafePythonPackageVersionProbe(args)) {
		return { kind: 'allow', reason: 'Python inline code is limited to printing six package file/version metadata.' }
	}

	if (args[0] === '-m') {
		const moduleName = args[1]
		if (moduleName === 'py_compile' || moduleName === 'compileall') {
			return { kind: 'allow', reason: `Python syntax/bytecode check via -m ${moduleName}.` }
		}
		if (moduleName === 'ruff' && args[2] === 'format') {
			return { kind: 'allow', reason: 'Python module execution is limited to ruff format.' }
		}
		return { kind: 'ask', reason: `Python module execution (-m ${moduleName ?? '<missing module>'}) can run arbitrary code.` }
	}

	if (args.includes('-c') || args.some((arg) => arg.startsWith('-c'))) {
		return { kind: 'ask', reason: 'Python -c executes arbitrary inline code.' }
	}

	if (args.includes('-') || segment.includes('<<') || segment.includes('|')) {
		return { kind: 'ask', reason: 'Python reading from stdin can execute arbitrary code.' }
	}

	return { kind: 'ask', reason: `Python script execution (${args[0]}) can run arbitrary code.` }
}

function isRepoPythonScriptHelp(args: string[]): boolean {
	const scriptIndex = args.findIndex((arg) => /^(\.\/)?scripts\/[A-Za-z0-9._-]+\.py$/.test(arg))
	if (scriptIndex === -1) {
		return false
	}
	return args.slice(scriptIndex + 1).includes('--help') || args.slice(scriptIndex + 1).includes('-h')
}

function isSafePythonPackageVersionProbe(args: string[]): boolean {
	return args.length === 2
		&& args[0] === '-c'
		&& args[1] === 'import six, importlib.metadata; print(six.__file__); print(importlib.metadata.version("six"))'
}

function evaluateShellInterpreter(command: string, args: string[], segment: string): TightenerDecision {
	if (args.length === 0) {
		return { kind: 'ask', reason: `${command} without arguments opens an interactive shell.` }
	}

	if (isOnlySafeInfoFlags(args)) {
		return { kind: 'allow', reason: `${command} informational flag.` }
	}

	if (args.includes('-n')) {
		return { kind: 'allow', reason: `${command} -n syntax check.` }
	}

	if (isRuntimeEnvInspectionShellCommand(command, segment)) {
		return { kind: 'allow', reason: 'Shell command only sources runtime env and prints approved non-secret variable names.' }
	}

	if (isReadOnlyAwsShellCommand(command, segment)) {
		return { kind: 'allow', reason: 'Shell command wraps a read-only AWS CLI inspection command.' }
	}

	if (args.includes('-c') || args.some((arg) => arg.startsWith('-c'))) {
		return { kind: 'ask', reason: `${command} -c executes arbitrary inline shell code.` }
	}

	if (args.includes('-') || segment.includes('<<') || segment.includes('|')) {
		return { kind: 'ask', reason: `${command} reading from stdin can execute arbitrary code.` }
	}

	return { kind: 'ask', reason: `${command} script execution (${args[0]}) can run arbitrary shell code.` }
}

function isRuntimeEnvInspectionShellCommand(command: string, segment: string): boolean {
	if (command !== 'bash') {
		return false
	}
	return segment === 'bash -lc \'source scripts/load_runtime_env.sh >/dev/null && env | rg "^(SBW_RENDER|SBW_AEO|AWS_REGION|DB_HOST|DB_NAME|DB_USER)="\''
		|| segment === "bash -lc \"source /home/ec2-user/sandwichboard-workflow/scripts/load_runtime_env.sh >/dev/null; env | rg 'UPLOAD|QUEUE|SQS|ENVIRONMENT|SBW' | sed -E 's/(KEY|SECRET|TOKEN|PASSWORD)=.*/\\1=<redacted>/'\""
}

function isReadOnlyAwsShellCommand(command: string, segment: string): boolean {
	if (command !== 'bash') {
		return false
	}
	const match = /^bash -lc (["'])(aws [^"'`$;&|()<>\r\n]+)\1$/.exec(segment)
	if (!match) {
		return false
	}
	return evaluateShellCommand(match[2]).kind === 'allow'
}

function evaluateNode(args: string[], segment: string): TightenerDecision {
	if (args.length === 0) {
		return { kind: 'ask', reason: 'Node without arguments opens a REPL that can run arbitrary code.' }
	}

	if (isOnlySafeInfoFlags(args)) {
		return { kind: 'allow', reason: 'Node informational flag.' }
	}

	if (args.includes('--check') || args.includes('-c')) {
		return { kind: 'allow', reason: 'Node syntax check.' }
	}

	if (args.includes('-e') || args.includes('--eval') || args.some((arg) => arg.startsWith('-e'))) {
		return { kind: 'ask', reason: 'Node eval executes arbitrary inline JavaScript.' }
	}

	if (args.includes('-') || segment.includes('<<') || segment.includes('|')) {
		return { kind: 'ask', reason: 'Node reading from stdin can execute arbitrary JavaScript.' }
	}

	return { kind: 'ask', reason: `Node script execution (${args[0]}) can run arbitrary JavaScript.` }
}

function evaluateTerraform(args: string[]): TightenerDecision {
	const subcommand = terraformSubcommand(args)
	if (subcommand === 'validate') {
		return { kind: 'allow', reason: 'terraform validate is a read-only configuration validation command.' }
	}

	return { kind: 'allow', reason: 'Command is not a guarded terraform validation command.' }
}

function evaluateAmp(args: string[]): TightenerDecision {
	const subcommand = subcommandAfterGlobalFlags(args)
	if (subcommand === 'plugins' && args.includes('list')) {
		return { kind: 'allow', reason: 'amp plugins list only lists installed plugins.' }
	}
	if (subcommand === 'plugins' && args.includes('show-docs')) {
		return { kind: 'allow', reason: 'amp plugins show-docs only displays plugin documentation.' }
	}

	return { kind: 'allow', reason: 'Command is not a guarded amp command.' }
}

function evaluateGit(args: string[]): TightenerDecision {
	const positional = gitPositionals(args)
	const subcommand = positional[0]
	if (subcommand === 'status') {
		return { kind: 'allow', reason: 'git status is a read-only repository status command.' }
	}

	if (subcommand === 'worktree' && positional[1] === 'remove') {
		return { kind: 'ask', reason: 'git worktree remove deletes a worktree and can lose uncommitted work.' }
	}

	return { kind: 'allow', reason: 'Command is not a guarded git command.' }
}

function gitPositionals(args: string[]): string[] {
	const positionals: string[] = []
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === '--') {
			positionals.push(...args.slice(index + 1))
			break
		}
		if (arg === '-C' || arg === '-c') {
			index += 1
			continue
		}
		if (arg.startsWith('-')) {
			continue
		}
		positionals.push(arg)
	}
	return positionals
}

function evaluateSed(command: string, args: string[], segment: string): TightenerDecision {
	if (hasUnsafeOutputRedirection(segment)) {
		return { kind: 'ask', reason: `${command} output redirection can write files.` }
	}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (isSedInPlaceFlag(arg)) {
			return { kind: 'ask', reason: `${command} ${arg} edits files in place.` }
		}

		if (arg === '-e' || arg === '--expression') {
			const script = args[index + 1]
			if (script && sedScriptCanWriteOrExecute(script)) {
				return { kind: 'ask', reason: `${command} script can write files or execute commands.` }
			}
			index += 1
			continue
		}

		if (arg.startsWith('--expression=')) {
			const script = arg.slice('--expression='.length)
			if (sedScriptCanWriteOrExecute(script)) {
				return { kind: 'ask', reason: `${command} script can write files or execute commands.` }
			}
			continue
		}

		if (arg === '-f' || arg === '--file' || arg.startsWith('--file=')) {
			return { kind: 'ask', reason: `${command} loads a sed script from a file that may write files or execute commands.` }
		}

		if (arg.startsWith('-')) {
			continue
		}

		if (sedScriptCanWriteOrExecute(arg)) {
			return { kind: 'ask', reason: `${command} script can write files or execute commands.` }
		}

		return { kind: 'allow', reason: `${command} command does not use in-place editing, script files, or write/execute sed commands.` }
	}

	return { kind: 'allow', reason: `${command} command does not use in-place editing, script files, or write/execute sed commands.` }
}

function evaluateGh(args: string[]): TightenerDecision {
	const positional = ghPositionals(args)
	const groupOrAction = positional[0]
	const action = positional[1]

	if (!groupOrAction) {
		return { kind: 'ask', reason: 'gh without a read-only subcommand may perform authenticated GitHub actions.' }
	}

	if (GH_TOP_LEVEL_READ_ONLY_ACTIONS.has(groupOrAction)) {
		return { kind: 'allow', reason: `gh ${groupOrAction} is read-only.` }
	}

	if (GH_READ_ONLY_GROUPS.has(groupOrAction) && action && GH_READ_ONLY_ACTIONS.has(action)) {
		return { kind: 'allow', reason: `gh ${groupOrAction} ${action} is read-only.` }
	}

	if (groupOrAction === 'issue' && action === 'edit' && ghIssueEditUsesOnlySafeFlags(args)) {
		return { kind: 'allow', reason: 'gh issue edit only adjusts assignees/labels.' }
	}

	if (groupOrAction === 'issue' && action === 'create') {
		return { kind: 'allow', reason: 'gh issue create is explicitly allowed by user policy.' }
	}

	if (groupOrAction === 'issue' && action === 'comment') {
		return { kind: 'allow', reason: 'gh issue comment is explicitly allowed by user policy.' }
	}

	return { kind: 'ask', reason: `gh ${positional.join(' ') || '<unknown>'} is not in the read-only allowlist.` }
}

const GH_ISSUE_EDIT_SAFE_FLAGS = new Set([
	'--add-assignee',
	'--remove-assignee',
	'--add-label',
	'--remove-label',
	'--add-project',
	'--remove-project',
	'-R',
	'--repo',
	'--hostname',
])

function ghIssueEditUsesOnlySafeFlags(args: string[]): boolean {
	// Skip 'issue' and 'edit' positionals, then ensure remaining tokens are
	// either issue numbers or safe flag/value pairs.
	const skipped = skipGhIssueEditHeader(args)
	for (let index = 0; index < skipped.length; index += 1) {
		const arg = skipped[index]
		if (!arg.startsWith('-')) {
			continue
		}
		const [flag] = arg.split('=', 1)
		if (!GH_ISSUE_EDIT_SAFE_FLAGS.has(flag)) {
			return false
		}
		if (!arg.includes('=')) {
			index += 1
		}
	}
	return true
}

function skipGhIssueEditHeader(args: string[]): string[] {
	let seenIssue = false
	let seenEdit = false
	const result: string[] = []
	for (const arg of args) {
		if (!seenIssue && arg === 'issue') {
			seenIssue = true
			continue
		}
		if (seenIssue && !seenEdit && arg === 'edit') {
			seenEdit = true
			continue
		}
		result.push(arg)
	}
	return result
}

function evaluateAws(args: string[]): TightenerDecision {
	// AWS CLI structure: `aws [global-flags] <service> <action> [args]`.
	// We require the *action* token (third positional after `aws`) to be a
	// known read-only verb, otherwise something like `aws s3 cp local list-X`
	// would slip past a glob like `aws * list-*`.
	const positionals = awsPositionals(args)
	const action = positionals[1]
	if (!action) {
		return { kind: 'ask', reason: 'aws invocation has no action positional to verify as read-only.' }
	}
	if (AWS_READ_ONLY_ACTIONS.has(action)) {
		return { kind: 'allow', reason: `aws ${positionals[0]} ${action} is a known read-only action.` }
	}
	for (const verb of AWS_READ_ONLY_VERBS) {
		if (action.startsWith(verb)) {
			return { kind: 'allow', reason: `aws ${positionals[0]} ${action} is a read-only ${verb}* action.` }
		}
	}
	return { kind: 'ask', reason: `aws ${positionals.slice(0, 2).join(' ')} is not a known read-only action.` }
}

function awsPositionals(args: string[]): string[] {
	// AWS global flags that take a value
	const valueFlags = new Set([
		'--profile', '--region', '--endpoint-url', '--ca-bundle', '--cli-read-timeout', '--cli-connect-timeout',
		'--output', '--query', '--color', '--cli-binary-format', '--cli-auto-prompt',
	])
	const positionals: string[] = []
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === '--') {
			positionals.push(...args.slice(index + 1))
			break
		}
		if (arg.startsWith('--') && arg.includes('=')) {
			continue
		}
		if (valueFlags.has(arg)) {
			index += 1
			continue
		}
		if (arg.startsWith('-')) {
			continue
		}
		positionals.push(arg)
	}
	return positionals
}

function evaluateFind(args: string[], segment: string): TightenerDecision {
	const dangerous = args.find((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg))
	if (dangerous) {
		return { kind: 'ask', reason: `find ${dangerous} can modify files or run arbitrary commands.` }
	}

	if (/\bfind\b[\s\S]*(?:;|&&|\|\|)\s*(?:rm|mv|chmod|chown|truncate)\b/.test(segment)) {
		return { kind: 'ask', reason: 'find output is combined with a potentially destructive command.' }
	}

	return { kind: 'allow', reason: 'find command has no destructive primary such as -delete or -exec.' }
}

function isOnlySafeInfoFlags(args: string[]): boolean {
	return args.length > 0 && args.every((arg) => SAFE_VERSION_FLAGS.has(arg))
}

function terraformSubcommand(args: string[]): string | undefined {
	return subcommandAfterGlobalFlags(args)
}

function subcommandAfterGlobalFlags(args: string[]): string | undefined {
	for (const arg of args) {
		if (arg === '--') {
			continue
		}
		if (arg.startsWith('-')) {
			continue
		}
		return arg
	}

	return undefined
}

function isSedInPlaceFlag(arg: string): boolean {
	return arg === '--in-place' || arg.startsWith('--in-place=') || /^-[A-Za-z]*i/.test(arg)
}

function hasUnsafeOutputRedirection(segment: string): boolean {
	let quote: 'single' | 'double' | null = null
	let escaped = false

	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index]

		if (escaped) {
			escaped = false
			continue
		}

		if (char === '\\' && quote !== 'single') {
			escaped = true
			continue
		}

		if (char === "'" && quote !== 'double') {
			quote = quote === 'single' ? null : 'single'
			continue
		}

		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double'
			continue
		}

		if (quote || char !== '>') {
			continue
		}

		if (segment[index + 1] === '(') {
			return true
		}

		const target = outputRedirectionTarget(segment, index)
		if (target !== '/dev/null' && target !== '&1' && target !== '&2') {
			return true
		}
	}

	return false
}

function outputRedirectionTarget(segment: string, redirectionIndex: number): string {
	let cursor = redirectionIndex + 1
	if (segment[cursor] === '>') {
		cursor += 1
	}
	while (/\s/.test(segment[cursor] ?? '')) {
		cursor += 1
	}
	let target = ''
	while (cursor < segment.length && !/\s/.test(segment[cursor])) {
		target += segment[cursor]
		cursor += 1
	}
	return target
}

function sedScriptCanWriteOrExecute(script: string): boolean {
	const withoutEscapes = script.replace(/\\./g, '')
	return /(^|[;{}\s])e(\s|;|$)/.test(withoutEscapes) || /(^|[;{}\s])w(\s|;|$)/.test(withoutEscapes) || sedSubstitutionCanWriteOrExecute(script)
}

function sedSubstitutionCanWriteOrExecute(script: string): boolean {
	for (let index = 0; index < script.length; index += 1) {
		const previous = script[index - 1]
		if (script[index] !== 's' || (previous && !/[;{}\s]/.test(previous))) {
			continue
		}

		const delimiter = script[index + 1]
		if (!delimiter || /[A-Za-z0-9\s\\]/.test(delimiter)) {
			continue
		}

		let cursor = index + 2
		for (let delimitersSeen = 0; cursor < script.length && delimitersSeen < 2; cursor += 1) {
			if (script[cursor] === '\\') {
				cursor += 1
				continue
			}
			if (script[cursor] === delimiter) {
				delimitersSeen += 1
			}
		}

		let flags = ''
		while (cursor < script.length && !/[;{}\s]/.test(script[cursor])) {
			flags += script[cursor]
			cursor += 1
		}

		if (flags.includes('e') || flags.includes('w')) {
			return true
		}
	}

	return false
}

function ghPositionals(args: string[]): string[] {
	const positionals: string[] = []
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === '--') {
			positionals.push(...args.slice(index + 1))
			break
		}

		if (arg.startsWith('--repo=') || arg.startsWith('--hostname=')) {
			continue
		}
		if (arg === '-R' || arg === '--repo' || arg === '--hostname') {
			index += 1
			continue
		}

		if (arg.startsWith('-')) {
			continue
		}

		positionals.push(arg)
	}

	return positionals
}

function basename(path: string): string {
	return path.split('/').pop() ?? path
}

function stripWrapper(tokens: string[]): string[] {
	const command = basename(tokens[0])
	if (command === 'env') {
		let index = 1
		while (index < tokens.length) {
			const token = tokens[index]
			if (token === '--') {
				index += 1
				break
			}
			if (token.includes('=') && !token.startsWith('-')) {
				index += 1
				continue
			}
			if (token.startsWith('-')) {
				index += 1
				continue
			}
			break
		}
		return tokens.slice(index)
	}

	if (command === 'command' || command === 'sudo') {
		if (command === 'command' && (tokens[1] === '-v' || tokens[1] === '-V')) {
			return tokens
		}

		let index = 1
		while (index < tokens.length && tokens[index].startsWith('-')) {
			index += 1
		}
		return tokens.slice(index)
	}

	if (command === 'uv' && tokens[1] === 'run') {
		let index = 2
		while (index < tokens.length && tokens[index].startsWith('-')) {
			index += 1
		}
		return tokens.slice(index)
	}

	if ((command === 'bun' || command === 'npx') && tokens.length > 1) {
		return tokens.slice(1)
	}

	return tokens
}

function splitShellSegments(command: string): string[] {
	const segments: string[] = []
	let current = ''
	let quote: 'single' | 'double' | null = null
	let escaped = false

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index]
		const next = command[index + 1]

		if (escaped) {
			current += char
			escaped = false
			continue
		}

		if (char === '\\' && quote !== 'single') {
			current += char
			escaped = true
			continue
		}

		if (char === "'" && quote !== 'double') {
			quote = quote === 'single' ? null : 'single'
			current += char
			continue
		}

		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double'
			current += char
			continue
		}

		if (quote !== 'single' && char === '$' && next === '(') {
			const end = findCommandSubstitutionEnd(command, index)
			if (end !== -1) {
				current += command.slice(index, end + 1)
				index = end
				continue
			}
		}

		if (!quote && isSegmentDelimiter(char, next, command, index)) {
			if (current.trim()) {
				segments.push(current.trim())
			}
			current = ''
			if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
				index += 1
			}
			continue
		}

		current += char
	}

	if (current.trim()) {
		segments.push(current.trim())
	}

	return segments
}

function isSegmentDelimiter(char: string, next: string | undefined, command: string, index: number): boolean {
	if (char === ';' || char === '\n') {
		return true
	}
	if (char === '&' && next === '&') {
		return true
	}
	if (char === '|' && next === '|') {
		return true
	}
	if (char === '|' && next !== '|') {
		const prevNonSpace = previousNonSpaceChar(command, index)
		if (prevNonSpace === '>' || prevNonSpace === '<' || prevNonSpace === '|') {
			return false
		}
		return true
	}
	return false
}

function previousNonSpaceChar(command: string, index: number): string | undefined {
	for (let i = index - 1; i >= 0; i -= 1) {
		const char = command[i]
		if (char !== ' ' && char !== '\t') {
			return char
		}
	}
	return undefined
}

function findCommandSubstitutionEnd(command: string, startIndex: number): number {
	let quote: 'single' | 'double' | null = null
	let escaped = false
	let depth = 1

	for (let index = startIndex + 2; index < command.length; index += 1) {
		const char = command[index]
		const next = command[index + 1]

		if (escaped) {
			escaped = false
			continue
		}

		if (char === '\\' && quote !== 'single') {
			escaped = true
			continue
		}

		if (char === "'" && quote !== 'double') {
			quote = quote === 'single' ? null : 'single'
			continue
		}

		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double'
			continue
		}

		if (quote === 'single') {
			continue
		}

		if (char === '$' && next === '(') {
			depth += 1
			index += 1
			continue
		}

		if (!quote && char === ')') {
			depth -= 1
			if (depth === 0) {
				return index
			}
		}
	}

	return -1
}

function tokenizeShell(segment: string): string[] {
	const tokens: string[] = []
	let current = ''
	let quote: 'single' | 'double' | null = null
	let escaped = false

	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index]

		if (escaped) {
			current += char
			escaped = false
			continue
		}

		if (char === '\\' && quote !== 'single') {
			escaped = true
			continue
		}

		if (char === "'" && quote !== 'double') {
			quote = quote === 'single' ? null : 'single'
			continue
		}

		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double'
			continue
		}

		if (!quote && /\s/.test(char)) {
			if (current) {
				tokens.push(current)
				current = ''
			}
			continue
		}

		current += char
	}

	if (current) {
		tokens.push(current)
	}

	return tokens
}
