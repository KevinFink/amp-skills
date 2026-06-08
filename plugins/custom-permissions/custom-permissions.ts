/**
 * Custom permissions plugin.
 *
 * Replaces Amp's legacy permissions plugin so every prompt uses the plugin
 * UI. To activate it, you must:
 *   1. Set `amp.dangerouslyAllowAll: true` in settings.json so the legacy
 *      plugin loads but allows everything (suppressing its own prompts).
 *   2. Symlink this file into ~/.config/amp/plugins/.
 *
 * It evaluates rules in order:
 *   1. User rules from `amp.permissions` (still read from settings.json).
 *   2. Built-in rules snapshotted in builtin-rules.json (refresh with
 *      ./scripts/refresh-builtin-permissions.sh).
 *
 * Match semantics mirror Amp's: `tool` and `matches.cmd`/`matches.command`
 * accept globs (`*`) or `/regex/`. First match wins. If no rule matches,
 * the user is asked via the plugin's confirm modal.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginAPI, ThreadID, ToolCallResult } from '@ampcode/plugin'
import builtinRulesData from './builtin-rules.json' with { type: 'json' }
import { installThreadWaitStatus } from './thread-wait-status'
import { THREAD_TITLE_STATUSES, ThreadTitleStatusManager } from './thread-title-status'
import { evaluateShellCommand } from './tighteners'

export type Action = 'allow' | 'ask' | 'reject' | 'delegate'

export interface Rule {
	tool: string
	action: Action
	matches?: { cmd?: string | string[]; command?: string | string[] }
	to?: string
}

export interface Decision {
	action: Action
	rule: Rule | null
	source: 'custom' | 'user' | 'builtin' | 'default'
	reason?: string
}

export interface TurnIntent {
	message: string
	gitCommitRequested: boolean
	gitLandingRequested: boolean
}

const BUILTIN_RULES = builtinRulesData as Rule[]
const CUSTOM_RULES: Rule[] = [
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ['npx eslint', 'npx eslint *', 'npx --yes eslint', 'npx --yes eslint *'] },
		action: 'allow',
	},
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ['tmux capture-pane', 'tmux capture-pane *', 'tmux list-windows', 'tmux list-windows *'] },
		action: 'allow',
	},
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ['gh repo view', 'gh repo view *'] },
		action: 'allow',
	},
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ['gh label list', 'gh label list *'] },
		action: 'allow',
	},
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ['gh pr list', 'gh pr list *'] },
		action: 'allow',
	},
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ['nl', 'nl *', 'sed -n *'] },
		action: 'allow',
	},
	{
		tool: '/^(Bash|shell_command)$/',
		matches: { cmd: ["/^curl -k -s https:\\/\\/([A-Za-z0-9-]+\\.)*sandwichboard\\.ai\\/[A-Za-z0-9._~:\\/?#[\\]@!$&'()*+,;=%-]*$/"] },
		action: 'allow',
	},
]
const SETTINGS_PATH = join(homedir(), '.config', 'amp', 'settings.json')

let settingsCache: { mtimeMs: number; rules: Rule[] } | null = null
const turnIntents = new Map<string, TurnIntent>()

function loadUserRules(): Rule[] {
	if (!existsSync(SETTINGS_PATH)) {
		return []
	}
	const mtimeMs = statSync(SETTINGS_PATH).mtimeMs
	if (settingsCache && settingsCache.mtimeMs === mtimeMs) {
		return settingsCache.rules
	}
	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, unknown>
		const rules = (parsed['amp.permissions'] as Rule[] | undefined) ?? []
		settingsCache = { mtimeMs, rules }
		return rules
	} catch {
		settingsCache = { mtimeMs, rules: [] }
		return []
	}
}

export default function (amp: PluginAPI) {
	const titleStatuses = new ThreadTitleStatusManager(amp)
	installThreadWaitStatus(amp, titleStatuses)

	amp.on('agent.start', (event) => {
		turnIntents.set(event.thread.id, buildTurnIntent(event.message))
	})

	amp.on('agent.end', (event) => {
		turnIntents.delete(event.thread.id)
	})

	amp.on('tool.call', async (event, ctx): Promise<ToolCallResult> => {
		const cmd = amp.helpers.shellCommandFromToolCall(event)?.command
		const decision = classifyPermissionDecision(event.tool, cmd, turnIntents.get(event.thread.id))

		if (decision.action === 'allow') {
			return { action: 'allow' }
		}

		if (decision.action === 'reject') {
			return {
				action: 'reject-and-continue',
				message: `Rejected by permission rule (${decision.source}).`,
			}
		}

		// 'ask', 'delegate' (delegate not implemented), or no match: prompt the user.
		return await askUser(titleStatuses, ctx, event.thread.id, event.tool, cmd, decision)
	})
}

export function buildTurnIntent(message: string): TurnIntent {
	return {
		message,
		gitCommitRequested: isExplicitGitCommitRequest(message),
		gitLandingRequested: isExplicitGitLandingRequest(message),
	}
}

export function classifyPermissionDecision(tool: string, cmd: string | undefined, turnIntent?: TurnIntent): Decision {
	let decision = decide(loadUserRules(), BUILTIN_RULES, tool, cmd, turnIntent)

	// Even if the rule cascade allows, run heuristic tighteners on shell
	// commands so things like `sed -i`, `python -c`, `git worktree remove`,
	// or `local_psql.sh --write` still prompt.
	if (decision.action === 'allow' && cmd !== undefined) {
		const tightened = evaluateShellCommand(cmd)
		if (tightened.kind === 'ask') {
			decision = { action: 'ask', rule: null, source: 'default', reason: permissionReasonForCommand(cmd, tightened.reason) }
		}
	}

	return decision
}

export function decide(userRules: Rule[], builtinRules: Rule[], tool: string, cmd: string | undefined, turnIntent?: TurnIntent): Decision {
	if ((tool === 'Bash' || tool === 'shell_command') && cmd !== undefined && gitStagingOrCommitRequested(cmd)) {
		if (turnIntent?.gitCommitRequested) {
			return { action: 'allow', rule: null, source: 'custom' }
		}
		return { action: 'ask', rule: null, source: 'default' }
	}

	if ((tool === 'Bash' || tool === 'shell_command') && cmd !== undefined && turnIntent?.gitLandingRequested && gitLandingCommandRequested(cmd)) {
		return { action: 'allow', rule: null, source: 'custom' }
	}

	if ((tool === 'Bash' || tool === 'shell_command') && cmd !== undefined && turnIntent?.gitLandingRequested && worktreeLandingScriptRequested(cmd)) {
		return { action: 'allow', rule: null, source: 'custom' }
	}

	if ((tool === 'Bash' || tool === 'shell_command') && cmd !== undefined) {
		const segments = splitShellSegments(cmd)
		if (segments.length > 1) {
			// Multi-segment commands are evaluated per segment so that broad
			// globs like `aws * list-*` or `echo *` cannot match across `;`,
			// `\n`, `&&`, or `||` and smuggle a destructive segment through.
			let sawCustom = false
			let sawUser = false
			for (const segment of segments) {
				const segmentDecision = decideSingle(userRules, builtinRules, tool, segment)
				if (segmentDecision.action !== 'allow') {
					return segmentDecision
				}
				if (segmentDecision.source === 'custom') {
					sawCustom = true
				}
				if (segmentDecision.source === 'user') {
					sawUser = true
				}
			}
			return { action: 'allow', rule: null, source: sawCustom ? 'custom' : sawUser ? 'user' : 'builtin' }
		}
	}
	return decideSingle(userRules, builtinRules, tool, cmd)
}

function gitStagingOrCommitRequested(cmd: string): boolean {
	const segments = splitShellSegments(cmd)
	return segments.some((segment) => {
		const tokens = tokenizeSimpleShell(segment)
		const git = parseGitCommand(tokens)
		return git?.subcommand === 'add' || git?.subcommand === 'commit'
	})
}

function isExplicitGitCommitRequest(message: string): boolean {
	const normalized = message.trim().toLowerCase()
	return /\b(commit|committing|land|landing|ship|shipping)\b/.test(normalized)
		&& !/\b(do not|don't|dont|without|avoid|skip)\s+(?:git\s+)?commit\b/.test(normalized)
}

function isExplicitGitLandingRequest(message: string): boolean {
	const normalized = message.trim().toLowerCase()
	return /\b(land|landing|ship|shipping|confirmed|confirm|approved|approve|yes|go ahead)\b/.test(normalized)
		&& !/\b(do not|don't|dont|without|avoid|skip)\s+(?:land|landing|ship|shipping|push|merge|cleanup|clean up)\b/.test(normalized)
}

function gitLandingCommandRequested(cmd: string): boolean {
	const segments = splitShellSegments(cmd)
	return segments.some((segment) => {
		const tokens = tokenizeSimpleShell(segment)
		const git = parseGitCommand(tokens)
		if (!git) {
			return false
		}
		if (git.subcommand === 'push' || git.subcommand === 'pull' || git.subcommand === 'fetch' || git.subcommand === 'rebase' || git.subcommand === 'merge' || git.subcommand === 'checkout') {
			return true
		}
		return git.subcommand === 'worktree' && git.args[0] === 'remove'
	})
}

function worktreeLandingScriptRequested(cmd: string): boolean {
	const segments = splitShellSegments(cmd)
	return segments.some((segment) => {
		const tokens = tokenizeSimpleShell(segment)
		const script = tokens[0]
		return script === '~/photoop-product/scripts/worktree-land.sh'
			|| script === '/home/ec2-user/photoop-product/scripts/worktree-land.sh'
			|| script === '~/SandwichBoard/scripts/worktree-land.sh'
			|| script === '/home/ec2-user/SandwichBoard/scripts/worktree-land.sh'
	})
}

function tokenizeSimpleShell(segment: string): string[] {
	const tokens: string[] = []
	let current = ''
	let quote: 'single' | 'double' | null = null
	let escaped = false

	for (const char of segment) {
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

function parseGitCommand(tokens: string[]): { subcommand: string; args: string[] } | null {
	let index = 0
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
		index += 1
	}
	if (tokens[index] !== 'git') {
		return null
	}
	index += 1
	while (index < tokens.length) {
		const token = tokens[index]
		if (token === '-C' || token === '-c') {
			index += 2
			continue
		}
		if (token.startsWith('-')) {
			index += 1
			continue
		}
		return { subcommand: token, args: tokens.slice(index + 1) }
	}
	return null
}

function decideSingle(userRules: Rule[], builtinRules: Rule[], tool: string, cmd: string | undefined): Decision {
	const normalizedCmd = cmd === undefined ? cmd : stripEnvPrefix(cmd)
	for (const rule of CUSTOM_RULES) {
		if (ruleMatches(rule, tool, normalizedCmd)) {
			return { action: rule.action, rule, source: 'custom' }
		}
	}
	for (const rule of userRules) {
		if (ruleMatches(rule, tool, normalizedCmd)) {
			return { action: rule.action, rule, source: 'user' }
		}
	}
	for (const rule of builtinRules) {
		if (ruleMatches(rule, tool, normalizedCmd)) {
			return { action: rule.action, rule, source: 'builtin' }
		}
	}
	return { action: 'ask', rule: null, source: 'default' }
}

// Strip leading shell env-var assignments (e.g. `AWS_PROFILE=photoop FOO="a b"`)
// so a rule like `aws * list-*` can match `AWS_PROFILE=photoop aws iam list-...`
// without forcing every rule to spell out env-prefix variants.
export function stripEnvPrefix(segment: string): string {
	return segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '')
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
	// Single pipe `|` separates commands in a pipeline. Each side must be
	// independently allowed, otherwise things like `aws ... | rm -rf /` would
	// slip through the user's `aws * describe-*` allow.
	if (char === '|' && next !== '|') {
		// Skip cases where `|` is part of a redirect like `>|` or `<|`.
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

function ruleMatches(rule: Rule, tool: string, cmd: string | undefined): boolean {
	if (!patternMatches(rule.tool, tool)) {
		return false
	}
	const cmdPatterns = rule.matches?.cmd ?? rule.matches?.command
	if (cmdPatterns === undefined) {
		return true
	}
	if (cmd === undefined) {
		return false
	}
	const patterns = Array.isArray(cmdPatterns) ? cmdPatterns : [cmdPatterns]
	return patterns.some((pattern) => patternMatches(pattern, cmd))
}

function patternMatches(pattern: string, value: string): boolean {
	return compilePattern(pattern).test(value)
}

const PATTERN_CACHE = new Map<string, RegExp>()

function compilePattern(pattern: string): RegExp {
	const cached = PATTERN_CACHE.get(pattern)
	if (cached) {
		return cached
	}
	const compiled = pattern.length > 1 && pattern.startsWith('/') && pattern.endsWith('/') ? new RegExp(pattern.slice(1, -1)) : globToRegExp(pattern)
	PATTERN_CACHE.set(pattern, compiled)
	return compiled
}

function globToRegExp(pattern: string): RegExp {
	let source = '^'
	for (const char of pattern) {
		if (char === '*') {
			source += '[\\s\\S]*'
			continue
		}
		source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
	}
	source += '$'
	return new RegExp(source)
}

async function askUser(
	titleStatuses: ThreadTitleStatusManager,
	ctx: Parameters<Parameters<PluginAPI['on']>[1]>[1],
	threadID: ThreadID,
	tool: string,
	cmd: string | undefined,
	decision: Decision,
): Promise<ToolCallResult> {
	const reasonLines = [
		`Tool: ${tool}`,
		cmd ? `Command:\n${cmd}` : null,
		`Source: ${decision.source}${decision.rule ? ` (action=${decision.rule.action})` : ''}`,
		decision.reason ? `Reason:\n${decision.reason}` : null,
	].filter(Boolean) as string[]

	titleStatuses.set(ctx.thread, threadID, THREAD_TITLE_STATUSES.permissions.id)
	try {
		const approved = await retryOnUITimeout(() => ctx.ui.confirm({
			title: `Approve ${tool}?`,
			message: reasonLines.join('\n\n'),
			confirmButtonText: 'Allow',
		}))
		if (approved) {
			return { action: 'allow' }
		}

		let rejectionComment: string | undefined
		try {
			rejectionComment = await retryOnUITimeout(() => ctx.ui.input({
				title: `Why reject ${tool}?`,
				helpText: 'Optional. This feedback will be returned to the agent so it can adjust its next step.',
				submitButtonText: 'Reject',
			}))
		} catch {
			// If the follow-up input is unavailable, still reject the original
			// tool call rather than losing the user's denial.
		}

		const trimmedComment = rejectionComment?.trim()
		return {
			action: 'reject-and-continue',
			message: trimmedComment
				? `User rejected the tool call via custom permissions plugin.${decision.reason ? `\n\nPermission reason: ${decision.reason}` : ''}\n\nUser feedback: ${trimmedComment}`
				: `User rejected the tool call via custom permissions plugin.${decision.reason ? `\n\nPermission reason: ${decision.reason}` : ''}`,
		}
	} catch (error) {
		return {
			action: 'reject-and-continue',
			message: `Plugin UI unavailable; rejecting ${tool} per safe-by-default policy.${decision.reason ? `\n\nPermission reason: ${decision.reason}` : ''}`,
		}
	} finally {
		titleStatuses.clear(ctx.thread, threadID, THREAD_TITLE_STATUSES.permissions.id)
	}
}

async function retryOnUITimeout<T>(operation: () => Promise<T>): Promise<T> {
	while (true) {
		try {
			return await operation()
		} catch (error) {
			if (isUITimeoutError(error)) {
				continue
			}
			throw error
		}
	}
}

export function isUITimeoutError(error: unknown): boolean {
	const name = error instanceof Error ? error.name : ''
	const message = error instanceof Error ? error.message : String(error)
	return /timeout|timed out|deadline/i.test(`${name}\n${message}`)
}

export function permissionReasonForCommand(command: string, reason: string): string {
	if (/backtick/i.test(reason) && looksLikeSearchCommandWithDoubleQuotedBackticks(command)) {
		return `${reason} This looks like a literal search pattern containing backticks; retry with single quotes around the rg/grep pattern, or escape the backticks.`
	}
	return reason
}

function looksLikeSearchCommandWithDoubleQuotedBackticks(command: string): boolean {
	return /(?:^|[;&|\n]\s*)(?:rg|grep|egrep|fgrep)\b/.test(command)
		&& /"[^"`]*`[^"`]*`?[^"`]*"/.test(command)
}
