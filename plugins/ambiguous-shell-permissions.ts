import type { PluginAPI, ToolCallResult } from '@ampcode/plugin'

type Decision =
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

const SAFE_VERSION_FLAGS = new Set(['--version', '-V', '-v', '--help', '-h'])
const GH_READ_ONLY_GROUPS = new Set(['issue', 'pr', 'repo', 'release', 'run', 'workflow', 'label', 'milestone', 'project', 'gist'])
const GH_READ_ONLY_ACTIONS = new Set(['list', 'view', 'status', 'diff', 'checks'])
const GH_TOP_LEVEL_READ_ONLY_ACTIONS = new Set(['status', 'version', 'help'])

export default function (amp: PluginAPI) {
	amp.on('tool.call', async (event, ctx): Promise<ToolCallResult> => {
		const shell = amp.helpers.shellCommandFromToolCall(event)
		if (!shell) {
			return { action: 'allow' }
		}

		const decision = evaluateShellCommand(shell.command)
		if (decision.kind === 'allow') {
			return { action: 'allow' }
		}

		const message = `This shell command requires permission review: ${decision.reason}\n\nCommand:\n${shell.command}`
		try {
			const approved = await ctx.ui.confirm({
				title: 'Review ambiguous shell command',
				message,
				confirmButtonText: 'Allow command',
			})
			if (approved) {
				return { action: 'allow' }
			}
			return {
				action: 'reject-and-continue',
				message: `Command was not approved by the user. ${decision.reason}`,
			}
		} catch (error) {
			if (error instanceof Error && amp.helpers.isPluginUINotAvailableError(error)) {
				return {
					action: 'reject-and-continue',
					message: `Command requires permission review, but plugin UI is unavailable. ${decision.reason}`,
				}
			}
			throw error
		}
	})
}

export function evaluateShellCommand(command: string): Decision {
	const segments = splitShellSegments(command)
	for (const segment of segments) {
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

function evaluateSimpleCommand(tokens: string[], segment: string): Decision {
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

	if (command === 'find' || command === 'gfind') {
		return evaluateFind(args, segment)
	}

	return { kind: 'allow', reason: 'Command is not one of the guarded ambiguous shell tools.' }
}

function evaluatePython(args: string[], segment: string): Decision {
	if (args.length === 0) {
		return { kind: 'ask', reason: 'Python without arguments may open an interpreter and run arbitrary code.' }
	}

	if (isOnlySafeInfoFlags(args)) {
		return { kind: 'allow', reason: 'Python informational flag.' }
	}

	if (args[0] === '-m') {
		const moduleName = args[1]
		if (moduleName === 'py_compile' || moduleName === 'compileall') {
			return { kind: 'allow', reason: `Python syntax/bytecode check via -m ${moduleName}.` }
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

function evaluateShellInterpreter(command: string, args: string[], segment: string): Decision {
	if (args.length === 0) {
		return { kind: 'ask', reason: `${command} without arguments opens an interactive shell.` }
	}

	if (isOnlySafeInfoFlags(args)) {
		return { kind: 'allow', reason: `${command} informational flag.` }
	}

	if (args.includes('-n')) {
		return { kind: 'allow', reason: `${command} -n syntax check.` }
	}

	if (args.includes('-c') || args.some((arg) => arg.startsWith('-c'))) {
		return { kind: 'ask', reason: `${command} -c executes arbitrary inline shell code.` }
	}

	if (args.includes('-') || segment.includes('<<') || segment.includes('|')) {
		return { kind: 'ask', reason: `${command} reading from stdin can execute arbitrary code.` }
	}

	return { kind: 'ask', reason: `${command} script execution (${args[0]}) can run arbitrary shell code.` }
}

function evaluateNode(args: string[], segment: string): Decision {
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

function evaluateTerraform(args: string[]): Decision {
	const subcommand = terraformSubcommand(args)
	if (subcommand === 'validate') {
		return { kind: 'allow', reason: 'terraform validate is a read-only configuration validation command.' }
	}

	return { kind: 'allow', reason: 'Command is not a guarded terraform validation command.' }
}

function evaluateAmp(args: string[]): Decision {
	const subcommand = subcommandAfterGlobalFlags(args)
	if (subcommand === 'plugins' && args.includes('list')) {
		return { kind: 'allow', reason: 'amp plugins list only lists installed plugins.' }
	}

	return { kind: 'allow', reason: 'Command is not a guarded amp command.' }
}

function evaluateGit(args: string[]): Decision {
	const subcommand = subcommandAfterGlobalFlags(args)
	if (subcommand === 'status') {
		return { kind: 'allow', reason: 'git status is a read-only repository status command.' }
	}

	return { kind: 'allow', reason: 'Command is not a guarded git command.' }
}

function evaluateSed(command: string, args: string[], segment: string): Decision {
	if (segment.includes('>')) {
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

function evaluateGh(args: string[]): Decision {
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

	return { kind: 'ask', reason: `gh ${positional.join(' ') || '<unknown>'} is not in the read-only allowlist.` }
}

function evaluateFind(args: string[], segment: string): Decision {
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

		if (!quote && (char === ';' || char === '\n' || (char === '&' && next === '&') || (char === '|' && next === '|'))) {
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
